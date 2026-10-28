import type { RoomCode } from '@shared/types';
import * as gameManager from '../managers/game-manager';
import { gameAdapter } from '../managers/games/registry';
import type { RuntimeCoordinator } from './coordinator';

interface ScheduledPass {
  readonly gameId: string;
  readonly pendingId: string;
  readonly timer: ReturnType<typeof setTimeout>;
}

/** Timers wake the durable runtime queue; only a committed PASS becomes public. */
export async function startBigTwoAutoPass(
  runtime: RuntimeCoordinator,
  publish: (roomCode: RoomCode) => void,
): Promise<() => void> {
  let stopped = false;
  const scheduled = new Map<RoomCode, ScheduledPass>();

  function reconcile(retryDelay = 0): void {
    if (stopped) return;
    const games = gameAdapter('bigtwo').exportGames();
    for (const [roomCode, job] of scheduled) {
      const game = games.find((entry) => entry.roomCode === roomCode);
      if (game?.id !== job.gameId || game.pendingAutoPass?.id !== job.pendingId) {
        clearTimeout(job.timer);
        scheduled.delete(roomCode);
      }
    }
    for (const game of games) {
      const pending = game.pendingAutoPass;
      if (!pending || scheduled.has(game.roomCode)) continue;
      const timer = setTimeout(() => {
        scheduled.delete(game.roomCode);
        let changed = false;
        void runtime.mutate(() => {
          if (stopped) return;
          changed = gameManager.handlePendingAutoPass(game.roomCode, game.id, pending.id).success;
        }, { skipUnchanged: true, afterCommit: () => {
          if (changed && !stopped) publish(game.roomCode);
        } }).catch((error: unknown) => {
          console.error('[runtime] Unable to commit automatic pass:', error);
          reconcile(1000);
        });
      }, Math.min(2_147_483_647, Math.max(retryDelay, pending.executeAt - Date.now(), 0)));
      timer.unref();
      scheduled.set(game.roomCode, { gameId: game.id, pendingId: pending.id, timer });
    }
  }

  // Legacy records need a single durable sample before any timer is installed.
  await runtime.mutate(() => gameManager.preparePendingAutoPasses(), { skipUnchanged: true });
  const unsubscribe = runtime.subscribe(reconcile);
  reconcile();
  return (): void => {
    stopped = true;
    unsubscribe();
    for (const job of scheduled.values()) clearTimeout(job.timer);
    scheduled.clear();
  };
}
