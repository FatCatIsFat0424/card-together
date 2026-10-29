// ─── Dou Dizhu rules engine (pure functions, shared by client and server) ───
// Rules: docs/games/cards.md#鬥地主

import type { CardOrJoker, GameSeat } from '../types';
import { cardKey, createJokerDeck, isJoker, removeCards } from './cards';

/** Deals in one match. */
export const DDZ_DEALS = 6;
/** Cards each player holds after the deal; the landlord adds the three bottom cards. */
export const DDZ_HAND_SIZE = 17;
export const DDZ_BOTTOM_SIZE = 3;
/** Redeals after an auction nobody bid in; the next all-pass auction makes its first caller the landlord. */
export const DDZ_MAX_REDEALS = 3;
/** Auction variants: bid 1-3 points, or call and then grab for a doubled base. */
export type DdzVariant = 'score' | 'grab';

export type DdzComboType =
  | 'single' | 'pair' | 'triple' | 'tripleSingle' | 'triplePair' | 'straight' | 'pairStraight'
  | 'airplane' | 'airplaneSingle' | 'airplanePair' | 'fourSingles' | 'fourPairs' | 'bomb' | 'rocket';

export interface DdzCombo {
  readonly type: DdzComboType;
  /** Power of the lowest rank in the chain (or of the repeated rank) */
  readonly power: number;
  /** Ranks in a chain or groups in an airplane; 1 otherwise */
  readonly length: number;
  readonly size: number;
}

export interface DdzMove {
  readonly cards: CardOrJoker[];
  readonly combo: DdzCombo;
}

/** Power of 3 is 3, A is 14, 2 is 15, the small joker 16 and the big joker 17. */
export function ddzPower(card: CardOrJoker): number {
  if (isJoker(card)) return card.joker === 'big' ? 17 : 16;
  return card.rank === 2 ? 15 : card.rank;
}

const SUIT_TIE: Readonly<Record<string, number>> = { clubs: 0, diamonds: 1, hearts: 2, spades: 3 };

const suitOf = (card: CardOrJoker): number => (isJoker(card) ? 0 : SUIT_TIE[card.suit]);

/** Strongest first, the order a hand reads from the left. */
export function sortDdzHand<T extends CardOrJoker>(cards: readonly T[]): T[] {
  return [...cards].sort((a, b) => ddzPower(b) - ddzPower(a) || suitOf(a) - suitOf(b));
}

/** Weakest first, for rule evaluation. */
function ascending<T extends CardOrJoker>(cards: readonly T[]): T[] {
  return [...cards].sort((a, b) => ddzPower(a) - ddzPower(b) || suitOf(a) - suitOf(b));
}

export function createDdzDeck(): CardOrJoker[] {
  return createJokerDeck(2);
}

/** Highest power a straight, pair straight, or airplane chain may reach (an ace). */
const CHAIN_TOP = 14;
const CHAIN_BOTTOM = 3;

function counts(cards: readonly CardOrJoker[]): Map<number, number> {
  const result = new Map<number, number>();
  for (const card of cards) result.set(ddzPower(card), (result.get(ddzPower(card)) ?? 0) + 1);
  return result;
}

function isRun(powers: readonly number[]): boolean {
  return powers.every((power, index) => index === 0 || power === powers[index - 1] + 1)
    && powers[0] >= CHAIN_BOTTOM && powers[powers.length - 1] <= CHAIN_TOP;
}

function isRocket(cards: readonly CardOrJoker[]): boolean {
  return cards.length === 2 && cards.every(isJoker) && ddzPower(cards[0]) !== ddzPower(cards[1]);
}

function rocketPair(cards: readonly CardOrJoker[]): boolean {
  return cards.filter(isJoker).length === 2;
}

/**
 * Every way the cards read as one legal combination. Most sets have one; an airplane with wings can read
 * as several chains, and a set of four triples reads as a plain airplane or an airplane with wings.
 */
