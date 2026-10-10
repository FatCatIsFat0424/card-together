// ─── Ninety-Nine rules engine (pure functions, shared by client and server) ───
// Rules: docs/games.md#ninety-nine

import type { Card, NinetyNineMatchResult, NinetyNineOptions, Seat } from '../types';

export const NN_HAND_SIZE = 5;
export const NN_MAX = 99;

export type NnChoice = 'plus' | 'minus';

export interface NnEffect {
  total: number;
  reverse: boolean;
  designate: boolean;
}

/** 10 and Q require choosing add or subtract */
export function nnRequiresChoice(card: Card): boolean {
  return card.rank === 10 || card.rank === 12;
}

/** Apply the card effect to get the new total and turn-flow change; throws when 10/Q has no choice */
export function nnApply(total: number, card: Card, choice?: NnChoice): NnEffect {
  const effect: NnEffect = { total, reverse: false, designate: false };
  switch (card.rank) {
    case 14:
      effect.total = card.suit === 'spades' ? 0 : total + 1;
      break;
    case 4:
      effect.reverse = true;
      break;
    case 5:
      effect.designate = true;
      break;
    case 11:
      // J = PASS: the total is unchanged and play moves to the next player
      break;
    case 13:
      effect.total = NN_MAX;
      break;
    case 10:
    case 12: {
      if (!choice) throw new Error('choice required');
      const delta = card.rank === 10 ? 10 : 20;
      effect.total = choice === 'plus' ? total + delta : Math.max(0, total - delta);
      break;
    }
    default:
      effect.total = total + card.rank;
  }
  return effect;
}

/** Some legal choice keeps the running total at or below 99 */
export function nnIsPlayable(total: number, card: Card): boolean {
  const choices: (NnChoice | undefined)[] = nnRequiresChoice(card) ? ['plus', 'minus'] : [undefined];
  return choices.some((choice) => nnApply(total, card, choice).total <= NN_MAX);
}

export function nnHasPlayable(total: number, hand: readonly Card[]): boolean {
  return hand.some((card) => nnIsPlayable(total, card));
}

/** One 52-card deck, or two shuffled together. */
export function nnDeckSize(options?: NinetyNineOptions): number {
  return options?.twoDecks ? 104 : 52;
}

/** Seats tied for first: the last survivor, or every survivor when a two-deck stock ran out. */
export function nnWinners(result: NinetyNineMatchResult): Seat[] {
  return 'winners' in result ? result.winners : [result.winnerSeat];
}

/** Ranks with ties: winners share first; eliminated seats follow in reverse elimination order. */
export function nnRank(result: NinetyNineMatchResult, seat: Seat): number {
  const winners = nnWinners(result);
  return winners.includes(seat) ? 1 : 4 - result.eliminationOrder.indexOf(seat);
}
