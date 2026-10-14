import type { Card, GameSeat, HoldemAction, HoldemVisibleState } from '@shared/types';
import type { HeLegalActions } from '@shared/rules/holdem';
import type { TableContext } from './holdem-context';
import { callOrCheck, passive, raiseTo, shortStackBlinds } from './holdem-context';
import { estimateEquity } from './holdem-equity';
import type { Opponent } from './holdem-equity';
import { blendRate, handOfSeat, statsOfSeat } from './holdem-history';
import type { MatchHistory } from './holdem-history';
import { preflopRankFraction } from './holdem-preflop-table';
import { topHandsFilter } from './holdem-ranges';

// Preflop plan: open a share of hands that grows with the number of players still to act and with how often
// those players fold to raises; defend against raises by comparing equity with the pot price, assuming the raiser
// holds the top slice of hands that matches how often that seat has raised or shoved so far this match. Raising
// back is limited to two raises per seat and four per hand so two strong bots cannot trade min-raises forever.

/** Opening share of hands by the number of opponents still to act; index 0 is the big blind's option. */
const OPEN_SHARE = [0.14, 0.55, 0.42, 0.3, 0.22, 0.18, 0.15, 0.13];
const OPEN_BLINDS = 3;
const DEFAULT_FOLD_TO_OPEN = 0.55;
const CALL_MARGIN = 1.15;
const COMMITTED_MARGIN = 1.03;
const VALUE_RERAISE_EQUITY = 0.6;
const RESTEAL_EQUITY = 0.52;
const LIGHT_RERAISE_CHANCE = 0.12;
const CALLER_RANGE = 0.5;
const COMPLETE_SHARE = 0.5;
const MAX_OWN_RAISES = 2;
const MAX_HAND_RAISES = 4;
const COMMIT_SHARE = 0.4;

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

/** Pocket queens or better, and ace-king. */
function isPremium(hole: readonly Card[]): boolean {
  const [high, low] = [...hole].sort((a, b) => b.rank - a.rank);
  return (high.rank === low.rank && high.rank >= 12) || (high.rank === 14 && low.rank === 13);
}

function isPocketKingsOrBetter(hole: readonly Card[]): boolean {
  return hole[0].rank === hole[1].rank && hole[0].rank >= 13;
}

/** Suited aces and connected suited cards: hands that bluff well because they keep real equity when called. */
function isLightRaiseHand(hole: readonly Card[]): boolean {
  if (hole[0].suit !== hole[1].suit) return false;
  const high = Math.max(hole[0].rank, hole[1].rank);
  const low = Math.min(hole[0].rank, hole[1].rank);
  return (high === 14 && low <= 5) || (high - low <= 2 && low >= 4 && high <= 11);
}

function foldToOpenShare(history: MatchHistory, seats: readonly GameSeat[]): number {
  if (seats.length === 0) return DEFAULT_FOLD_TO_OPEN;
  const total = seats.reduce((sum, seat) => sum + blendRate(statsOfSeat(history, seat).foldToOpen, DEFAULT_FOLD_TO_OPEN, 5), 0);
  return total / seats.length;
}

function openShare(context: TableContext, history: MatchHistory): number {
  const base = OPEN_SHARE[Math.min(context.behind.length, OPEN_SHARE.length - 1)];
  // Opponents that rarely fold make stealing unprofitable, so only value hands open against them.
  const stealing = clamp(1 + 1.6 * (foldToOpenShare(history, context.behind) - DEFAULT_FOLD_TO_OPEN), 0.45, 1.5);
  const limpBonus = 1 + 0.15 * history.hand.limpers;
  const { urgency, caution } = context.pressure;
  return clamp(base * stealing * limpBonus * (1 + 0.9 * urgency) * (1 - 0.25 * caution), 0, 0.85);
}

/** Share of hands that push when the stack is short; shrinks with depth and with each extra player to act. */
function pushShare(context: TableContext): number {
  const heads = clamp(1.2 - 0.07 * context.stackBlinds, 0.15, 0.95);
  const { urgency, caution } = context.pressure;
  return clamp(heads ** (1 + 0.5 * (Math.max(1, context.behind.length) - 1)) * (1 + 0.9 * urgency) * (1 - 0.25 * caution), 0, 0.95);
}

/** Share of hands a seat is assumed to hold for its latest preflop raise. */
function raiserShare(history: MatchHistory, seat: GameSeat): number {
  const stats = statsOfSeat(history, seat);
  switch (handOfSeat(history, seat).raiseKind) {
    case 'shove': return clamp(blendRate(stats.shove, 0.12, 3), 0.04, 1);
    case 'reraise': return clamp(blendRate(stats.reraise, 0.1, 3), 0.03, 0.8);
    default: return clamp(blendRate(stats.open, 0.24, 3), 0.06, 1);
  }
}

