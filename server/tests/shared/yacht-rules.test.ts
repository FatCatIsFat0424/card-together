import { describe, expect, it } from 'vitest';
import {
  EMPTY_YACHT_SCORECARD, YACHT_BOXES, isYachtOptions, isYachtScorecard, yachtBoxScore, yachtLegalBoxes, yachtPotentials,
  yachtReroll, yachtRollDice, yachtRoundSeconds, yachtScoreIn, yachtTotals, yachtWinners, yachtWrite,
} from '@shared/rules/yacht';
import type { YachtBox, YachtFace, YachtScorecard } from '@shared/rules/yacht';
import { yachtBestBox, yachtBestPlacement } from '@shared/rules/yacht-value';

const dice = (...faces: number[]): YachtFace[] => faces as YachtFace[];

function card(boxes: Partial<Record<YachtBox, number>>, extraYachts = 0): YachtScorecard {
  return { boxes, extraYachts };
}

/** A card with every box filled except the listed ones. */
function filledExcept(open: readonly YachtBox[], overrides: Partial<Record<YachtBox, number>> = {}): YachtScorecard {
  return card(Object.fromEntries(YACHT_BOXES.filter((box) => !open.includes(box)).map((box) => [box, overrides[box] ?? 0])));
}

describe('Yacht Dice box scores', () => {
  it('sums the face for the upper boxes', () => {
    expect(yachtBoxScore('ones', dice(1, 1, 3, 4, 1))).toBe(3);
    expect(yachtBoxScore('sixes', dice(6, 6, 3, 4, 1))).toBe(12);
    expect(yachtBoxScore('fives', dice(1, 2, 3, 4, 6))).toBe(0);
  });

  it('scores the kinds as the sum of every die', () => {
    expect(yachtBoxScore('threeKind', dice(4, 4, 4, 2, 6))).toBe(20);
    expect(yachtBoxScore('threeKind', dice(4, 4, 4, 4, 4))).toBe(20);
    expect(yachtBoxScore('threeKind', dice(4, 4, 3, 2, 6))).toBe(0);
    expect(yachtBoxScore('fourKind', dice(5, 5, 5, 5, 1))).toBe(21);
    expect(yachtBoxScore('fourKind', dice(5, 5, 5, 1, 1))).toBe(0);
  });

  it('scores a full house of exactly three and two', () => {
    expect(yachtBoxScore('fullHouse', dice(2, 2, 5, 5, 5))).toBe(25);
    expect(yachtBoxScore('fullHouse', dice(2, 2, 2, 5, 6))).toBe(0);
    expect(yachtBoxScore('fullHouse', dice(3, 3, 3, 3, 3))).toBe(0);
  });

  it('scores straights from four or five consecutive faces', () => {
    expect(yachtBoxScore('smallStraight', dice(1, 2, 3, 4, 4))).toBe(30);
    expect(yachtBoxScore('smallStraight', dice(2, 3, 4, 5, 6))).toBe(30);
    expect(yachtBoxScore('smallStraight', dice(1, 2, 3, 5, 6))).toBe(0);
    expect(yachtBoxScore('largeStraight', dice(1, 2, 3, 4, 5))).toBe(40);
    expect(yachtBoxScore('largeStraight', dice(6, 5, 4, 3, 2))).toBe(40);
    expect(yachtBoxScore('largeStraight', dice(1, 2, 3, 4, 6))).toBe(0);
  });

  it('scores a Yacht 50 and Chance as the sum', () => {
    expect(yachtBoxScore('yacht', dice(6, 6, 6, 6, 6))).toBe(50);
    expect(yachtBoxScore('yacht', dice(6, 6, 6, 6, 5))).toBe(0);
    expect(yachtBoxScore('chance', dice(1, 2, 3, 4, 6))).toBe(16);
  });
});