export function ddzCombos(cards: readonly CardOrJoker[]): DdzCombo[] {
  const size = cards.length;
  if (size === 0) return [];
  if (new Set(cards.map(cardKey)).size !== size) return [];
  const byPower = counts(cards);
  const powers = [...byPower.keys()].sort((a, b) => a - b);
  const found: DdzCombo[] = [];
  const add = (type: DdzComboType, power: number, length = 1): void => {
    if (!found.some((combo) => combo.type === type && combo.power === power && combo.length === length)) {
      found.push({ type, power, length, size });
    }
  };
  const countValues = [...byPower.values()];
  if (size === 1) add('single', powers[0]);
  if (isRocket(cards)) add('rocket', 16);
  else if (size === 2 && countValues[0] === 2) add('pair', powers[0]);
  if (size === 3 && powers.length === 1) add('triple', powers[0]);
  if (size === 4 && powers.length === 1) add('bomb', powers[0]);
  if (size === 4 && powers.length === 2 && [...byPower].some(([, count]) => count === 3)) {
    add('tripleSingle', powers.find((power) => byPower.get(power) === 3)!);
  }
  if (size === 5 && powers.length === 2 && countValues.includes(3) && countValues.includes(2)) {
    add('triplePair', powers.find((power) => byPower.get(power) === 3)!);
  }
  if (size >= 5 && countValues.every((count) => count === 1) && isRun(powers)) add('straight', powers[0], size);
  if (size >= 6 && size % 2 === 0 && countValues.every((count) => count === 2) && isRun(powers)) {
    add('pairStraight', powers[0], size / 2);
  }
  const quad = powers.find((power) => byPower.get(power) === 4);
  if (quad !== undefined && size === 6 && !rocketPair(cards)) add('fourSingles', quad);
  if (quad !== undefined && size === 8 && [...byPower].every(([power, count]) => power === quad || count % 2 === 0)
    && [...byPower].filter(([power]) => power !== quad).every(([power]) => power < 16)) add('fourPairs', quad);
  // Airplanes: k consecutive triples, no wings, k single wings, or k pair wings.
  const triples = powers.filter((power) => (byPower.get(power) ?? 0) >= 3 && power <= CHAIN_TOP);
  for (const wings of [0, 1, 2]) {
    const length = size / (3 + wings);
    if (!Number.isInteger(length) || length < 2) continue;
    for (const start of triples) {
      const chain = Array.from({ length }, (_, index) => start + index);
      if (!chain.every((power) => triples.includes(power))) continue;
      const rest = new Map(byPower);
      for (const power of chain) rest.set(power, rest.get(power)! - 3);
      const left = [...rest].filter(([, count]) => count > 0);
      if (wings === 0) {
        if (left.length === 0) add('airplane', start, length);
      } else if (wings === 1) {
        // Two jokers together would be a rocket, which cannot ride along as wings.
        const jokers = left.filter(([power]) => power >= 16).length;
        if (jokers < 2) add('airplaneSingle', start, length);
      } else if (left.every(([power, count]) => count % 2 === 0 && power < 16)) {
        add('airplanePair', start, length);
      }
    }
  }
  return found;
}

/** The strongest reading of a set of cards, or null when it is not a legal combination. */
export function ddzIdentify(cards: readonly CardOrJoker[]): DdzCombo | null {
  const combos = ddzCombos(cards);
  if (combos.length === 0) return null;
  return combos.reduce((best, combo) => (combo.power > best.power ? combo : best));
}

export function ddzIsBomb(combo: DdzCombo): boolean {
  return combo.type === 'bomb' || combo.type === 'rocket';
}

/** Whether `next` beats `previous`: a rocket beats everything, a bomb beats anything else, others need the same shape. */
export function ddzBeats(next: DdzCombo, previous: DdzCombo): boolean {
  if (previous.type === 'rocket') return false;
  if (next.type === 'rocket') return true;
  if (next.type === 'bomb') return previous.type !== 'bomb' || next.power > previous.power;
  return next.type === previous.type && next.size === previous.size && next.length === previous.length
    && next.power > previous.power;
}

/**
 * The reading of `cards` that is legal after `previous` (any reading when leading), preferring the
 * strongest. Returns null when the cards cannot be played.
 */
export function ddzResolve(cards: readonly CardOrJoker[], previous: DdzCombo | null): DdzCombo | null {
  const options = ddzCombos(cards).filter((combo) => previous === null || ddzBeats(combo, previous));
  return options.length === 0 ? null : options.reduce((best, combo) => (combo.power > best.power ? combo : best));
}

