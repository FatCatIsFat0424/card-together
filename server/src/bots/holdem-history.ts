import type { GameSeat, HoldemLogEntry, HoldemStreet } from '@shared/types';
import { heBlindSeats, heNextSeat } from '@shared/rules/holdem';

// Reads the current hand from the public log: what each seat did, from where, and how large each bet was relative
// to the pot. Nothing carries over from earlier hands, so ranges depend on the action and its size, never on a
// particular player's habits. Hole cards never enter the log before a showdown.

export type PreflopKind = 'none' | 'limp' | 'call' | 'open' | 'reraise' | 'shove' | 'callShove';

export interface PreflopRead {
  readonly kind: PreflopKind;
  /** Seats still to act behind a first-in raise or all-in; for a call of a first-in all-in, that all-in's count. */
  readonly behind: number;
  /** For a call of a first-in all-in: the caller's place among the seats behind it (1 = next). */
  readonly place: number;
  /** Effective stack in big blinds when the seat acted. */
  readonly stackBlinds: number;
  /** Raises before this seat's latest raise. */
  readonly raisesBefore: number;
}

export interface PostflopRead {
  readonly street: Exclude<HoldemStreet, 'preflop'>;
  readonly kind: 'check' | 'call' | 'bet' | 'raise';
  /** A bet or raise: the increment over the current bet as a share of the pot after calling; a call: the bet called. */
  readonly fraction: number;
}

export interface SeatRead {
  readonly preflop: PreflopRead;
  readonly postflop: readonly PostflopRead[];
}

export interface HandRead {
  readonly seats: ReadonlyMap<GameSeat, SeatRead>;
  readonly preflopRaises: number;
  /** Seats that only called the big blind before any raise. */
  readonly limpers: number;
  /** Raises the viewer made preflop this hand. */
  readonly ownPreflopRaises: number;
  /** The seat that made the last preflop raise. */
  readonly preflopAggressor: GameSeat | null;
  /** The viewer already checked on the current street. */
  readonly checkedThisStreet: boolean;
  /** Bets and raises on the current street. */
  readonly streetRaises: number;
}

const NO_PREFLOP: PreflopRead = { kind: 'none', behind: 0, place: 0, stackBlinds: 0, raisesBefore: 0 };

export const seatRead = (read: HandRead, seat: GameSeat): SeatRead => read.seats.get(seat) ?? { preflop: NO_PREFLOP, postflop: [] };

/** Preflop acting order: the seat after the big blind first, the big blind last. */
export function preflopOrder(dealt: readonly GameSeat[], button: GameSeat): GameSeat[] {
  const { big } = heBlindSeats(dealt, button);
  const order: GameSeat[] = [];
  let seat: GameSeat | null = big;
  for (let step = 0; step < dealt.length; step++) {
    seat = heNextSeat(seat ?? big, (candidate) => dealt.includes(candidate));
    if (seat) order.push(seat);
  }
  return order;
}

/** The current hand's table: who was dealt in, the button, the big blind, and each seat's chips when it began. */
export interface HandTable {
  readonly dealt: readonly GameSeat[];
  readonly button: GameSeat;
  readonly bigBlind: number;
  readonly stacks: Readonly<Record<GameSeat, number>>;
}

