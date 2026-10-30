import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SEAT_FRAMES } from '@shared/constants';
import { SeatFrame, seatFrameHostClass } from '../../../client/src/cosmetics/seat-frames/SeatFrame';
import { runBorderOrbit } from '../../../client/src/cosmetics/seat-frames/border-orbit';
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
      expect(html.match(/_corner_/g)).toHaveLength(4);
      expect(html).not.toContain('data-turn');
      expect(seatFrameHostClass(item.id)).not.toBe('');
    }
  });

  it('marks the turn state without changing the design', () => {
    expect(markup('seat-frame-ember', true)).toContain('data-turn="true"');
    expect(markup('seat-frame-ember', true)).toContain('data-seat-frame="ember"');
  });

  it('draws each animated corner part as its own wrapped image, in paint order', () => {
    const starfleet = markup('seat-frame-starfleet', true);
    // Two engine lines per corner pulse; the HTML wrapper carries the animation for the compositor.
    expect(starfleet.match(/<span class="[^"]*_part_[^"]*_pulse_[^"]*"><svg/g)).toHaveLength(8);
    const constellation = markup('seat-frame-constellation', true);
    expect(constellation).toContain('style="transform-origin:37.5% 37.5%"');
    expect(markup('seat-frame-aurora', true).match(/<svg/g)).toHaveLength(4);
  });

  it('mirrors the main motif on the corners that have no alternate', () => {
    const aurora = markup('seat-frame-aurora');
    const sakura = markup('seat-frame-sakura');
    const paths = (html: string): string[] => [...html.matchAll(/<svg[^>]*>(.*?)<\/svg>/g)].map((match) => match[1]);
    expect(new Set(paths(aurora)).size).toBe(1);
    expect(new Set(paths(sakura)).size).toBe(2);
  });
});

describe('border orbit runner', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('keeps one orbit across resize reports until the frame size changes, then refits at the same lap position', () => {
    const resizeReports: Array<() => void> = [];
    const observer = { observe: vi.fn(), disconnect: vi.fn() };
    vi.stubGlobal('ResizeObserver', vi.fn(function (report: () => void) {
      resizeReports.push(report);
      return observer;
    }));
    vi.stubGlobal('getComputedStyle', () => ({ borderTopLeftRadius: '8px' }));
    const animations: Array<{ currentTime: number | null; cancel: ReturnType<typeof vi.fn> }> = [];
    const mark = {
      offsetWidth: 6, offsetHeight: 2, dataset: {} as DOMStringMap,
      animate: vi.fn(() => {
        const animation = { currentTime: null, cancel: vi.fn() };
        animations.push(animation);
        return animation;
      }),
    };
    const frame = { clientWidth: 120, clientHeight: 40 };

    const stop = runBorderOrbit(mark as unknown as HTMLElement, frame as unknown as HTMLElement, { from: 0.15, seconds: 2.5 });
    expect(mark.dataset.orbit).toBe('');
    expect(observer.observe).toHaveBeenCalledWith(frame);
    // The observer's first report and later same-size reports leave the running orbit alone.
    resizeReports[0]();
    resizeReports[0]();
    expect(animations).toHaveLength(1);
    expect(animations[0].cancel).not.toHaveBeenCalled();

    animations[0].currentTime = 900;
    frame.clientWidth = 140;
    resizeReports[0]();
    expect(animations).toHaveLength(2);
    expect(animations[0].cancel).toHaveBeenCalledOnce();
    expect(animations[1].currentTime).toBe(900);

    stop();
    expect(animations[1].cancel).toHaveBeenCalledOnce();
    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(mark.dataset.orbit).toBeUndefined();
  });
});
