// ─── Five-card stud rules (pure functions, shared by client and server) ───
// Rules: docs/games/cards.md#梭哈. Betting, pots, and showdown ranking come from the Hold'em module.

import type { Card, StudLogEntry, StudStreet, Suit, GameSeat } from '../types';
import { GAME_SEAT_ORDER } from '../constants';
import {
  HE_HANDS, HE_STARTING_CHIPS, heApplyBet, heBestHand, heBettingClosed, heBlinds, heInHand, heNeedsAction, heNextSeat,
  heNextToAct, hePayouts,
} from './holdem';
import type { HeAward, HeBettingTable, HeBettingView } from './holdem';

export const STUD_STARTING_CHIPS = HE_STARTING_CHIPS;
/** Hands per match unless one seat wins every chip first */
export const STUD_HANDS = HE_HANDS;
export const STUD_STREETS: readonly StudStreet[] = [2, 3, 4, 5];
export const STUD_FINAL_STREET: StudStreet = 5;

/** Showing-hand ties break by the suit of the deciding card, spades highest. */
export const STUD_SUIT_RANK: Readonly<Record<Suit, number>> = { clubs: 0, diamonds: 1, hearts: 2, spades: 3 };

/** Public table state rebuilt from the log. */
export interface StudTable extends HeBettingTable {
  hand: number;
  button: GameSeat;
  ante: number;
  minBet: number;
  dealt: GameSeat[];
  street: StudStreet;
  up: Record<GameSeat, Card[]>;
  revealed: Record<GameSeat, Card[]>;
  eliminated: GameSeat[];
}

/** Read-only form accepted by every query, so a player's visible state can be passed directly. */
export interface StudTableView extends HeBettingView {
  readonly hand: number;
  readonly button: GameSeat;
  readonly ante: number;
  readonly minBet: number;
  readonly street: StudStreet;
  readonly up: Readonly<Record<GameSeat, readonly Card[]>>;
  readonly revealed: Readonly<Record<GameSeat, readonly Card[]>>;
  readonly eliminated: readonly GameSeat[];
}

function seatMap<T>(value: (seat: GameSeat) => T): Record<GameSeat, T> {
  return Object.fromEntries(GAME_SEAT_ORDER.map((seat) => [seat, value(seat)])) as Record<GameSeat, T>;
}

/** The ante rises with the Hold'em small blind schedule; the minimum bet equals its big blind. */
export function studStakes(hand: number): { ante: number; minBet: number } {
  const { smallBlind, bigBlind } = heBlinds(hand);
  return { ante: smallBlind, minBet: bigBlind };
}

/**
 * Orders showing cards best first. Only pairs, trips, and fours count (no straights or flushes
 * among up cards); equal rank patterns fall back to the suits of the deciding cards. Both hands
 * must hold the same number of cards. Positive when `a` is stronger.
 */
export function studCompareShowing(a: readonly Card[], b: readonly Card[]): number {
  const key = (cards: readonly Card[]): { counts: number[]; ranks: number[]; suits: number[] } => {
    const groups = new Map<number, { count: number; suit: number }>();
    for (const card of cards) {
      const group = groups.get(card.rank) ?? { count: 0, suit: -1 };
      group.count += 1;
      group.suit = Math.max(group.suit, STUD_SUIT_RANK[card.suit]);
      groups.set(card.rank, group);
    }
    const sorted = [...groups].sort(([rankA, a2], [rankB, b2]) => b2.count - a2.count || rankB - rankA);
    return { counts: sorted.map(([, group]) => group.count), ranks: sorted.map(([rank]) => rank),
      suits: sorted.map(([, group]) => group.suit) };
  };
  const left = key(a);
  const right = key(b);
  for (const field of ['counts', 'ranks', 'suits'] as const) {
    for (let index = 0; index < Math.min(left[field].length, right[field].length); index++) {
      if (left[field][index] !== right[field][index]) return left[field][index] - right[field][index];
    }
  }
  return 0;
}

