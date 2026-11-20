import type { Card, GameSeat, HoldemAction, HoldemStreet, HoldemVisibleState } from '@shared/types';
import { HE_HANDS, heCanAct, heInHand } from '@shared/rules/holdem';
import type { HeLegalActions } from '@shared/rules/holdem';
import type { Effort } from './holdem-equity';
import { readHand } from './holdem-history';
import type { HandRead } from './holdem-history';

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
  /** The pot once this seat calls, without chips beyond its stack that would be returned. */
  readonly calledPot: number;
  /** Chips not yet staked this hand. */
  readonly chips: number;
  /** Chips behind plus the stake already on this street. */
  readonly stack: number;
  readonly stackBlinds: number;
  /** Chips each seat has not yet staked this hand. */
  readonly chipsOf: Readonly<Record<GameSeat, number>>;
  /** Chips each seat held when the hand began. */
  readonly startStacks: Readonly<Record<GameSeat, number>>;
  /** The smaller of this seat's starting stack and the largest other unfolded one, in big blinds. */
  readonly effectiveBlinds: number;
  /** Unfolded opponents, including all-in seats. */
  readonly opponents: readonly GameSeat[];
  /** Opponents that still owe an action on this street. */
  readonly behind: readonly GameSeat[];
  /** Chance that an opponent is still in the hand at showdown: 1 once it has acted, lower for seats yet to face the bet. */
  readonly stays: (seat: GameSeat) => number;
  /** The bet being faced is an opponent's last chip, so no further betting can follow it. */
  readonly facingAllIn: boolean;
  readonly pressure: MatchPressure;
  readonly read: HandRead;
  readonly random: () => number;
  readonly effort: Effort;
}

const MAX_BEHIND_STAYS = 0.7;
const MIN_BEHIND_STAYS = 0.05;

/** Hands left in the match, counting the current one. */
const handsLeft = (visible: HoldemVisibleState): number => Math.max(1, HE_HANDS - visible.hand + 1);

/** How much the last hands weigh: the final hand fully, the middle of the match not at all. */
const HORIZON = [1, 1, 0.75, 0.55, 0.4, 0.3, 0.2, 0.12];
/** Big blinds that typically change hands per hand still to play, as the scale of a deficit or a lead. */
const SWING_BLINDS = 5;

/**
 * Standing against the strongest other stack, measured against the chips the remaining hands can still move: a deficit
 * the remaining hands are unlikely to recover raises urgency, a lead they are unlikely to erase raises caution. On the
 * last hand any deficit is urgent and any lead calls for caution.
 */
export function matchPressure(visible: HoldemVisibleState): MatchPressure {
  const stackOf = (seat: GameSeat): number => visible.chips[seat] + visible.totalBets[seat];
  const rival = Math.max(0, ...visible.seats.filter((seat) => seat !== visible.mySeat).map(stackOf));
  const mine = stackOf(visible.mySeat);
  const left = handsLeft(visible);
  const horizon = HORIZON[left] ?? 0;
  if (horizon === 0 || mine === rival || rival === 0) return { urgency: 0, caution: 0 };
  const swing = visible.bigBlind * SWING_BLINDS * Math.sqrt(left);
  const gap = Math.abs(mine - rival) / swing;
  const weight = left === 1 ? 1 : Math.min(1, 0.3 + gap) * horizon;
  return mine < rival ? { urgency: weight, caution: 0 } : { urgency: 0, caution: weight };
}

function calledPot(visible: HoldemVisibleState, call: number): number {
  const matched = visible.totalBets[visible.mySeat] + call;
  return visible.seats.reduce((sum, other) => sum + (other === visible.mySeat ? matched : Math.min(visible.totalBets[other], matched)), 0);
}

export function buildContext(
  visible: HoldemVisibleState, legal: HeLegalActions, random: () => number, effort: Effort,
): TableContext {
  const seat = visible.mySeat;
  const opponents = heInHand(visible).filter((other) => other !== seat);
  const stack = visible.chips[seat] + visible.streetBets[seat];
  const pot = Object.values(visible.totalBets).reduce((sum, value) => sum + value, 0);
  const behind = opponents.filter((other) => heCanAct(visible, other)
    && (!visible.acted.includes(other) || visible.streetBets[other] < visible.currentBet));
  const startStacks = Object.fromEntries(visible.seats.map((other) => [other, visible.chips[other] + visible.totalBets[other]])) as
    Record<GameSeat, number>;
  const deepest = Math.max(0, ...opponents.map((other) => startStacks[other] ?? 0));
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
    calledPot: calledPot(visible, legal.call),
    chips: visible.chips[seat],
    stack,
    stackBlinds: stack / visible.bigBlind,
    chipsOf: visible.chips,
    startStacks,
    effectiveBlinds: Math.min(startStacks[seat] ?? 0, deepest) / visible.bigBlind,
    opponents,
    behind,
    stays,
    facingAllIn: opponents.some((other) => visible.chips[other] === 0 && visible.streetBets[other] === visible.currentBet && visible.currentBet > 0),
    pressure: matchPressure(visible),
    read: readHand(visible.log, seat, { dealt: visible.dealt, button: visible.button, bigBlind: visible.bigBlind, stacks: startStacks }),
    random,
    effort,
  };
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
