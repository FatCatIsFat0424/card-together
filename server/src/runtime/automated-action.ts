import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { legalPlays } from '@shared/rules/bigtwo';
import { NN_MAX, nnApply, nnIsPlayable, nnRequiresChoice } from '@shared/rules/ninetynine';
import type { NnChoice } from '@shared/rules/ninetynine';
import { rpPairOptions } from '@shared/rules/redpoints';
import { cpGreedyArrangement } from '@shared/rules/chinesepoker-arrange';
import { ldMustChallenge } from '@shared/rules/liarsdeck';
import { BJ_MIN_BET, bjSitsIn } from '@shared/rules/blackjack';
import { heLegalActions } from '@shared/rules/holdem';
import type { PlayerVisibleGameState, RoomCode, Seat } from '@shared/types';
import type { BotAction } from '../bots/bot-decisions';
import * as chatManager from '../managers/chat-manager';
import * as gameManager from '../managers/game-manager';
import * as roomManager from '../managers/room-manager';

/** Consecutive failed attempts for one turn before the scheduler stops asking the strategy. */
export const MAX_AUTOMATED_FAILURES = 3;

/** Client i18n key for the chat line shown when a stuck game is aborted. */
export const AUTOMATED_ABORT_MESSAGE = 'game.automatedAborted';

export function applyAutomatedAction(code: RoomCode, seat: Seat, action: BotAction): { success: boolean; reason?: string } {
  switch (action.type) {
    case 'bridge-redeal': return gameManager.handleRedealResponse(code, seat, action.accept, true);
    case 'bridge-bid': return gameManager.handleBid(code, seat, action.action, true);
    case 'bridge-play': return gameManager.handlePlayCard(code, seat, action.card, true);
    case 'bigtwo-play': return gameManager.handleBigTwoPlay(code, seat, action.cards, true);
    case 'bigtwo-pass': return gameManager.handleBigTwoPass(code, seat, true);
    case 'redpoints-play': return gameManager.handleRedPointsPlay(code, seat, action.card, action.capture, true);
    case 'redpoints-flip': return gameManager.handleRedPointsChooseFlip(code, seat, action.capture, true);
    case 'ninetynine-play': return gameManager.handleNinetyNinePlay(code, seat, action.card, action.choice, action.target, true);
    case 'sevens-play': return gameManager.handleSevensPlay(code, seat, action.card, true);
    case 'sevens-cover': return gameManager.handleSevensCover(code, seat, action.card, true);
    case 'chinesepoker-arrange': return gameManager.handleChinesePokerArrange(code, seat, action.arrangement, true);
    case 'liarsdeck-play': return gameManager.handleLiarsDeckPlay(code, seat, action.cardIds, true);
    case 'liarsdeck-challenge': return gameManager.handleLiarsDeckChallenge(code, seat, true);
    case 'blackjack-bet': return gameManager.handleBlackjackBet(code, seat, action.amount, true);
    case 'blackjack-action': return gameManager.handleBlackjackAction(code, seat, action.action, true);
    case 'holdem-action': return gameManager.handleHoldemAction(code, seat, action.action, true);
  }
}

function ninetyNineAction(visible: Extract<PlayerVisibleGameState, { gameType: 'ninetynine' }>): BotAction | null {
  const card = visible.myHand.find((own) => nnIsPlayable(visible.total, own));
  if (!card) return null;
  const choice = nnRequiresChoice(card)
    ? (['minus', 'plus'] as const).find((option: NnChoice) => nnApply(visible.total, card, option).total <= NN_MAX)
    : undefined;
  const effect = nnApply(visible.total, card, choice);
  const target = effect.designate
    ? SEAT_ORDER_CLOCKWISE.find((seat) => seat !== visible.mySeat && !visible.eliminated.includes(seat))
    : undefined;
  return { type: 'ninetynine-play', card, ...(choice ? { choice } : {}), ...(target ? { target } : {}) };
}

/** Check when free, otherwise fold: the conventional poker default for a player who does not act. */
export function holdemPassiveAction(visible: Extract<PlayerVisibleGameState, { gameType: 'holdem' }>): BotAction | null {
  if (visible.currentTurnSeat !== visible.mySeat) return null;
  const legal = heLegalActions(visible, visible.mySeat);
  if (!legal) return null;
  return { type: 'holdem-action', action: legal.check ? { type: 'check' } : { type: 'fold' } };
}

/** A deliberately simple legal move used only after the strategy repeatedly fails. */
export function firstLegalAction(visible: PlayerVisibleGameState): BotAction | null {
  if (visible.phase === 'scoring') return null;
  switch (visible.gameType) {
    case 'bridge':
      if (visible.phase === 'redeal_pending') return { type: 'bridge-redeal', accept: false };
      if (visible.phase === 'bidding') return { type: 'bridge-bid', action: { type: 'pass' } };
      return visible.validCards[0] ? { type: 'bridge-play', card: visible.validCards[0] } : null;
    case 'bigtwo': {
      if (visible.lastPlay) return { type: 'bigtwo-pass' };
      const lead = legalPlays(visible.myHand, null, visible.firstPlay)[0];
      return lead ? { type: 'bigtwo-play', cards: lead.cards } : null;
    }
    case 'redpoints': {
      if (visible.step === 'flip-choose') {
        const capture = visible.pendingFlip && rpPairOptions(visible.pendingFlip, visible.table)[0];
        return capture ? { type: 'redpoints-flip', capture } : null;
      }
      const card = visible.myHand[0];
      if (!card) return null;
      const capture = rpPairOptions(card, visible.table)[0];
      return { type: 'redpoints-play', card, ...(capture ? { capture } : {}) };
    }
    case 'ninetynine': return ninetyNineAction(visible);
    case 'sevens': {
      if (visible.validCards[0]) return { type: 'sevens-play', card: visible.validCards[0] };
      return visible.myHand[0] ? { type: 'sevens-cover', card: visible.myHand[0] } : null;
    }
    case 'chinesepoker':
      return visible.myArrangement || visible.submitted[visible.mySeat] ? null
        : { type: 'chinesepoker-arrange', arrangement: cpGreedyArrangement(visible.myHand) };
    case 'liarsdeck':
      if (ldMustChallenge(visible.mySeat, visible.handCounts, visible.lastPlay)) return { type: 'liarsdeck-challenge' };
      return visible.myHand[0] ? { type: 'liarsdeck-play', cardIds: [visible.myHand[0].id] } : null;
    case 'blackjack':
      if (visible.phase === 'betting') {
        return visible.myBet === null && bjSitsIn(visible.chips[visible.mySeat])
          ? { type: 'blackjack-bet', amount: BJ_MIN_BET } : null;
      }
      return visible.currentTurnSeat === visible.mySeat ? { type: 'blackjack-action', action: 'stand' } : null;
    case 'holdem': return holdemPassiveAction(visible);
  }
}

/** Ends a game that cannot progress so the table is not retried forever. */
function abortStuckGame(code: RoomCode, seat: Seat): void {
  const players = gameManager.getGameState(code)?.players;
  // Chat senders must be accounts, so a bot's stuck turn is reported about a human seat.
  const subject = players && [players[seat], ...SEAT_ORDER_CLOCKWISE.map((other) => players[other])]
    .find((player) => !player.isBot);
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
  code: RoomCode, seat: Seat, failures: number,
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
