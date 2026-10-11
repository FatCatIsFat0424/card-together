// ─── DragonSlay: the closed Sevens row burns and is cut along its length, with or without a dragon ───

import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { RANK_DISPLAY, SUIT_SYMBOLS } from '@shared/constants';
import type { PresentationFrame } from '@shared/game-presentation';
import type { SevensSlayEffect } from '@shared/types';
import { playSlashSound } from '../../audio/card-sound';
import { useI18nStore } from '../../stores/i18n-store';
import { useMotionStore } from '../../stores/motion-store';
import { useSeatName } from '../seat-names';
import { slayLayout, slayTimeline } from './dragon-slay-scene';
import { createSlayRenderer } from './dragon-slay-render';
import styles from './DragonSlay.module.css';

/** Longest step the fire simulation takes, so a stalled tab does not fling particles. */
const MAX_STEP_SECONDS = 0.05;
/** A frame joined later than this, such as after a refresh, starts silently. */
const SOUND_LATENESS_MS = 300;
/** Effects can run twice for one mount (React StrictMode); each frame sounds once. */
let soundedFrame: string | null = null;

/**
 * Rendered above the seats while the `slay` frame runs. The suit rows stay visible underneath;
 * the row is measured every animation frame because the table centre rescales around it.
 * The scene is time-based from the frame start, so a refresh resumes mid-animation.
 * Nothing visible is written; the status text is for screen readers only.
 */
export function DragonSlay({ frame, frameStartedAt, effect }: {
  frame: PresentationFrame; frameStartedAt: number; effect: SevensSlayEffect;
}): ReactNode {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const reducedMotion = useMotionStore((state) => state.reducedMotion);
  const card = frame.cards[0];
  const suit = card?.suit;

  useEffect(() => {
    if (soundedFrame === frame.key || Date.now() - frameStartedAt > SOUND_LATENESS_MS) return;
    soundedFrame = frame.key;
    const timeline = slayTimeline(effect);
    playSlashSound({ fireStart: timeline.fireStart / 1000, fireEnd: timeline.fireEnd / 1000,
      strike: timeline.strike / 1000, cut: timeline.cut / 1000 });
  }, [frame.key, frameStartedAt, effect]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas || !suit) return;
    const renderer = createSlayRenderer(canvas);
    const still = reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let previous = performance.now();
    let request = 0;
    const tick = (now: number): void => {
      const row = root.parentElement?.querySelector(`[data-sevens-row="${suit}"]`) ?? null;
      const layout = slayLayout(root.getBoundingClientRect(), row?.getBoundingClientRect() ?? null);
      const step = Math.min(MAX_STEP_SECONDS, Math.max(0, (now - previous) / 1000));
      previous = now;
      renderer.draw(layout, Date.now() - frameStartedAt, step, still, effect);
      request = requestAnimationFrame(tick);
    };
    tick(previous);
    return () => cancelAnimationFrame(request);
  }, [suit, frameStartedAt, reducedMotion, effect]);

  if (!card || !frame.seat) return null;
  const label = `${SUIT_SYMBOLS[card.suit]}${RANK_DISPLAY[card.rank]}`;

  return <div ref={rootRef} className={styles.slay} data-presentation-kind="slay">
    <p className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">
      {t('sevens.slayDetail', { name: seatName(frame.seat), suit: SUIT_SYMBOLS[card.suit], card: label })}
    </p>
    <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
  </div>;
}
