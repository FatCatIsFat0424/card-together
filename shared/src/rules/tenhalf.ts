// ─── Ten and a Half rules (pure functions, shared by client and server) ───
// Rules: docs/games/cards.md#十點半
// Betting, chip stacks, banker rotation, and the shortfall split reuse the Blackjack rules.

import type { Card, GameSeat, TenHalfAction, TenHalfHandKind, TenHalfLogEntry, TenHalfOutcome } from '../types';
import { GAME_SEAT_ORDER } from '../constants';
import { BJ_STARTING_CHIPS, bjProportionalPayouts } from './blackjack';

/** Points are counted in halves so totals stay integers: 10.5 points is 21. */
export const TH_LIMIT = 21;
/** A hand holds at most five cards, the hidden one included. */
export const TH_MAX_CARDS = 5;
export const TH_ACTIONS: readonly TenHalfAction[] = ['hit', 'stand'];

export const TH_OUTCOMES: readonly TenHalfOutcome[] = ['win', 'lose', 'bust'];

/** Payout multiple of each hand kind; an ordinary or busted hand pays 1. */
export const TH_MULTIPLIERS: Readonly<Record<TenHalfHandKind, number>> = {
  bust: 1, points: 1, tenhalf: 2, fivesmall: 3, tianwang: 4, renwuxiao: 5,
};

/** Order of the special hands; ordinary hands compare by points below all of them. */
const SPECIAL_STRENGTH: Readonly<Record<Exclude<TenHalfHandKind, 'bust' | 'points'>, number>> = {
  tenhalf: 100, fivesmall: 200, tianwang: 300, renwuxiao: 400,
};

/** Public table state rebuilt from the log; hole cards stay out until the showdown. */
export interface ThTable {
  hand: number;
  chips: Record<GameSeat, number>;
  /** Chips staked on the hand being played; 0 for the banker and seats sitting out */
  bets: Record<GameSeat, number>;
  /** Chips each seat held before this hand's stakes, which caps what it can lose */
  stacks: Record<GameSeat, number>;
  banker?: GameSeat;
  /** Seats dealt into the hand being played (banker included), ordered N, E, S, W */
  dealt: GameSeat[];
  /** Face-up cards drawn after the hole card */
  ups: Record<GameSeat, Card[]>;
  /** Seats whose hand is finished: stood, or ended by a draw (bust, 10.5, or five cards) */
  done: Record<GameSeat, boolean>;
  /** Hole cards, known once the showdown entry is applied */
  holes: Record<GameSeat, Card | null>;
}

export interface ThSettlement {
  /** Null for the banker and seats sitting out */
  readonly outcomes: Record<GameSeat, TenHalfOutcome | null>;
  readonly net: Record<GameSeat, number>;
  readonly chips: Record<GameSeat, number>;
}

function seatMap<T>(value: (seat: GameSeat) => T): Record<GameSeat, T> {
  return Object.fromEntries(GAME_SEAT_ORDER.map((seat) => [seat, value(seat)])) as Record<GameSeat, T>;
}

/** Half points: A is 1 point, 2-10 their face value, and J/Q/K half a point. */
export function thCardHalves(card: Card): number {
  if (card.rank === 14) return 2;
  return card.rank >= 11 ? 1 : card.rank * 2;
}

export function thHalves(cards: readonly Card[]): number {
  return cards.reduce((sum, card) => sum + thCardHalves(card), 0);
}

/** Display value of a half-point total, such as 10.5 or 3. */
export function thPoints(halves: number): number {
  return halves / 2;
}

/**
 * 人五小: five face cards. 天王: five cards totalling exactly 10.5. 五小: five cards within 10.5.
 * 十點半: exactly 10.5 in fewer than five cards. Anything over 10.5 is a bust. Every card counts at
 * least a half point, so a hand whose half points equal its card count holds only face cards.
 */
export function thKindOf(halves: number, count: number): TenHalfHandKind {
  if (halves > TH_LIMIT) return 'bust';
  if (count >= TH_MAX_CARDS) {
    if (halves === count) return 'renwuxiao';
    return halves === TH_LIMIT ? 'tianwang' : 'fivesmall';
  }
  return halves === TH_LIMIT ? 'tenhalf' : 'points';
}

/** Comparable strength: special hands outrank every ordinary total, and a bust is below everything. */
export function thStrengthOf(halves: number, count: number): number {
  const kind = thKindOf(halves, count);
  if (kind === 'bust') return -1;
  return kind === 'points' ? halves : SPECIAL_STRENGTH[kind];
}

export function thHandKind(cards: readonly Card[]): TenHalfHandKind {
  return thKindOf(thHalves(cards), cards.length);
}

export function thMultiplier(cards: readonly Card[]): number {
  return TH_MULTIPLIERS[thHandKind(cards)];
}

export function thStrength(cards: readonly Card[]): number {
  return thStrengthOf(thHalves(cards), cards.length);
}

