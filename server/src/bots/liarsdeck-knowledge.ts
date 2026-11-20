import type { LiarsDeckVisibleState, Seat } from '@shared/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { LD_DECK, LD_HAND_SIZE, LD_TRUTH_COUNT, ldIsTruth } from '@shared/rules/liarsdeck';

// What the seat can know about the cards it cannot see. Only two things matter to the rules: whether a card counts
// as the table face (a truth, jokers included) or not (a lie), so the unseen cards are a pool of truths and lies.
// The table's play record gives two kinds of evidence:
// - The plays made this round: a seat that claimed cards honestly held that many truths, and a seat with no truth
//   left had to lie.
// - The record of the game so far: how often challenged plays were honest and how often a claim of each size was
//   called, pooled over every seat but the bot's own (table-wide statistics, never a per-player model).

export const DECK_SIZE = LD_DECK.length;
export const LIE_COUNT = DECK_SIZE - LD_TRUTH_COUNT;

/** Honest share of plays assumed before the game shows any challenge. */
const PRIOR_HONESTY = 0.8;
/** The prior counts as this many challenged plays. */
const PRIOR_WEIGHT = 8;
/** Share of claims of 1, 2 and 3 cards that the next seat calls, before the game shows anything. */
const PRIOR_CALL_RATES: readonly number[] = [0.12, 0.28, 0.9];
/** Each prior call rate counts as this many opportunities to call. */
const PRIOR_CALL_WEIGHT = 6;
const MAX_CALL_RATE = 0.97;

export function seatIndex(seat: Seat): number {
  return SEAT_ORDER_CLOCKWISE.indexOf(seat);
}

export interface RoundPlay {
  readonly seat: number;
  readonly count: number;
}

/** Plays made this round, oldest first. */
export function roundPlays(visible: LiarsDeckVisibleState): RoundPlay[] {
  const plays: RoundPlay[] = [];
  for (const entry of visible.log) {
    if (entry.type === 'round') plays.length = 0;
    else if (entry.type === 'play') plays.push({ seat: seatIndex(entry.seat), count: entry.count });
  }
  return plays;
}

/**
 * Chance that a play by a seat with a truth in hand was honest, from the resolved challenges of other seats'
 * plays. Challenged plays were suspected ones, so the figure leans toward lying and the prior holds it down.
 */
export function tableHonesty(visible: LiarsDeckVisibleState): number {
  let honest = PRIOR_HONESTY * PRIOR_WEIGHT;
  let total = PRIOR_WEIGHT;
  for (const entry of visible.log) {
    if (entry.type !== 'challenge' || entry.target === visible.mySeat) continue;
    total += 1;
    if (!entry.lied) honest += 1;
  }
  return honest / total;
}

/**
 * How often a claim of 1, 2 or 3 cards was called by a seat other than the bot's, among the times the seat could
 * choose (a seat that is the last holder must call and says nothing about the table).
 */
export function tableCallRates(visible: LiarsDeckVisibleState): number[] {
  const me = seatIndex(visible.mySeat);
  const calls = [0, 0, 0];
  const chances = [0, 0, 0];
  const held = [0, 0, 0, 0];
  const dead = new Set<number>();
  let claim: RoundPlay | null = null;
  for (const entry of visible.log) {
    if (entry.type === 'round') {
      SEAT_ORDER_CLOCKWISE.forEach((_, seat) => { held[seat] = dead.has(seat) ? 0 : LD_HAND_SIZE; });
      claim = null;
    } else if (entry.type === 'play') {
      const seat = seatIndex(entry.seat);
      if (claim && seat !== me) chances[claim.count - 1]++;
      held[seat] -= entry.count;
      claim = { seat, count: entry.count };
    } else if (entry.type === 'challenge') {
      const seat = seatIndex(entry.seat);
      const forced = held.every((count, other) => other === seat || count === 0);
      if (claim && seat !== me && !forced) {
        chances[claim.count - 1]++;
        calls[claim.count - 1]++;
      }
      claim = null;
    } else if (!entry.survived) {
      dead.add(seatIndex(entry.seat));
    }
  }
  return PRIOR_CALL_RATES.map((prior, index) => Math.min(MAX_CALL_RATE,
    (prior * PRIOR_CALL_WEIGHT + calls[index]) / (PRIOR_CALL_WEIGHT + chances[index])));
}

/** Truths and lies among the cards the bot holds or has played. */
export function knownCards(visible: LiarsDeckVisibleState): { truths: number; lies: number } {
  const cards = [...visible.myHand, ...visible.myPlayed];
  const truths = cards.filter((card) => ldIsTruth(card.face, visible.tableFace)).length;
  return { truths, lies: cards.length - truths };
}

/** One dealt world: every other seat's cards split into truths and lies, in hand and played. */
export interface DeckWorld {
  readonly handTruths: Int8Array;
  readonly handLies: Int8Array;
  readonly playedTruths: Int8Array;
  readonly playedLies: Int8Array;
  /** Lies among the cards of the last play */
  readonly lastLies: number;
  readonly weight: number;
}

/**
 * Deals the unseen truths and lies to the other seats (hands and cards already played) and weighs the deal by how
 * well it explains the round's plays. An honest play costs a factor of `honesty`, a lie by a seat that still held a
 * truth `1 - honesty`, and a lie by a seat with none is certain.
 */
export function dealWorld(visible: LiarsDeckVisibleState, honesty: number, random: () => number): DeckWorld {
  const me = seatIndex(visible.mySeat);
  const known = knownCards(visible);
  const pool: boolean[] = [];
  for (let index = 0; index < LD_TRUTH_COUNT - known.truths; index++) pool.push(true);
  for (let index = 0; index < LIE_COUNT - known.lies; index++) pool.push(false);
  for (let index = pool.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [pool[index], pool[other]] = [pool[other], pool[index]];
  }
  const plays = roundPlays(visible);
  const handTruths = new Int8Array(4);
  const handLies = new Int8Array(4);
  const playedTruths = new Int8Array(4);
  const playedLies = new Int8Array(4);
  let weight = 1;
  let lastLies = 0;
  let next = 0;
  for (let seat = 0; seat < SEAT_ORDER_CLOCKWISE.length; seat++) {
    if (seat === me) continue;
    const mine = plays.filter((play) => play.seat === seat);
    const playedCards = mine.reduce((sum, play) => sum + play.count, 0);
    const cards = pool.slice(next, next + playedCards + visible.handCounts[SEAT_ORDER_CLOCKWISE[seat]]);
    next += cards.length;
    let truthsHeld = cards.filter(Boolean).length;
    let offset = 0;
    for (const play of mine) {
      const claimed = cards.slice(offset, offset + play.count);
      offset += play.count;
      const truths = claimed.filter(Boolean).length;
      if (truths === play.count) weight *= honesty;
      else if (truthsHeld > 0) weight *= 1 - honesty;
      truthsHeld -= truths;
      playedTruths[seat] += truths;
      playedLies[seat] += play.count - truths;
      if (play === plays[plays.length - 1]) lastLies = play.count - truths;
    }
    const hand = cards.slice(playedCards);
    handTruths[seat] = hand.filter(Boolean).length;
    handLies[seat] = hand.length - handTruths[seat];
  }
  return { handTruths, handLies, playedTruths, playedLies, lastLies, weight };
}