export function ddzCanPlay(
  hand: readonly CardOrJoker[], cards: readonly CardOrJoker[], previous: DdzCombo | null,
): boolean {
  const held = new Set(hand.map(cardKey));
  return cards.length > 0 && cards.every((card) => held.has(cardKey(card))) && ddzResolve(cards, previous) !== null;
}

// ─── Enumeration for bots and automatic plays ───

type Pile = Map<number, CardOrJoker[]>;

function pile(hand: readonly CardOrJoker[]): Pile {
  const result: Pile = new Map();
  for (const card of ascending(hand)) {
    const list = result.get(ddzPower(card));
    if (list) list.push(card);
    else result.set(ddzPower(card), [card]);
  }
  return result;
}

/**
 * Cards to ride along with a main group, drawn from the other ranks: units that do not break larger
 * groups come first, then the lowest power.
 */
function wings(rest: Pile, unit: 1 | 2, need: number, jokersTogether: boolean): CardOrJoker[] | null {
  const order = [...rest.entries()]
    .filter(([, cards]) => cards.length >= unit)
    .sort(([a, x], [b, y]) => x.length - y.length || a - b);
  const taken: CardOrJoker[] = [];
  for (const [power, cards] of order) {
    if (unit === 1) {
      // Both jokers together would form a rocket, which cannot ride along as wings.
      if (!jokersTogether && isJoker(cards[0]) && taken.some(isJoker)) continue;
      taken.push(cards[0]);
      if (taken.length === need) break;
    } else if (power < 16) {
      taken.push(cards[0], cards[1]);
      if (taken.length === need * 2) break;
    }
  }
  const complete = taken.length === (unit === 1 ? need : need * 2);
  if (!complete) return null;
  return taken;
}

function without(rest: Pile, powers: readonly number[], per: number): Pile {
  const result: Pile = new Map();
  for (const [power, cards] of rest) {
    result.set(power, powers.includes(power) ? cards.slice(per) : cards);
  }
  for (const [power, cards] of [...result]) if (cards.length === 0) result.delete(power);
  return result;
}

/**
 * Plays worth considering from `hand`. One representative per shape and rank: attached cards are the
 * cheapest ones that do not break larger groups. With `previous` only plays that beat it are listed.
 */
export function ddzMoves(hand: readonly CardOrJoker[], previous: DdzCombo | null): DdzMove[] {
  const all = pile(hand);
  const powers = [...all.keys()].sort((a, b) => a - b);
  const moves: DdzMove[] = [];
  const push = (cards: CardOrJoker[], type: DdzComboType, power: number, length = 1): void => {
    const combo: DdzCombo = { type, power, length, size: cards.length };
    if (previous === null || ddzBeats(combo, previous)) moves.push({ cards, combo });
  };
  const chainable = powers.filter((power) => power >= CHAIN_BOTTOM && power <= CHAIN_TOP);
  const runs = (minimum: number, minimumLength: number): number[][] => {
    const result: number[][] = [];
    for (const start of chainable) {
      if ((all.get(start)?.length ?? 0) < minimum) continue;
      const chain = [start];
      for (let power = start + 1; power <= CHAIN_TOP && (all.get(power)?.length ?? 0) >= minimum; power++) chain.push(power);
      for (let length = minimumLength; length <= chain.length; length++) result.push(chain.slice(0, length));
    }
    return result;
  };

  for (const power of powers) {
    const cards = all.get(power)!;
    push([cards[0]], 'single', power);
    if (cards.length >= 2 && power < 16) push(cards.slice(0, 2), 'pair', power);
    if (cards.length >= 3) {
      push(cards.slice(0, 3), 'triple', power);
      const rest = without(all, [power], 3);
      const single = wings(rest, 1, 1, true);
      if (single) push([...cards.slice(0, 3), ...single], 'tripleSingle', power);
      const pair = wings(rest, 2, 1, true);
      if (pair) push([...cards.slice(0, 3), ...pair], 'triplePair', power);
    }
    if (cards.length === 4) {
      push(cards, 'bomb', power);
      const rest = without(all, [power], 4);
      const singles = wings(rest, 1, 2, false);
      if (singles) push([...cards, ...singles], 'fourSingles', power);
      const pairs = wings(rest, 2, 2, true);
      if (pairs) push([...cards, ...pairs], 'fourPairs', power);
    }
  }
  if (all.has(16) && all.has(17)) push([all.get(16)![0], all.get(17)![0]], 'rocket', 16);
  for (const chain of runs(1, 5)) push(chain.map((power) => all.get(power)![0]), 'straight', chain[0], chain.length);
  for (const chain of runs(2, 3)) {
    push(chain.flatMap((power) => all.get(power)!.slice(0, 2)), 'pairStraight', chain[0], chain.length);
  }
  for (const chain of runs(3, 2)) {
    const body = chain.flatMap((power) => all.get(power)!.slice(0, 3));
    push(body, 'airplane', chain[0], chain.length);
    const rest = without(all, chain, 3);
    const singles = wings(rest, 1, chain.length, false);
    if (singles) push([...body, ...singles], 'airplaneSingle', chain[0], chain.length);
    const pairs = wings(rest, 2, chain.length, true);
    if (pairs) push([...body, ...pairs], 'airplanePair', chain[0], chain.length);
  }
  return moves;
}

