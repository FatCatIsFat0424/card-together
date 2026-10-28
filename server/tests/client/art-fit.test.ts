import { afterEach, describe, expect, it, vi } from 'vitest';
import { ART_FILL, observeArtFit, scheduleArtFit } from '../../../client/src/components/art-fit';

interface FakeRect { top: number; right: number; bottom: number; left: number; width: number; height: number }

const rect = (left: number, top: number, width: number, height: number): FakeRect =>
  ({ left, top, width, height, right: left + width, bottom: top + height });

/** Records style writes and layout reads, so a test can check how often a flush forces layout. */
function fakeTile(log: string[], name: string, size: { box: [number, number]; art: [number, number]; ornament?: FakeRect }) {
  const style = new Proxy({} as Record<string, string>, {
    set(target, key: string, value: string) {
      log.push(`write ${name}.${key}`);
      target[key] = value;
      return true;
    },
  });
  const read = <T>(label: string, value: T): T => {
    log.push(`read ${name}.${label}`);
    return value;
  };
  const children = size.ornament ? [{ getAnimations: () => [], getBoundingClientRect: () => size.ornament }] : [];
  const inner = {
    isConnected: true, style,
    get offsetWidth() { return read('offsetWidth', size.art[0]); },
    get offsetHeight() { return read('offsetHeight', size.art[1]); },
    getBoundingClientRect: () => read('rect', rect(0, 0, size.art[0], size.art[1])),
    querySelectorAll: () => children,
  };
  const outer = {
    isConnected: true,
    get clientWidth() { return read('clientWidth', size.box[0]); },
    get clientHeight() { return read('clientHeight', size.box[1]); },
  };
  return { outer: outer as unknown as HTMLElement, inner: inner as unknown as HTMLElement, style };
}

const flush = (): Promise<void> => new Promise((resolve) => queueMicrotask(resolve));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('batched shop art fitting', () => {
  it('fits every queued tile with a single measuring pass between the resets and the writes', async () => {
    const log: string[] = [];
    const first = fakeTile(log, 'a', { box: [100, 80], art: [200, 100] });
    const second = fakeTile(log, 'b', { box: [60, 60], art: [40, 40], ornament: rect(-30, -30, 20, 20) });
    scheduleArtFit(first);
    scheduleArtFit(second);
    expect(log).toEqual([]);
    await flush();
    // Any read after a write forces another layout, so all reads must sit in one run.
    const passes = log.map((entry) => entry.split(' ')[0]).filter((kind, index, all) => kind !== all[index - 1]);
    expect(passes).toEqual(['write', 'read', 'write']);
    expect(first.style.zoom).toBe(String(Math.min(ART_FILL * 100 / 200, ART_FILL * 80 / 100)));
    // The ornament reaching 30px up and left counts toward the size that must fit.
    expect(second.style.padding).toBe('30px 0px 0px 30px');
    expect(second.style.zoom).toBe(String(ART_FILL * 60 / 70));
  });

  it('refits a tile when its box resizes but not for the initial report, and stops after cleanup', async () => {
    let notify: ResizeObserverCallback | undefined;
    const observe = vi.fn();
    const unobserve = vi.fn();
    vi.stubGlobal('ResizeObserver', vi.fn(function (callback: ResizeObserverCallback) {
      notify = callback;
      return { observe, unobserve, disconnect: vi.fn() };
    }));
    const log: string[] = [];
    const tile = fakeTile(log, 'a', { box: [100, 80], art: [50, 50] });
    const stop = observeArtFit(tile);
    await flush();
    expect(observe).toHaveBeenCalledWith(tile.outer);
    const fitted = log.length;
    const report = (): void => notify?.([{ target: tile.outer } as unknown as ResizeObserverEntry], {} as ResizeObserver);
    report();
    await flush();
    expect(log.length).toBe(fitted);
    report();
    await flush();
    expect(log.length).toBeGreaterThan(fitted);
    stop();
    expect(unobserve).toHaveBeenCalledWith(tile.outer);
    const stopped = log.length;
    report();
    await flush();
    expect(log.length).toBe(stopped);
  });
});
