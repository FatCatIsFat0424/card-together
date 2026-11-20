import type { GameSeat } from '@shared/types';
import type { TableContext } from './holdem-context';
import { compileRange, knownIds } from './holdem-equity';
import type { HandWeight, Opponent, Range } from './holdem-equity';
import { seatRead } from './holdem-history';
import { rankFractionOfClass, classIndexOfIds } from './holdem-preflop-table';
import { actionWeight, createBoardPercentile, preflopWeight, productWeight } from './holdem-ranges';

// Each unfolded opponent as a weighted range: generic preflop ranges for the action it took, narrowed after the flop
// by every bet, raise, call and check it made this hand and by the size of each bet. Earlier streets count less,
// because the board has changed since.

const EARLIER_STREET_EXPONENT = 0.6;

export interface OpponentModel extends Opponent {
  readonly seat: GameSeat;
  /** Strength of each pair of `range` from 0 (weakest) to 1: board percentile after the flop, preflop rank before. */
  readonly strength: Float64Array;
}

export function opponentModels(context: TableContext): OpponentModel[] {
  const dead = knownIds(context.hole, context.board);
  const river = context.board.length === 5;
  const percentile = context.board.length >= 3 ? createBoardPercentile(context.board, context.hole) : null;
  const strengthOf = (first: number, second: number): number =>
    (percentile ? percentile(first, second) : 1 - rankFractionOfClass(classIndexOfIds(first, second)));
  return context.opponents.map((seat) => {
    const read = seatRead(context.read, seat);
    const actions = read.postflop;
    const postflop: HandWeight | null = percentile && actions.length > 0
      ? (first, second) => {
        const value = percentile(first, second);
        return actions.reduce((product, action) => {
          const weight = actionWeight(action, value, river);
          return product * (action.street === context.street ? weight : weight ** EARLIER_STREET_EXPONENT);
        }, 1);
      }
      : null;
    const range = compileRange(productWeight([preflopWeight(read.preflop), postflop]), dead);
    const strength = Float64Array.from(range.firsts, (first, index) => strengthOf(first, range.seconds[index]));
    return { seat, range, strength, stays: context.stays(seat) };
  });
}

/** A range over the same pairs with new weights. */
export function reweigh(range: Range, weights: Float64Array): Range {
  const cumulative = new Float64Array(weights.length);
  let total = 0;
  for (let i = 0; i < weights.length; i++) {
    total += weights[i];
    cumulative[i] = total;
  }
  if (total <= 0) return range;
  return { firsts: range.firsts, seconds: range.seconds, weights, cumulative, total };
}

/** The strongest `share` of the model's weight at full weight, the rest at `tail`. */
export function continuingRange(model: OpponentModel, share: number, tail: number): Range {
  const { range, strength } = model;
  const order = Array.from(range.weights.keys()).sort((a, b) => strength[b] - strength[a]);
  const target = share * range.total;
  const weights = new Float64Array(range.weights.length);
  let kept = 0;
  for (const index of order) {
    const weight = range.weights[index];
    weights[index] = kept < target ? weight : weight * tail;
    kept += weight;
  }
  return reweigh(range, weights);
}