describe('Yacht Dice jokers', () => {
  it('lets any roll go into any empty box before the Yacht box holds 50', () => {
    expect(yachtLegalBoxes(EMPTY_YACHT_SCORECARD, dice(3, 3, 3, 3, 3))).toEqual([...YACHT_BOXES]);
    const scratched = card({ yacht: 0 });
    expect(yachtLegalBoxes(scratched, dice(3, 3, 3, 3, 3))).toEqual(YACHT_BOXES.filter((box) => box !== 'yacht'));
    expect(yachtScoreIn(scratched, 'fullHouse', dice(3, 3, 3, 3, 3))).toBe(0);
    expect(yachtWrite(scratched, 'chance', dice(3, 3, 3, 3, 3))?.extraYachts).toBe(0);
  });

  it('forces the matching upper box while it is empty', () => {
    const scored = card({ yacht: 50 });
    expect(yachtLegalBoxes(scored, dice(4, 4, 4, 4, 4))).toEqual(['fours']);
    expect(yachtWrite(scored, 'chance', dice(4, 4, 4, 4, 4))).toBeNull();
    const written = yachtWrite(scored, 'fours', dice(4, 4, 4, 4, 4))!;
    expect(written.boxes.fours).toBe(20);
    expect(written.extraYachts).toBe(1);
  });

  it('allows any empty lower box once the matching upper box is filled, with full-value straights and full house', () => {
    const scored = card({ yacht: 50, fours: 8 });
    const roll = dice(4, 4, 4, 4, 4);
    expect(yachtLegalBoxes(scored, roll)).toEqual(['threeKind', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight', 'chance']);
    expect(yachtScoreIn(scored, 'fullHouse', roll)).toBe(25);
    expect(yachtScoreIn(scored, 'smallStraight', roll)).toBe(30);
    expect(yachtScoreIn(scored, 'largeStraight', roll)).toBe(40);
    expect(yachtScoreIn(scored, 'threeKind', roll)).toBe(20);
    expect(yachtPotentials(scored, roll).largeStraight).toBe(40);
  });

  it('falls back to an empty upper box scoring 0 when no lower box is left', () => {
    const scored = filledExcept(['twos', 'sixes'], { yacht: 50, fours: 8 });
    expect(yachtLegalBoxes(scored, dice(4, 4, 4, 4, 4))).toEqual(['twos', 'sixes']);
    expect(yachtWrite(scored, 'twos', dice(4, 4, 4, 4, 4))?.boxes.twos).toBe(0);
  });

  it('counts each extra Yacht, and totals add 100 for it', () => {
    let current = card({ yacht: 50 });
    current = yachtWrite(current, 'threes', dice(3, 3, 3, 3, 3))!;
    current = yachtWrite(current, 'ones', dice(1, 1, 1, 1, 1))!;
    expect(current.extraYachts).toBe(2);
    expect(yachtTotals(current)).toMatchObject({ upper: 20, lower: 50, extra: 200, total: 270 });
  });
});

describe('Yacht Dice totals', () => {
  it('awards the 35-point upper bonus from 63', () => {
    const exact = card({ ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 });
    expect(yachtTotals(exact)).toMatchObject({ upper: 63, upperBonus: 35, total: 98 });
    const short = card({ ones: 2, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 });
    expect(yachtTotals(short)).toMatchObject({ upper: 62, upperBonus: 0, total: 62 });
  });

  it('lets tied totals share the win', () => {
    expect(yachtWinners({ N: 200, E: 200, S: 150 }, ['N', 'E', 'S'])).toEqual(['N', 'E']);
    expect(yachtWinners({ N: 10, E: 20 }, ['N', 'E'])).toEqual(['E']);
  });
});

describe('Yacht Dice helpers', () => {
  it('rolls with the injected source and keeps held dice in place', () => {
    const faces = [0, 0.2, 0.4, 0.6, 0.99];
    let index = 0;
    const rolled = yachtRollDice(5, () => faces[index++]);
    expect(rolled).toEqual([1, 2, 3, 4, 6]);
    expect(yachtReroll(rolled, [true, false, true, false, false], () => 0.5)).toEqual([1, 4, 3, 4, 4]);
  });

  it('gives simultaneous rounds at least thirty seconds', () => {
    expect([yachtRoundSeconds(5), yachtRoundSeconds(30), yachtRoundSeconds(90)]).toEqual([30, 30, 90]);
  });

  it('validates stored cards and room options', () => {
    expect(isYachtScorecard(card({ ones: 3, largeStraight: 40 }))).toBe(true);
    expect(isYachtScorecard(card({ ones: 3 }, 1))).toBe(false);
    expect(isYachtScorecard(card({ yacht: 50 }, 2))).toBe(true);
    expect(isYachtScorecard({ boxes: { bonus: 1 }, extraYachts: 0 })).toBe(false);
    expect(isYachtOptions({ mode: 'turns' })).toBe(true);
    expect(isYachtOptions({ mode: 'simultaneous' })).toBe(true);
    expect(isYachtOptions({ mode: 'async' })).toBe(false);
    expect(isYachtOptions({ mode: 'turns', extra: true })).toBe(false);
  });

  it('prefers a good box over scratching, and a forced upper box for a joker', () => {
    expect(yachtBestBox(EMPTY_YACHT_SCORECARD, dice(5, 5, 5, 5, 5))).toBe('yacht');
    expect(yachtBestBox(EMPTY_YACHT_SCORECARD, dice(1, 2, 3, 4, 5))).toBe('largeStraight');
    expect(yachtBestBox(EMPTY_YACHT_SCORECARD, dice(1, 2, 4, 4, 6))).not.toBe('yacht');
    expect(yachtBestBox(card({ yacht: 50 }), dice(2, 2, 2, 2, 2))).toBe('twos');
    expect(yachtBestPlacement(card({ yacht: 50, twos: 6 }), dice(2, 2, 2, 2, 2)).value).toBeGreaterThan(50);
  });
});