/** Order for picking the cheapest play: plain plays before bombs and the rocket, then by power. */
export function compareMoves(a: DdzMove, b: DdzMove): number {
  const bomb = Number(ddzIsBomb(a.combo)) - Number(ddzIsBomb(b.combo));
  if (bomb) return bomb;
  return a.combo.type === 'rocket' ? 1 : b.combo.type === 'rocket' ? -1
    : a.combo.power - b.combo.power || b.cards.length - a.cards.length;
}

/** The smallest play that is legal now, or null when the player can only pass. */
export function ddzSmallestMove(hand: readonly CardOrJoker[], previous: DdzCombo | null): DdzMove | null {
  const moves = ddzMoves(hand, previous);
  return moves.length === 0 ? null : moves.reduce((best, move) => (compareMoves(move, best) < 0 ? move : best));
}

export function ddzHasMove(hand: readonly CardOrJoker[], previous: DdzCombo): boolean {
  return ddzMoves(hand, previous).length > 0;
}

// ─── Auction ───

export type DdzBidEntry =
  | { readonly kind: 'score'; readonly seat: GameSeat; readonly score: 0 | 1 | 2 | 3 }
  | { readonly kind: 'claim'; readonly seat: GameSeat; readonly take: boolean };

type ScoreEntry = Extract<DdzBidEntry, { readonly kind: 'score' }>;

export type DdzAuction =
  | {
    readonly done: false;
    readonly turn: GameSeat;
    /** `score` bids 1-3, `call` opens the grab, `grab` takes it over */
    readonly mode: 'score' | 'call' | 'grab';
    /** Lowest score a bid must reach in `score` mode */
    readonly minScore: number;
  }
  | {
    readonly done: true;
    /** Null when every seat passed and the deal is void */
    readonly landlord: GameSeat | null;
    readonly base: number;
    /** Grabs made after the call, each doubling the stake */
    readonly grabs: number;
  };

/** The seats in bidding order, starting with `first`. */
export function ddzOrder(seats: readonly GameSeat[], first: GameSeat): GameSeat[] {
  const start = seats.indexOf(first);
  return seats.map((_, index) => seats[(start + index) % seats.length]);
}

/** The seat that plays after `seat`. */
export function ddzNextSeat(seats: readonly GameSeat[], seat: GameSeat): GameSeat {
  return seats[(seats.indexOf(seat) + 1) % seats.length];
}

