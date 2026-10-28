import { describe, expect, it } from 'vitest';
import type { DiceFace, GameSeat, LiarsDiceBid } from '@shared/types';
import {
  LDI_FACE_ORDER, ldiCountFace, ldiIsLegalBid, ldiLegalBids, ldiMinimalBid, ldiNextAlive, ldiNextStarter, ldiOnesWildAfter, ldiRaises,
  ldiResolveCall, ldiRoll, ldiTotalDice,
} from '@shared/rules/liarsdice';

const bid = (quantity: number, face: DiceFace): LiarsDiceBid => ({ quantity, face });

describe("Liar's Dice rules", () => {
  describe('bid ordering', () => {
    it('should accept a higher quantity of any face, including a lower one', () => {
      expect(ldiRaises(bid(3, 6), bid(4, 2))).toBe(true);
      expect(ldiRaises(bid(3, 2), bid(4, 2))).toBe(true);
      expect(ldiRaises(bid(3, 1), bid(4, 2))).toBe(true);
    });

    it('should accept the same quantity only with a higher face', () => {
      expect(ldiRaises(bid(3, 4), bid(3, 5))).toBe(true);
      expect(ldiRaises(bid(3, 4), bid(3, 4))).toBe(false);
      expect(ldiRaises(bid(3, 4), bid(3, 3))).toBe(false);
    });

    it('should reject a lower quantity of any face', () => {
      expect(ldiRaises(bid(3, 2), bid(2, 6))).toBe(false);
      expect(ldiRaises(bid(4, 6), bid(2, 1))).toBe(false);
      expect(ldiRaises(bid(2, 1), bid(1, 6))).toBe(false);
    });

    it('should rank ones above every other face, with no halving or doubling', () => {
      expect(LDI_FACE_ORDER).toEqual([2, 3, 4, 5, 6, 1]);
      expect(ldiRaises(bid(3, 6), bid(3, 1))).toBe(true);
      expect(ldiRaises(bid(3, 1), bid(3, 6))).toBe(false);
      expect(ldiRaises(bid(3, 1), bid(3, 1))).toBe(false);
      expect(ldiRaises(bid(5, 4), bid(3, 1))).toBe(false);
      expect(ldiRaises(bid(2, 1), bid(5, 2))).toBe(true);
      expect(ldiRaises(bid(2, 1), bid(3, 1))).toBe(true);
    });

    it('should never let a chain of raises return to an earlier bid', () => {
      for (let quantity = 1; quantity <= 6; quantity++) {
        for (const face of [1, 2, 3, 4, 5, 6] as const) {
          for (const next of ldiLegalBids(bid(quantity, face), 12)) {
            for (const again of ldiLegalBids(next, 12)) expect(ldiRaises(again, bid(quantity, face))).toBe(false);
          }
        }
      }
    });
  });

  describe('legal bids', () => {
    it('should allow any bid within the dice in play as the opening bid', () => {
      expect(ldiIsLegalBid(null, bid(1, 1), 10)).toBe(true);
      expect(ldiIsLegalBid(null, bid(10, 6), 10)).toBe(true);
      expect(ldiIsLegalBid(null, bid(11, 2), 10)).toBe(false);
    });

    it('should reject malformed bids', () => {
      expect(ldiIsLegalBid(null, bid(0, 2), 10)).toBe(false);
      expect(ldiIsLegalBid(null, bid(1.5, 2), 10)).toBe(false);
      expect(ldiIsLegalBid(null, { quantity: 2, face: 7 as DiceFace }, 10)).toBe(false);
      expect(ldiIsLegalBid(null, { quantity: 2, face: 0 as DiceFace }, 10)).toBe(false);
    });

    it('should cap bids at the dice in play', () => {
      expect(ldiIsLegalBid(bid(9, 6), bid(10, 2), 10)).toBe(true);
      expect(ldiIsLegalBid(bid(10, 5), bid(11, 2), 10)).toBe(false);
    });

    it('should list legal bids from lowest to highest, ones last in each quantity', () => {
      expect(ldiLegalBids(bid(2, 5), 3)).toEqual([bid(2, 6), bid(2, 1), bid(3, 2), bid(3, 3), bid(3, 4), bid(3, 5), bid(3, 6), bid(3, 1)]);
    });

    it('should find the least raise', () => {
      expect(ldiMinimalBid(null, 10)).toEqual(bid(1, 2));
      expect(ldiMinimalBid(bid(3, 4), 10)).toEqual(bid(3, 5));
      expect(ldiMinimalBid(bid(3, 6), 10)).toEqual(bid(3, 1));
      expect(ldiMinimalBid(bid(3, 1), 10)).toEqual(bid(4, 2));
    });

    it('should leave no raise when nothing outbids the standing bid within the dice in play', () => {
      expect(ldiMinimalBid(bid(2, 1), 2)).toBeNull();
      expect(ldiMinimalBid(bid(3, 1), 3)).toBeNull();
      expect(ldiMinimalBid(bid(3, 6), 3)).toEqual(bid(3, 1));
      expect(ldiMinimalBid(bid(1, 1), 1)).toBeNull();
    });
  });

  describe('wild ones', () => {
    it('should count ones toward another face while they are wild', () => {
      expect(ldiCountFace([1, 3, 3, 5, 1], 3, true)).toBe(4);
      expect(ldiCountFace([1, 3, 3, 5, 1], 3, false)).toBe(2);
    });

    it('should count only ones for a bid on ones', () => {
      expect(ldiCountFace([1, 3, 1, 5, 1], 1, true)).toBe(3);
      expect(ldiCountFace([1, 3, 1, 5, 1], 1, false)).toBe(3);
    });

    it('should end the wild role when anyone bids on ones and keep it for other bids', () => {
      expect(ldiOnesWildAfter(true, bid(2, 1))).toBe(false);
      expect(ldiOnesWildAfter(true, bid(2, 5))).toBe(true);
      expect(ldiOnesWildAfter(false, bid(2, 5))).toBe(false);
    });
  });

  describe('challenge resolution', () => {
    const cups: Partial<Record<GameSeat, DiceFace[]>> = { N: [2, 2, 5, 1, 6], E: [2, 3, 3, 4, 1] };

    it('should make a bid true when the table shows at least its quantity', () => {
      expect(ldiResolveCall(cups, bid(5, 2), true)).toEqual({ count: 5, bidTrue: true });
      expect(ldiResolveCall(cups, bid(4, 2), true)).toEqual({ count: 5, bidTrue: true });
    });

    it('should make a bid false when the table falls short', () => {
      expect(ldiResolveCall(cups, bid(6, 2), true)).toEqual({ count: 5, bidTrue: false });
      expect(ldiResolveCall(cups, bid(5, 2), false)).toEqual({ count: 3, bidTrue: false });
    });

    it('should count ones exactly when the bid is on ones', () => {
      expect(ldiResolveCall(cups, bid(2, 1), true)).toEqual({ count: 2, bidTrue: true });
      expect(ldiResolveCall(cups, bid(3, 1), true)).toEqual({ count: 2, bidTrue: false });
    });

    it('should ignore empty cups', () => {
      expect(ldiResolveCall({ ...cups, S: [] }, bid(5, 2), true).count).toBe(5);
    });
  });

  describe('seat order and elimination', () => {
    const seats: GameSeat[] = ['N', 'E', 'P5', 'P8'];

    it('should pass the turn to the next seat still holding dice', () => {
      expect(ldiNextAlive('N', seats, [])).toBe('E');
      expect(ldiNextAlive('E', seats, ['P5'])).toBe('P8');
      expect(ldiNextAlive('P8', seats, [])).toBe('N');
      expect(ldiNextAlive('P8', seats, ['N'])).toBe('E');
    });

    it('should let the loser open the next round unless they were eliminated', () => {
      expect(ldiNextStarter('E', seats, [])).toBe('E');
      expect(ldiNextStarter('E', seats, ['E'])).toBe('P5');
      expect(ldiNextStarter('P8', seats, ['P8', 'N'])).toBe('E');
    });
  });

  describe('dice', () => {
    it('should roll the requested number of dice from the injected source', () => {
      expect(ldiRoll(5, () => 0)).toEqual([1, 1, 1, 1, 1]);
      expect(ldiRoll(3, () => 0.9999)).toEqual([6, 6, 6]);
      const samples = [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6];
      let index = 0;
      expect(ldiRoll(6, () => samples[index++])).toEqual([1, 2, 3, 4, 5, 6]);
      expect(ldiRoll(0, () => 0)).toEqual([]);
    });

    it('should total the dice in play', () => {
      expect(ldiTotalDice({ N: 5, E: 3, S: 0 })).toBe(8);
    });
  });
});
