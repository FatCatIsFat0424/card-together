import { gamePlayer } from '@shared/rules/seats';
import type { AnyGameState, GameClock, PlayerVisibleGameState, RoomCode } from '@shared/types';
import { getBotAction } from '../bots/bot-decisions';
import type { BotAction } from '../bots/bot-decisions';
import { gameBot } from '../bots/bot-registry';
import { seedFromText } from '../bots/search/seeded-random';
import type { SearchBotSpec, SearchOutcome, SearchRunner } from '../bots/search/search-types';
import * as gameManager from '../managers/game-manager';
import * as roomManager from '../managers/room-manager';
import { createFailureTracker, performAutomatedTurn } from './automated-action';
import type { RuntimeCoordinator, RuntimeMutationOptions } from './coordinator';

type Turn = NonNullable<GameClock['turn']>;

function pendingTurn(game: AnyGameState): Turn | null {
  const turn = game.clock?.turn;
  return turn && game.phase !== 'scoring' && !gamePlayer(game, turn.seat)?.isBot
    && roomManager.getRoomInfo(game.roomCode)?.status === 'playing'
    && !gameManager.isForcedActionPending(game) ? turn : null;
}

/**
 * A human whose turn clock expired gets the game's timeout rule, or else the bot's decision: the worker
 * pool's `searched` action when there is one, otherwise the synchronous strategy.
 */
function timeoutAction(visible: PlayerVisibleGameState, searched?: BotAction | null): BotAction | null {
  const strategy = (): BotAction | null => searched || getBotAction(visible);
  const timeout = gameBot(visible.gameType).turnTimeout;
  return timeout ? timeout(visible, { isBot: false, strategy }) : strategy();
}

/** Whether the game's timeout rule consults the bot at all, so that searching could change the outcome. */
function timeoutUsesBot(visible: PlayerVisibleGameState): boolean {
  const timeout = gameBot(visible.gameType).turnTimeout;
  if (!timeout) return true;
  let asked = false;
  timeout(visible, { isBot: false, strategy: () => { asked = true; return null; } });
  return asked;
}

/**
 * Restore durable deadlines; each expiry performs only the currently committed decision.
 *
 * In a game that declares `search`, an expired turn is decided like a bot's turn: the view is taken inside
 * the runtime queue, the search runs in the worker pool, and the result is applied in a second queued
 * mutation only if the same turn is still pending, so the move lands about one search budget after the
 * deadline. When the search fails or no pool runs, the synchronous strategy decides at the deadline. The
 * search lives only in memory; after a restart the expired deadline fires again and searches anew.
 */
