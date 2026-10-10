import { describe, expect, it } from 'vitest';
import type { LiarCard, Seat } from '@shared/types';
import {
  LD_DECK,
  LD_TRUTH_COUNT,
  ldCanChallenge,
  ldIsLie,
  ldIsTruth,
  ldMustChallenge,
  ldNextAlive,
  ldNextHolder,
  ldSortHand,
} from '@shared/rules/liarsdeck';

const counts = (N: number, E: number, S: number, W: number): Record<Seat, number> => ({ N, E, S, W });

describe("Liar's Deck rules", () => {
  it('should build 6 kings, 6 queens, 6 aces and 2 jokers with unique ids', () => {
    const faces = LD_DECK.map((card) => card.face);
    expect(LD_DECK).toHaveLength(20);
    expect(new Set(LD_DECK.map((card) => card.id)).size).toBe(20);
    expect(['K', 'Q', 'A', 'joker'].map((face) => faces.filter((entry) => entry === face).length)).toEqual([6, 6, 6, 2]);
    expect(LD_TRUTH_COUNT).toBe(8);
  });

  it('should treat the table face and jokers as truths and any other face as a lie', () => {
    expect(ldIsTruth('K', 'K')).toBe(true);
    expect(ldIsTruth('joker', 'A')).toBe(true);
    expect(ldIsTruth('Q', 'K')).toBe(false);
    expect(ldIsLie(['K', 'joker', 'K'], 'K')).toBe(false);
    expect(ldIsLie(['K', 'A'], 'K')).toBe(true);
  });

  it('should move counterclockwise past eliminated seats and empty hands', () => {
    expect(ldNextAlive('N', ['W'])).toBe('S');
    expect(ldNextAlive('E', ['N', 'W'])).toBe('S');
    expect(ldNextHolder('N', counts(2, 3, 0, 0))).toBe('E');
    expect(ldNextHolder('N', counts(2, 0, 0, 0))).toBeNull();
  });

  it('should forbid a call on the first play and force it for the last holder', () => {
    expect(ldCanChallenge('N', null)).toBe(false);
    expect(ldCanChallenge('N', { seat: 'N', count: 1 })).toBe(false);
    expect(ldCanChallenge('W', { seat: 'N', count: 2 })).toBe(true);
    expect(ldMustChallenge('W', counts(0, 0, 0, 3), { seat: 'N', count: 1 })).toBe(true);
    expect(ldMustChallenge('W', counts(1, 0, 0, 3), { seat: 'N', count: 1 })).toBe(false);
    expect(ldMustChallenge('W', counts(0, 0, 0, 3), null)).toBe(false);
  });

  it('should sort a hand by face, then id, without mutating it', () => {
    const hand: LiarCard[] = [{ id: 19, face: 'joker' }, { id: 12, face: 'A' }, { id: 3, face: 'K' }, { id: 1, face: 'K' }];
    const before = structuredClone(hand);
    expect(ldSortHand(hand).map((card) => card.id)).toEqual([1, 3, 12, 19]);
    expect(hand).toEqual(before);
  });
});