/** The hand cannot draw: it busted, reached 10.5, or holds five cards. */
export function thIsMaxed(cards: readonly Card[]): boolean {
  return cards.length >= TH_MAX_CARDS || thHalves(cards) >= TH_LIMIT;
}

/** A player wins only by outranking the banker; equal hands go to the banker. */
export function thOutcome(player: readonly Card[], banker: readonly Card[]): TenHalfOutcome {
  const own = thStrength(player);
  if (own < 0) return 'bust';
  return own > thStrength(banker) ? 'win' : 'lose';
}

/** Next unfinished player in N, E, S, W order, then the banker; null once every seat is done. */
export function thNextTurn(table: Readonly<Pick<ThTable, 'banker' | 'dealt' | 'done'>>): GameSeat | null {
  const pending = table.dealt.find((seat) => seat !== table.banker && !table.done[seat]);
  if (pending) return pending;
  return table.banker && !table.done[table.banker] ? table.banker : null;
}

/**
 * Settles every player against the banker. A winner collects its bet times its own hand's
 * multiple; a loser pays its bet times the banker's multiple (1 when the banker busted), capped at
 * the chips it held before the hand. The banker pays winners out of its own chips plus what it
 * collected; when that falls short, winners share it in proportion to what each is owed.
 * `holes` must hold the hole card of every dealt seat.
 */
export function thSettle(table: Readonly<ThTable>, holes: Readonly<Partial<Record<GameSeat, Card>>>): ThSettlement {
  const banker = table.banker;
  if (!banker) throw new Error('Ten and a Half settles against a banker');
  const cardsOf = (seat: GameSeat): Card[] => {
    const hole = holes[seat];
    if (!hole) throw new Error('Hole card missing');
    return [hole, ...table.ups[seat]];
  };
  const bankerCards = cardsOf(banker);
  const bankerMultiple = thMultiplier(bankerCards);
  const outcomes = seatMap((seat): TenHalfOutcome | null => table.dealt.includes(seat) && seat !== banker
    ? thOutcome(cardsOf(seat), bankerCards) : null);
  const owed = seatMap((seat) => outcomes[seat] === 'win' ? table.bets[seat] * thMultiplier(cardsOf(seat)) : 0);
  const lost = seatMap((seat) => outcomes[seat] === 'lose' || outcomes[seat] === 'bust'
    ? Math.min(table.bets[seat] * bankerMultiple, table.stacks[seat]) : 0);
  const collected = GAME_SEAT_ORDER.reduce((sum, seat) => sum + lost[seat], 0);
  const pool = table.chips[banker] + collected;
  const paid = bjProportionalPayouts(owed, pool, banker);
  const bankerChips = pool - GAME_SEAT_ORDER.reduce((sum, seat) => sum + paid[seat], 0);
  const chips = seatMap((seat) => {
    if (seat === banker) return bankerChips;
    if (outcomes[seat] === null) return table.chips[seat];
    return outcomes[seat] === 'win' ? table.chips[seat] + table.bets[seat] + paid[seat] : table.stacks[seat] - lost[seat];
  });
  return { outcomes, net: seatMap((seat) => chips[seat] - table.stacks[seat]), chips };
}

/** Empty seats hold no chips, so they never bet. */
export function thEmptyTable(seats: readonly GameSeat[]): ThTable {
  const chips = seatMap((seat) => seats.includes(seat) ? BJ_STARTING_CHIPS : 0);
  return {
    hand: 0, chips, bets: seatMap(() => 0), stacks: { ...chips }, dealt: [], ups: seatMap((): Card[] => []),
    done: seatMap(() => false), holes: seatMap((): Card | null => null),
  };
}

/** Applies one public log entry; entries are assumed legal because the server validates first. */
export function thApplyEntry(table: ThTable, entry: TenHalfLogEntry): void {
  switch (entry.type) {
    case 'bet': return;
    case 'deal':
      table.hand = entry.hand;
      table.banker = entry.banker;
      table.stacks = { ...table.chips };
      table.bets = { ...entry.bets };
      for (const seat of GAME_SEAT_ORDER) table.chips[seat] -= entry.bets[seat];
      table.dealt = GAME_SEAT_ORDER.filter((seat) => seat === entry.banker || entry.bets[seat] > 0);
      table.ups = seatMap((): Card[] => []);
      table.done = seatMap(() => false);
      table.holes = seatMap((): Card | null => null);
      return;
    case 'hit':
      table.ups[entry.seat].push(entry.card);
      table.done[entry.seat] = entry.done;
      return;
    case 'stand':
      table.done[entry.seat] = true;
      return;
    case 'showdown':
      table.holes = seatMap((seat) => entry.holes[seat] ?? null);
      return;
    case 'settle':
      table.chips = { ...entry.chips };
  }
}

/** The public table of a match between `seats` after the first `end` log entries. */
export function thReplay(log: readonly TenHalfLogEntry[], seats: readonly GameSeat[], end = log.length): ThTable {
  const table = thEmptyTable(seats);
  for (const entry of log.slice(0, end)) thApplyEntry(table, entry);
  return table;
}
