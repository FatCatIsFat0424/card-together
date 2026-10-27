// ─── Texas Hold'em rules engine (pure functions, shared by client and server) ───
// Rules: docs/games/cards.md#德州撲克

import type { Card, HoldemLogEntry, HoldemPot, HoldemStreet, GameSeat } from '../types';
import { GAME_SEAT_ORDER } from '../constants';
import { cpCompare, cpEvaluate } from './chinesepoker';
import type { CpEvaluation } from './chinesepoker';
import { nextGameSeat } from './seats';

export const HE_STARTING_CHIPS = 1000;
/** Hands per match unless one seat wins every chip first */
export const HE_HANDS = 20;
export const HE_HANDS_PER_LEVEL = 4;
/** Small and big blinds, rising every four hands */
export const HE_BLIND_LEVELS: readonly (readonly [number, number])[] = [[10, 20], [15, 30], [25, 50], [40, 80], [60, 120]];
export const HE_HOLE_CARDS = 2;
export const HE_STREET_CARDS: Record<Exclude<HoldemStreet, 'preflop'>, number> = { flop: 3, turn: 1, river: 1 };

/** Public table state rebuilt from the log. */
export interface HeTable {
  hand: number;
  button: GameSeat;
  smallBlind: number;
  bigBlind: number;
  chips: Record<GameSeat, number>;
  streetBets: Record<GameSeat, number>;
  totalBets: Record<GameSeat, number>;
  dealt: GameSeat[];
  folded: GameSeat[];
  street: HoldemStreet;
  board: Card[];
  currentBet: number;
  minRaise: number;
  acted: GameSeat[];
  revealed: Record<GameSeat, Card[]>;
  eliminated: GameSeat[];
}

/** Read-only form accepted by every query, so a player's visible state can be passed directly. */
export interface HeTableView {
  readonly hand: number;
  readonly button: GameSeat;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly chips: Readonly<Record<GameSeat, number>>;
  readonly streetBets: Readonly<Record<GameSeat, number>>;
  readonly totalBets: Readonly<Record<GameSeat, number>>;
  readonly dealt: readonly GameSeat[];
  readonly folded: readonly GameSeat[];
  readonly street: HoldemStreet;
  readonly board: readonly Card[];
  readonly currentBet: number;
  readonly minRaise: number;
  readonly acted: readonly GameSeat[];
  readonly revealed: Readonly<Record<GameSeat, readonly Card[]>>;
  readonly eliminated: readonly GameSeat[];
}

export interface HeLegalActions {
  readonly fold: boolean;
  readonly check: boolean;
  /** Chips a call adds, capped by the seat's chips; 0 when nothing is owed */
  readonly call: number;
  /** Street totals a bet or raise may reach; `min` equals `max` for a short all-in */
  readonly raise: { readonly min: number; readonly max: number } | null;
}

export interface HeAward {
  readonly pots: HoldemPot[];
  readonly payouts: Record<GameSeat, number>;
}

function seatMap<T>(value: (seat: GameSeat) => T): Record<GameSeat, T> {
  return Object.fromEntries(GAME_SEAT_ORDER.map((seat) => [seat, value(seat)])) as Record<GameSeat, T>;
}

const ordered = (seats: Iterable<GameSeat>): GameSeat[] => {
  const set = new Set(seats);
  return GAME_SEAT_ORDER.filter((seat) => set.has(seat));
};

export function heBlinds(hand: number): { smallBlind: number; bigBlind: number } {
  const level = HE_BLIND_LEVELS[Math.min(HE_BLIND_LEVELS.length - 1, Math.floor((hand - 1) / HE_HANDS_PER_LEVEL))];
  return { smallBlind: level[0], bigBlind: level[1] };
}

/** First seat clockwise after `seat` that satisfies `include`, possibly `seat` itself last. */
export function heNextSeat(seat: GameSeat, include: (candidate: GameSeat) => boolean): GameSeat | null {
  let next = nextGameSeat(seat);
  for (let step = 0; step < GAME_SEAT_ORDER.length; step++) {
    if (include(next)) return next;
    next = nextGameSeat(next);
  }
  return null;
}

/** The button moves clockwise to the next seat that still has chips. */
export function heNextButton(previous: GameSeat, chips: Readonly<Record<GameSeat, number>>): GameSeat {
  return heNextSeat(previous, (seat) => chips[seat] > 0) ?? previous;
}

/** Heads-up, the button posts the small blind; otherwise the next two dealt seats post. */
export function heBlindSeats(dealt: readonly GameSeat[], button: GameSeat): { small: GameSeat; big: GameSeat } {
  const small = dealt.length === 2 ? button : heNextSeat(button, (seat) => dealt.includes(seat)) ?? button;
  return { small, big: heNextSeat(small, (seat) => dealt.includes(seat)) ?? small };
}

export function heInHand(table: HeTableView): GameSeat[] {
  return table.dealt.filter((seat) => !table.folded.includes(seat));
}

