import type { GameSeat, HoldemAction, HoldemVisibleState } from '@shared/types';
import type { HeLegalActions } from '@shared/rules/holdem';
import { createDeck } from '../engine/deck';
import type { TableContext } from './holdem-context';
import { passive, raiseTo } from './holdem-context';
import { estimateEquity } from './holdem-equity';
import type { HandFilter, Opponent } from './holdem-equity';
import { cardId, evaluateIds, scoreCategory } from './holdem-evaluator';
import { blendRate, handOfSeat, statsOfSeat } from './holdem-history';
import type { MatchHistory } from './holdem-history';
import { allOf, createBoardRanker, topHandsFilter } from './holdem-ranges';

// Postflop plan: estimate equity against ranges that shrink when an opponent bets or raises (by how often that
// seat has bet or raised so far this match), then act on equity times the number of players, which measures a hand
// against a fair share. Strong hands sometimes slowplay or check-raise, draws semi-bluff, and pure bluffs depend
// on how often the opponents fold. Bet sizes are drawn independently of hand strength.

const RAISE_STRENGTH = 1.6;
const VALUE_BET_STRENGTH = 1.25;
const COMMIT_STRENGTH = 1.2;
const COMMIT_SHARE = 0.5;
const CALL_MARGIN = 1.1;
const COMMITTED_MARGIN = 1.03;
const VALUE_BET_CHANCE = 0.85;
const SLOWPLAY_CHANCE = 0.2;
const RAISE_BET_CHANCE = 0.55;
const CHECK_RAISE_CHANCE = 0.8;
const RIVER_RAISE_CHANCE = 0.85;
const SEMI_BLUFF_BET_CHANCE = 0.4;
const SEMI_BLUFF_RAISE_CHANCE = 0.18;
const STRONG_DRAW_OUTS = 8;
const DEFAULT_FOLD_TO_BET = 0.4;
const MIN_SIZE_SHARE = 0.45;
const SIZE_SHARE_SPREAD = 0.35;
const SHOVE_REMAINDER_SHARE = 0.45;
const NARROWING_PREFLOP_CALLER = 0.55;
const EARLIER_STREET_WEIGHT = 0.5;
const MIN_KEEP = 0.07;

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

function preflopRange(history: MatchHistory, seat: GameSeat): HandFilter | null {
  const hand = handOfSeat(history, seat);
  const stats = statsOfSeat(history, seat);
  if (hand.raiseKind === 'shove') return topHandsFilter(clamp(blendRate(stats.shove, 0.12, 3), 0.04, 1));
  if (hand.raiseKind === 'reraise') return topHandsFilter(clamp(blendRate(stats.reraise, 0.1, 3), 0.03, 0.8));
  if (hand.raiseKind === 'open') return topHandsFilter(clamp(blendRate(stats.open, 0.24, 3), 0.06, 1));
  return hand.calledRaise ? topHandsFilter(NARROWING_PREFLOP_CALLER) : null;
}

/** Share of hands a seat would bet or raise on a street, from how often it has done so this match. */
function aggressionShare(history: MatchHistory, seat: GameSeat, kind: 'bet' | 'raise'): number {
  const stats = statsOfSeat(history, seat);
  return kind === 'bet'
    ? clamp(blendRate(stats.bet, 0.5, 3), 0.15, 1)
    : clamp(blendRate(stats.raise, 0.15, 3), 0.06, 1);
}

function boardKeep(context: TableContext, history: MatchHistory, seat: GameSeat): number {
  const aggression = handOfSeat(history, seat).aggression;
  let keep = 1;
  for (const [street, kind] of Object.entries(aggression)) {
    if (!kind) continue;
    const weight = street === context.street ? 1 : EARLIER_STREET_WEIGHT;
    keep *= aggressionShare(history, seat, kind) ** weight;
  }
  return Math.max(MIN_KEEP, keep);
}

function opponentRanges(context: TableContext, history: MatchHistory): Opponent[] {
  const rank = createBoardRanker(context.board, context.hole);
  return context.opponents.map((seat) => {
    const keep = boardKeep(context, history, seat);
    return { filter: allOf([preflopRange(history, seat), keep < 1 ? rank(keep) : null]), stays: context.stays(seat) };
  });
}

