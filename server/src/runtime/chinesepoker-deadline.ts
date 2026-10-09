import type { RoomCode } from '@shared/types';
import { getBotAction } from '../bots/bot-decisions';
import * as gameManager from '../managers/game-manager';
import * as roomManager from '../managers/room-manager';
import { createFailureTracker, performAutomatedTurn } from './automated-action';
import type { RuntimeCoordinator } from './coordinator';

interface PendingDeadline {
  readonly gameId: string;
  readonly deadline: number;
}

function pendingDeadline(code: RoomCode): PendingDeadline | null {
  const game = gameManager.getGameState(code);
  return game?.gameType === 'chinesepoker' && game.phase === 'arranging'
    && roomManager.getRoomInfo(code)?.status === 'playing'
    ? { gameId: game.id, deadline: game.arrangeDeadline } : null;
}

/**
 * Chinese Poker seats share one durable deadline; at expiry every missing arrangement is made
 * from that seat's own filtered view in a single committed change.
 */
export function startChinesePokerDeadlines(
  runtime: RuntimeCoordinator, publish: (code: RoomCode) => void,
): () => void {
  let stopped = false;
  const scheduled = new Map<RoomCode, { gameId: string; timer: ReturnType<typeof setTimeout> }>();
  const failures = createFailureTracker();

  function reconcile(retryDelay = 0): void {
    if (stopped) return;
    for (const [code, job] of scheduled) {
      if (pendingDeadline(code)?.gameId !== job.gameId) {
        clearTimeout(job.timer);
        scheduled.delete(code);
      }
    }
    for (const game of gameManager.exportGames()) {
      const code = game.roomCode;
      const pending = pendingDeadline(code);
      if (!pending || scheduled.has(code)) continue;
      const key = `${pending.gameId}:deadline`;
      const timer = setTimeout(() => {
        let changed = false;
        void runtime.mutate(() => {
          if (scheduled.get(code)?.gameId === pending.gameId) scheduled.delete(code);
          if (stopped || pendingDeadline(code)?.gameId !== pending.gameId) return;
          for (const seat of gameManager.overdueChinesePokerSeats(code, pending.gameId)) {
            // A stuck seat may abort the game; later seats must then stop.
            if (pendingDeadline(code)?.gameId !== pending.gameId) break;
            performAutomatedTurn(code, seat, failures.count(code, key), (visible) => getBotAction(visible));
            changed = true;
          }
        }, { skipUnchanged: true, afterCommit: () => {
          failures.clear(code);
          if (changed && !stopped) publish(code);
        } }).catch((error: unknown) => {
          const count = failures.fail(code, key);
          console.error(`[runtime] Unable to commit expired arrangements (attempt ${count}):`, error);
          reconcile(1000);
        });
      }, Math.min(2_147_483_647, Math.max(0, retryDelay, pending.deadline - Date.now())));
      timer.unref();
      scheduled.set(code, { gameId: pending.gameId, timer });
    }
  }

  const unsubscribe = runtime.subscribe(reconcile);
  reconcile();
  return (): void => {
    stopped = true;
    unsubscribe();
    for (const job of scheduled.values()) clearTimeout(job.timer);
    scheduled.clear();
  };
}
