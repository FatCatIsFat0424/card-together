import { describe, it, expect } from 'vitest';
import {
  createPlayingState,
  getValidPlays,
  validatePlay,
  compareCards,
  determineTrickWinner,
  completeTrick,
  isPlayingComplete,
  removeCardFromHand,
} from '../../src/engine/playing';
import type { Card, Seat } from '@shared/types';

describe('playing engine', () => {

  describe('createPlayingState', () => {
    it('should create initial state with correct lead seat', () => {
      const state = createPlayingState('E');
      expect(state.trickLeadSeat).toBe('E');
      expect(state.currentTurnSeat).toBe('E');
      expect(state.completedTricks).toHaveLength(0);
      expect(state.trickCountEW).toBe(0);
      expect(state.trickCountNS).toBe(0);
    });
  });

  describe('getValidPlays', () => {
    it('should allow any card for the first play in a trick', () => {
      const hand: Card[] = [
        { suit: 'spades', rank: 14 },
        { suit: 'hearts', rank: 10 },
        { suit: 'clubs', rank: 5 },
      ];
      const state = createPlayingState('N');
      const valid = getValidPlays(hand, state);
      expect(valid).toHaveLength(3);
    });

    it('should restrict to lead suit when available', () => {
      const hand: Card[] = [
        { suit: 'spades', rank: 14 },
        { suit: 'spades', rank: 10 },
        { suit: 'hearts', rank: 5 },
      ];
      const state = {
        ...createPlayingState('N'),
        currentTrick: { N: { suit: 'spades' as const, rank: 7 as const } },
        trickLeadSeat: 'N' as Seat,
        currentTurnSeat: 'E' as Seat,
      };
      const valid = getValidPlays(hand, state);
      expect(valid).toHaveLength(2);
      expect(valid.every((c) => c.suit === 'spades')).toBe(true);
    });

    it('should allow any card when no lead suit in hand', () => {
      const hand: Card[] = [
        { suit: 'hearts', rank: 14 },
        { suit: 'clubs', rank: 10 },
      ];
      const state = {
        ...createPlayingState('N'),
        currentTrick: { N: { suit: 'spades' as const, rank: 7 as const } },
        trickLeadSeat: 'N' as Seat,
        currentTurnSeat: 'E' as Seat,
      };
      const valid = getValidPlays(hand, state);
      expect(valid).toHaveLength(2);
    });
  });

  describe('validatePlay', () => {
    it('should reject play from wrong seat', () => {
      const state = createPlayingState('N');
      const result = validatePlay(
        [{ suit: 'spades', rank: 14 }],
        state, 'E',
        { suit: 'spades', rank: 14 },
      );
      expect(result).toEqual({ valid: false, reason: expect.any(String) });
    });

    it('should reject card not in hand', () => {
      const state = createPlayingState('N');
      const result = validatePlay(
        [{ suit: 'hearts', rank: 10 }],
        state, 'N',
        { suit: 'spades', rank: 14 },
      );
      expect(result).toEqual({ valid: false, reason: expect.any(String) });
    });
  });

  describe('compareCards', () => {
    it('should rank trump over non-trump', () => {
      expect(compareCards(
        { suit: 'hearts', rank: 2 },
        { suit: 'spades', rank: 14 },
        'spades',
        'hearts',
      )).toBeGreaterThan(0);
    });

    it('should rank lead suit over off-suit', () => {
      expect(compareCards(
        { suit: 'spades', rank: 3 },
        { suit: 'hearts', rank: 14 },
        'spades',
        'nt',
      )).toBeGreaterThan(0);
    });

    it('should compare same suit by rank', () => {
      expect(compareCards(
        { suit: 'spades', rank: 14 },
        { suit: 'spades', rank: 13 },
        'spades',
        'nt',
      )).toBeGreaterThan(0);
    });

    it('should handle NT (no trump)', () => {
      // With NT, only lead suit matters
      expect(compareCards(
        { suit: 'spades', rank: 14 },
        { suit: 'spades', rank: 2 },
        'spades',
        'nt',
      )).toBeGreaterThan(0);
    });
  });

  describe('determineTrickWinner', () => {
    it('should select highest lead suit card in NT', () => {
      const trick: Record<Seat, Card> = {
        N: { suit: 'spades', rank: 10 },
        E: { suit: 'spades', rank: 14 },
        S: { suit: 'spades', rank: 7 },
        W: { suit: 'hearts', rank: 14 },
      };
      expect(determineTrickWinner(trick, 'N', 'nt')).toBe('E');
    });

    it('should let trump card win over lead suit', () => {
      const trick: Record<Seat, Card> = {
        N: { suit: 'spades', rank: 14 },
        E: { suit: 'spades', rank: 13 },
        S: { suit: 'hearts', rank: 2 },  // trump
        W: { suit: 'spades', rank: 12 },
      };
      expect(determineTrickWinner(trick, 'N', 'hearts')).toBe('S');
    });

    it('should select highest trump when multiple trumps played', () => {
      const trick: Record<Seat, Card> = {
        N: { suit: 'spades', rank: 14 },
        E: { suit: 'hearts', rank: 3 },  // trump
        S: { suit: 'hearts', rank: 10 }, // trump
        W: { suit: 'clubs', rank: 14 },
      };
      expect(determineTrickWinner(trick, 'N', 'hearts')).toBe('S');
    });
  });

  describe('completeTrick', () => {
    it('should update trick counts correctly', () => {
      const state = createPlayingState('N');
      const trick: Record<Seat, Card> = {
        N: { suit: 'spades', rank: 14 },
        E: { suit: 'spades', rank: 13 },
        S: { suit: 'spades', rank: 12 },
        W: { suit: 'spades', rank: 11 },
      };
      const result = completeTrick(state, 'N', trick, 'N');
      expect(result.trickCountNS).toBe(1);
      expect(result.trickCountEW).toBe(0);
      expect(result.completedTricks).toHaveLength(1);
      expect(result.currentTurnSeat).toBe('N');
    });
  });

  describe('isPlayingComplete', () => {
    it('should return false when tricks < 13', () => {
      const state = createPlayingState('N');
      expect(isPlayingComplete(state)).toBe(false);
    });

    it('should return true when 13 tricks completed', () => {
      const state: ReturnType<typeof createPlayingState> = {
        ...createPlayingState('N'),
        completedTricks: Array(13).fill({
          cards: {},
          leadSeat: 'N' as Seat,
          winnerSeat: 'N' as Seat,
        }),
      };
      expect(isPlayingComplete(state)).toBe(true);
    });
  });

  describe('removeCardFromHand', () => {
    it('should remove the specified card', () => {
      const hand: Card[] = [
        { suit: 'spades', rank: 14 },
        { suit: 'hearts', rank: 10 },
        { suit: 'clubs', rank: 5 },
      ];
      const result = removeCardFromHand(hand, { suit: 'hearts', rank: 10 });
      expect(result).toHaveLength(2);
      expect(result.find((c) => c.suit === 'hearts')).toBeUndefined();
    });

    it('should not modify original hand', () => {
      const hand: Card[] = [{ suit: 'spades', rank: 14 }];
      removeCardFromHand(hand, { suit: 'spades', rank: 14 });
      expect(hand).toHaveLength(1);
    });
  });
});
