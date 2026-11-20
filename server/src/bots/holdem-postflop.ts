import type { HoldemAction, HoldemVisibleState } from '@shared/types';
import type { HeLegalActions } from '@shared/rules/holdem';
import type { TableContext } from './holdem-context';
import { passive, raiseTo } from './holdem-context';
import { estimateContestedEquity, estimateEquity } from './holdem-equity';
import { continuingRange, opponentModels } from './holdem-opponents';
import type { OpponentModel } from './holdem-opponents';
import { callShare } from './holdem-ranges';

// Postflop plan: estimate equity against each opponent's range, narrowed by the actions and bet sizes it chose this
// hand, then pick the action with the best chip expectation. A bet of each candidate size is valued by how often the
// opponents fold (a generic share that falls as bets grow) and by the equity against the part of their ranges that
// continues, so strong hands choose large bets, medium hands small ones, and bluffs appear where the folds pay for
// them. Calls compare equity with the pot price; raises are valued like bets against the bettor's range. Very strong
// hands sometimes slowplay so checks are not always weak.

/** Bet sizes considered, as shares of the pot. */
const BET_SIZES = [0.33, 0.66, 1];
/** Equity a call or check realizes before the river, where later bets can still push it out. */
const REALIZATION = 0.9;
/** A bet that leaves less than this share of the pot behind goes all-in instead. */
const SHOVE_REMAINDER_SHARE = 0.4;
/** Hands that continue below the strongest share: draws and floats before the river, hero calls on it. */
const CONTINUE_TAIL = 0.15;
const RIVER_CONTINUE_TAIL = 0.04;
/** Opponents continue this much more often against a raise than against a bet of the same size: they already bet. */
const RAISE_CONTINUE_FACTOR = 1.2;
const SLOWPLAY_CHANCE = 0.12;
const SLOWPLAY_EQUITY = 0.85;
/** Bluffs are held back to this share of spots where one shows a profit, keeping the betting range value-heavy. */
const BLUFF_CHANCE = 0.6;
const BLUFF_EQUITY = 0.45;
const MAX_STREET_RAISES = 3;
/** Some hands always give up, even against a minimum raise. */
const MAX_CONTINUE_SHARE = 0.95;
const MAX_SHOVE_POTS = 2;
/** Raises without a strong hand are taken this share of the time they show a profit. */
const RAISE_BLUFF_CHANCE = 0.25;

interface Choice {
  readonly action: HoldemAction;
  readonly value: number;
}

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

/** The legal raise to `to` chips this street, all-in when little would be left behind. */
function sizedRaise(context: TableContext, legal: HeLegalActions, to: number): HoldemAction | null {
  if (!legal.raise) return null;
  const remainder = context.stack - to;
  return raiseTo(legal, remainder < SHOVE_REMAINDER_SHARE * (context.pot + context.owed) ? Number.POSITIVE_INFINITY : to);
}

/** Chips the raise adds for this seat and the bet the opponents face beyond what was owed. */
function raiseCost(context: TableContext, visible: HoldemVisibleState, action: HoldemAction): { added: number; extra: number } {
  if (action.type !== 'raise') return { added: 0, extra: 0 };
  const added = action.to - visible.streetBets[context.seat];
  return { added, extra: action.to - visible.currentBet };
}

/**
 * Chip expectation of betting or raising to `action`, from this moment: every opponent folds, or the continuing part
 * of their ranges (a share that shrinks as the bet grows) calls and the hand is played out.
 */
function aggressiveChoice(
  context: TableContext, visible: HoldemVisibleState, models: readonly OpponentModel[], action: HoldemAction, raising: boolean,
): Choice & { readonly equity: number } {
  const { added, extra } = raiseCost(context, visible, action);
  const pot = context.pot;
  const fraction = extra / Math.max(1, pot + context.owed);
  const river = context.street === 'river';
  const share = Math.min(MAX_CONTINUE_SHARE, callShare(fraction) * (raising ? RAISE_CONTINUE_FACTOR : 1));
  const continuing = models.map((model) => ({
    range: continuingRange(model, share, river ? RIVER_CONTINUE_TAIL : CONTINUE_TAIL), stays: share,
  }));
  const allFold = (1 - share) ** models.length;
  const called = estimateContestedEquity({
    hole: context.hole, board: context.board, random: context.random, effort: context.effort, opponents: continuing,
  });
  const realized = river || action.type === 'raise' && action.to >= context.stack ? called.equity : called.equity * REALIZATION;
  // Each caller matches the bet as far as its chips allow.
  const matched = models.reduce((sum, model) => sum + Math.min(extra + visible.currentBet - visible.streetBets[model.seat],
    context.chipsOf[model.seat]), 0) / Math.max(1, models.length);
  const finalPot = pot + added + matched * Math.max(1, called.present);
  return { action, value: allFold * pot + (1 - allFold) * (realized * finalPot - added), equity: called.equity };
}

