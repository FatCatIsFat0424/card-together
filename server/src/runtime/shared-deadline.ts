import { BJ_MIN_BET } from '@shared/rules/blackjack';
import type { PlayerVisibleGameState, RoomCode, Seat } from '@shared/types';
import { getBotAction } from '../bots/bot-decisions';
import type { BotAction } from '../bots/bot-decisions';
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
  if (game.gameType === 'chinesepoker' && game.phase === 'arranging') {
    return { key: `${game.id}:arrange`, gameId: game.id, deadline: game.arrangeDeadline };
  }
  if (game.gameType === 'blackjack' && game.phase === 'betting' && game.betDeadline !== null) {
    return { key: `${game.id}:bet:${game.hand}`, gameId: game.id, deadline: game.betDeadline };
  }
  return null;
}

function overdueSeats(code: RoomCode, gameId: string): Seat[] {
  return gameManager.getGameState(code)?.gameType === 'blackjack'
    ? gameManager.overdueBlackjackSeats(code, gameId)
    : gameManager.overdueChinesePokerSeats(code, gameId);
}

/** Bots keep their own decision; a human who missed the betting window stakes the minimum. */
function expiredAction(code: RoomCode, seat: Seat, visible: PlayerVisibleGameState): BotAction | null {
  if (visible.gameType === 'blackjack' && !gameManager.getGameState(code)?.players[seat].isBot) {
    return { type: 'blackjack-bet', amount: BJ_MIN_BET };
  }
  return getBotAction(visible);
}

/**
 * Chinese Poker arrangements and Blackjack bets share one durable deadline per window; at expiry
 * every missing decision is made from that seat's own filtered view in a single committed change.
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
          for (const seat of overdueSeats(code, pending.gameId)) {
            // A stuck seat may abort the game; later seats must then stop.
            if (pendingDeadline(code)?.key !== pending.key) break;
            performAutomatedTurn(code, seat, failures.count(code, key), (visible) => expiredAction(code, seat, visible));
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