export async function startTurnTimers(
  runtime: RuntimeCoordinator, publish: (code: RoomCode) => void, pool?: SearchRunner,
): Promise<() => void> {
  let stopped = false;
  const scheduled = new Map<RoomCode, { gameId: string; turnId: string; timer: ReturnType<typeof setTimeout> }>();
  const searching = new Map<RoomCode, { gameId: string; turnId: string; controller: AbortController }>();
  const failures = createFailureTracker();

  /** Publishes after the commit; `applied` tells whether the mutation changed anything. */
  function commitOptions(code: RoomCode, applied: () => boolean): RuntimeMutationOptions {
    return { skipUnchanged: true, afterCommit: () => {
      failures.clear(code);
      if (applied() && !stopped) publish(code);
    } };
  }

  function commitFailed(code: RoomCode, turnId: string, error: unknown): void {
    const count = failures.fail(code, turnId);
    console.error(`[runtime] Unable to commit expired turn (attempt ${count}):`, error);
    reconcile(1000);
  }

  /** The expired turn still waits on the same human and nothing is being presented. */
  function stillExpired(code: RoomCode, gameId: string, turnId: string): AnyGameState | null {
    const current = gameManager.getGameState(code);
    const pending = current && pendingTurn(current);
    return current && current.id === gameId && pending?.id === turnId && Date.now() >= pending.deadline
      && !gameManager.isPresentationActive(code) ? current : null;
  }

  /** Inside a mutation: decides the expired turn, then marks the timeout on the clock. */
  function performTimeout(
    code: RoomCode, current: AnyGameState, turn: Turn, choose: (visible: PlayerVisibleGameState) => BotAction | null,
  ): void {
    performAutomatedTurn(code, turn.seat, failures.count(code, turn.id), choose);
    if (current.clock && gameManager.getGameState(code) === current) current.clock = { ...current.clock,
      lastTimeout: { seat: turn.seat, at: Date.now() } };
  }

  function finishSearch(
    code: RoomCode, gameId: string, turn: Turn, controller: AbortController, outcome: SearchOutcome,
  ): void {
    if (searching.get(code)?.controller === controller) searching.delete(code);
    if (stopped || controller.signal.aborted) return;
    if (outcome.status !== 'ok') {
      console.warn(`[bots] Timeout search for ${code}/${turn.seat} ended as ${outcome.status}; using the synchronous strategy.`,
        outcome.reason ?? '');
    }
    const searched = outcome.status === 'ok' ? outcome.action : null;
    let changed = false;
    void runtime.mutate(() => {
      // A newer state means this result answers a question that is no longer asked.
      const current = stillExpired(code, gameId, turn.id);
      if (!current) return;
      performTimeout(code, current, turn, (visible) => timeoutAction(visible, searched));
      changed = true;
    }, commitOptions(code, () => changed)).catch((error: unknown) => commitFailed(code, turn.id, error));
  }

  /** Starts the pool search for an expired turn; false means the caller decides synchronously. */
  function startSearch(code: RoomCode, gameId: string, turn: Turn, spec: SearchBotSpec): boolean {
    const visible = pool && gameManager.getPlayerVisibleState(code, turn.seat);
    if (!pool || !visible || !timeoutUsesBot(visible)) return false;
    const controller = new AbortController();
    searching.set(code, { gameId, turnId: turn.id, controller });
    void pool.run({
      strategy: spec.strategy, visible, budgetMs: spec.budgetMs, maxDepth: spec.maxDepth,
      seed: seedFromText(`${gameId}:${turn.id}:timeout`),
    }, controller.signal).then((outcome) => finishSearch(code, gameId, turn, controller, outcome));
    return true;
  }

  function reconcile(retryDelay = 0): void {
    if (stopped) return;
    const games = gameManager.exportGames();
    for (const [code, job] of scheduled) {
      const game = gameManager.getGameState(code);
      if (!game || game.id !== job.gameId || pendingTurn(game)?.id !== job.turnId) {
        clearTimeout(job.timer);
        scheduled.delete(code);
      }
    }
    for (const [code, job] of searching) {
      const game = gameManager.getGameState(code);
      if (!game || game.id !== job.gameId || pendingTurn(game)?.id !== job.turnId) {
        job.controller.abort();
        searching.delete(code);
      }
    }
    for (const game of games) {
      const turn = pendingTurn(game);
      if (!turn || scheduled.has(game.roomCode) || searching.has(game.roomCode)) continue;
      const code = game.roomCode;
      const timer = setTimeout(() => {
        let changed = false;
        void runtime.mutate(() => {
          if (scheduled.get(code)?.turnId === turn.id) scheduled.delete(code);
          if (stopped) return;
          const current = stillExpired(code, game.id, turn.id);
          if (!current) return;
          const spec = gameBot(current.gameType).search;
          if (spec && failures.count(code, turn.id) === 0 && startSearch(code, game.id, turn, spec)) return;
          performTimeout(code, current, turn, (visible) => timeoutAction(visible));
          changed = true;
        }, commitOptions(code, () => changed)).catch((error: unknown) => commitFailed(code, turn.id, error));
      }, Math.min(2_147_483_647, Math.max(0, retryDelay, turn.deadline - Date.now())));
      timer.unref();
      scheduled.set(code, { gameId: game.id, turnId: turn.id, timer });
    }
  }

  // Upgrade legacy games atomically before exposing any timeout scheduling.
  await runtime.mutate(() => {
    for (const game of gameManager.exportGames()) {
      gameManager.initializeClock(game.roomCode, roomManager.getRoomInfo(game.roomCode)?.timeControl);
    }
  }, { skipUnchanged: true });
  const unsubscribe = runtime.subscribe(reconcile);
  reconcile();
  return (): void => {
    stopped = true;
    unsubscribe();
    for (const job of scheduled.values()) clearTimeout(job.timer);
    scheduled.clear();
    for (const job of searching.values()) job.controller.abort();
    searching.clear();
  };
}