/** Reads the hand in progress from the log entries after its last `hand` entry. */
export function readHand(log: readonly HoldemLogEntry[], viewer: GameSeat, { dealt, button, bigBlind, stacks }: HandTable): HandRead {
  const start = log.reduce((found, entry, index) => (entry.type === 'hand' ? index : found), -1);
  const hand = start >= 0 ? log[start] : null;
  const order = preflopOrder(dealt, button);
  const reads = new Map<GameSeat, { preflop: PreflopRead; postflop: PostflopRead[] }>();
  const readOf = (seat: GameSeat): { preflop: PreflopRead; postflop: PostflopRead[] } => {
    const found = reads.get(seat) ?? { preflop: NO_PREFLOP, postflop: [] };
    reads.set(seat, found);
    return found;
  };
  const stake = new Map<GameSeat, number>();
  let pot = 0;
  if (hand?.type === 'hand') {
    for (const seat of dealt) {
      const blind = hand.blinds[seat] ?? 0;
      stake.set(seat, blind);
      pot += blind;
    }
  }
  const folded = new Set<GameSeat>();
  let street: HoldemStreet = 'preflop';
  let currentBet = bigBlind;
  let lastFraction = 0;
  let preflopRaises = 0;
  let limpers = 0;
  let ownPreflopRaises = 0;
  let preflopAggressor: GameSeat | null = null;
  let checkedThisStreet = false;
  let streetRaises = 0;
  /** The first raise was an all-in from a seat that nobody had limped in front of. */
  let firstShove: { seat: GameSeat; behind: number } | null = null;

  const effectiveBlinds = (seat: GameSeat): number => {
    const others = dealt.filter((other) => other !== seat && !folded.has(other)).map((other) => stacks[other] ?? 0);
    return Math.min(stacks[seat] ?? 0, Math.max(0, ...others)) / bigBlind;
  };
  const behindOf = (seat: GameSeat): number => {
    const index = order.indexOf(seat);
    return order.slice(index + 1).filter((other) => !folded.has(other)).length;
  };

  for (const entry of log.slice(start + 1)) {
    if (entry.type === 'street') {
      street = entry.street;
      currentBet = 0;
      lastFraction = 0;
      streetRaises = 0;
      checkedThisStreet = false;
      stake.clear();
      continue;
    }
    if (entry.type !== 'action') continue;
    const { seat, action } = entry;
    const read = readOf(seat);
    const before = stake.get(seat) ?? 0;
    const aggressive = action === 'bet' || action === 'raise';
    const added = action === 'call' || aggressive ? Math.max(0, entry.to - before) : 0;
    if (street === 'preflop') {
      if (aggressive) {
        const firstIn = preflopRaises === 0;
        const kind: PreflopKind = entry.allIn ? 'shove' : firstIn ? 'open' : 'reraise';
        if (firstIn && entry.allIn && limpers === 0) firstShove = { seat, behind: behindOf(seat) };
        read.preflop = {
          kind, behind: firstIn ? behindOf(seat) : 0, place: 0, stackBlinds: effectiveBlinds(seat), raisesBefore: preflopRaises,
        };
        preflopRaises += 1;
        preflopAggressor = seat;
        if (seat === viewer) ownPreflopRaises += 1;
      } else if (action === 'call') {
        if (preflopRaises === 0) {
          limpers += 1;
          read.preflop = { ...NO_PREFLOP, kind: 'limp', stackBlinds: effectiveBlinds(seat) };
        } else if (firstShove && preflopRaises === 1) {
          const place = order.indexOf(seat) - order.indexOf(firstShove.seat);
          read.preflop = {
            kind: place > 0 ? 'callShove' : 'call', behind: firstShove.behind, place, stackBlinds: effectiveBlinds(firstShove.seat),
            raisesBefore: preflopRaises,
          };
        } else if (read.preflop.kind === 'none' || read.preflop.kind === 'limp') {
          read.preflop = { ...NO_PREFLOP, kind: 'call', stackBlinds: effectiveBlinds(seat), raisesBefore: preflopRaises };
        }
      }
    } else if (action !== 'fold') {
      const owed = Math.max(0, currentBet - before);
      if (aggressive) {
        const fraction = (entry.to - currentBet) / Math.max(1, pot + owed);
        read.postflop.push({ street, kind: currentBet === 0 ? 'bet' : 'raise', fraction });
        lastFraction = fraction;
        streetRaises += 1;
      } else {
        read.postflop.push({ street, kind: action === 'call' ? 'call' : 'check', fraction: action === 'call' ? lastFraction : 0 });
        if (action === 'check' && seat === viewer) checkedThisStreet = true;
      }
    }
    if (action === 'fold') folded.add(seat);
    pot += added;
    stake.set(seat, before + added);
    if (aggressive) currentBet = Math.max(currentBet, entry.to);
  }
  return { seats: reads, preflopRaises, limpers, ownPreflopRaises, preflopAggressor, checkedThisStreet, streetRaises };
}
