import type { DiceFace, LiarsDiceBid, LiarsDiceVisibleState } from '@shared/types';
import {
  LDI_ALL_FACES,
  LDI_FACES,
  LDI_WILD_FACE,
  ldiCountFace,
  ldiLegalBids,
  ldiMinimalBid,
  ldiOnesWildAfter,
  ldiTotalDice,
} from '@shared/rules/liarsdice';
import type { BotAction } from './bot-decisions';
import { selectNearBest } from './selection';

// Heuristic summary: every option is scored as the bot's chance of not losing a die this round.
// - Calling is worth the chance the standing bid is false. Unknown dice are everything outside the bot's own cup;
//   each is a match with probability 1/6, or 2/6 for a non-ones face while ones are wild. The bidder is assumed to
//   hold at least one die of the face it named about half the time, since players tend to bid what they hold.
// - A raise is worth the chance it holds if called plus a neutral value if nobody calls. The table is assumed to
//   call roughly as often as the bid looks false from public information, so high bids score close to their true
//   chance and low bids stay cheap.
// - Scores that are close are chosen between at random, which varies bluffs without ever picking a poor option.

const BIDDER_HOLDS_ONE = 0.5;
const UNCALLED_VALUE = 0.5;
const MIN_CALL_CHANCE = 0.05;
const MARGIN = 0.02;
const EASY_SLACK = 1;

function action(request: { type: 'bid'; quantity: number; face: DiceFace } | { type: 'challenge' }): BotAction {
  return { type: 'game-action', request: { gameType: 'liarsdice', action: request } };
}

const bidAction = (bid: LiarsDiceBid): BotAction => action({ type: 'bid', quantity: bid.quantity, face: bid.face });

/** Chance that at least `need` of `trials` independent dice with match probability `chance` are matches. */
export function atLeastMatches(trials: number, chance: number, need: number): number {
  if (need <= 0) return 1;
  if (need > trials) return 0;
  let mass = (1 - chance) ** trials;
  let below = 0;
  for (let hits = 0; hits < need; hits++) {
    below += mass;
    mass *= ((trials - hits) / (hits + 1)) * (chance / (1 - chance));
  }
  return Math.min(1, Math.max(0, 1 - below));
}

function matchChance(face: DiceFace, onesWild: boolean): number {
  return (onesWild && face !== LDI_WILD_FACE ? 2 : 1) / LDI_FACES;
}

/** Dice no one at the table has shown the bot. */
function unknownDice(visible: LiarsDiceVisibleState): number {
  return ldiTotalDice(visible.diceCounts) - visible.myDice.length;
}

/** Chance that `bid` holds given the bot's own dice alone, with `onesWild` the rule at the time of the call. */
export function bidHoldsChance(visible: LiarsDiceVisibleState, bid: LiarsDiceBid, onesWild: boolean): number {
  const need = bid.quantity - ldiCountFace(visible.myDice, bid.face, onesWild);
  return atLeastMatches(unknownDice(visible), matchChance(bid.face, onesWild), need);
}

/** Chance that the standing bid holds, crediting its bidder with a die of the named face about half the time. */
export function standingBidHoldsChance(visible: LiarsDiceVisibleState): number {
  const standing = visible.bid;
  if (!standing) return 1;
  const unknown = unknownDice(visible);
  const chance = matchChance(standing.face, visible.onesWild);
  const need = standing.quantity - ldiCountFace(visible.myDice, standing.face, visible.onesWild);
  const withHolding = atLeastMatches(Math.max(0, unknown - 1), chance, need - 1);
  return BIDDER_HOLDS_ONE * withHolding + (1 - BIDDER_HOLDS_ONE) * atLeastMatches(unknown, chance, need);
}

/** Chance the next seat challenges a bid, judged from the dice count alone. */
function callChance(visible: LiarsDiceVisibleState, bid: LiarsDiceBid, onesWild: boolean): number {
  const total = ldiTotalDice(visible.diceCounts);
  return Math.max(MIN_CALL_CHANCE, 1 - atLeastMatches(total, matchChance(bid.face, onesWild), bid.quantity));
}

function scoreRaise(visible: LiarsDiceVisibleState, bid: LiarsDiceBid): number {
  const onesWild = ldiOnesWildAfter(visible.onesWild, bid);
  const called = callChance(visible, bid, onesWild);
  return called * bidHoldsChance(visible, bid, onesWild) + (1 - called) * UNCALLED_VALUE;
}

function myTurn(visible: LiarsDiceVisibleState): boolean {
  return visible.phase === 'playing' && visible.currentTurnSeat === visible.mySeat;
}

export function getLiarsDiceBotAction(visible: LiarsDiceVisibleState, random: () => number): BotAction | null {
  if (!myTurn(visible)) return null;
  const total = ldiTotalDice(visible.diceCounts);
  const options: { value: BotAction; score: number }[] = ldiLegalBids(visible.bid, total)
    .map((bid) => ({ value: bidAction(bid), score: scoreRaise(visible, bid) }));
  if (visible.bid && visible.bid.seat !== visible.mySeat) {
    options.push({ value: action({ type: 'challenge' }), score: 1 - standingBidHoldsChance(visible) });
  }
  return selectNearBest(options, random, MARGIN);
}

/** The face the bot holds most of, with ones counted while they are wild. */
function strongestFace(visible: LiarsDiceVisibleState): DiceFace {
  const faces = LDI_ALL_FACES.filter((face) => face !== LDI_WILD_FACE);
  return faces.reduce((best, face) => (ldiCountFace(visible.myDice, face, visible.onesWild)
    > ldiCountFace(visible.myDice, best, visible.onesWild) ? face : best), faces[0]);
}

/**
 * Fixed thresholds: challenge when the bid is more than one die above what the table should hold on average,
 * otherwise raise by the least allowed. Opens with the face the bot holds most. Deterministic, so it also serves
 * players whose turn clock ran out.
 */
export function easyLiarsDiceAction(visible: LiarsDiceVisibleState): BotAction | null {
  if (!myTurn(visible)) return null;
  const total = ldiTotalDice(visible.diceCounts);
  const standing = visible.bid;
  if (!standing) {
    const face = strongestFace(visible);
    return bidAction({ quantity: Math.max(1, ldiCountFace(visible.myDice, face, visible.onesWild)), face });
  }
  const expected = ldiCountFace(visible.myDice, standing.face, visible.onesWild)
    + unknownDice(visible) * matchChance(standing.face, visible.onesWild);
  const raise = ldiMinimalBid(standing, total);
  return raise && standing.quantity <= expected + EASY_SLACK ? bidAction(raise) : action({ type: 'challenge' });
}

/** A deliberately simple legal move: challenge any standing bid, otherwise open with the least bid. */
export function liarsDiceFirstLegalAction(visible: LiarsDiceVisibleState): BotAction | null {
  if (!myTurn(visible)) return null;
  if (visible.bid && visible.bid.seat !== visible.mySeat) return action({ type: 'challenge' });
  const opening = ldiMinimalBid(visible.bid, ldiTotalDice(visible.diceCounts));
  return opening ? bidAction(opening) : null;
}