/** Where the auction stands after `entries`, bid in turn from `first`. */
export function ddzAuction(
  variant: DdzVariant, seats: readonly GameSeat[], first: GameSeat, entries: readonly DdzBidEntry[],
): DdzAuction {
  const order = ddzOrder(seats, first);
  if (variant === 'score') {
    const scores = entries.flatMap((entry) => (entry.kind === 'score' ? [entry] : []));
    const best = scores.reduce<ScoreEntry | null>((top, entry) => (entry.score > (top?.score ?? 0) ? entry : top), null);
    if (best?.score === 3 || scores.length >= order.length) {
      return { done: true, landlord: best?.seat ?? null, base: best?.score ?? 0, grabs: 0 };
    }
    return { done: false, turn: order[scores.length], mode: 'score', minScore: (best?.score ?? 0) + 1 };
  }
  const claims = entries.flatMap((entry) => (entry.kind === 'claim' ? [entry] : []));
  const callerIndex = claims.findIndex((entry) => entry.take);
  if (callerIndex < 0) {
    if (claims.length >= order.length) return { done: true, landlord: null, base: 0, grabs: 0 };
    return { done: false, turn: order[claims.length], mode: 'call', minScore: 1 };
  }
  const caller = claims[callerIndex].seat;
  const grabbers = claims.slice(callerIndex + 1);
  const grabs = grabbers.filter((entry) => entry.take).length;
  const others = order.length - 1;
  const lastGrabber = [...grabbers].reverse().find((entry) => entry.take)?.seat;
  // Everyone after the caller decides once; if someone grabbed, the caller may answer once.
  if (grabbers.length < others) {
    const sequence = ddzOrder(seats, caller);
    return { done: false, turn: sequence[1 + grabbers.length], mode: 'grab', minScore: 1 };
  }
  if (grabs > 0 && grabbers.length === others) {
    return { done: false, turn: caller, mode: 'grab', minScore: 1 };
  }
  return { done: true, landlord: lastGrabber ?? caller, base: 1, grabs };
}

// ─── Scoring ───

export interface DdzDealOutcome {
  readonly landlord: GameSeat;
  readonly landlordWins: boolean;
  /** Both farmers never played a card (landlord wins) */
  readonly spring: boolean;
  /** The landlord played only once (farmers win) */
  readonly antiSpring: boolean;
  readonly multiplier: number;
  /** Chips each seat gains or loses */
  readonly scores: Record<GameSeat, number>;
}

/** Doublings are bombs, rockets, and grabs; a spring or anti-spring adds one more. */
export function ddzSettle(args: {
  readonly seats: readonly GameSeat[];
  readonly landlord: GameSeat;
  readonly winner: GameSeat;
  readonly base: number;
  readonly doublings: number;
  readonly plays: Readonly<Partial<Record<GameSeat, number>>>;
}): DdzDealOutcome {
  const { seats, landlord, winner, base, doublings, plays } = args;
  const landlordWins = winner === landlord;
  const farmers = seats.filter((seat) => seat !== landlord);
  const spring = landlordWins && farmers.every((seat) => (plays[seat] ?? 0) === 0);
  const antiSpring = !landlordWins && (plays[landlord] ?? 0) === 1;
  const multiplier = base * 2 ** (doublings + Number(spring || antiSpring));
  const scores: Record<GameSeat, number> = {} as Record<GameSeat, number>;
  for (const seat of seats) {
    scores[seat] = seat === landlord ? (landlordWins ? 2 : -2) * multiplier : (landlordWins ? -1 : 1) * multiplier;
  }
  return { landlord, landlordWins, spring, antiSpring, multiplier, scores };
}

/** Seats with the highest running total, ties included. */
export function ddzWinners(seats: readonly GameSeat[], totals: Readonly<Record<GameSeat, number>>): GameSeat[] {
  const best = Math.max(...seats.map((seat) => totals[seat]));
  return seats.filter((seat) => totals[seat] === best);
}

/** Cards of the hand left after `played`. */
export function ddzWithout<T extends CardOrJoker>(hand: readonly T[], played: readonly CardOrJoker[]): T[] {
  return removeCards(hand, played);
}

/**
 * Deals three hands and the bottom from a shuffled deck: 17 cards each in seat order, then the bottom.
 * `seats` are ordered by play order.
 */
export function ddzDeal(
  seats: readonly GameSeat[], deck: readonly CardOrJoker[],
): { hands: Record<GameSeat, CardOrJoker[]>; bottom: CardOrJoker[] } {
  const hands = {} as Record<GameSeat, CardOrJoker[]>;
  seats.forEach((seat, index) => {
    hands[seat] = sortDdzHand(deck.filter((_, position) => position < DDZ_HAND_SIZE * seats.length
      && position % seats.length === index));
  });
  return { hands, bottom: sortDdzHand(deck.slice(DDZ_HAND_SIZE * seats.length, DDZ_HAND_SIZE * seats.length + DDZ_BOTTOM_SIZE)) };
}
