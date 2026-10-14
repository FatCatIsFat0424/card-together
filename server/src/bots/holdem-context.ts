import type { Card, GameSeat, HoldemAction, HoldemStreet, HoldemVisibleState } from '@shared/types';
import { HE_HANDS, heCanAct, heInHand } from '@shared/rules/holdem';
import type { HeLegalActions } from '@shared/rules/holdem';

/** How the match clock and chip standings should bend the strategy. Both values are 0 to 1. */
export interface MatchPressure {
  /** Trailing near the end of the match: widen ranges and accept thinner prices. */
  readonly urgency: number;
  /** Leading near the end of the match: avoid variance. */
  readonly caution: number;
}

export interface TableContext {
  readonly seat: GameSeat;
  readonly hole: readonly Card[];
  readonly board: readonly Card[];
  readonly street: HoldemStreet;
  readonly bigBlind: number;
  readonly pot: number;
  /** Chips a call adds. */
  readonly owed: number;
  /** Chips not yet staked this hand. */
  readonly chips: number;
  /** Chips behind plus the stake already on this street. */
  readonly stack: number;
  readonly stackBlinds: number;
  /** Unfolded opponents, including all-in seats. */
  readonly opponents: readonly GameSeat[];
  /** Opponents that still owe an action on this street. */
  readonly behind: readonly GameSeat[];
  /** Chance that an opponent is still in the hand at showdown: 1 once it has acted, lower for seats yet to face the bet. */
  readonly stays: (seat: GameSeat) => number;
  /** The bet being faced is an opponent's last chip, so no further betting can follow it. */
  readonly facingAllIn: boolean;
  readonly pressure: MatchPressure;
}

const MAX_BEHIND_STAYS = 0.7;
const MIN_BEHIND_STAYS = 0.05;

/** Hands left in the match, counting the current one. */
const handsLeft = (visible: HoldemVisibleState): number => Math.max(1, HE_HANDS - visible.hand + 1);

export function matchPressure(visible: HoldemVisibleState): MatchPressure {
  const stackOf = (seat: GameSeat): number => visible.chips[seat] + visible.totalBets[seat];
  const rival = Math.max(0, ...visible.seats.filter((seat) => seat !== visible.mySeat).map(stackOf));
  const mine = stackOf(visible.mySeat);
  const left = handsLeft(visible);
  if (mine < rival) return { urgency: left === 1 ? 1 : left === 2 ? 0.6 : 0, caution: 0 };
  if (mine === rival || rival === 0) return { urgency: 0, caution: 0 };
  const lead = Math.min(1, Math.max(0.3, (mine / rival - 1) / 0.25));
  return { urgency: 0, caution: lead * (left <= 2 ? 1 : left <= 4 ? 0.4 : 0) };
}

export function buildContext(visible: HoldemVisibleState, legal: HeLegalActions): TableContext {
  const seat = visible.mySeat;
  const opponents = heInHand(visible).filter((other) => other !== seat);
  const stack = visible.chips[seat] + visible.streetBets[seat];
  const pot = Object.values(visible.totalBets).reduce((sum, value) => sum + value, 0);
  const behind = opponents.filter((other) => heCanAct(visible, other)
    && (!visible.acted.includes(other) || visible.streetBets[other] < visible.currentBet));
  const stays = (other: GameSeat): number => {
    if (!behind.includes(other)) return 1;
    const cost = Math.min(visible.chips[other], visible.currentBet - visible.streetBets[other]);
    // A seat facing a large price continues only with strong hands, so it rarely reaches the showdown.
    return cost <= 0 ? 1 : Math.min(MAX_BEHIND_STAYS, Math.max(MIN_BEHIND_STAYS, 1.1 - 2 * (cost / (pot + cost))));
  };
  return {
    seat,
    hole: visible.myHand,
    board: visible.board,
    street: visible.street,
    bigBlind: visible.bigBlind,
    pot,
    owed: legal.call,
    chips: visible.chips[seat],
    stack,
    stackBlinds: stack / visible.bigBlind,
    opponents,
    behind,
    stays,
    facingAllIn: opponents.some((other) => visible.chips[other] === 0 && visible.streetBets[other] === visible.currentBet && visible.currentBet > 0),
    pressure: matchPressure(visible),
  };
}

/** Stack depth in big blinds at which hands are pushed or folded; deeper tables and more players raise the bar. */
export function shortStackBlinds(context: TableContext): number {
  const players = context.opponents.length + 1;
  return Math.max(8, 15 - 1.5 * (players - 2)) + 4 * context.pressure.urgency;
}

export function raiseTo(legal: HeLegalActions, target: number): HoldemAction | null {
  if (!legal.raise) return null;
  return { type: 'raise', to: Math.max(legal.raise.min, Math.min(legal.raise.max, Math.round(target))) };
}

export function passive(legal: HeLegalActions): HoldemAction {
  return legal.check ? { type: 'check' } : { type: 'fold' };
}

/** The legal call, or the passive action when nothing is owed. */
export function callOrCheck(legal: HeLegalActions): HoldemAction {
  return legal.call > 0 ? { type: 'call' } : passive(legal);
}
