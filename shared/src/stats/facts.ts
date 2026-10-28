import type { Card, GameSeat, ReplaySnapshot } from '../types';

/** What one seat added to its counters in one match, besides the generic counters of its standing. */
export interface SeatFacts {
  /** Occurrences added to `GameStats.counts`; absent keys add nothing */
  readonly counts: Readonly<Record<string, number>>;
  /** Signed amounts added to `GameStats.sums` */
  readonly sums: Readonly<Record<string, number>>;
  /** This match's value of each `max`/`min` record the seat reached */
  readonly values: Readonly<Record<string, number>>;
}

export interface FactsBuilder extends SeatFacts {
  count(id: string, amount?: number): void;
  sum(id: string, amount: number): void;
  value(id: string, value: number): void;
}

export function factsBuilder(): FactsBuilder {
  const counts: Record<string, number> = {};
  const sums: Record<string, number> = {};
  const values: Record<string, number> = {};
  return {
    counts, sums, values,
    count: (id, amount = 1) => { if (amount > 0) counts[id] = (counts[id] ?? 0) + amount; },
    sum: (id, amount) => { sums[id] = (sums[id] ?? 0) + amount; },
    value: (id, value) => { values[id] = value; },
  };
}

/** The final frame narrowed to one game, or null without a recorded log. */
export function frameOf<T extends ReplaySnapshot['gameType']>(
  frame: ReplaySnapshot | null, gameType: T,
): Extract<ReplaySnapshot, { readonly gameType: T }> | null {
  return frame?.gameType === gameType ? frame as Extract<ReplaySnapshot, { readonly gameType: T }> : null;
}

export function isCard(card: Card | null | undefined, suit: Card['suit'], rank: Card['rank']): boolean {
  return card?.suit === suit && card.rank === rank;
}

/** Per-seat values; games without a `seats` list only use compass seats. */
export function seatValue(values: Readonly<Partial<Record<GameSeat, number>>>, seat: GameSeat): number {
  return values[seat] ?? 0;
}
