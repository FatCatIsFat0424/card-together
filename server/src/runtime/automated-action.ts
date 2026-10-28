import { isCompassSeat } from '@shared/rules/seats';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import type { PlayerInfo, PlayerVisibleGameState, RoomCode, GameSeat, Seat } from '@shared/types';
import type { BotAction } from '../bots/bot-decisions';
import { gameBot } from '../bots/bot-registry';
import * as chatManager from '../managers/chat-manager';
import * as gameManager from '../managers/game-manager';
import * as roomManager from '../managers/room-manager';

/** Consecutive failed attempts for one turn before the scheduler stops asking the strategy. */
export const MAX_AUTOMATED_FAILURES = 3;

/** Client i18n key for the chat line shown when a stuck game is aborted. */
export const AUTOMATED_ABORT_MESSAGE = 'game.automatedAborted';

export function applyAutomatedAction(code: RoomCode, seat: GameSeat, action: BotAction): { success: boolean; reason?: string } {
  if (action.type === 'game-action') return gameManager.handleGameAction(code, seat, action.request, true);
  if (!isCompassSeat(seat) && !['ninetynine-play', 'blackjack-bet', 'blackjack-action', 'blackjack-dealer', 'holdem-action',
    'napoleon-action'].includes(action.type)) {
    return { success: false, reason: 'This action requires a compass seat.' };
  }
  const compass = seat as Seat;
  switch (action.type) {
    case 'bridge-redeal': return gameManager.handleRedealResponse(code, compass, action.accept, true);
    case 'bridge-bid': return gameManager.handleBid(code, compass, action.action, true);
    case 'bridge-play': return gameManager.handlePlayCard(code, compass, action.card, true);
    case 'bigtwo-play': return gameManager.handleBigTwoPlay(code, compass, action.cards, true);
    case 'bigtwo-pass': return gameManager.handleBigTwoPass(code, compass, true);
    case 'redpoints-play': return gameManager.handleRedPointsPlay(code, compass, action.card, action.capture, true);
    case 'redpoints-flip': return gameManager.handleRedPointsChooseFlip(code, compass, action.capture, true);
    case 'ninetynine-play': return gameManager.handleNinetyNinePlay(code, seat, action.card, action.choice, action.target, true);
    case 'sevens-play': return gameManager.handleSevensPlay(code, compass, action.card, true);
    case 'sevens-cover': return gameManager.handleSevensCover(code, compass, action.card, true);
    case 'chinesepoker-arrange': return gameManager.handleChinesePokerArrange(code, compass, action.arrangement, true);
    case 'liarsdeck-play': return gameManager.handleLiarsDeckPlay(code, compass, action.cardIds, true);
    case 'liarsdeck-challenge': return gameManager.handleLiarsDeckChallenge(code, compass, true);
    case 'blackjack-bet': return gameManager.handleBlackjackBet(code, seat, action.amount, true);
    case 'blackjack-action': return gameManager.handleBlackjackAction(code, seat, action.action, true);
    case 'blackjack-dealer': return gameManager.handleBlackjackDealerAction(code, seat, action.action, true);
    case 'holdem-action': return gameManager.handleHoldemAction(code, seat, action.action, true);
    case 'napoleon-action': return gameManager.handleNapoleonAction(code, seat, action.action, true);
  }
}

/** A deliberately simple legal move used only after the strategy repeatedly fails. */
export function firstLegalAction(visible: PlayerVisibleGameState): BotAction | null {
  return visible.phase === 'scoring' ? null : gameBot(visible.gameType).firstLegal(visible);
}

/** Ends a game that cannot progress so the table is not retried forever. */
function abortStuckGame(code: RoomCode, seat: GameSeat): void {
  const players: Partial<Record<GameSeat, PlayerInfo>> | undefined = gameManager.getGameState(code)?.players;
  // Chat senders must be accounts, so a bot's stuck turn is reported about a human seat.
  const subject = players && [players[seat], ...SEAT_ORDER_CLOCKWISE.map((other) => players[other])]
    .find((player) => player && !player.isBot);
  gameManager.abortGame(code);
  roomManager.setRoomStatus(code, 'waiting');
  roomManager.resetAllReady(code);
  if (subject) chatManager.addSystemMessage(code, subject, AUTOMATED_ABORT_MESSAGE);
}

/**
 * Applies the strategy's action; after repeated failures uses the first legal action and,
 * if even that is impossible or keeps failing to commit, aborts the game. Throws to request
 * another attempt.
 */
export function performAutomatedTurn(
  code: RoomCode, seat: GameSeat, failures: number,
  choose: (visible: PlayerVisibleGameState) => BotAction | null,
): void {
  // A fallback that applies but never persists would otherwise be retried forever.
  if (failures >= MAX_AUTOMATED_FAILURES * 2) {
    console.error(`[runtime] Aborting ${code}: the action for ${seat} failed to commit ${failures} times.`);
    abortStuckGame(code, seat);
    return;
  }
  const visible = gameManager.getPlayerVisibleState(code, seat);
  if (failures < MAX_AUTOMATED_FAILURES) {
    const action = visible && choose(visible);
    if (!action) throw new Error('No legal automated action for the pending turn.');
    const result = applyAutomatedAction(code, seat, action);
    if (!result.success) throw new Error(result.reason ?? 'Automated action rejected.');
    return;
  }
  const fallback = visible && firstLegalAction(visible);
  const result = fallback ? applyAutomatedAction(code, seat, fallback) : null;
  if (result?.success) {
    console.warn(`[runtime] Used the first legal action for ${code}/${seat} after ${failures} failures.`);
    return;
  }
  console.error(`[runtime] Aborting ${code}: no legal automated action for ${seat}.`, result?.reason ?? '');
  abortStuckGame(code, seat);
}

/** Tracks consecutive failures per room for the turn currently being retried. */
export interface FailureTracker {
  count: (code: RoomCode, key: string) => number;
  fail: (code: RoomCode, key: string) => number;
  clear: (code: RoomCode) => void;
}

export function createFailureTracker(): FailureTracker {
  const failures = new Map<RoomCode, { key: string; count: number }>();
  return {
    count: (code, key) => (failures.get(code)?.key === key ? failures.get(code)?.count ?? 0 : 0),
    fail: (code, key) => {
      const count = (failures.get(code)?.key === key ? failures.get(code)?.count ?? 0 : 0) + 1;
      failures.set(code, { key, count });
      return count;
    },
    clear: (code) => { failures.delete(code); },
  };
}
