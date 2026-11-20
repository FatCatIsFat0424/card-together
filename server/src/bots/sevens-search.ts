import type { GameSeat, Seat, SevensVisibleState } from '@shared/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import type { BotAction } from './bot-decisions';
import { dealUnseen } from './search/card-dealer';
import { determinizedSearch } from './search/determinized';
import type { DeterminizedGame, SampledWorld } from './search/determinized';
import type { SearchContext } from './search/search-types';
import {
  COVER_LOW_BIAS, SV_CARDS, SV_SUITS, buildSevensKnowledge, sevensCoverConstraints, sevensUnseen, svCardAt, svIndex,
} from './sevens-knowledge';
import { getSevensBotAction, sevensAction, sevensOptions } from './sevens-strategy';
import type { SevensOption } from './sevens-strategy';

// Determinized search for Sevens. Each sample deals the unseen cards to the opponents' hands and covers,
// honoring what their forced covers proved and leaning their covers toward low cards; each candidate is
// then played out to the end of the game with a quick policy, and scored by whether the bot finishes with
// the lowest penalty, plus a little for the margin.

/** A cover move is the card index plus this offset; a play is the bare index. */
const COVER = 100;
const SEVEN_BIT = 1 << 6;
/** Weight of the penalty margin against winning outright, per point of penalty. */
const MARGIN_WEIGHT = 0.015;

/** Seats by index in clockwise order; play passes counter-clockwise, to index + 3. */
const SEATS: readonly Seat[] = SEAT_ORDER_CLOCKWISE;

/** A complete Sevens position, every hand known. Hands are 13-bit order masks per seat and suit. */
export interface SevensWorld {
  readonly hands: Int32Array;
  readonly counts: Int8Array;
  readonly penalty: Int32Array;
  /** Lowest and highest order played per suit; 0 while the suit is unopened. */
  readonly low: Int8Array;
  readonly high: Int8Array;
  /** Each seat's own covered cards per suit, as order masks: what that seat knows is dead. */
  readonly dead: Int32Array;
  turn: number;
  left: number;
  first: boolean;
}

// Rollout policy weights, in points of penalty. Matched against the synchronous heuristic in self-play.
/** Cost of laying a card whose next card is someone else's: it opens the way for them. */
const OPEN_PENALTY = 3;
/** Discount on the bot's own cards further out for every card of others in between. */
const GAP_DECAY = 0.6;
/** Per step from the seven: outer cards free fewer of the bot's own cards later. */
const OUTER_VALUE = 0.3;
/** Dragon Slaying: own cards on the far side put at risk by laying a 2 or Q, which exposes the closing card. */
const EXPOSE_PENALTY = 0.6;
/** Dragon Slaying: own cards a close kills, and others' cards it blocks. */
const CLOSE_OWN = 1.2;
const CLOSE_BLOCK = 0.15;
/** Covering: share of others' cards beyond the cover that it blocks, and the live discount per gap. */
const COVER_BLOCK = 0.2;
const LIVE_DECAY = 0.8;

const orderOf = (card: number): number => (card % 13) + 1;
const bit = (order: number): number => 1 << (order - 1);

function popOrders(mask: number): number {
  let total = 0;
  for (let order = 1; mask !== 0; order++, mask >>>= 1) if (mask & 1) total += order;
  return total;
}

function copyWorld(world: SevensWorld): SevensWorld {
  return {
    hands: world.hands.slice(), counts: world.counts.slice(), penalty: world.penalty.slice(), low: world.low.slice(),
    high: world.high.slice(), dead: world.dead.slice(), turn: world.turn, left: world.left, first: world.first,
  };
}

function rowClosed(world: SevensWorld, suit: number, closeOnEnd: boolean): boolean {
  return closeOnEnd && world.low[suit] !== 0 && (world.low[suit] === 1 || world.high[suit] === 13);
}

