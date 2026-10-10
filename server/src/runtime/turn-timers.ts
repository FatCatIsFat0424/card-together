import type { AnyGameState, GameClock, RoomCode } from '@shared/types';
import { getBotAction } from '../bots/bot-decisions';
import * as gameManager from '../managers/game-manager';
import * as roomManager from '../managers/room-manager';
import { createFailureTracker, holdemPassiveAction, performAutomatedTurn } from './automated-action';
import type { RuntimeCoordinator } from './coordinator';

type Turn = NonNullable<GameClock['turn']>;

function pendingTurn(game: AnyGameState): Turn | null {
  const turn = game.clock?.turn;
  return turn && game.phase !== 'scoring' && !game.players[turn.seat].isBot
    && roomManager.getRoomInfo(game.roomCode)?.status === 'playing'
    && !(game.gameType === 'bigtwo' && game.pendingAutoPass) ? turn : null;
}

/** Restore durable deadlines; each expiry performs only the currently committed decision. */
export async function startTurnTimers(
  runtime: RuntimeCoordinator, publish: (code: RoomCode) => void,
): Promise<() => void> {
  let stopped = false;
  const scheduled = new Map<RoomCode, { gameId: string; turnId: string; timer: ReturnType<typeof setTimeout> }>();
  const failures = createFailureTracker();

  function reconcile(retryDelay = 0): void {
    if (stopped) return;
    const games = gameManager.exportGames();
    for (const [code, job] of scheduled) {
      const game = games.find((entry) => entry.roomCode === code);
      if (!game || game.id !== job.gameId || pendingTurn(game)?.id !== job.turnId) {
        clearTimeout(job.timer);
        scheduled.delete(code);
      }
    }
    for (const game of games) {
      const turn = pendingTurn(game);
      if (!turn || scheduled.has(game.roomCode)) continue;
      const code = game.roomCode;
      const timer = setTimeout(() => {
        let changed = false;
        void runtime.mutate(() => {
          if (scheduled.get(code)?.turnId === turn.id) scheduled.delete(code);
          if (stopped) return;
          const current = gameManager.getGameState(code);
          const pending = current && pendingTurn(current);
          if (!current || current.id !== game.id || pending?.id !== turn.id
            || Date.now() < pending.deadline || gameManager.isPresentationActive(code)) return;
          // A Hold'em player who runs out of time checks or folds rather than letting a bot stake their chips.
          performAutomatedTurn(code, turn.seat, failures.count(code, turn.id), (visible) => visible.gameType === 'holdem'
            ? holdemPassiveAction(visible) : getBotAction(visible));
          if (current.clock && gameManager.getGameState(code) === current) current.clock = { ...current.clock,
            lastTimeout: { seat: turn.seat, at: Date.now() } };
          changed = true;
        }, { skipUnchanged: true, afterCommit: () => {
          failures.clear(code);
          if (changed && !stopped) publish(code);
        } }).catch((error: unknown) => {
          const count = failures.fail(code, turn.id);
          console.error(`[runtime] Unable to commit expired turn (attempt ${count}):`, error);
          reconcile(1000);
        });
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
  };
}