function betOptions(context: TableContext, visible: HoldemVisibleState, legal: HeLegalActions): HoldemAction[] {
  if (!legal.raise) return [];
  const actions: HoldemAction[] = [];
  const pot = context.pot + context.owed;
  for (const size of BET_SIZES) {
    const action = sizedRaise(context, legal, visible.currentBet + Math.max(visible.minRaise, size * pot));
    if (action && !actions.some((other) => other.type === 'raise' && action.type === 'raise' && other.to === action.to)) actions.push(action);
  }
  return actions;
}

function unopened(
  context: TableContext, visible: HoldemVisibleState, legal: HeLegalActions, models: readonly OpponentModel[], equity: number,
): HoldemAction {
  const { urgency, caution } = context.pressure;
  const river = context.street === 'river';
  const check: Choice = { action: passive(legal), value: equity * (river ? 1 : REALIZATION) * context.pot };
  if (!river && equity >= SLOWPLAY_EQUITY && models.length === 1 && context.random() < SLOWPLAY_CHANCE) return check.action;
  let best: Choice & { equity?: number } = check;
  let bestBluff: Choice | null = null;
  for (const action of betOptions(context, visible, legal)) {
    const choice = aggressiveChoice(context, visible, models, action, false);
    const value = choice.value * (1 - 0.15 * caution) + urgency * 0.1 * context.pot;
    if (choice.equity < BLUFF_EQUITY && equity < BLUFF_EQUITY) {
      if (value > check.value && (!bestBluff || value > bestBluff.value)) bestBluff = { action, value };
    } else if (value > best.value) {
      best = { action, value };
    }
  }
  if (best === check && bestBluff && context.random() < BLUFF_CHANCE * (1 + urgency) * (1 - 0.5 * caution)) return bestBluff.action;
  return best.action;
}

function facingBet(
  context: TableContext, visible: HoldemVisibleState, legal: HeLegalActions, models: readonly OpponentModel[], equity: number,
): HoldemAction {
  const { urgency, caution } = context.pressure;
  const committed = context.owed >= context.chips || context.facingAllIn;
  const river = context.street === 'river';
  const realization = committed || river ? 1 : REALIZATION;
  const margin = 1 - 0.12 * urgency + 0.08 * caution + (committed ? 0 : 0.04 * context.behind.length);
  const call: Choice = { action: { type: 'call' }, value: equity * realization * context.calledPot - context.owed * margin };
  let best: Choice = call.value > 0 ? call : { action: { type: 'fold' }, value: 0 };
  if (committed || context.read.streetRaises >= MAX_STREET_RAISES) return best.action;
  const pot = context.pot + context.owed;
  // All-in is a separate size only when the stack is not much deeper than the pot; deeper, an overbet shove risks far
  // more than the folds it buys.
  const sizes = [visible.currentBet + Math.max(visible.minRaise, 0.75 * pot)];
  if (context.stack <= MAX_SHOVE_POTS * pot) sizes.push(Number.POSITIVE_INFINITY);
  for (const to of sizes) {
    const action = sizedRaise(context, legal, to);
    if (!action || action.type !== 'raise') continue;
    const choice = aggressiveChoice(context, visible, models, action, true);
    const value = choice.value * (1 - 0.2 * caution) - context.owed * 0.02;
    // Raises without a strong hand are bluffs; take them only part of the time.
    if (choice.equity < BLUFF_EQUITY && context.random() >= RAISE_BLUFF_CHANCE) continue;
    if (value > best.value) best = { action, value };
  }
  return best.action;
}

export function postflopAction(visible: HoldemVisibleState, legal: HeLegalActions, context: TableContext): HoldemAction {
  const models = opponentModels(context);
  const price = context.owed / context.calledPot;
  const equity = estimateEquity({
    hole: context.hole, board: context.board, random: context.random, effort: context.effort, opponents: models,
    thresholds: legal.call > 0 ? [price, clamp(price / REALIZATION, 0, 1)] : [BLUFF_EQUITY, SLOWPLAY_EQUITY],
  });
  return legal.call === 0
    ? unopened(context, visible, legal, models, equity)
    : facingBet(context, visible, legal, models, equity);
}
