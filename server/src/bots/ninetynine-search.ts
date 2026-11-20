import type { Card, GameSeat, NinetyNineVisibleState } from '@shared/types';
import { GAME_SEAT_ORDER, SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { NN_HAND_SIZE, NN_MAX, nnDeckSize } from '@shared/rules/ninetynine';
import type { BotAction } from './bot-decisions';
import { getNinetyNineBotAction, ninetyNineOptions, unseenCards } from './ninetynine-strategy';
import type { NinetyNinePlay } from './ninetynine-strategy';
import { determinizedSearch } from './search/determinized';
import type { DeterminizedGame } from './search/determinized';
import type { SearchContext } from './search/search-types';
import { seededRandom } from './search/seeded-random';

// Determinized search for Ninety-Nine. Each sample deals the unseen cards to the opponents' hands, the
// face-down hands of eliminated seats, and the stock in a random order; each candidate is then played out
// with a quick policy for every seat, reshuffles and two-deck stock exhaustion included. The utility is the
// match result: winning (or sharing the win when a two-deck stock runs out) counts most, and outlasting
// more seats a little.

/**
 * Cards are coded by effect: 0 is the spade ace (back to 0), 1 any other ace, 2–13 the rank (J = 11,
 * Q = 12, K = 13). Suits matter for nothing else.
 */
type Code = number;
const SPADE_ACE = 0;

export function nnCode(card: Card): Code {
  if (card.rank === 14) return card.suit === 'spades' ? SPADE_ACE : 1;
  return card.rank;
}

/** A move: card code, choice (0 none, 1 plus, 2 minus) and designated seat (index + 1, 0 none). */
const move = (code: Code, choice: number, target: number): number => code | (choice << 4) | (target << 6);
const codeOf = (value: number): Code => value & 15;
const choiceOf = (value: number): number => (value >> 4) & 3;
const targetOf = (value: number): number => (value >> 6) - 1;

/** A complete position; seat numbers are indices in GAME_SEAT_ORDER. */
export interface NinetyNineWorld {
  readonly hands: Code[][];
  readonly alive: boolean[];
  /** Seats at the table, in seat order. */
  readonly seats: readonly number[];
  stock: Code[];
  /** Discard pile with its top card last. */
  discard: Code[];
  total: number;
  /** +1 clockwise (up the seat order), -1 counter-clockwise. */
  direction: number;
  turn: number;
  readonly eliminated: number[];
  /** Survivors share the win: the last one standing, or everyone left when a two-deck stock ran out. */
  winners: number[] | null;
  readonly twoDecks: boolean;
  /** Seeds the next reshuffle, so every candidate played on a copy of this world reshuffles alike. */
  shuffleSeed: number;
}

function copyWorld(world: NinetyNineWorld): NinetyNineWorld {
  return {
    ...world, hands: world.hands.map((hand) => hand.slice()), alive: world.alive.slice(), stock: world.stock.slice(),
    discard: world.discard.slice(), eliminated: world.eliminated.slice(), winners: world.winners?.slice() ?? null,
  };
}

/** Total after playing `code` with `choice`, or -1 when it would pass 99. */
function totalAfter(total: number, code: Code, choice: number): number {
  switch (code) {
    case SPADE_ACE: return 0;
    case 4: case 5: case 11: return total;
    case 13: return NN_MAX;
    case 10: case 12: {
      const delta = code === 10 ? 10 : 20;
      if (choice === 1) return total + delta <= NN_MAX ? total + delta : -1;
      return Math.max(0, total - delta);
    }
    default: return total + code <= NN_MAX ? total + code : -1;
  }
}

function playable(total: number, code: Code): boolean {
  return totalAfter(total, code, code === 10 || code === 12 ? 2 : 0) >= 0;
}

function nextAlive(world: NinetyNineWorld, from: number): number {
  let seat = from;
  do seat = (seat + world.direction + GAME_SEAT_ORDER.length) % GAME_SEAT_ORDER.length;
  while (!world.alive[seat] && seat !== from);
  return seat;
}

function shuffleInPlace(items: Code[], random: () => number): void {
  for (let index = items.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    const swap = items[index];
    items[index] = items[other];
    items[other] = swap;
  }
}

function survivors(world: NinetyNineWorld): number[] {
  return world.seats.filter((seat) => world.alive[seat]);
}

/** The turn lands on `seat`: seats without a playable card are eliminated in turn, as on the server. */
function landOn(world: NinetyNineWorld, seat: number): void {
  let current = seat;
  while (!world.hands[current].some((code) => playable(world.total, code))) {
    world.alive[current] = false;
    world.eliminated.push(current);
    world.discard.splice(Math.max(0, world.discard.length - 1), 0, ...world.hands[current]);
    world.hands[current] = [];
    const left = survivors(world);
    if (left.length === 1) {
      world.winners = left;
      return;
    }
    current = nextAlive(world, current);
  }
  world.turn = current;
}

function playMove(world: NinetyNineWorld, value: number): void {
  const seat = world.turn;
  const code = codeOf(value);
  const hand = world.hands[seat];
  hand.splice(hand.indexOf(code), 1);
  world.discard.push(code);
  world.total = totalAfter(world.total, code, choiceOf(value));
  if (code === 4) world.direction = -world.direction;
  if (world.stock.length === 0 && !world.twoDecks) {
    world.stock = world.discard.slice(0, -1);
    shuffleInPlace(world.stock, seededRandom(world.shuffleSeed++));
    world.discard = world.discard.slice(-1);
  }
  const drawn = world.stock.pop();
  if (drawn !== undefined) hand.push(drawn);
  if (world.twoDecks && world.stock.length === 0) {
    world.winners = survivors(world);
    return;
  }
  landOn(world, code === 5 ? targetOf(value) : nextAlive(world, seat));
}

function legalMoves(world: NinetyNineWorld): number[] {
  const moves: number[] = [];
  const seen = new Set<Code>();
  for (const code of world.hands[world.turn]) {
    if (seen.has(code)) continue;
    seen.add(code);
    if (code === 10 || code === 12) {
      if (totalAfter(world.total, code, 1) >= 0) moves.push(move(code, 1, 0));
      moves.push(move(code, 2, 0));
    } else if (code === 5) {
      for (const seat of world.seats) if (seat !== world.turn && world.alive[seat]) moves.push(move(code, 0, seat + 1));
    } else if (playable(world.total, code)) moves.push(move(code, 0, 0));
  }
  return moves;
}

/** What keeping a card is worth to the rollout policy; it spends the cheapest card that keeps it safe. */
const KEEP: readonly number[] = [12, 0, 0, 0, 6, 7, 0, 0, 0, 0, 8, 7, 9, 7];
const RESCUE: readonly boolean[] = [true, false, false, false, true, true, false, false, false, false, true, true, true, true];

/**
 * The rollout policy: the largest number card that fits; failing that the rescue card least worth keeping,
 * adding with 10 or Q only when the hand keeps another rescue, and setting 99 with a K whenever it holds one.
 * A 5 designates the seat after next.
 */
function rolloutMove(world: NinetyNineWorld): number {
  const hand = world.hands[world.turn];
  const total = world.total;
  let bestNumber = -1;
  for (const code of hand) {
    if (RESCUE[code]) continue;
    if (total + code <= NN_MAX && code > bestNumber) bestNumber = code;
  }
  if (bestNumber > 0) return move(bestNumber, 0, 0);
  let rescue = -1;
  for (const code of hand) {
    if (!RESCUE[code]) continue;
    if (code === 13 && total < NN_MAX) {
      // Setting 99 is the strongest pressure, and keeps nothing worse in hand.
      rescue = code;
      break;
    }
    if (rescue < 0 || KEEP[code] < KEEP[rescue]) rescue = code;
  }
  if (rescue < 0) throw new Error('No playable card in a rollout.');
  if (rescue === 10 || rescue === 12) {
    const others = hand.filter((code) => RESCUE[code]).length > 1;
    const plus = totalAfter(total, rescue, 1);
    return move(rescue, plus >= 0 && others ? 1 : 2, 0);
  }
  if (rescue === 5) {
    const target = nextAlive(world, nextAlive(world, world.turn));
    return move(5, 0, (target === world.turn ? nextAlive(world, world.turn) : target) + 1);
  }
  return move(rescue, 0, 0);
}

/** Share of a win for outlasting every other seat; each seat eliminated first earns a part of it. */
const PLACE_WEIGHT = 0.2;

/** 1 for a (shared) win; otherwise a little for every seat that went out first. */
function utilityFor(world: NinetyNineWorld, seat: number): number {
  const others = world.seats.length - 1;
  if (world.winners) {
    if (world.winners.includes(seat)) return 1;
  } else if (world.alive[seat]) {
    // Unfinished rollout: an even share of the win among the survivors.
    return 1 / survivors(world).length;
  }
  const before = world.eliminated.indexOf(seat);
  return PLACE_WEIGHT * (before < 0 ? others : before) / Math.max(1, others);
}

/** The current discard pile: plays since the last reshuffle (top last) and face-down eliminated hands. */
export function ninetyNineDiscard(visible: NinetyNineVisibleState): { known: Card[]; faceDown: number } {
  const held = Object.values(visible.handCounts).reduce((sum, count) => sum + count, 0);
  const size = nnDeckSize(visible.options) - visible.stockCount - held;
  const known: Card[] = [];
  let counted = 0;
  let faceDown = 0;
  for (let index = visible.log.length - 1; index >= 0 && counted < size; index--) {
    const entry = visible.log[index];
    const cards = entry.type === 'play' ? 1 : NN_HAND_SIZE;
    if (counted + cards > size) break;
    counted += cards;
    if (entry.type === 'play') known.unshift(entry.card);
    else faceDown += cards;
  }
  return { known, faceDown: faceDown + size - counted };
}

function seatIndex(seat: GameSeat): number {
  return GAME_SEAT_ORDER.indexOf(seat);
}

/** Deals one world from the view, or null when its counts do not add up. */
export function sampleNinetyNineWorld(visible: NinetyNineVisibleState, random: () => number): NinetyNineWorld | null {
  const seats = (visible.seats ?? SEAT_ORDER_CLOCKWISE).map(seatIndex).sort((a, b) => a - b);
  const me = seatIndex(visible.mySeat);
  const unseen = unseenCards(visible).map(nnCode);
  const { known, faceDown } = ninetyNineDiscard(visible);
  const opponents = seats.filter((seat) => seat !== me && !visible.eliminated.includes(GAME_SEAT_ORDER[seat]));
  const needed = opponents.reduce((sum, seat) => sum + visible.handCounts[GAME_SEAT_ORDER[seat]], 0) + faceDown + visible.stockCount;
  if (needed !== unseen.length) return null;
  shuffleInPlace(unseen, random);
  const hands: Code[][] = GAME_SEAT_ORDER.map(() => []);
  hands[me] = visible.myHand.map(nnCode);
  let offset = 0;
  for (const seat of opponents) {
    const count = visible.handCounts[GAME_SEAT_ORDER[seat]];
    hands[seat] = unseen.slice(offset, offset + count);
    offset += count;
  }
  const hidden = unseen.slice(offset, offset + faceDown);
  offset += faceDown;
  const discard = known.map(nnCode);
  discard.splice(Math.max(0, discard.length - 1), 0, ...hidden);
  const alive = GAME_SEAT_ORDER.map((seat, index) => seats.includes(index) && !visible.eliminated.includes(seat));
  return {
    hands, alive, seats, stock: unseen.slice(offset), discard, total: visible.total,
    direction: visible.direction === 'cw' ? 1 : -1, turn: me, eliminated: visible.eliminated.map(seatIndex),
    winners: null, twoDecks: visible.options?.twoDecks ?? false, shuffleSeed: Math.floor(random() * 4294967296),
  };
}

const MAX_PLIES = 600;

export function ninetyNineGame(visible: NinetyNineVisibleState): DeterminizedGame<NinetyNineWorld, number> {
  return {
    seat: visible.mySeat,
    sample: (random) => {
      const state = sampleNinetyNineWorld(visible, random);
      return state ? { state } : null;
    },
    copy: copyWorld,
    legalMoves,
    play: playMove,
    rolloutMove,
    isTerminal: (world) => world.winners !== null,
    utility: (world, seat) => utilityFor(world, seatIndex(seat)),
  };
}

function encode(play: NinetyNinePlay): number {
  const choice = play.choice === 'plus' ? 1 : play.choice === 'minus' ? 2 : 0;
  return move(nnCode(play.card), choice, play.target ? seatIndex(play.target) + 1 : 0);
}

const MAX_SAMPLES = 600;
const MAX_CANDIDATES = 8;

/**
 * Bot search for the worker pool; the synchronous heuristic answers when only one play is legal, and in
 * two-deck matches, where most seats share the win when the stock runs out and the search measured no
 * better than the heuristic.
 */
export function ninetyNineSearch(visible: NinetyNineVisibleState, context: SearchContext): BotAction | null {
  const options = ninetyNineOptions(visible);
  if (options.length <= 1 || visible.options?.twoDecks) return getNinetyNineBotAction(visible, context.random);
  // Equal codes are equal moves; keep the best-scored card for each.
  const byMove = new Map<number, { value: NinetyNinePlay; score: number }>();
  for (const option of options) {
    const key = encode(option.value);
    const known = byMove.get(key);
    if (!known || option.score > known.score) byMove.set(key, option);
  }
  if (byMove.size === 1) return [...byMove.values()][0].value;
  const choice = determinizedSearch(ninetyNineGame(visible),
    [...byMove.entries()].map(([key, option]) => ({ move: key, prior: option.score })),
    context, { maxSamples: MAX_SAMPLES, maxCandidates: MAX_CANDIDATES, maxPlies: MAX_PLIES, minSamples: 12 });
  return byMove.get(choice.move)!.value;
}
