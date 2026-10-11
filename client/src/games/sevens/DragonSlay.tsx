// ─── DragonSlay: table-wide slash and fire when Dragon Slaying closes a Sevens row ───

import { useId, useLayoutEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { RANK_DISPLAY, SUIT_SYMBOLS } from '@shared/constants';
import type { PresentationFrame } from '@shared/game-presentation';
import { useI18nStore } from '../../stores/i18n-store';
import { useMotionStore } from '../../stores/motion-store';
import { useSeatName } from '../seat-names';
import { SLAY_PARTICLES, slayAnchor } from './sevens-view';
import type { SlayLayer, SlayParticle } from './sevens-view';
import styles from './DragonSlay.module.css';

const FLAME_LAYERS: readonly SlayLayer[] = ['back', 'mid', 'core'];

function Particle({ particle }: { particle: SlayParticle }): ReactNode {
  return <span className={styles.anchor} style={{ '--t': particle.t } as CSSProperties}>
    <span className={`${styles.particle} ${styles[particle.layer]}`} style={{
      '--scale': particle.scale, '--delay': `${particle.delayMs}ms`, '--life': `${particle.lifeMs}ms`,
      '--drift': `${particle.drift}px`, '--rise': particle.rise,
    } as CSSProperties}>
      {/* The outer span rises and fades over the particle's life; the inner one flickers. */}
      <span className={styles.body} />
    </span>
  </span>;
}

/**
 * Rendered above the seats while the `slay` frame runs. The suit rows stay visible underneath,
 * so the slash is measured onto the slain row every animation frame while the centre rescales.
 * Nothing visible is written; the status text is for screen readers only.
 */
export function DragonSlay({ frame, frameStartedAt }: { frame: PresentationFrame; frameStartedAt: number }): ReactNode {
  const rootRef = useRef<HTMLDivElement>(null);
  const filterId = `slay-fire-${useId().replace(/:/g, '')}`;
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const reducedMotion = useMotionStore((state) => state.reducedMotion);
  const card = frame.cards[0];
  const suit = card?.suit;

  // A refresh mid-frame resumes the animation at the elapsed point instead of restarting it.
  useLayoutEffect(() => {
    rootRef.current?.style.setProperty('--elapsed', `${Math.max(0, Date.now() - frameStartedAt)}ms`);
  }, [frameStartedAt]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !suit) return;
    let previous = '';
    let request = 0;
    const measure = (): void => {
      const row = root.parentElement?.querySelector(`[data-sevens-row="${suit}"]`);
      const anchor = slayAnchor(root.getBoundingClientRect(), row?.getBoundingClientRect() ?? null);
      const next = [anchor.left, anchor.y, anchor.width, anchor.rowLeft, anchor.rowWidth, anchor.rowHeight].join();
      if (next !== previous) {
        previous = next;
        root.style.setProperty('--slash-x', `${anchor.left}px`);
        root.style.setProperty('--slay-y', `${anchor.y}px`);
        root.style.setProperty('--slash-w', `${anchor.width}px`);
        root.style.setProperty('--row-x', `${anchor.rowLeft}px`);
        root.style.setProperty('--row-w', `${anchor.rowWidth}px`);
        root.style.setProperty('--row-h', `${anchor.rowHeight}px`);
      }
      request = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(request);
  }, [suit]);

  if (!card || !frame.seat) return null;
  const label = `${SUIT_SYMBOLS[card.suit]}${RANK_DISPLAY[card.rank]}`;

  return <div ref={rootRef} className={`${styles.slay} ${reducedMotion ? styles.still : ''}`}
    data-presentation-kind="slay">
    <p className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">
      {t('sevens.slayDetail', { name: seatName(frame.seat), suit: SUIT_SYMBOLS[card.suit], card: label })}
    </p>
    {/* Rippling noise displaces the flames so their edges lick and waver like real fire. */}
    <svg className={styles.defs} aria-hidden="true" focusable="false">
      <filter id={filterId} x="-25%" y="-60%" width="150%" height="185%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.018 0.06" numOctaves={2} seed={7} result="noise">
          <animate attributeName="baseFrequency" dur="0.9s" repeatCount="indefinite"
            values="0.018 0.06;0.024 0.09;0.016 0.05;0.018 0.06" />
        </feTurbulence>
        <feDisplacementMap in="SourceGraphic" in2="noise" scale={30} xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
    <div className={styles.backdrop} />
    <div className={styles.char} />
    <div className={styles.line}>
      <div className={`${styles.layer} ${styles.smokeLayer}`}>
        {SLAY_PARTICLES.filter((particle) => particle.layer === 'smoke')
          .map((particle, index) => <Particle key={index} particle={particle} />)}
      </div>
      <div className={styles.bed} />
      <div className={styles.cut} />
      <div className={`${styles.layer} ${styles.fireLayer}`}
        style={{ '--fire-filter': `url(#${filterId})` } as CSSProperties}>
        {SLAY_PARTICLES.filter((particle) => FLAME_LAYERS.includes(particle.layer))
          .map((particle, index) => <Particle key={index} particle={particle} />)}
      </div>
      <div className={styles.streak} />
      <div className={styles.head} />
      <div className={styles.layer}>
        {SLAY_PARTICLES.filter((particle) => particle.layer === 'ember')
          .map((particle, index) => <Particle key={index} particle={particle} />)}
      </div>
    </div>
  </div>;
}
