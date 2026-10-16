import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SEAT_FRAMES } from '@shared/constants';
import { SeatFrame, seatFrameHostClass } from '../../../client/src/cosmetics/seat-frames/SeatFrame';
import { SEAT_FRAME_MOTIFS, seatFrameDesign } from '../../../client/src/cosmetics/seat-frames/seat-frame-designs';
import { seatFramesTranslations } from '../../../client/src/cosmetics/seat-frames/i18n';

const markup = (frame: string | null | undefined, turn = false): string =>
  renderToStaticMarkup(createElement(SeatFrame, { frame, turn }));

describe('seat frame designs', () => {
  it('maps every catalog frame to its own design', () => {
    const designs = SEAT_FRAMES.map((item) => seatFrameDesign(item.id));
    expect(designs).toEqual(SEAT_FRAMES.map((item) => item.design));
    expect(new Set(designs).size).toBe(SEAT_FRAMES.length);
  });

  it('treats a missing or unknown frame as no frame', () => {
    for (const id of [null, undefined, '', 'seat-frame-unknown', 'seat-aurora', 'nameplate-lucky']) {
      expect(seatFrameDesign(id)).toBeNull();
      expect(seatFrameHostClass(id)).toBe('');
      expect(markup(id)).toBe('');
    }
  });

  it('draws a distinct corner motif for every design', () => {
    const drawings = SEAT_FRAMES.map((item) => {
      const motif = SEAT_FRAME_MOTIFS[item.design];
      expect(motif.main.length).toBeGreaterThan(3);
      for (const part of [...motif.main, ...(motif.alt ?? [])]) expect(part.d).toMatch(/^M[-\d.]/);
      return JSON.stringify(motif);
    });
    expect(new Set(drawings).size).toBe(SEAT_FRAMES.length);
  });

  it('has a name and description in both languages for every frame', () => {
    for (const item of SEAT_FRAMES) {
      for (const locale of ['en', 'zh-TW'] as const) {
        const entries = seatFramesTranslations[locale] as Record<string, string>;
        expect(entries[`shop.item.${item.id}.name`]?.length).toBeGreaterThan(1);
        expect(entries[`shop.item.${item.id}.description`]?.length).toBeGreaterThan(8);
      }
    }
  });
});

describe('SeatFrame layer', () => {
  it('is a decorative layer with four corners that carries the design', () => {
    for (const item of SEAT_FRAMES) {
      const html = markup(item.id);
      expect(html).toContain(`data-seat-frame="${item.design}"`);
      expect(html).toContain('aria-hidden="true"');
      expect(html.match(/<svg/g)).toHaveLength(4);
      expect(html).not.toContain('data-turn');
      expect(seatFrameHostClass(item.id)).not.toBe('');
    }
  });

  it('marks the turn state without changing the design', () => {
    expect(markup('seat-frame-ember', true)).toContain('data-turn="true"');
    expect(markup('seat-frame-ember', true)).toContain('data-seat-frame="ember"');
  });

  it('mirrors the main motif on the corners that have no alternate', () => {
    const aurora = markup('seat-frame-aurora');
    const sakura = markup('seat-frame-sakura');
    const paths = (html: string): string[] => [...html.matchAll(/<svg[^>]*>(.*?)<\/svg>/g)].map((match) => match[1]);
    expect(new Set(paths(aurora)).size).toBe(1);
    expect(new Set(paths(sakura)).size).toBe(2);
  });
});
