import type { Card, HoldemAction } from '@shared/types';
import type { HeLegalActions } from '@shared/rules/holdem';
import type { TableContext } from './holdem-context';
import { callOrCheck, passive, raiseTo } from './holdem-context';
import { estimateContestedEquity, estimateEquity } from './holdem-equity';
import { seatRead } from './holdem-history';
import { continuingRange, opponentModels } from './holdem-opponents';
import type { OpponentModel } from './holdem-opponents';
import { preflopRankFraction } from './holdem-preflop-table';
import { callLimit, pushLimit } from './holdem-push-fold';
import { OPEN_SHARE } from './holdem-ranges';

// Preflop plan. Short stacks play the push/fold equilibrium charts: all-in or fold when first in, and call a first-in
// all-in from the call charts. Deeper stacks open a share of hands that depends on the seats still to act, and
// answer raises by comparing three choices on chip expectation: folding, calling at the pot price, and reraising
// (all-in when shallow) against the raiser's generic range and the part of it that would continue. Raising back is
// limited to two raises per seat and four per hand so two strong bots cannot trade raises forever.

/** Effective stacks, in big blinds, at which an unraised pot is played push or fold. */
const PUSH_FOLD_BLINDS = 14;
/** Effective stacks at which a reraise is all-in. */
const RESHOVE_BLINDS = 30;
/**
 * Pushes are read from the chart as if stacks were this much deeper: the equilibrium assumes callers fold as often as
 * it prescribes, while real tables call all-ins more often, which makes the widest pushes lose.
 */
const PUSH_DEPTH_FACTOR = 1.5;
const OPEN_BLINDS = 2.5;
const SHALLOW_OPEN_BLINDS = 2.2;
const SHALLOW_OPEN_DEPTH = 30;
const COMPLETE_SHARE = 0.45;
const MAX_OWN_RAISES = 2;
const MAX_HAND_RAISES = 4;
/** A raise that stakes this share of the stack is made all-in instead. */
const COMMIT_SHARE = 0.4;
/** Share of the pot a call realizes when more betting follows, out of position or against several players. */
const CALL_REALIZATION = 0.88;
const VALUE_RERAISE_EQUITY = 0.6;
const LIGHT_RERAISE_CHANCE = 0.1;

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

/** The stack depth the charts are read at: shallower when trailing late (wider ranges), deeper when leading. */
function chartDepth(context: TableContext, depth: number): number {
  const { urgency, caution } = context.pressure;
  return depth * (1 - 0.45 * urgency) * (1 + 0.35 * caution);
}

/** Pocket queens or better, and ace-king. */
function isPremium(hole: readonly Card[]): boolean {
  const [high, low] = [...hole].sort((a, b) => b.rank - a.rank);
  return (high.rank === low.rank && high.rank >= 12) || (high.rank === 14 && low.rank === 13);
}

function isPocketKingsOrBetter(hole: readonly Card[]): boolean {
  return hole[0].rank === hole[1].rank && hole[0].rank >= 13;
}

/** Suited aces and connected suited cards keep real equity when a light reraise is called. */
function isLightRaiseHand(hole: readonly Card[]): boolean {
  if (hole[0].suit !== hole[1].suit) return false;
  const high = Math.max(hole[0].rank, hole[1].rank);
  const low = Math.min(hole[0].rank, hole[1].rank);
  return (high === 14 && low <= 5) || (high - low <= 2 && low >= 4 && high <= 11);
}

const shove = (legal: HeLegalActions): HoldemAction | null => raiseTo(legal, Number.POSITIVE_INFINITY);

function openShare(context: TableContext): number {
  const base = OPEN_SHARE[clamp(context.behind.length, 0, OPEN_SHARE.length - 1)];
  const { urgency, caution } = context.pressure;
  return clamp(base * (1 + 0.9 * urgency) * (1 - 0.3 * caution), 0, 0.85);
}

function openSize(context: TableContext): number {
  const blinds = context.effectiveBlinds > SHALLOW_OPEN_DEPTH ? OPEN_BLINDS : SHALLOW_OPEN_BLINDS;
  return context.bigBlind * (blinds + context.read.limpers);
}

function unraised(context: TableContext, legal: HeLegalActions): HoldemAction {
  const rank = preflopRankFraction(context.hole);
  const { limpers } = context.read;
  if (context.effectiveBlinds <= PUSH_FOLD_BLINDS) {
    // Limpers add dead money but may call, so they count as extra seats behind.
    const behind = Math.max(1, context.behind.length + limpers);
    if (chartDepth(context, context.effectiveBlinds) * PUSH_DEPTH_FACTOR <= pushLimit(behind, context.hole)) return shove(legal) ?? callOrCheck(legal);
    if (legal.call > 0 && legal.call <= context.bigBlind / 2 && limpers > 0 && rank <= COMPLETE_SHARE) return { type: 'call' };
    return passive(legal);
  }
  const share = limpers > 0 ? openShare(context) * 0.7 : openShare(context);
  if (legal.call === 0) {
    // The big blind's option with only limpers in front: raise strong hands, otherwise see the flop.
    return (rank <= share * 0.6 ? raiseTo(legal, openSize(context) + context.bigBlind) : null) ?? passive(legal);
  }
  if (rank <= share) {
    const open = raiseTo(legal, openSize(context));
    if (open) return open;
  }
  // Completing the small blind costs half a big blind, which any decent hand can afford.
  if (legal.call <= context.bigBlind / 2 && rank <= COMPLETE_SHARE) return { type: 'call' };
  return passive(legal);
}

