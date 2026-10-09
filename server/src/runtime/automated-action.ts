import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { legalPlays } from '@shared/rules/bigtwo';
import { NN_MAX, nnApply, nnIsPlayable, nnRequiresChoice } from '@shared/rules/ninetynine';
import type { NnChoice } from '@shared/rules/ninetynine';
import { rpPairOptions } from '@shared/rules/redpoints';
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
  }
}

/** Ends a game that cannot progress so the table is not retried forever. */
function abortStuckGame(code: RoomCode, seat: Seat): void {
  const subject = gameManager.getGameState(code)?.players[seat];
  gameManager.abortGame(code);
  roomManager.setRoomStatus(code, 'waiting');
  roomManager.resetAllReady(code);
  if (subject) chatManager.addSystemMessage(code, subject, AUTOMATED_ABORT_MESSAGE);
}

/**
 * Applies the strategy's action; after repeated failures uses the first legal action and,
 * if even that is impossible, aborts the game. Throws to request another attempt.
 */
export function performAutomatedTurn(
  code: RoomCode, seat: Seat, failures: number,
  choose: (visible: PlayerVisibleGameState) => BotAction | null,
): void {
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
