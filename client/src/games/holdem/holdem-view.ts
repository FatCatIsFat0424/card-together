import { frameLogIndex } from '@shared/game-presentation';
import type { PresentationFrame } from '@shared/game-presentation';
import { HE_STARTING_CHIPS, heBestHand, heBlindSeats, heLegalActions, hePots, heReplay } from '@shared/rules/holdem';
import type { HeTableView } from '@shared/rules/holdem';
import type {
  Card, ChinesePokerCategory, HoldemLogEntry, HoldemMatchResult, HoldemPot, HoldemVisibleState, Seat,
} from '@shared/types';

export const HE_SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
/** Board slots, including streets not dealt yet */
export const HE_BOARD_SLOTS = 5;

/** Result of the shown hand once its award has been reached. */
export interface HoldemAwardView {
  readonly pots: readonly HoldemPot[];
  /** Chips each seat collected from the pots */
  readonly payouts: Record<Seat, number>;
  /** Seats that lost their last chip in this hand */
  readonly eliminated: readonly Seat[];
}

/** Public table as the presentation currently shows it. */
export interface HoldemTableView extends HeTableView {
  readonly award: HoldemAwardView | null;
  /** Log entries already shown */
  readonly logEnd: number;
}

function seatMap<T>(value: (seat: Seat) => T): Record<Seat, T> {
  return { N: value('N'), E: value('E'), S: value('S'), W: value('W') };
}

/** Index of the latest `hand` entry before `end`, or -1 before the first deal. */
function handStart(log: readonly HoldemLogEntry[], end: number): number {
  for (let index = Math.min(end, log.length) - 1; index >= 0; index--) {
    if (log[index].type === 'hand') return index;
  }
  return -1;
}

/** The award of the hand shown after the first `end` entries, if it has been reached. */
export function shownAward(log: readonly HoldemLogEntry[], end: number): HoldemAwardView | null {
  const stop = Math.min(end, log.length);
  for (let index = stop - 1; index > handStart(log, stop); index--) {
    const entry = log[index];
    if (entry.type !== 'award') continue;
    const before = heReplay(log, index).chips;
    return {
      pots: entry.pots,
      payouts: seatMap((seat) => Math.max(0, entry.chips[seat] - before[seat])),
      eliminated: entry.eliminated,
    };
  }
  return null;
}

/** The table rebuilt from the public log before `end`. */
export function replayHoldem(log: readonly HoldemLogEntry[], end: number): HoldemTableView {
  return { ...heReplay(log, end), award: shownAward(log, end), logEnd: Math.min(end, log.length) };
}

/**
 * While a frame is presented the table is rebuilt up to that frame's entry, so board cards, bets,
 * showdown cards, awards, and the next hand's blinds never appear before their own frames.
 */
export function holdemView(game: HoldemVisibleState, frame: PresentationFrame | null): HoldemTableView {
  const index = frame ? frameLogIndex(frame) : null;
  if (index !== null) return replayHoldem(game.log, index + 1);
  return { ...game, award: shownAward(game.log, game.log.length), logEnd: game.log.length };
}

/** Hole cards from an earlier hand, kept so a hand still being presented keeps showing them. */
export interface HeldHoleCards {
  readonly hand: number;
  readonly cards: readonly Card[];
}

export interface ShownHoleCards {
  readonly cards: readonly Card[];
  /** The seat holds cards in the shown hand that may not be drawn yet: show two backs */
  readonly hidden: boolean;
}

/**
 * My hole cards for the shown hand. `myHand` may already belong to a later hand whose deal frame
 * has not played, so earlier hands fall back to their showdown, the remembered cards, or backs.
 */
export function shownHoleCards(
  game: Pick<HoldemVisibleState, 'hand' | 'myHand' | 'mySeat'>, view: HoldemTableView, held: HeldHoleCards | null,
): ShownHoleCards {
  const me = game.mySeat;
  if (!view.dealt.includes(me)) return { cards: [], hidden: false };
  if (view.hand === game.hand) return { cards: game.myHand, hidden: false };
  if (view.revealed[me].length > 0) return { cards: view.revealed[me], hidden: false };
  if (held && held.hand === view.hand) return { cards: held.cards, hidden: false };
  return { cards: [], hidden: true };
}