/** A first-in all-in with nobody calling yet, where the call chart applies. */
function chartedShove(context: TableContext): { behind: number; place: number; depth: number } | null {
  const { read } = context;
  const shover = read.preflopAggressor;
  if (read.preflopRaises !== 1 || read.limpers > 0 || !shover) return null;
  const shove = seatRead(read, shover).preflop;
  if (shove.kind !== 'shove' || shove.raisesBefore !== 0) return null;
  if (context.opponents.some((seat) => seatRead(read, seat).preflop.kind === 'callShove')) return null;
  const place = shove.behind - context.behind.length;
  if (place < 1) return null;
  const depth = Math.min(context.startStacks[context.seat] ?? 0, context.startStacks[shover] ?? 0) / context.bigBlind;
  return { behind: shove.behind, place, depth };
}

interface Choice {
  readonly action: HoldemAction;
  readonly value: number;
}

function facingRaise(context: TableContext, legal: HeLegalActions): HoldemAction {
  const { read, random } = context;
  const { urgency, caution } = context.pressure;
  const charted = chartedShove(context);
  if (charted) {
    const calls = chartDepth(context, charted.depth) <= callLimit(charted.behind, charted.place, context.hole);
    return calls ? { type: 'call' } : { type: 'fold' };
  }
  const models = opponentModels(context);
  const price = legal.call / context.calledPot;
  const committed = legal.call >= context.chips || context.facingAllIn;
  const realization = committed ? 1 : CALL_REALIZATION;
  const margin = committed ? 1 - 0.15 * urgency + 0.05 * caution : 1 - 0.1 * urgency + 0.06 * caution;
  const equity = estimateEquity({
    hole: context.hole, board: [], random, effort: context.effort, opponents: models,
    thresholds: [(price * margin) / realization, VALUE_RERAISE_EQUITY],
  });
  const call: Choice = { action: { type: 'call' }, value: equity * realization * context.calledPot - legal.call * margin };
  const fold: Choice = { action: { type: 'fold' }, value: 0 };
  const defend = call.value > 0 ? call : fold;
  const raises = read.preflopRaises;
  const canRaise = legal.raise !== null && read.ownPreflopRaises < MAX_OWN_RAISES && raises < MAX_HAND_RAISES;
  if (!canRaise) return defend.action;
  if (raises >= 3) return isPocketKingsOrBetter(context.hole) ? shove(legal) ?? defend.action : defend.action;
  const premium = isPremium(context.hole);
  const aggressor = models.find((model) => model.seat === read.preflopAggressor) ?? null;

  // Shallow: compare an all-in reraise with calling and folding.
  if (aggressor && context.effectiveBlinds <= RESHOVE_BLINDS && !context.facingAllIn) {
    const reshove = reshoveChoice(context, legal, models, aggressor);
    if (reshove && reshove.value > defend.value) return reshove.action;
    return defend.action;
  }
  if (raises === 2) return premium ? reraise(context, legal) ?? defend.action : defend.action;
  if (premium || equity >= VALUE_RERAISE_EQUITY) return reraise(context, legal) ?? defend.action;
  const light = isLightRaiseHand(context.hole) && preflopRankFraction(context.hole) >= 0.1 && context.opponents.length === 1
    && legal.call < context.chips * 0.2;
  if (light && random() < LIGHT_RERAISE_CHANCE * (1 + 1.5 * urgency) * (1 - caution)) return reraise(context, legal) ?? defend.action;
  return defend.action;
}

function reraise(context: TableContext, legal: HeLegalActions): HoldemAction | null {
  const target = (context.pot + legal.call) * 1.1 + (context.stack - context.chips) + legal.call;
  return raiseTo(legal, target >= context.stack * COMMIT_SHARE ? Number.POSITIVE_INFINITY : target);
}

/**
 * Chip expectation of moving all-in now, measured from folding: everyone folds and the pot is won, or the raiser
 * continues with the strongest part of its range that its pot odds justify and the hand is played out.
 */
function reshoveChoice(
  context: TableContext, legal: HeLegalActions, models: readonly OpponentModel[], aggressor: OpponentModel,
): Choice | null {
  const action = shove(legal);
  if (!action) return null;
  const mine = context.startStacks[context.seat] ?? 0;
  const theirs = context.startStacks[aggressor.seat] ?? 0;
  const myStake = mine - context.chips;
  const theirStake = theirs - context.chipsOf[aggressor.seat];
  const covered = Math.min(mine, theirs);
  const risk = covered - myStake;
  const theirCall = Math.max(0, covered - theirStake);
  // The raiser's price decides how much of its range continues.
  const theirPrice = theirCall / (context.pot + risk + theirCall);
  const share = clamp(1.25 - 2.2 * theirPrice, 0.12, 0.85);
  const others = models.filter((model) => model !== aggressor);
  // Seats that have not raised call an all-in only with their best few hands.
  const othersFold = others.reduce((product) => product * 0.94, 1);
  const pFold = (1 - share) * othersFold;
  const called = estimateContestedEquity({
    hole: context.hole, board: [], random: context.random, effort: context.effort,
    opponents: [{ range: continuingRange(aggressor, share, 0), stays: 1 }],
  });
  const value = pFold * context.pot + (1 - pFold) * (called.equity * (context.pot + risk + theirCall) - risk);
  return { action, value };
}

export function preflopAction(legal: HeLegalActions, context: TableContext): HoldemAction {
  if (context.read.preflopRaises === 0) return unraised(context, legal);
  if (legal.call === 0) return passive(legal);
  return facingRaise(context, legal);
}
