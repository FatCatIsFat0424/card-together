import { describe, expect, it } from 'vitest';
import { clampFloatingCard, defaultFloatingCardPosition, floatingCardArea, floatingCardBounds, floatingCardDragStarted, floatingCardKeyMove, normalizeFloatingCard, restoreFloatingCard } from '../../../client/src/components/floating-room-card-position';

const noSafeArea = { left: 0, top: 0, right: 0, bottom: 0 };
const desktopArea = floatingCardArea({ left: 0, top: 0, width: 1280, height: 800 }, { left: 76, top: 0 }, noSafeArea);
const desktopBounds = floatingCardBounds(desktopArea, { width: 264, height: 240 });

describe('floating card positioning', () => {
  it('excludes the desktop rail and topbar as well as safe areas', () => {
    expect(desktopArea).toEqual({ left: 84, top: 8, right: 1272, bottom: 792 });
    expect(floatingCardArea({ left: 0, top: 0, width: 390, height: 844 }, { left: 0, top: 52 },
      { left: 12, top: 24, right: 16, bottom: 34 })).toEqual({ left: 12, top: 60, right: 374, bottom: 810 });
  });
  it('retains arbitrary positions and clamps every edge using the actual card dimensions', () => {
    expect(clampFloatingCard({ x: 320, y: 187 }, desktopBounds)).toEqual({ x: 320, y: 187 });
    expect(clampFloatingCard({ x: -999, y: -999 }, desktopBounds)).toEqual({ x: 84, y: 8 });
    expect(clampFloatingCard({ x: 9999, y: 9999 }, desktopBounds)).toEqual({ x: 1008, y: 552 });
    const bigger = floatingCardBounds(desktopArea, { width: 300, height: 380 });
    expect(restoreFloatingCard({ x: 1, y: 1 }, bigger)).toEqual({ x: 972, y: 412 });
  });
  it('keeps normalized placement visible across orientation and keyboard viewport changes', () => {
    const normalized = normalizeFloatingCard({ x: 546, y: 280 }, desktopBounds);
    expect(normalized).toEqual({ x: 0.5, y: 0.5 });
    const area = floatingCardArea({ left: 20, top: 120, width: 370, height: 210 }, { left: 0, top: 52 }, noSafeArea);
    expect(area).toEqual({ left: 28, top: 128, right: 382, bottom: 322 });
    const bounds = floatingCardBounds(area, { width: 300, height: 120 });
    const restored = restoreFloatingCard(normalized, bounds);
    expect(restored).toEqual({ x: 55, y: 165 });
    expect(normalizeFloatingCard(restored, bounds)).toEqual(normalized);
  });
  it('handles cards larger than the available area without inverted bounds or division by zero', () => {
    const bounds = floatingCardBounds({ left: 8, top: 60, right: 108, bottom: 90 }, { width: 264, height: 240 });
    expect(bounds).toEqual({ left: 8, top: 60, right: 8, bottom: 60 });
    expect(normalizeFloatingCard({ x: 100, y: -20 }, bounds)).toEqual({ x: 0, y: 0 });
    expect(restoreFloatingCard({ x: 0.5, y: 0.5 }, bounds)).toEqual({ x: 8, y: 60 });
  });
  it('uses upper right on messages and retains the full and compact default corners elsewhere', () => {
    expect(defaultFloatingCardPosition(true, false, false)).toEqual({ x: 1, y: 0 });
    expect(defaultFloatingCardPosition(true, true, false)).toEqual({ x: 1, y: 0 });
    expect(defaultFloatingCardPosition(false, false, false)).toEqual({ x: 1, y: 1 });
    expect(defaultFloatingCardPosition(false, true, false)).toEqual({ x: 0, y: 1 });
    expect(defaultFloatingCardPosition(false, true, true)).toEqual({ x: 1, y: 1 });
  });
  it('starts dragging at exactly six pixels, including diagonal movements', () => {
    const start = { x: 50, y: 70 };
    expect(floatingCardDragStarted(start, { x: 55.9, y: 70 })).toBe(false);
    expect(floatingCardDragStarted(start, { x: 56, y: 70 })).toBe(true);
    expect(floatingCardDragStarted(start, { x: 53, y: 74 })).toBe(false);
    expect(floatingCardDragStarted(start, { x: 45, y: 65 })).toBe(true);
  });
  it.each([
    ['ArrowLeft', { x: -10, y: 0 }, { x: -40, y: 0 }],
    ['ArrowRight', { x: 10, y: 0 }, { x: 40, y: 0 }],
    ['ArrowUp', { x: 0, y: -10 }, { x: 0, y: -40 }],
    ['ArrowDown', { x: 0, y: 10 }, { x: 0, y: 40 }],
  ])('moves with %s and a larger Shift step', (key, normal, shifted) => {
    expect(floatingCardKeyMove(key, false)).toEqual(normal);
    expect(floatingCardKeyMove(key, true)).toEqual(shifted);
  });
  it('leaves tab, activation and unrelated keys to the browser and clamps keyboard movement at the edge', () => {
    for (const key of ['Tab', 'Enter', ' ', 'Escape']) expect(floatingCardKeyMove(key, false)).toBeNull();
    const delta = floatingCardKeyMove('ArrowRight', true)!;
    expect(clampFloatingCard({ x: desktopBounds.right + delta.x, y: 200 }, desktopBounds)).toEqual({ x: desktopBounds.right, y: 200 });
  });
});
