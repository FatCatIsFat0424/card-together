import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { VictoryEffectId } from '@shared/types';
import { Avatar } from '../../components/Avatar';
import { useMotionStore } from '../../stores/motion-store';
import type { PreviewAccount } from '../preview-props';
import { runVictoryCanvas } from './victory-canvas';
import { VICTORY_DURATION_MS, victorySeries } from './victory-schedule';
import styles from './VictoryEffectPreview.module.css';

const LOOP_GAP_MS = 900;
const PREVIEW_DENSITY = 0.6;

/** A looping miniature around the shopper's avatar; it pauses while scrolled out of view. */
export function VictoryEffectPreview({ id, account }: { readonly id: VictoryEffectId; readonly account: PreviewAccount }): ReactNode {
  const reduced = useMotionStore((state) => state.reducedMotion);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const anchor = anchorRef.current;
    if (!canvas || !anchor) return;
    let stop: (() => void) | null = null;
    const start = (): void => {
      stop?.();
      stop = runVictoryCanvas(canvas, {
        targets: [{
          series: victorySeries(id), seed: id,
          locate: () => {
            const rect = anchor.getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          },
        }],
        reduced, durationMs: VICTORY_DURATION_MS, loopGapMs: LOOP_GAP_MS, density: PREVIEW_DENSITY,
        scale: (_, height) => Math.min(0.48, Math.max(0.3, height / 290)),
      });
    };
    const pause = (): void => {
      stop?.();
      stop = null;
    };
    if (typeof IntersectionObserver === 'undefined') {
      start();
      return pause;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        if (!stop) start();
      } else pause();
    });
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      pause();
    };
  }, [id, reduced]);

  return <div className={styles.preview}>
    <span ref={anchorRef} className={styles.anchor}>
      <Avatar avatar={account.avatar} image={account.avatarImage} border={account.avatarBorder} color={account.color} size="medium" />
    </span>
    <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
  </div>;
}