/** An unfolded seat with chips behind can still act; an all-in seat cannot. */
export function heCanAct(table: HeTableView, seat: GameSeat): boolean {
  return table.dealt.includes(seat) && !table.folded.includes(seat) && table.chips[seat] > 0;
}

function needsAction(table: HeTableView, seat: GameSeat): boolean {
  return heCanAct(table, seat) && (!table.acted.includes(seat) || table.streetBets[seat] < table.currentBet);
}

/**
 * Betting on a street is over once one seat remains, nobody owes an action, or at most one seat
 * can act and it has matched the stake (raising against all-in seats is pointless).
 */
export function heBettingClosed(table: HeTableView): boolean {
  const inHand = heInHand(table);
  if (inHand.length <= 1) return true;
  const active = inHand.filter((seat) => heCanAct(table, seat));
  if (!active.some((seat) => needsAction(table, seat))) return true;
  return active.length <= 1 && active.every((seat) => table.streetBets[seat] >= table.currentBet);
}

/** Next seat clockwise after `seat` that owes an action, or null once betting is closed. */
export function heNextToAct(table: HeTableView, seat: GameSeat): GameSeat | null {
  if (heBettingClosed(table)) return null;
  return heNextSeat(seat, (candidate) => needsAction(table, candidate));
}

/** Preflop the seat after the big blind opens; later streets start after the button. */
export function heFirstToAct(table: HeTableView): GameSeat | null {
  const anchor = table.street === 'preflop' ? heBlindSeats(table.dealt, table.button).big : table.button;
  return heNextToAct(table, anchor);
}

export function heLegalActions(table: HeTableView, seat: GameSeat): HeLegalActions | null {
  if (!needsAction(table, seat)) return null;
  const owed = table.currentBet - table.streetBets[seat];
  const max = table.streetBets[seat] + table.chips[seat];
  const opponentCanAct = heInHand(table).some((other) => other !== seat && heCanAct(table, other));
  const canRaise = !table.acted.includes(seat) && max > table.currentBet && opponentCanAct;
  return {
    fold: true,
    check: owed === 0,
    call: Math.min(Math.max(owed, 0), table.chips[seat]),
    raise: canRaise ? { min: Math.min(max, table.currentBet + table.minRaise), max } : null,
  };
}

/** Best five of the given cards; A2345 is the lowest straight and suits never break ties. */
export function heBestHand(cards: readonly Card[]): CpEvaluation {
  if (cards.length < 5) throw new RangeError('A poker hand needs five cards');
  let best = cpEvaluate(cards.slice(0, 5));
  const n = cards.length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) {
    for (let d = c + 1; d < n; d++) for (let e = d + 1; e < n; e++) {
      const evaluation = cpEvaluate([cards[a], cards[b], cards[c], cards[d], cards[e]]);
      if (cpCompare(evaluation, best) > 0) best = evaluation;
    }
  }
  return best;
}

/**
 * Stakes split into layers by contribution level; unfolded seats that reached a layer are its
 * eligible winners. Adjacent layers with the same eligible seats merge into one pot.
 */
export function hePots(table: HeTableView): { amount: number; eligible: GameSeat[] }[] {
  const inHand = heInHand(table);
  const levels = [...new Set(table.dealt.map((seat) => table.totalBets[seat]).filter((value) => value > 0))]
    .sort((a, b) => a - b);
  const pots: { amount: number; eligible: GameSeat[] }[] = [];
  let previous = 0;
  for (const level of levels) {
    const amount = GAME_SEAT_ORDER.reduce((sum, seat) =>
      sum + Math.max(0, Math.min(table.totalBets[seat], level) - previous), 0);
    const eligible = inHand.filter((seat) => table.totalBets[seat] >= level);
    previous = level;
    if (amount === 0) continue;
    const last = pots.at(-1);
    // A layer nobody unfolded reached (folded excess) joins the previous pot.
    if (last && (eligible.length === 0 || last.eligible.join() === eligible.join())) last.amount += amount;
    else pots.push({ amount, eligible: eligible.length > 0 ? eligible : inHand });
  }
  return pots;
}

/** Awards every pot to its best eligible hand; odd chips go clockwise from the button. */
export function heAward(table: HeTableView): HeAward {
  const payouts = seatMap(() => 0);
  const pots = hePots(table).map(({ amount, eligible }) => {
    let winners = eligible;
    if (eligible.length > 1) {
      const scored = eligible.map((seat) => ({ seat, hand: heBestHand([...table.revealed[seat], ...table.board]) }));
      const best = scored.reduce((top, entry) => (cpCompare(entry.hand, top.hand) > 0 ? entry : top));
      winners = scored.filter((entry) => cpCompare(entry.hand, best.hand) === 0).map((entry) => entry.seat);
    }
    const share = Math.floor(amount / winners.length);
    let remainder = amount - share * winners.length;
    for (const seat of winners) payouts[seat] += share;
    for (let seat = heNextSeat(table.button, (candidate) => winners.includes(candidate)); remainder > 0 && seat;
      seat = heNextSeat(seat, (candidate) => winners.includes(candidate))) {
      payouts[seat] += 1;
      remainder -= 1;
    }
    return { amount, eligible, winners: ordered(winners) };
  });
  return { pots, payouts };
}