/** Next remembered hole cards when the store receives `next` after `previous`. */
export function nextHeldHoleCards(
  previous: Pick<HoldemVisibleState, 'hand' | 'myHand'> | null, next: Pick<HoldemVisibleState, 'hand'>,
  held: HeldHoleCards | null,
): HeldHoleCards | null {
  if (previous && previous.hand < next.hand) {
    return previous.myHand.length > 0 ? { hand: previous.hand, cards: previous.myHand } : null;
  }
  return held && held.hand < next.hand ? held : null;
}

/** Category of the best five cards once the board has at least three cards. */
export function holdemCategory(hole: readonly Card[], board: readonly Card[]): ChinesePokerCategory | null {
  if (hole.length === 0 || board.length < 3 || hole.length + board.length < 5) return null;
  return heBestHand([...hole, ...board]).category;
}

export interface HoldemBlindSeats { readonly button: Seat; readonly small: Seat; readonly big: Seat }

export function holdemBlindSeats(view: HeTableView): HoldemBlindSeats | null {
  if (view.hand === 0 || view.dealt.length < 2) return null;
  return { button: view.button, ...heBlindSeats(view.dealt, view.button) };
}

/** Every chip staked this hand, including the current street. */
export function potTotal(view: HeTableView): number {
  return HE_SEATS.reduce((sum, seat) => sum + view.totalBets[seat], 0);
}

export interface PotLine {
  readonly amount: number;
  readonly eligible: readonly Seat[];
  readonly winners: readonly Seat[];
  /** Excess only its owner staked, returned rather than won */
  readonly returned: boolean;
}

/**
 * Main and side pots to display. During a street only chips from finished streets are split into
 * pots (current bets sit in front of each seat); after showdown or the award every stake counts.
 */
export function potLines(view: HoldemTableView): PotLine[] {
  const mark = (pots: readonly { amount: number; eligible: readonly Seat[]; winners?: readonly Seat[] }[]): PotLine[] =>
    pots.map((pot, index) => ({
      amount: pot.amount,
      eligible: pot.eligible,
      winners: pot.winners ?? [],
      returned: pots.length > 1 && index === pots.length - 1 && pot.eligible.length === 1,
    }));
  if (view.award) return mark(view.award.pots);
  const settled = HE_SEATS.some((seat) => view.revealed[seat].length > 0);
  const table = settled ? view
    : { ...view, totalBets: seatMap((seat) => view.totalBets[seat] - view.streetBets[seat]) };
  return mark(hePots(table));
}

export type SeatAction = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allIn';

/** Each seat's latest action on the shown street. */
export function streetActions(log: readonly HoldemLogEntry[], end: number): Partial<Record<Seat, SeatAction>> {
  const actions: Partial<Record<Seat, SeatAction>> = {};
  for (let index = Math.min(end, log.length) - 1; index >= 0; index--) {
    const entry = log[index];
    if (entry.type === 'hand' || entry.type === 'street') break;
    if (entry.type === 'action' && !actions[entry.seat]) actions[entry.seat] = entry.allIn ? 'allIn' : entry.action;
  }
  return actions;
}

/** Chips an action at `index` added to the seat's stake on its street. */
export function chipsAdded(log: readonly HoldemLogEntry[], index: number): number {
  const entry = log[index];
  if (entry?.type !== 'action') return 0;
  for (let previous = index - 1; previous >= 0; previous--) {
    const earlier = log[previous];
    if (earlier.type === 'street') return entry.to;
    if (earlier.type === 'hand') return entry.to - earlier.blinds[entry.seat];
    if (earlier.type === 'action' && earlier.seat === entry.seat && earlier.action !== 'fold') return entry.to - earlier.to;
  }
  return entry.to;
}

export type SeatState = 'out' | 'folded' | 'allIn' | 'active' | 'waiting';

