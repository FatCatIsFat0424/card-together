import { useLayoutEffect, useRef, useState } from 'react';

export interface IndicatorFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ActiveIndicatorRefs<C extends HTMLElement, I extends HTMLElement> {
  readonly containerRef: (element: C | null) => void;
  readonly indicatorRef: (element: I | null) => void;
}

export function sameIndicatorFrame(a: IndicatorFrame | null, b: IndicatorFrame | null): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** Offset box of the active child; null when none is active or the container is not laid out. */
function measure(container: HTMLElement, selector: string): IndicatorFrame | null {
  const active = container.querySelector<HTMLElement>(selector);
  if (!active || active.offsetParent !== container || active.offsetWidth === 0) return null;
  return { x: active.offsetLeft, y: active.offsetTop, width: active.offsetWidth, height: active.offsetHeight };
}

function applyFrame(indicator: HTMLElement, frame: IndicatorFrame): void {
  indicator.style.setProperty('--indicator-x', `${frame.x}px`);
  indicator.style.setProperty('--indicator-y', `${frame.y}px`);
  indicator.style.setProperty('--indicator-width', `${frame.width}px`);
  indicator.style.setProperty('--indicator-height', `${frame.height}px`);
}

/** Moves the indicator to the active child and returns the frame it now shows. */
function placeIndicator(
  container: HTMLElement,
  indicator: HTMLElement,
  selector: string,
  previous: IndicatorFrame | null,
  animate: boolean,
): IndicatorFrame | null {
  const frame = measure(container, selector);
  if (!frame) {
    indicator.style.opacity = '0';
    return null;
  }
  if (sameIndicatorFrame(previous, frame)) return frame;
  if (animate && previous) applyFrame(indicator, frame);
  else {
    indicator.style.transition = 'none';
    applyFrame(indicator, frame);
    // A fresh selection fades in where it lands; layout changes appear instantly.
    if (!animate) indicator.style.opacity = '1';
    void indicator.offsetWidth;
    indicator.style.transition = '';
  }
  indicator.style.opacity = '1';
  return frame;
}

/**
 * Positions an indicator element behind the child matching `selector` through the
 * `--indicator-*` custom properties. The container must be the indicator's positioned
 * ancestor. Changing `activeKey` slides the indicator; size changes (resize, font load,
 * locale) snap it so the slide transition only plays for real selection changes.
 */
export function useActiveIndicator<C extends HTMLElement, I extends HTMLElement>(
  selector: string,
  activeKey: string,
): ActiveIndicatorRefs<C, I> {
  const [container, setContainer] = useState<C | null>(null);
  const [indicator, setIndicator] = useState<I | null>(null);
  const placed = useRef<{ indicator: I; frame: IndicatorFrame | null } | null>(null);

  useLayoutEffect(() => {
    if (!container || !indicator) return;
    const update = (animate: boolean): void => {
      const previous = placed.current?.indicator === indicator ? placed.current.frame : null;
      placed.current = { indicator, frame: placeIndicator(container, indicator, selector, previous, animate) };
    };
    // The first placement of a newly mounted indicator appears without animating.
    update(placed.current?.indicator === indicator);
    const observer = new ResizeObserver(() => update(false));
    observer.observe(container);
    for (const child of Array.from(container.children)) {
      if (child !== indicator) observer.observe(child);
    }
    return () => observer.disconnect();
  }, [container, indicator, selector, activeKey]);

  return { containerRef: setContainer, indicatorRef: setIndicator };
}