function opponentRange(history: MatchHistory, context: TableContext, seat: GameSeat): Opponent {
  const hand = handOfSeat(history, seat);
  const stays = context.stays(seat);
  if (hand.raiseKind) return { filter: topHandsFilter(raiserShare(history, seat)), stays };
  return { filter: hand.calledRaise ? topHandsFilter(CALLER_RANGE) : null, stays };
}

function openOrFold(
  context: TableContext, legal: HeLegalActions, history: MatchHistory, rank: number,
): HoldemAction {
  if (rank <= openShare(context, history)) {
    const open = raiseTo(legal, context.bigBlind * (OPEN_BLINDS + history.hand.limpers));
    if (open) return open;
  }
  // Completing the small blind costs half a big blind, which any decent hand can afford.
  if (legal.call > 0 && legal.call <= context.bigBlind / 2 && rank <= COMPLETE_SHARE) return { type: 'call' };
  return passive(legal);
}

function unraised(
  context: TableContext, legal: HeLegalActions, history: MatchHistory,
): HoldemAction {
  const rank = preflopRankFraction(context.hole);
  if (context.stackBlinds <= shortStackBlinds(context)) {
    if (rank <= pushShare(context)) return raiseTo(legal, Number.POSITIVE_INFINITY) ?? callOrCheck(legal);
    return passive(legal);
  }
  if (legal.call === 0) {
    // Big blind with only limpers in front: raise strong hands for value, otherwise see the flop.
    const iso = rank <= openShare(context, history) ? raiseTo(legal, context.bigBlind * (OPEN_BLINDS + history.hand.limpers)) : null;
    return iso ?? passive(legal);
  }
  return openOrFold(context, legal, history, rank);
}

interface Facing {
  readonly context: TableContext;
  readonly visible: HoldemVisibleState;
  readonly legal: HeLegalActions;
  readonly history: MatchHistory;
  readonly random: () => number;
}

function raiseSize({ context, visible, legal }: Facing, raises: number): HoldemAction | null {
  const target = visible.currentBet * (raises === 1 ? 3 : 2.3);
  // A raise that stakes a large part of the stack is a shove in all but name.
  return raiseTo(legal, target >= context.stack * COMMIT_SHARE ? Number.POSITIVE_INFINITY : target);
}

function facingRaise(facing: Facing): HoldemAction {
  const { context, legal, history, random } = facing;
  const raises = history.hand.preflopRaises;
  const rank = preflopRankFraction(context.hole);
  const price = legal.call / (context.pot + legal.call);
  // With the last chips going in or against an all-in raise, no further betting can follow.
  const committed = legal.call >= context.chips || context.facingAllIn;
  const { urgency, caution } = context.pressure;
  const margin = committed ? COMMITTED_MARGIN : CALL_MARGIN - 0.1 * urgency + 0.06 * caution;
  const equity = estimateEquity({
    hole: context.hole, board: [], random,
    opponents: context.opponents.map((seat) => opponentRange(history, context, seat)),
    thresholds: [price * margin, VALUE_RERAISE_EQUITY, RESTEAL_EQUITY],
  });
  const defend: HoldemAction = equity >= price * margin ? { type: 'call' } : { type: 'fold' };
  const canRaise = legal.raise !== null && history.hand.ownPreflopRaises < MAX_OWN_RAISES && raises < MAX_HAND_RAISES;
  if (!canRaise) return defend;
  const premium = isPremium(context.hole);
  if (raises >= 3) return isPocketKingsOrBetter(context.hole) ? raiseTo(legal, Number.POSITIVE_INFINITY) ?? defend : defend;
  if (raises === 2) return premium ? raiseSize(facing, raises) ?? defend : defend;
  if (premium || equity >= VALUE_RERAISE_EQUITY) return raiseSize(facing, raises) ?? defend;
  if (context.stackBlinds <= shortStackBlinds(context) && equity >= RESTEAL_EQUITY) {
    return raiseTo(legal, Number.POSITIVE_INFINITY) ?? defend;
  }
  const opener = context.opponents.find((seat) => handOfSeat(history, seat).raiseKind !== null);
  const wideOpener = opener !== undefined && raiserShare(history, opener) >= 0.2;
  const light = isLightRaiseHand(context.hole) && rank >= 0.1 && wideOpener && context.opponents.length === 1
    && context.stackBlinds >= 20 && legal.call < context.chips * 0.25;
  if (light && random() < LIGHT_RERAISE_CHANCE * (1 + 1.5 * urgency) * (1 - caution)) {
    return raiseSize(facing, raises) ?? defend;
  }
  return defend;
}

export function preflopAction(
  visible: HoldemVisibleState, legal: HeLegalActions, context: TableContext, history: MatchHistory, random: () => number,
): HoldemAction {
  if (history.hand.preflopRaises === 0) return unraised(context, legal, history);
  if (legal.call === 0) return passive(legal);
  return facingRaise({ context, visible, legal, history, random });
}