/** Dealt seats left without chips, smaller starting stacks first, then N, E, S, W. */
export function heEliminations(table: HeTableView, chips: Readonly<Record<GameSeat, number>>): GameSeat[] {
  return table.dealt.filter((seat) => chips[seat] === 0)
    .sort((a, b) => table.totalBets[a] - table.totalBets[b] || GAME_SEAT_ORDER.indexOf(a) - GAME_SEAT_ORDER.indexOf(b));
}

/** Most chips, ties included, ordered N, E, S, W. */
export function heWinners(chips: Readonly<Record<GameSeat, number>>): GameSeat[] {
  const best = Math.max(...GAME_SEAT_ORDER.map((seat) => chips[seat]));
  return GAME_SEAT_ORDER.filter((seat) => chips[seat] === best);
}

/** The match ends after the last hand or once a single seat holds chips. */
export function heMatchOver(table: HeTableView): boolean {
  return table.hand >= HE_HANDS || GAME_SEAT_ORDER.filter((seat) => table.chips[seat] > 0).length <= 1;
}

/** Empty seats hold no chips, so they are never dealt in, hold the button, or post blinds. */
export function heEmptyTable(seats: readonly GameSeat[]): HeTable {
  return {
    hand: 0,
    button: 'N',
    smallBlind: 0,
    bigBlind: 0,
    chips: seatMap((seat) => seats.includes(seat) ? HE_STARTING_CHIPS : 0),
    streetBets: seatMap(() => 0),
    totalBets: seatMap(() => 0),
    dealt: [],
    folded: [],
    street: 'preflop',
    board: [],
    currentBet: 0,
    minRaise: 0,
    acted: [],
    revealed: seatMap(() => []),
    eliminated: [],
  };
}

/**
 * Applies one public log entry. A raise of at least the previous increment reopens betting for
 * every other seat; a shorter all-in raise must be called but does not let earlier actors raise.
 */
export function heApplyEntry(table: HeTable, entry: HoldemLogEntry): void {
  switch (entry.type) {
    case 'hand':
      table.hand = entry.hand;
      table.button = entry.button;
      table.smallBlind = entry.smallBlind;
      table.bigBlind = entry.bigBlind;
      table.dealt = GAME_SEAT_ORDER.filter((seat) => table.chips[seat] > 0);
      table.chips = seatMap((seat) => table.chips[seat] - entry.blinds[seat]);
      table.streetBets = { ...entry.blinds };
      table.totalBets = { ...entry.blinds };
      table.folded = [];
      table.street = 'preflop';
      table.board = [];
      table.currentBet = entry.bigBlind;
      table.minRaise = entry.bigBlind;
      table.acted = [];
      table.revealed = seatMap(() => []);
      return;
    case 'action': {
      const { seat } = entry;
      if (entry.action === 'fold') {
        table.folded = ordered([...table.folded, seat]);
        return;
      }
      const added = entry.to - table.streetBets[seat];
      table.chips[seat] -= added;
      table.streetBets[seat] = entry.to;
      table.totalBets[seat] += added;
      const increment = entry.to - table.currentBet;
      if (increment > 0) {
        table.currentBet = entry.to;
        if (increment >= table.minRaise) {
          table.minRaise = increment;
          table.acted = [seat];
          return;
        }
      }
      table.acted = ordered([...table.acted, seat]);
      return;
    }
    case 'street':
      table.street = entry.street;
      table.board = [...table.board, ...entry.cards];
      table.streetBets = seatMap(() => 0);
      table.currentBet = 0;
      table.minRaise = table.bigBlind;
      table.acted = [];
      return;
    case 'showdown':
      table.revealed = seatMap((seat) => [...entry.cards[seat]]);
      return;
    case 'award':
      // The entry already holds the evaluated showdown: the server derives it from heAward and
      // log validation recomputes it, so replays skip re-ranking every hand.
      table.eliminated = [...table.eliminated, ...entry.eliminated];
      table.chips = seatMap((seat) => entry.chips[seat]);
      table.streetBets = seatMap(() => 0);
      table.totalBets = seatMap(() => 0);
      table.currentBet = 0;
  }
}

/** The public table of a match between `seats` after the first `end` log entries. */
export function heReplay(log: readonly HoldemLogEntry[], seats: readonly GameSeat[], end = log.length): HeTable {
  const table = heEmptyTable(seats);
  for (const entry of log.slice(0, end)) heApplyEntry(table, entry);
  return table;
}
