/** Share of the tile's art box that a preview may use; the rest is breathing room. */
export const ART_FILL = 0.9;

export interface Reach {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** The box a preview must fit (`outer`) and the preview it shrinks with `zoom` (`inner`). */
export interface ArtFitTarget {
  readonly outer: HTMLElement;
  readonly inner: HTMLElement;
}

/**
 * How far painted descendants reach beyond the element's own box, so ears, antlers, tentacles and
 * emblems count toward the preview size. Elements running animations are skipped: they move in and
 * out of the box and would change the size from one measurement to the next.
 */
export function paintedOverflow(element: HTMLElement): Reach {
  const base = element.getBoundingClientRect();
  const reach = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const child of element.querySelectorAll('*')) {
    if (typeof child.getAnimations === 'function' && child.getAnimations().length > 0) continue;
    const rect = child.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    reach.top = Math.max(reach.top, base.top - rect.top);
    reach.left = Math.max(reach.left, base.left - rect.left);
    reach.right = Math.max(reach.right, rect.right - base.right);
    reach.bottom = Math.max(reach.bottom, rect.bottom - base.bottom);
  }
  return reach;
}

const mounted = new Map<Element, ArtFitTarget>();
/** Boxes whose initial ResizeObserver report is still due; mounting already queued their fit. */
const unreported = new WeakSet<Element>();
const pending = new Set<ArtFitTarget>();
let scheduled = false;
let resizes: ResizeObserver | null = null;
let fontsListening = false;

/**
 * Fits every queued preview with one layout: reset all, measure all, then write all. Fitting each
 * tile on its own (reset, measure, write) forces a synchronous layout of the whole page per tile,
 * which dominated the shop's load.
 */
function flushArtFits(): void {
  scheduled = false;
  const targets = [...pending].filter(({ outer, inner }) => outer.isConnected && inner.isConnected);
  pending.clear();
  for (const { inner } of targets) {
    inner.style.zoom = '';
    inner.style.padding = '';
  }
  const fits = targets.map(({ outer, inner }) => {
    const reach = paintedOverflow(inner);
    // Padding by the reach makes the decoration part of the box that has to fit.
    const width = inner.offsetWidth + reach.left + reach.right;
    const height = inner.offsetHeight + reach.top + reach.bottom;
    const zoom = width > 0 && height > 0
      ? Math.min(1, ART_FILL * outer.clientWidth / width, ART_FILL * outer.clientHeight / height) : null;
    return { reach, zoom };
  });
  targets.forEach(({ inner }, index) => {
    const { reach, zoom } = fits[index];
    inner.style.padding = `${reach.top}px ${reach.right}px ${reach.bottom}px ${reach.left}px`;
    if (zoom !== null) inner.style.zoom = String(zoom);
  });
}

/** Queues a fit for the next microtask, which still runs before the browser paints the commit. */
export function scheduleArtFit(target: ArtFitTarget): void {
  pending.add(target);
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(flushArtFits);
}

/** Text previews change size when a web font arrives after the first fit. */
function refitAll(): void {
  for (const target of mounted.values()) scheduleArtFit(target);
}

/** Fits a preview now and again whenever its box resizes or fonts load; returns the cleanup. */
export function observeArtFit(target: ArtFitTarget): () => void {
  mounted.set(target.outer, target);
  scheduleArtFit(target);
  if (typeof ResizeObserver === 'function') {
    resizes ??= new ResizeObserver((entries) => {
      for (const entry of entries) {
        const observed = mounted.get(entry.target);
        if (unreported.delete(entry.target) || !observed) continue;
        scheduleArtFit(observed);
      }
    });
    unreported.add(target.outer);
    resizes.observe(target.outer);
  }
  if (!fontsListening && typeof document !== 'undefined' && document.fonts) {
    fontsListening = true;
    document.fonts.addEventListener('loadingdone', refitAll);
  }
  return () => {
    mounted.delete(target.outer);
    pending.delete(target);
    resizes?.unobserve(target.outer);
  };
}