/** Legal plays of the seat on turn, written to `out`; returns how many. */
function legalPlays(world: SevensWorld, closeOnEnd: boolean, out: number[]): number {
  const base = world.turn * 4;
  if (world.first) {
    if (world.hands[base] & SEVEN_BIT) out[0] = 6;
    return world.hands[base] & SEVEN_BIT ? 1 : 0;
  }
  let count = 0;
  for (let suit = 0; suit < 4; suit++) {
    const mask = world.hands[base + suit];
    if (mask === 0) continue;
    const low = world.low[suit];
    if (low === 0) {
      if (mask & SEVEN_BIT) out[count++] = suit * 13 + 6;
      continue;
    }
    if (rowClosed(world, suit, closeOnEnd)) continue;
    const high = world.high[suit];
    if (low > 1 && mask & bit(low - 1)) out[count++] = suit * 13 + low - 2;
    if (high < 13 && mask & bit(high + 1)) out[count++] = suit * 13 + high;
  }
  return count;
}

function legalMoves(world: SevensWorld, closeOnEnd: boolean): number[] {
  const out: number[] = [];
  const count = legalPlays(world, closeOnEnd, out);
  if (count > 0) return out.slice(0, count);
  const moves: number[] = [];
  for (let suit = 0; suit < 4; suit++) {
    const mask = world.hands[world.turn * 4 + suit];
    for (let order = 1; order <= 13; order++) if (mask & bit(order)) moves.push(COVER + suit * 13 + order - 1);
  }
  return moves;
}

function playMove(world: SevensWorld, move: number, closeOnEnd: boolean): void {
  const seat = world.turn;
  const card = move >= COVER ? move - COVER : move;
  const suit = Math.floor(card / 13);
  const order = orderOf(card);
  world.hands[seat * 4 + suit] &= ~bit(order);
  world.counts[seat]--;
  world.left--;
  world.turn = (seat + 3) & 3;
  if (move >= COVER) {
    world.penalty[seat] += order;
    world.dead[seat * 4 + suit] |= bit(order);
    return;
  }
  world.first = false;
  if (world.low[suit] === 0) {
    world.low[suit] = order;
    world.high[suit] = order;
  } else if (order < world.low[suit]) world.low[suit] = order;
  else world.high[suit] = order;
  if (!closeOnEnd || world.left === 0) return;
  for (let other = 0; other < 4; other++) if (!rowClosed(world, other, true)) return;
  // Every suit is closed: all remaining cards are covered at once.
  for (let other = 0; other < 4; other++) {
    for (let index = 0; index < 4; index++) world.penalty[other] += popOrders(world.hands[other * 4 + index]);
    world.hands.fill(0, other * 4, other * 4 + 4);
    world.counts[other] = 0;
  }
  world.left = 0;
}

/**
 * How likely a card of `suit` at `order` still gets played: 0 behind a covered card or in a closed row,
 * otherwise lower the more cards other seats must lay first.
 */
function liveness(world: SevensWorld, own: number, suit: number, order: number, closeOnEnd: boolean): number {
  if (rowClosed(world, suit, closeOnEnd)) return 0;
  const low = world.low[suit];
  const dead = world.dead[world.turn * 4 + suit];
  let from: number;
  let to: number;
  if (low === 0) {
    from = Math.min(7, order);
    to = Math.max(7, order);
  } else if (order < low) {
    from = order;
    to = low - 1;
  } else if (order > world.high[suit]) {
    from = world.high[suit] + 1;
    to = order;
  } else return 0;
  let live = 1;
  for (let step = from; step <= to; step++) {
    if (step === order) continue;
    if (dead & bit(step)) return 0;
    if (!(own & bit(step))) live *= LIVE_DECAY;
  }
  return live;
}

/** Orders beyond `order` on the far side from the seven (both sides for a seven), as a mask. */
function beyondMask(order: number): number {
  if (order === 7) return 0x1fff & ~SEVEN_BIT;
  return order < 7 ? bit(order) - 1 : 0x1fff & ~((bit(order) << 1) - 1);
}

