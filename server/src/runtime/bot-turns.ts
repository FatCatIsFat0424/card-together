import { getPresentationEndsAt } from '@shared/game-presentation';
import type { AnyGameState, RoomCode, Seat } from '@shared/types';
import { getBotAction, type BotAction } from '../bots/bot-decisions';
import * as gameManager from '../managers/game-manager';
import * as roomManager from '../managers/room-manager';
import type { RuntimeCoordinator } from './coordinator';

export const BOT_ACTION_DELAY_MS = 650;

interface BotTurn {
  readonly seat: Seat;
  readonly key: string;
}

function pendingTurn(game: AnyGameState): BotTurn | null {
  if (roomManager.getRoomInfo(game.roomCode)?.status !== 'playing' || game.phase === 'scoring') return null;
  // The existing durable forced-pass scheduler owns these turns, including bot seats.
  if (game.gameType === 'bigtwo' && game.pendingAutoPass) return null;
  const seat = game.gameType !== 'bridge' ? game.currentTurnSeat
    : game.phase === 'redeal_pending' ? game.redealPendingSeat
    : game.phase === 'bidding' ? game.bidding?.currentBidderSeat
    : game.phase === 'playing' ? game.playing?.currentTurnSeat : null;
  if (!seat || !game.players[seat].isBot) return null;
  return { seat, key: `${game.id}:${game.phase}:${game.log.length}:${seat}` };
}

function applyAction(code: RoomCode, seat: Seat, action: BotAction): { success: boolean; reason?: string } {
  switch (action.type) {
    case 'bridge-redeal': return gameManager.handleRedealResponse(code, seat, action.accept);
    case 'bridge-bid': return gameManager.handleBid(code, seat, action.action);
    case 'bridge-play': return gameManager.handlePlayCard(code, seat, action.card);
    case 'bigtwo-play': return gameManager.handleBigTwoPlay(code, seat, action.cards);
    case 'bigtwo-pass': return gameManager.handleBigTwoPass(code, seat);
    case 'redpoints-play': return gameManager.handleRedPointsPlay(code, seat, action.card, action.capture);
    case 'redpoints-flip': return gameManager.handleRedPointsChooseFlip(code, seat, action.capture);
    case 'ninetynine-play': return gameManager.handleNinetyNinePlay(code, seat, action.card, action.choice, action.target);
  }
}

/** Rebuild timers from committed turns; bots use the same private view and rules as humans. */
export function startBotTurns(runtime: RuntimeCoordinator, publish: (code: RoomCode) => void): () => void {
  let stopped = false;
  const scheduled = new Map<RoomCode, { key: string; timer: ReturnType<typeof setTimeout> }>();

  function reconcile(retryDelay = 0): void {
    if (stopped) return;
    const games = gameManager.exportGames();
    for (const [code, job] of scheduled) {
      const game = games.find((entry) => entry.roomCode === code);
      if (!game || pendingTurn(game)?.key !== job.key) {
        clearTimeout(job.timer);
        scheduled.delete(code);
      }
    }
    for (const game of games) {
      const turn = pendingTurn(game);
      if (!turn || scheduled.has(game.roomCode)) continue;
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
          const visible = gameManager.getPlayerVisibleState(code, turn.seat);
          const action = visible && getBotAction(visible);
          if (!action) throw new Error('No legal bot action for the pending turn.');
          const result = applyAction(code, turn.seat, action);
          if (!result.success) throw new Error(result.reason ?? 'Bot action rejected.');
          changed = true;
        }, { skipUnchanged: true, afterCommit: () => {
          if (changed && !stopped) publish(code);
        } }).catch((error: unknown) => {
          console.error('[runtime] Unable to commit bot action:', error);
          reconcile(1000);
        });
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
  };
}