/** Cards that would complete a straight or flush using a hole card; eight or more marks a strong draw. */
function drawOuts(context: TableContext): number {
  if (context.board.length >= 5) return 0;
  const mine = [...context.hole, ...context.board].map(cardId);
  if (scoreCategory(evaluateIds(mine, mine.length)) >= 4) return 0;
  const board = context.board.map(cardId);
  const seen = new Set(mine);
  let outs = 0;
  for (const card of createDeck().map(cardId)) {
    if (seen.has(card)) continue;
    const category = scoreCategory(evaluateIds([...mine, card], mine.length + 1));
    const boardCategory = scoreCategory(evaluateIds([...board, card], board.length + 1));
    if ([4, 5, 8].includes(category) && boardCategory < category) outs += 1;
  }
  return outs;
}

/** How often the opponents together give up a bet; drives the bluff frequency. */
function foldShare(history: MatchHistory, seats: readonly GameSeat[]): number {
  return seats.reduce((product, seat) => product * blendRate(statsOfSeat(history, seat).foldToBet, DEFAULT_FOLD_TO_BET, 4), 1);
}

/** Pot-fraction bets that do not depend on hand strength; a bet leaving little behind goes all-in. */
function sizedRaise(
  context: TableContext, visible: HoldemVisibleState, legal: HeLegalActions, random: () => number,
): HoldemAction | null {
  const share = MIN_SIZE_SHARE + SIZE_SHARE_SPREAD * random();
  const target = visible.currentBet + Math.max(visible.minRaise, share * (context.pot + context.owed));
  const remainder = context.stack - target;
  return raiseTo(legal, remainder < SHOVE_REMAINDER_SHARE * (context.pot + context.owed) ? Number.POSITIVE_INFINITY : target);
}

export function postflopAction(
  visible: HoldemVisibleState, legal: HeLegalActions, context: TableContext, history: MatchHistory, random: () => number,
): HoldemAction {
  const players = context.opponents.length + 1;
  const { urgency, caution } = context.pressure;
  const price = context.owed / (context.pot + context.owed);
  const committed = context.owed >= context.chips || context.facingAllIn;
  const margin = committed ? COMMITTED_MARGIN : CALL_MARGIN - 0.1 * urgency + 0.06 * caution;
  const equity = estimateEquity({
    hole: context.hole, board: context.board, random, opponents: opponentRanges(context, history),
    thresholds: [price * margin, RAISE_STRENGTH / players, VALUE_BET_STRENGTH / players, COMMIT_STRENGTH / players],
  });
  const strength = equity * players;
  const outs = strength < VALUE_BET_STRENGTH ? drawOuts(context) : 0;
  const strongDraw = outs >= STRONG_DRAW_OUTS && context.opponents.length <= 2;
  const foldChance = foldShare(history, context.opponents);
  const bluffChance = clamp((foldChance - 0.28) * 0.8, 0, 0.4) * (1 + 1.5 * urgency) * (1 - caution);
  const strong = strength >= RAISE_STRENGTH;

  if (legal.call === 0) {
    if (strong) {
      if (context.street !== 'river' && random() < SLOWPLAY_CHANCE) return passive(legal);
      return sizedRaise(context, visible, legal, random) ?? passive(legal);
    }
    if (strength >= VALUE_BET_STRENGTH) {
      return random() < VALUE_BET_CHANCE ? sizedRaise(context, visible, legal, random) ?? passive(legal) : passive(legal);
    }
    if (strongDraw && context.street !== 'river' && random() < SEMI_BLUFF_BET_CHANCE) {
      return sizedRaise(context, visible, legal, random) ?? passive(legal);
    }
    if (context.opponents.length <= 2 && strength < 1 && random() < bluffChance) {
      return sizedRaise(context, visible, legal, random) ?? passive(legal);
    }
    return passive(legal);
  }

  const call: HoldemAction = { type: 'call' };
  const defend = equity >= price * margin && (context.owed < context.chips * COMMIT_SHARE || strength >= COMMIT_STRENGTH)
    ? call : { type: 'fold' as const };
  if (strong) {
    const chance = context.street === 'river' ? RIVER_RAISE_CHANCE : history.hand.checkedThisStreet ? CHECK_RAISE_CHANCE : RAISE_BET_CHANCE;
    if (random() < chance) return sizedRaise(context, visible, legal, random) ?? call;
    return call;
  }
  if (strongDraw && context.owed < context.pot * 0.8 && random() < SEMI_BLUFF_RAISE_CHANCE * (1 - caution)) {
    return sizedRaise(context, visible, legal, random) ?? defend;
  }
  if (context.opponents.length === 1 && strength < 0.8 && random() < Math.min(0.1, bluffChance * 0.4) && defend.type === 'fold') {
    return sizedRaise(context, visible, legal, random) ?? defend;
  }
  return defend;
}
