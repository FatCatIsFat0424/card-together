import { gamePlayer } from '@shared/rules/seats';
import { getPresentationEndsAt } from '@shared/game-presentation';
import type { AnyGameState, RoomCode, GameSeat } from '@shared/types';
import { getBotAction } from '../bots/bot-decisions';
import { gameBot } from '../bots/bot-registry';
import { seedFromText } from '../bots/search/seeded-random';
import type { SearchBotSpec, SearchOutcome, SearchRunner } from '../bots/search/search-types';
import * as gameManager from '../managers/game-manager';
import * as roomManager from '../managers/room-manager';
import { getTurnSeat } from '../managers/game-clock';
import { createFailureTracker, performAutomatedTurn } from './automated-action';
import type { RuntimeCoordinator, RuntimeMutationOptions } from './coordinator';

export const BOT_ACTION_DELAY_MS = 650;

interface BotTurn {
  readonly seat: GameSeat;
  readonly key: string;
}

function pendingTurn(game: AnyGameState): BotTurn | null {
  if (roomManager.getRoomInfo(game.roomCode)?.status !== 'playing' || game.phase === 'scoring') return null;
  // A separate durable scheduler owns forced turns, including bot seats.
  if (gameManager.isForcedActionPending(game)) return null;
  const automated = (seat: GameSeat): boolean => Boolean(gamePlayer(game, seat)?.isBot || game.autoPlaySeats?.includes(seat));
  // Simultaneous decisions are submitted one bot at a time, each after its own thinking delay.
  const owing = gameManager.getOwingSeats(game);
  const seat = owing ? owing.find(automated) : getTurnSeat(game);
  if (!seat || !automated(seat)) return null;
  return { seat, key: `${game.id}:${game.phase}:${game.log.length}:${seat}` };
}

/**
 * Rebuild timers from committed turns; bots use the same private view and rules as humans.
 *
 * A hard bot whose game declares `search` decides in the worker pool: the view is taken inside the
 * runtime queue, the search runs off the event loop, and the result is applied in a second queued
 * mutation only if the same turn is still pending. Without a pool, or when the search does not
 * produce an action, the easy strategy decides instead.
 */
export function startBotTurns(
  runtime: RuntimeCoordinator, publish: (code: RoomCode) => void, pool?: SearchRunner,
): () => void {
  let stopped = false;
  const scheduled = new Map<RoomCode, { key: string; timer: ReturnType<typeof setTimeout> }>();
  const searching = new Map<RoomCode, { key: string; controller: AbortController }>();
  const failures = createFailureTracker();

  /** Publishes after the commit; `applied` tells whether the mutation changed anything. */
  function commitOptions(code: RoomCode, applied: () => boolean): RuntimeMutationOptions {
    return { skipUnchanged: true, afterCommit: () => {
      failures.clear(code);
      if (applied() && !stopped) publish(code);
    } };
  }

  function commitFailed(code: RoomCode, key: string, error: unknown): void {
    const count = failures.fail(code, key);
    console.error(`[runtime] Unable to commit bot action (attempt ${count}):`, error);
    reconcile(1000);
  }

  function finishSearch(code: RoomCode, turn: BotTurn, controller: AbortController, outcome: SearchOutcome): void {
    if (searching.get(code)?.controller === controller) searching.delete(code);
    if (stopped || controller.signal.aborted) return;
    if (outcome.status !== 'ok') {
      console.warn(`[bots] Search for ${code}/${turn.seat} ended as ${outcome.status}; using the easy strategy.`,
        outcome.reason ?? '');
    }
    let changed = false;
    void runtime.mutate(() => {
      const current = gameManager.getGameState(code);
      // A newer state means this result answers a question that is no longer asked.
      if (!current || pendingTurn(current)?.key !== turn.key || gameManager.isPresentationActive(code)) return;
      performAutomatedTurn(code, turn.seat, failures.count(code, turn.key),
        (visible) => (outcome.status === 'ok' && outcome.action) || getBotAction(visible, Math.random, 'easy'));
      changed = true;
    }, commitOptions(code, () => changed)).catch((error: unknown) => commitFailed(code, turn.key, error));
  }

  /** Starts the pool search for a turn; false means the caller decides synchronously. */
  function startSearch(code: RoomCode, turn: BotTurn, spec: SearchBotSpec): boolean {
    const visible = pool && gameManager.getPlayerVisibleState(code, turn.seat);
    if (!pool || !visible) return false;
    const controller = new AbortController();
    searching.set(code, { key: turn.key, controller });
    void pool.run({
      strategy: spec.strategy, visible, budgetMs: spec.budgetMs, maxDepth: spec.maxDepth, seed: seedFromText(turn.key),
    }, controller.signal).then((outcome) => finishSearch(code, turn, controller, outcome));
    return true;
  }

  function reconcile(retryDelay = 0): void {
    if (stopped) return;
    const games = gameManager.exportGames();
    for (const [code, job] of scheduled) {
      const game = gameManager.getGameState(code);
      if (!game || pendingTurn(game)?.key !== job.key) {
        clearTimeout(job.timer);
        scheduled.delete(code);
      }
    }
    for (const [code, job] of searching) {
      const game = gameManager.getGameState(code);
      if (!game || pendingTurn(game)?.key !== job.key) {
        job.controller.abort();
        searching.delete(code);
      }
    }
    for (const game of games) {
      const turn = pendingTurn(game);
      if (!turn || scheduled.has(game.roomCode) || searching.has(game.roomCode)) continue;
      const code = game.roomCode;
      const delay = Math.min(2_147_483_647, Math.max(retryDelay,
        getPresentationEndsAt(game) - Date.now() + BOT_ACTION_DELAY_MS, BOT_ACTION_DELAY_MS));
      const timer = setTimeout(() => {
        let changed = false;
        void runtime.mutate(() => {
          if (scheduled.get(code)?.key === turn.key) scheduled.delete(code);
          if (stopped) return;
          const current = gameManager.getGameState(code);
          if (!current || pendingTurn(current)?.key !== turn.key || gameManager.isPresentationActive(code)) return;
          const configured = gamePlayer(current, turn.seat)?.botDifficulty ?? 'hard';
          const spec = configured === 'hard' ? gameBot(current.gameType).search : undefined;
          if (spec && failures.count(code, turn.key) === 0 && startSearch(code, turn, spec)) return;
          // A search game's hard strategy is only the cheap timeout move; its bot turns fall back to easy.
          const difficulty = spec ? 'easy' : configured;
          performAutomatedTurn(code, turn.seat, failures.count(code, turn.key),
            (visible) => getBotAction(visible, Math.random, difficulty));
          changed = true;
        }, commitOptions(code, () => changed)).catch((error: unknown) => commitFailed(code, turn.key, error));
      }, delay);
      timer.unref();
      scheduled.set(code, { key: turn.key, timer });
    }
  }

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