/** Unfolded seats ordered strongest showing hand first; equal hands keep seat order. */
export function studShowingOrder(table: Pick<StudTableView, 'dealt' | 'folded' | 'up'>): GameSeat[] {
  return [...heInHand(table)].sort((a, b) => studCompareShowing(table.up[b], table.up[a]));
}

/**
 * The strongest showing hand opens each street, or the next seat clockwise that can still act when
 * that hand is all in. Null once betting is closed.
 */
export function studFirstToAct(table: StudTableView): GameSeat | null {
  if (heBettingClosed(table)) return null;
  const best = studShowingOrder(table)[0];
  return heNeedsAction(table, best) ? best : heNextSeat(best, (seat) => heNeedsAction(table, seat));
}

/** Next seat clockwise that owes an action, or null once betting is closed. */
export const studNextToAct = heNextToAct;

/** The five-card hand of a seat whose hole card is known. */
export function studHand(hole: readonly Card[], up: readonly Card[]): ReturnType<typeof heBestHand> {
  return heBestHand([...hole, ...up]);
}

/** Awards every pot to its best five cards; odd chips go clockwise from the button. */
export function studAward(table: StudTableView): HeAward {
  return hePayouts(table, (seat) => studHand(table.revealed[seat], table.up[seat]));
}

/** Empty seats hold no chips, so they are never dealt in or hold the button. */
export function studEmptyTable(seats: readonly GameSeat[]): StudTable {
  return {
    hand: 0,
    button: 'N',
    ante: 0,
    minBet: 0,
    chips: seatMap((seat) => seats.includes(seat) ? STUD_STARTING_CHIPS : 0),
    streetBets: seatMap(() => 0),
    totalBets: seatMap(() => 0),
    dealt: [],
    folded: [],
    street: 2,
    up: seatMap(() => []),
    currentBet: 0,
    minRaise: 0,
    acted: [],
    revealed: seatMap(() => []),
    eliminated: [],
  };
}

/** Applies one public log entry. */
export function studApplyEntry(table: StudTable, entry: StudLogEntry): void {
  switch (entry.type) {
    case 'hand':
      table.hand = entry.hand;
      table.button = entry.button;
      table.ante = entry.ante;
      table.minBet = entry.minBet;
      table.dealt = GAME_SEAT_ORDER.filter((seat) => table.chips[seat] > 0);
      table.chips = seatMap((seat) => table.chips[seat] - entry.antes[seat]);
      table.streetBets = seatMap(() => 0);
      table.totalBets = { ...entry.antes };
      table.folded = [];
      table.street = 2;
      table.up = seatMap(() => []);
      table.currentBet = 0;
      table.minRaise = entry.minBet;
      table.acted = [];
      table.revealed = seatMap(() => []);
      return;
    case 'street':
      table.street = entry.street;
      table.up = seatMap((seat) => [...table.up[seat], ...entry.cards[seat]]);
      table.streetBets = seatMap(() => 0);
      table.currentBet = 0;
      table.minRaise = table.minBet;
      table.acted = [];
      return;
    case 'action':
      heApplyBet(table, entry);
      return;
    case 'showdown':
      table.revealed = seatMap((seat) => [...entry.cards[seat]]);
      return;
    case 'award':
      // The entry already holds the evaluated showdown: the server derives it from studAward and
      // log validation recomputes it, so replays skip re-ranking every hand.
      table.eliminated = [...table.eliminated, ...entry.eliminated];
      table.chips = seatMap((seat) => entry.chips[seat]);
      table.streetBets = seatMap(() => 0);
      table.totalBets = seatMap(() => 0);
      table.currentBet = 0;
  }
}

/** The public table of a match between `seats` after the first `end` log entries. */
export function studReplay(log: readonly StudLogEntry[], seats: readonly GameSeat[], end = log.length): StudTable {
  const table = studEmptyTable(seats);
  for (const entry of log.slice(0, end)) studApplyEntry(table, entry);
  return table;
}
