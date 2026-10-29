import { useLayoutEffect, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { fitHand, handCardLimit, HAND_ROOMY_VISIBLE } from './hand-fit';
import type { HandFit } from './hand-fit';

const LANDSCAPE_PHONE = '(max-height: 500px) and (min-width: 600px)';
/** Portrait phones size the hand in the stylesheet: their cards run past the row and the table clips them. */
const PORTRAIT_PHONE = '(max-width: 767px) and (orientation: portrait)';

/** Attribute of the hidden element whose width is the card width the stylesheet would pick without a width limit. */
export const HAND_PROBE = 'data-hand-probe';

function contentWidth(element: HTMLElement): number {
  const style = getComputedStyle(element);
  return element.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
}

/**
 * Style variables that fit a hand in the width its container has, so every card stays visible and
 * selectable whatever the hand size or the controls reserved beside it. Portrait phones keep the stylesheet's
 * sizes, so this returns nothing there.
 */
export function useHandFit(ref: RefObject<HTMLElement | null>, count: number): CSSProperties | undefined {
  const [fit, setFit] = useState<HandFit | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const phone = window.matchMedia(LANDSCAPE_PHONE);
    const portrait = window.matchMedia(PORTRAIT_PHONE);
    const probe = element.querySelector<HTMLElement>(`[${HAND_PROBE}]`);
    const update = (): void => {
      let next: HandFit | null = null;
      if (phone.matches) {
        next = fitHand(contentWidth(element), count, handCardLimit(window.innerHeight));
      } else if (!portrait.matches && probe) {
        next = fitHand(contentWidth(element), count, probe.offsetWidth, HAND_ROOMY_VISIBLE);
      }
      setFit((previous) => previous?.cardWidth === next?.cardWidth && previous?.overlap === next?.overlap
        ? previous : next);
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    if (probe) observer.observe(probe);
    phone.addEventListener('change', update);
    portrait.addEventListener('change', update);
    window.addEventListener('resize', update);
    update();
    return () => {
      observer.disconnect();
      phone.removeEventListener('change', update);
      portrait.removeEventListener('change', update);
      window.removeEventListener('resize', update);
    };
  }, [ref, count]);
  return fit ? { '--card-w': `${fit.cardWidth}px`, '--overlap': fit.overlap } as CSSProperties : undefined;
}
