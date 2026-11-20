import type { GameSeat, StudVisibleState } from '@shared/types';
import { heInHand } from '@shared/rules/holdem';
import { studApplyEntry, studEmptyTable } from '@shared/rules/stud';
import { cardId } from './holdem-evaluator';
import { studStrength } from './stud-strength';

// A generic model of how a reasonable player bets from its own hand. It serves twice: the bot reads an
// opponent's betting line this hand as evidence about the hole card (the likelihood of the line given each
// possible card), and rollouts play the other seats' future betting with the same probabilities. Nothing here
// remembers a player from an earlier hand.

export interface LineProbabilities {
  readonly fold: number;
  readonly passive: number;
  readonly aggressive: number;
}

export type LineKind = 'fold' | 'passive' | 'aggressive';

/** One betting action an opponent took this hand, with the hand and the price it faced. */
export interface LineObservation {
  readonly seat: GameSeat;
  /** Ids of the opponent's face-up cards when it acted */
  readonly up: readonly number[];
  readonly kind: LineKind;
  /** Chips owed over the pot after paying them */
  readonly odds: number;
  /** Other seats still in the hand */
  readonly rivals: number;
  /** Size of a bet or raise, as a share of the pot after a call */
  readonly size: number;
}

const FLOOR = 0.02;
/** Chance that any seat pays a bet whatever its hand: the table holds loose callers, and a model that folds weak hands every time would overrate bluffs. */
const STAY_FLOOR = 0.3;
/** A line is read at less than full strength: players mix and the model is generic. */
const TEMPER = 0.8;

const sigmoid = (value: number): number => 1 / (1 + Math.exp(-value));

/** Equity needed to bet, by the number of rivals: a clear lead over an even share of the pot. */
export function aggressionBar(rivals: number): number {
  return Math.min(0.75, Math.max(0.38, 1 / (rivals + 1) + 0.22));
}

/** Rough chance of winning against every rival: the strength against one random hand, once per rival. */
export const fieldEquity = (strength: number, rivals: number): number => strength ** Math.max(1, rivals);

/** Pot share of a bet by a hand: bigger when further above the betting bar. */
export function betFraction(strength: number, rivals: number): number {
  const margin = (fieldEquity(strength, rivals) - aggressionBar(rivals)) / 0.3;
  return 0.4 + 0.5 * Math.min(1, Math.max(0, margin));
}

/**
 * How a seat with this strength acts when it owes `odds` (the call as a share of the pot after calling it, 0 when
 * it may check), against `rivals` other seats. Calls need a little more than the price; a raise needs more than a call.
 */
export function lineProbabilities(strength: number, odds: number, rivals: number, margin = 0): LineProbabilities {
  const equity = fieldEquity(strength, rivals);
  const owes = odds > 0;
  const stay = owes ? STAY_FLOOR + (1 - STAY_FLOOR) * sigmoid((equity - odds - 0.04 - margin) / 0.08) : 1;
  const bar = aggressionBar(rivals) + (owes ? 0.05 : 0);
  const raise = 0.06 + 0.88 * sigmoid((equity - bar) / 0.07);
  return { fold: 1 - stay, passive: stay * (1 - raise), aggressive: stay * raise };
}

/** Public betting actions of every seat except the viewer in the current hand, with the table they faced. */
export function lineObservations(visible: StudVisibleState): LineObservation[] {
  const table = studEmptyTable(visible.seats);
  let start = 0;
  visible.log.forEach((entry, index) => { if (entry.type === 'hand') start = index; });
  const observations: LineObservation[] = [];
  visible.log.forEach((entry, index) => {
    if (index >= start && entry.type === 'action' && entry.seat !== visible.mySeat && entry.action !== 'fold') {
      const pot = Object.values(table.totalBets).reduce((sum, bet) => sum + bet, 0);
      const owed = Math.max(0, table.currentBet - table.streetBets[entry.seat]);
      const aggressive = entry.action === 'bet' || entry.action === 'raise';
      observations.push({
        seat: entry.seat,
        up: table.up[entry.seat].map(cardId),
        kind: aggressive ? 'aggressive' : 'passive',
        odds: owed / (pot + owed || 1),
        rivals: Math.max(1, heInHand(table).length - 1),
        size: aggressive ? (entry.to - table.currentBet) / (pot + owed || 1) : 0,
      });
    }
    studApplyEntry(table, entry);
  });
  return observations;
}

/**
 * Relative likelihood of each candidate hole card for a seat: how well the hand it would make explains the
 * seat's betting line. Cards no line favours keep the same weight, so an empty line gives a uniform prior.
 */
export function holeLikelihoods(
  candidates: readonly number[], observations: readonly LineObservation[], seat: GameSeat,
): Float64Array {
  const own = observations.filter((observation) => observation.seat === seat);
  const weights = new Float64Array(candidates.length).fill(1);
  if (own.length === 0) return weights;
  const logs = new Float64Array(candidates.length);
  const cards: number[] = [];
  candidates.forEach((candidate, index) => {
    for (const observation of own) {
      cards.length = 0;
      cards.push(candidate, ...observation.up);
      const strength = studStrength(cards, cards.length);
      const odds = lineProbabilities(strength, observation.odds, observation.rivals);
      let probability = observation.kind === 'aggressive' ? odds.aggressive : odds.passive;
      if (observation.kind === 'aggressive') {
        // Larger bets come from stronger hands; the effect stays mild so that varied sizing does not dominate.
        const expected = betFraction(strength, observation.rivals);
        probability *= Math.max(0.35, Math.exp(-((observation.size - expected) ** 2) / 0.5));
      }
      logs[index] += Math.log(Math.max(FLOOR, probability));
    }
  });
  const top = Math.max(...logs);
  for (let index = 0; index < logs.length; index++) weights[index] = Math.exp(TEMPER * (logs[index] - top));
  return weights;
}