/** Out: lost every chip; waiting: not dealt into the shown hand (before the first deal). */
export function seatState(view: HeTableView, seat: Seat): SeatState {
  if (view.eliminated.includes(seat)) return 'out';
  if (!view.dealt.includes(seat)) return 'waiting';
  if (view.folded.includes(seat)) return 'folded';
  return view.chips[seat] === 0 && view.totalBets[seat] > 0 ? 'allIn' : 'active';
}

export interface RaiseControl {
  readonly min: number;
  readonly max: number;
  /** Nothing has been bet on this street, so the control bets rather than raises */
  readonly bet: boolean;
}

export interface HoldemControls {
  readonly check: boolean;
  /** Chips a call adds; 0 when nothing is owed */
  readonly call: number;
  /** The call puts every remaining chip in */
  readonly callAllIn: boolean;
  readonly raise: RaiseControl | null;
}

/** Controls for the local seat; null unless it owes an action and the table is ready. */
export function holdemControls(game: HoldemVisibleState, ready: boolean): HoldemControls | null {
  if (!ready || game.phase !== 'playing' || game.currentTurnSeat !== game.mySeat) return null;
  const legal = heLegalActions(game, game.mySeat);
  if (!legal) return null;
  return {
    check: legal.check,
    call: legal.call,
    callAllIn: legal.call > 0 && legal.call === game.chips[game.mySeat],
    raise: legal.raise && { ...legal.raise, bet: game.currentBet === 0 },
  };
}

/** Nearest whole street total within the legal range. */
export function clampRaise(value: number, range: Pick<RaiseControl, 'min' | 'max'>): number {
  if (!Number.isFinite(value)) return range.min;
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

export type QuickSize = 'min' | 'halfPot' | 'pot' | 'allIn';
export const QUICK_SIZES: readonly QuickSize[] = ['min', 'halfPot', 'pot', 'allIn'];

/**
 * Street totals for the shortcuts. A pot-sized raise first calls, then raises by the pot after
 * that call; half pot raises by half of it. Every size is clamped to the legal range.
 */
export function quickRaise(size: QuickSize, view: HeTableView, seat: Seat, range: Pick<RaiseControl, 'min' | 'max'>): number {
  if (size === 'min') return range.min;
  if (size === 'allIn') return range.max;
  const owed = Math.max(0, view.currentBet - view.streetBets[seat]);
  const potAfterCall = potTotal(view) + owed;
  return clampRaise(view.currentBet + (size === 'pot' ? potAfterCall : Math.floor(potAfterCall / 2)), range);
}

export type RaiseKind = 'bet' | 'raise' | 'allIn';

/** Label for the confirm button: committing every chip is an all-in. */
export function raiseKind(to: number, control: RaiseControl): RaiseKind {
  if (to >= control.max) return 'allIn';
  return control.bet ? 'bet' : 'raise';
}

/** Newest first, limited to `limit` entries of the shown log. */
export function recentHoldemMoves(log: readonly HoldemLogEntry[], end: number, limit: number): HoldemLogEntry[] {
  return limit > 0 ? log.slice(0, end).slice(-limit).reverse() : [];
}

export interface HoldemRanking {
  readonly seat: Seat;
  readonly place: number;
  readonly chips: number;
  readonly net: number;
  readonly winner: boolean;
  readonly eliminated: boolean;
}

/** Final standings: chips first (ties share a place), then busted seats, last to bust highest. */
export function rankHoldem(result: HoldemMatchResult): HoldemRanking[] {
  const out = (seat: Seat): number => result.eliminationOrder.indexOf(seat);
  const sorted = [...HE_SEATS].sort((a, b) => result.chips[b] - result.chips[a] || out(b) - out(a));
  return sorted.map((seat, index) => {
    const eliminated = out(seat) >= 0;
    return {
      seat,
      place: eliminated ? index + 1 : sorted.findIndex((other) => result.chips[other] === result.chips[seat]) + 1,
      chips: result.chips[seat],
      net: result.chips[seat] - HE_STARTING_CHIPS,
      winner: result.winners.includes(seat),
      eliminated,
    };
  });
}

export function signedChips(value: number): string {
  return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '±0';
}
