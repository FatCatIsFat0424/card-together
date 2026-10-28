import { useLayoutEffect, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { fitHand, handCardLimit } from './hand-fit';
import type { HandFit } from './hand-fit';

const LANDSCAPE_PHONE = '(max-height: 500px) and (min-width: 600px)';

/**
 * Style variables that fit a hand in its container on a landscape phone, where every card must stay
 * visible. Elsewhere the stylesheet sizes the hand, so this returns nothing.
 */
export function useHandFit(ref: RefObject<HTMLElement | null>, count: number): CSSProperties | undefined {
  const [fit, setFit] = useState<HandFit | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const query = window.matchMedia(LANDSCAPE_PHONE);
    const update = (): void => {
      const next = query.matches ? fitHand(element.clientWidth, count, handCardLimit(window.innerHeight)) : null;
      setFit((previous) => previous?.cardWidth === next?.cardWidth && previous?.overlap === next?.overlap
        ? previous : next);
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    query.addEventListener('change', update);
    window.addEventListener('resize', update);
    update();
    return () => {
      observer.disconnect();
      query.removeEventListener('change', update);
      window.removeEventListener('resize', update);
    };
  }, [ref, count]);
  return fit ? { '--card-w': `${fit.cardWidth}px`, '--overlap': fit.overlap } as CSSProperties : undefined;
}
