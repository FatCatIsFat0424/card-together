import { describe, expect, it } from 'vitest';
import {
  CARD_ASPECT, HAND_MAX_VISIBLE, HAND_MIN_VISIBLE, cardHeight, fitHand, handCardLimit,
} from '../../../client/src/components/hand-fit';

/** Width a hand occupies once every card but the last is covered by its neighbour. */
const rowWidth = (fit: { cardWidth: number; overlap: number }, count: number): number =>
  fit.cardWidth + (count - 1) * fit.cardWidth * (1 - fit.overlap);

describe('hand fit', () => {
  it('keeps the card limit between 44 and 72px and grows it with the screen height', () => {
    expect(handCardLimit(200)).toBe(44);
    expect(handCardLimit(2000)).toBe(72);
    expect(handCardLimit(390)).toBeGreaterThan(handCardLimit(336));
    expect(handCardLimit(336)).toBeGreaterThan(50);
  });

  it('fits thirteen cards in a phone hand row at full size without hiding any card', () => {
    const fit = fitHand(480, 13, handCardLimit(336));
    expect(fit.cardWidth).toBe(Math.floor(handCardLimit(336) * 100) / 100);
    expect(rowWidth(fit, 13)).toBeLessThanOrEqual(480 + 0.5);
    // Each card keeps at least its minimum visible share.
    expect(1 - fit.overlap).toBeGreaterThanOrEqual(HAND_MIN_VISIBLE - 0.001);
    expect(1 - fit.overlap).toBeLessThanOrEqual(HAND_MAX_VISIBLE + 0.001);
  });

  it('overlaps only as much as the row needs', () => {
    const wide = fitHand(600, 13, 57);
    const narrow = fitHand(360, 13, 57);
    expect(wide.overlap).toBeLessThan(narrow.overlap);
    expect(1 - wide.overlap).toBeCloseTo(HAND_MAX_VISIBLE, 2);
    expect(rowWidth(narrow, 13)).toBeLessThanOrEqual(360 + 0.5);
  });

  it('shrinks the cards when even the tightest overlap cannot fit them', () => {
    const fit = fitHand(200, 13, 57);
    expect(fit.cardWidth).toBeLessThan(57);
    expect(1 - fit.overlap).toBeCloseTo(HAND_MIN_VISIBLE, 2);
    expect(rowWidth(fit, 13)).toBeLessThanOrEqual(200 + 0.5);
  });

  it('handles a single card, an empty hand and an unmeasured row', () => {
    expect(fitHand(300, 1, 57)).toEqual({ cardWidth: 57, overlap: 1 - HAND_MAX_VISIBLE });
    expect(fitHand(300, 0, 57).cardWidth).toBe(57);
    expect(fitHand(0, 13, 57).cardWidth).toBe(57);
    expect(Number.isFinite(fitHand(Number.NaN, 13, 57).overlap)).toBe(true);
  });

  it('derives the card height from the face aspect ratio', () => {
    expect(cardHeight(56)).toBeCloseTo(56 / CARD_ASPECT, 5);
    expect(cardHeight(56)).toBeGreaterThan(56);
  });
});
