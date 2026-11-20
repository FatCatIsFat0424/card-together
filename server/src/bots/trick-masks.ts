import type { Card, Rank, Suit } from '@shared/types';

// Compact card sets for the Hearts and Gong Zhu bots: a card is `suit * 13 + rank - 2`, and a set of cards
// of one suit is a 13-bit mask whose bit `rank - 2` marks the card. Bot heuristics and their rollouts use the
// same representation, so a rollout costs a few integer operations per card.

export const SUITS: readonly Suit[] = ['clubs', 'diamonds', 'hearts', 'spades'];
export const CLUBS = 0;
export const DIAMONDS = 1;
export const HEARTS = 2;
export const SPADES = 3;
/** Every rank of one suit. */
export const FULL_SUIT = 0x1fff;
/** Rank index (bit) of the jack, queen, king, and ace. */
export const JACK = 9;
export const QUEEN = 10;
export const KING = 11;
export const ACE = 12;

export function cardCode(card: Card): number {
  return SUITS.indexOf(card.suit) * 13 + card.rank - 2;
}

export function codeCard(code: number): Card {
  return { suit: SUITS[Math.floor(code / 13)], rank: (code % 13) + 2 as Rank };
}

export const suitOf = (code: number): number => Math.floor(code / 13);
export const rankOf = (code: number): number => code % 13;

export function popcount(mask: number): number {
  let value = mask - ((mask >>> 1) & 0x55555555);
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Highest set bit, or -1 for an empty mask. */
export function highest(mask: number): number {
  return 31 - Math.clz32(mask);
}

/** Lowest set bit, or -1 for an empty mask. */
export function lowest(mask: number): number {
  return mask === 0 ? -1 : 31 - Math.clz32(mask & -mask);
}

/** Ranks strictly above `rank`. */
export const above = (rank: number): number => FULL_SUIT & ~((2 << rank) - 1);
/** Ranks strictly below `rank`. */
export const below = (rank: number): number => (1 << rank) - 1;

/** Four suit masks for a list of cards. */
export function suitMasks(cards: readonly Card[]): number[] {
  const masks = [0, 0, 0, 0];
  for (const card of cards) masks[SUITS.indexOf(card.suit)] |= 1 << (card.rank - 2);
  return masks;
}

/** Card codes in a list of suit masks, lowest first. */
export function maskCodes(masks: ArrayLike<number>, offset = 0): number[] {
  const codes: number[] = [];
  for (let suit = 0; suit < 4; suit++) {
    for (let bits = masks[offset + suit]; bits !== 0; bits &= bits - 1) codes.push(suit * 13 + lowest(bits));
  }
  return codes;
}

/** One card of a trick, by seat index. */
export interface TrickPlay {
  readonly seat: number;
  readonly code: number;
}

/**
 * Per seat, how often it passed up a plain chance to shed `target` while that card was unplayed: it
 * discarded something else when void, or followed under a higher card of the target's suit with another
 * card. A seat holding the target would rarely do either, so each case is evidence it does not hold it.
 * `exempt(trickIndex)` marks tricks where the rules forbade shedding the target.
 */
export function shedDoubts(
  tricks: readonly (readonly TrickPlay[])[], target: number, exempt: (trickIndex: number) => boolean,
): number[] {
  const doubts = [0, 0, 0, 0];
  const suit = suitOf(target);
  const rank = rankOf(target);
  for (let index = 0; index < tricks.length; index++) {
    const plays = tricks[index];
    if (plays.length === 0) continue;
    const lead = suitOf(plays[0].code);
    let above = false;
    for (const play of plays) {
      if (play.code === target) return doubts;
      const playSuit = suitOf(play.code);
      if (playSuit !== lead) {
        if (!exempt(index)) doubts[play.seat]++;
      } else if (lead === suit && above) doubts[play.seat]++;
      if (playSuit === suit && rankOf(play.code) > rank) above = true;
    }
  }
  return doubts;
}
