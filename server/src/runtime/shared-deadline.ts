import type { PlayerVisibleGameState, RoomCode } from '@shared/types';
import { getBotAction } from '../bots/bot-decisions';
import type { BotAction } from '../bots/bot-decisions';
import { gameBot } from '../bots/bot-registry';
import * as gameManager from '../managers/game-manager';
import * as roomManager from '../managers/room-manager';
import { createFailureTracker, performAutomatedTurn } from './automated-action';
import type { RuntimeCoordinator } from './coordinator';

interface PendingDeadline {
  /** Identifies one shared window, so a later Blackjack hand schedules a fresh timer */
  readonly key: string;
  readonly gameId: string;
  readonly deadline: number;
}

function pendingDeadline(code: RoomCode): PendingDeadline | null {
  const game = gameManager.getGameState(code);
  if (!game || roomManager.getRoomInfo(code)?.status !== 'playing') return null;
  const window = gameManager.getSharedDeadlineWindow(game);
  return window && { key: window.key, gameId: game.id, deadline: window.deadline };
}

/** A seat that missed the deadline gets the game's expiry default, or else the hard strategy. */
function expiredAction(visible: PlayerVisibleGameState, isBot: boolean): BotAction | null {
  const strategy = (): BotAction | null => getBotAction(visible);
  const expired = gameBot(visible.gameType).deadlineExpired;
  return expired ? expired(visible, { isBot, strategy }) : strategy();
}

/**
 * Chinese Poker arrangements, Blackjack bets, and Napoleon discard reviews share one durable
 * deadline per window; at expiry every missing decision is made from that seat's own filtered view
 * in a single committed change.
 */
export function startSharedDeadlines(
  runtime: RuntimeCoordinator, publish: (code: RoomCode) => void,
): () => void {
  let stopped = false;
  const scheduled = new Map<RoomCode, { key: string; timer: ReturnType<typeof setTimeout> }>();
  const failures = createFailureTracker();

  function reconcile(retryDelay = 0): void {
    if (stopped) return;
    for (const [code, job] of scheduled) {
      if (pendingDeadline(code)?.key !== job.key) {
        clearTimeout(job.timer);
        scheduled.delete(code);
      }
    }
    for (const game of gameManager.exportGames()) {
      const code = game.roomCode;
      const pending = pendingDeadline(code);
      if (!pending || scheduled.has(code)) continue;
      const key = `${pending.key}:deadline`;
      const timer = setTimeout(() => {
        let changed = false;
        void runtime.mutate(() => {
          if (scheduled.get(code)?.key === pending.key) scheduled.delete(code);
          if (stopped || pendingDeadline(code)?.key !== pending.key) return;
          for (const seat of gameManager.overdueSharedDeadlineSeats(code, pending.gameId)) {
            // A stuck seat may abort the game; later seats must then stop.
            if (pendingDeadline(code)?.key !== pending.key) break;
            const isBot = Boolean(roomManager.getSeatPlayers(code)?.[seat]?.isBot);
            performAutomatedTurn(code, seat, failures.count(code, key), (visible) => expiredAction(visible, isBot));
            changed = true;
          }
        }, { skipUnchanged: true, afterCommit: () => {
          failures.clear(code);
          if (changed && !stopped) publish(code);
        } }).catch((error: unknown) => {
          const count = failures.fail(code, key);
          console.error(`[runtime] Unable to commit expired decisions (attempt ${count}):`, error);
          reconcile(1000);
        });
      }, Math.min(2_147_483_647, Math.max(0, retryDelay, pending.deadline - Date.now())));
      timer.unref();
      scheduled.set(code, { key: pending.key, timer });
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
