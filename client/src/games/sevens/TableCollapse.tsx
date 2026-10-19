// ─── TableCollapse: the table cracks and caves in once Dragon Slaying has closed every suit, then stays broken ───

import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { playCollapseSound } from '../../audio/card-sound';
import { useI18nStore } from '../../stores/i18n-store';
import { useMotionStore } from '../../stores/motion-store';
import { collapseShake } from './table-collapse-scene';
import type { Point } from './table-collapse-scene';
import { createCollapseRenderer } from './table-collapse-render';
import styles from './DragonSlay.module.css';

/** A frame joined later than this, such as after a refresh, starts silently. */
const SOUND_LATENESS_MS = 300;
const MAX_STEP_SECONDS = 0.05;
/** Effects can run twice for one mount (React StrictMode); each collapse sounds once. */
let soundedCollapse: number | null = null;

/** Centre of the four suit rows, where the blow lands; the middle of the table if they are not rendered. */
function impactPoint(root: HTMLElement, layer: DOMRect): Point {
  const rows = [...(root.parentElement?.querySelectorAll('[data-sevens-row]') ?? [])]
    .map((row) => row.getBoundingClientRect()).filter((rect) => rect.width > 0);
  if (rows.length === 0) return { x: layer.width / 2, y: layer.height / 2 };
  const left = Math.min(...rows.map((rect) => rect.left));
  const right = Math.max(...rows.map((rect) => rect.right));
  const top = Math.min(...rows.map((rect) => rect.top));
  const bottom = Math.max(...rows.map((rect) => rect.bottom));
  return { x: (left + right) / 2 - layer.left, y: (top + bottom) / 2 - layer.top };
}

/**
 * Drawn over the whole table. `startedAt` is when the collapse frame began; once the collapse is over
 * (`settled`, as during the closing frame, after a refresh, or under the result) the broken table is drawn still.
 */
export function TableCollapse({ startedAt, settled }: { startedAt: number; settled: boolean }): ReactNode {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { t } = useI18nStore();
  const reducedMotion = useMotionStore((state) => state.reducedMotion);

  useEffect(() => {
    if (settled || soundedCollapse === startedAt || Date.now() - startedAt > SOUND_LATENESS_MS) return;
    soundedCollapse = startedAt;
    playCollapseSound();
  }, [settled, startedAt]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const table = root?.parentElement;
    if (!root || !canvas || !table) return;
    const still = settled || reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const renderer = createCollapseRenderer(canvas);
    if (still) {
      // The broken table only changes with its size, so it is not redrawn every frame under the result.
      const paint = (): void => {
        const layer = root.getBoundingClientRect();
        renderer.draw({ width: layer.width, height: layer.height, impact: impactPoint(root, layer) }, 0, 0, true);
      };
      paint();
      const observer = new ResizeObserver(paint);
      observer.observe(root);
      return () => observer.disconnect();
    }
    let previous = performance.now();
    let request = 0;
    const tick = (now: number): void => {
      const ms = Date.now() - startedAt;
      const step = Math.min(MAX_STEP_SECONDS, Math.max(0, (now - previous) / 1000));
      previous = now;
      // The whole table jolts with the blow, overlay included.
      const jolt = collapseShake(ms);
      table.style.transform = jolt.x || jolt.y ? `translate(${jolt.x}px, ${jolt.y}px)` : '';
      const layer = root.getBoundingClientRect();
      renderer.draw({ width: layer.width, height: layer.height, impact: impactPoint(root, layer) }, ms, step, false);
      request = requestAnimationFrame(tick);
    };
    tick(previous);
    return () => {
      cancelAnimationFrame(request);
      table.style.transform = '';
    };
  }, [startedAt, settled, reducedMotion]);

  return <div ref={rootRef} className={styles.slay} data-presentation-kind="collapse">
    {!settled && <p className={styles.srOnly} role="status" aria-live="polite">{t('presentation.collapse')}</p>}
    <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
  </div>;
}