/**
 * The rollout policy, deterministic so every candidate meets the same continuations: a judgement from the
 * seat's own hand, its own covers, and the table. Plays lead toward the seat's own cards and avoid opening
 * the way for others; covers give up the card whose loss (with the own cards behind it) costs least.
 */
function rolloutMove(world: SevensWorld, closeOnEnd: boolean, scratch: number[]): number {
  const count = legalPlays(world, closeOnEnd, scratch);
  if (count === 1) return scratch[0];
  const base = world.turn * 4;
  let best = -1;
  let bestScore = -Infinity;
  if (count > 1) {
    for (let index = 0; index < count; index++) {
      const card = scratch[index];
      const suit = Math.floor(card / 13);
      const order = orderOf(card);
      const own = world.hands[base + suit] & ~bit(order);
      let score = 0;
      const directions = order === 7 ? [-1, 1] : [order < 7 ? -1 : 1];
      for (const direction of directions) {
        let weight = 1;
        for (let step = order + direction; step >= 1 && step <= 13; step += direction) {
          if (world.dead[base + suit] & bit(step)) break;
          if (own & bit(step)) score += step * weight;
          else weight *= GAP_DECAY;
        }
        const next = order + direction;
        if (next >= 1 && next <= 13 && !(own & bit(next))) score -= OPEN_PENALTY;
      }
      score += OUTER_VALUE * Math.abs(order - 7);
      if (closeOnEnd && (order === 1 || order === 13) && world.low[suit] !== 0) {
        // Closing kills the bot's own remaining cards in the suit and everyone else's.
        score -= popOrders(own) * CLOSE_OWN;
        const others = 0x1fff & ~own & ~world.dead[base + suit] & ~rangeMask(world.low[suit], world.high[suit]) & ~bit(order);
        score += CLOSE_BLOCK * popOrders(others);
      }
      if (closeOnEnd && (order === 2 || order === 12)) {
        const end = order === 2 ? 1 : 13;
        if (!(own & bit(end))) {
          // Laying the card next to an end lets anyone close the row on the bot's cards at the other side.
          const other = order === 2 ? own & ~((bit(7) << 1) - 1) : own & (bit(7) - 1);
          score -= EXPOSE_PENALTY * popOrders(other);
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = card;
      }
    }
    return best;
  }
  // No play: cover the card whose loss costs least.
  for (let suit = 0; suit < 4; suit++) {
    const mask = world.hands[base + suit];
    if (mask === 0) continue;
    for (let order = 1; order <= 13; order++) {
      if (!(mask & bit(order))) continue;
      let cost = order * liveness(world, mask, suit, order, closeOnEnd);
      if (cost > 0) {
        const beyond = beyondMask(order);
        const ownBeyond = mask & beyond;
        for (let step = 1; step <= 13; step++) {
          if (ownBeyond & bit(step)) cost += step * liveness(world, mask, suit, step, closeOnEnd);
        }
        cost -= COVER_BLOCK * popOrders(beyond & ~mask & ~world.dead[base + suit] & ~rangeMask(world.low[suit], world.high[suit]));
      }
      if (-cost > bestScore) {
        bestScore = -cost;
        best = COVER + suit * 13 + order - 1;
      }
    }
  }
  return best;
}

function rangeMask(low: number, high: number): number {
  if (low === 0) return 0;
  return ((bit(high) << 1) - 1) & ~(bit(low) - 1);
}

/** Win outright (ties included) is worth 1; the penalty margin to the average opponent breaks ties. */
function utilityFor(world: SevensWorld, seat: number): number {
  const mine = world.penalty[seat];
  let lowest = Infinity;
  let others = 0;
  for (let other = 0; other < 4; other++) {
    if (other === seat) continue;
    lowest = Math.min(lowest, world.penalty[other]);
    others += world.penalty[other];
  }
  return (mine <= lowest ? 1 : 0) + MARGIN_WEIGHT * (others / 3 - mine);
}

function weightedPick(cards: readonly number[], weights: readonly number[], random: () => number): number {
  let total = 0;
  for (const weight of weights) total += weight;
  let ticket = random() * total;
  for (let index = 0; index < cards.length; index++) {
    ticket -= weights[index];
    if (ticket < 0) return index;
  }
  return cards.length - 1;
}

const DEAL_RETRIES = 6;

type CoverSlot = { readonly seat: Seat; readonly excluded: Uint8Array };
type OpponentDeal = { readonly hands: readonly (readonly number[])[]; readonly covered: ReadonlyMap<Seat, readonly number[]> };

/** Covers first, each drawn with a lean toward low cards; then the hands within their exclusions. */
function leanDeal(
  visible: SevensVisibleState, opponents: readonly Seat[], constraints: ReturnType<typeof sevensCoverConstraints>,
  covers: readonly CoverSlot[], unseen: readonly number[], random: () => number,
): OpponentDeal | null {
  const pool = [...unseen];
  const covered = new Map<Seat, number[]>(opponents.map((seat) => [seat, []]));
  for (const cover of covers) {
    const choices = pool.filter((card) => !cover.excluded[card]);
    if (choices.length === 0) return null;
    const picked = choices[weightedPick(choices, choices.map((card) => Math.exp(-COVER_LOW_BIAS * orderOf(card))), random)];
    pool.splice(pool.indexOf(picked), 1);
    covered.get(cover.seat)!.push(picked);
  }
  const deal = dealUnseen({
    unseen: pool,
    seats: opponents.map((seat) => ({ size: visible.handCounts[seat], accepts: (card: number) => !constraints[seat].hand[card] })),
  }, random);
  return deal ? { hands: deal.hands, covered } : null;
}

/** Every hand and cover as one deal, so tightly limited cards are placed first. */
function plainDeal(
  visible: SevensVisibleState, opponents: readonly Seat[], constraints: ReturnType<typeof sevensCoverConstraints>,
  covers: readonly CoverSlot[], unseen: readonly number[], random: () => number,
): OpponentDeal | null {
  const deal = dealUnseen({
    unseen,
    seats: [
      ...opponents.map((seat) => ({ size: visible.handCounts[seat], accepts: (card: number) => !constraints[seat].hand[card] })),
      ...covers.map((cover) => ({ size: 1, accepts: (card: number) => !cover.excluded[card] })),
    ],
    attempts: 8,
  }, random);
  if (!deal) return null;
  const covered = new Map<Seat, number[]>(opponents.map((seat) => [seat, []]));
  covers.forEach((cover, index) => covered.get(cover.seat)!.push(...deal.hands[opponents.length + index]));
  return { hands: deal.hands.slice(0, opponents.length), covered };
}

/**
 * Deals one world: each opponent cover takes a card it may be, drawn with a lean toward low cards, then the
 * rest fill the opponents' hands within their exclusions. Null when the view admits no consistent deal.
 */
export function sampleSevensWorld(visible: SevensVisibleState, random: () => number): SevensWorld | null {
  const me = SEATS.indexOf(visible.mySeat as Seat);
  const opponents = SEATS.filter((seat) => seat !== visible.mySeat);
  const constraints = sevensCoverConstraints(visible);
  const unseen = sevensUnseen(visible);
  const free = opponents.reduce((sum, seat) => sum + visible.handCounts[seat] + visible.coveredCounts[seat], 0);
  if (free !== unseen.length) return null;
  const covers = opponents.flatMap((seat) => Array.from({ length: visible.coveredCounts[seat] },
    (_, index) => ({ seat, excluded: constraints[seat].covers[index] ?? new Uint8Array(SV_CARDS) })));
  for (let attempt = 0; attempt <= DEAL_RETRIES; attempt++) {
    // The last attempt drops the lean toward low covers and lets the dealer place the most constrained cards first.
    const deal = attempt < DEAL_RETRIES ? leanDeal(visible, opponents, constraints, covers, unseen, random)
      : plainDeal(visible, opponents, constraints, covers, unseen, random);
    if (!deal) continue;
    const { hands, covered } = deal;
    const world: SevensWorld = {
      hands: new Int32Array(16), counts: new Int8Array(4), penalty: new Int32Array(4), low: new Int8Array(4),
      high: new Int8Array(4), dead: new Int32Array(16), turn: me, left: 0, first: visible.table.spades === null,
    };
    const give = (seat: number, card: number): void => {
      world.hands[seat * 4 + Math.floor(card / 13)] |= bit(orderOf(card));
      world.counts[seat]++;
      world.left++;
    };
    const bury = (seat: number, card: number): void => {
      world.penalty[seat] += orderOf(card);
      world.dead[seat * 4 + Math.floor(card / 13)] |= bit(orderOf(card));
    };
    for (const card of visible.myHand) give(me, svIndex(card));
    for (const card of visible.myCovered) bury(me, svIndex(card));
    opponents.forEach((seat, index) => {
      const position = SEATS.indexOf(seat);
      for (const card of hands[index]) give(position, card);
      for (const card of covered.get(seat)!) bury(position, card);
    });
    SV_SUITS.forEach((suit, index) => {
      const row = visible.table[suit];
      if (row) {
        world.low[index] = row.low;
        world.high[index] = row.high;
      }
    });
    return world;
  }
  return null;
}

/** The search plug-in for one decision, closed over the seat's view. */
export function sevensGame(visible: SevensVisibleState): DeterminizedGame<SevensWorld, number> {
  const closeOnEnd = visible.options?.closeOnEnd ?? false;
  const scratch: number[] = [];
  return {
    seat: visible.mySeat as GameSeat,
    sample: (random): SampledWorld<SevensWorld> | null => {
      const state = sampleSevensWorld(visible, random);
      return state ? { state } : null;
    },
    copy: copyWorld,
    legalMoves: (world) => legalMoves(world, closeOnEnd),
    play: (world, move) => playMove(world, move, closeOnEnd),
    rolloutMove: (world) => rolloutMove(world, closeOnEnd, scratch),
    isTerminal: (world) => world.left === 0,
    utility: (world, seat) => utilityFor(world, SEATS.indexOf(seat as Seat)),
  };
}

/** Worlds per decision; more did not play measurably better, and this leaves the budget as a safety margin. */
const MAX_SAMPLES = 1000;
const MAX_CANDIDATES = 6;

/** Bot search for the worker pool; the synchronous heuristic answers forced and trivial turns. */
export function sevensSearch(visible: SevensVisibleState, context: SearchContext): BotAction | null {
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat) return null;
  if (visible.validCards.length === 1) return getSevensBotAction(visible, context.random);
  const options = sevensOptions(visible, buildSevensKnowledge(visible));
  // Every dead card ends up covered anyway, so the best-scored one stands for all.
  const firstDead = options.reduce<SevensOption | null>((best, option) =>
    (option.dead && (!best || option.score > best.score) ? option : best), null);
  const distinct = options.filter((option) => !option.dead || option === firstDead);
  if (distinct.length <= 1) return getSevensBotAction(visible, context.random);
  const choice = determinizedSearch(sevensGame(visible),
    distinct.map((option) => ({ move: (option.cover ? COVER : 0) + svIndex(option.card), prior: option.score })),
    context, { maxSamples: MAX_SAMPLES, maxCandidates: MAX_CANDIDATES, minSamples: 12 });
  const move = choice.move;
  return sevensAction({ card: svCardAt(move >= COVER ? move - COVER : move), cover: move >= COVER });
}

