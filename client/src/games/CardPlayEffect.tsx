import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { cardEffectElapsed } from './card-play-effect';
import type { CardPlayEffect as Effect } from './card-play-effect';
import styles from './CardPlayEffect.module.css';

/** Decorative feedback shares the public frame's start and never captures input. */
export function CardPlayEffect({ effect, elapsedMs, durationMs, reducedMotion }: {
  effect: Effect; elapsedMs: number; durationMs: number; reducedMotion: boolean;
}): ReactNode {
  // The parent keys each frame; snapshot updates must not move an animation's delay.
  const [entryElapsed] = useState(elapsedMs);
  const elapsed = cardEffectElapsed(entryElapsed, durationMs);
  if (elapsed === null) return null;
  const style = { '--effect-delay': `${-elapsed}ms` } as CSSProperties;
  return <div className={`${styles.effect} ${reducedMotion ? styles.still : ''}`}
    style={style} data-card-play-effect={effect.kind} aria-hidden="true">
    <div className={styles.scene}>
      <span className={styles.aura} />
      <svg className={styles.rings} viewBox="0 0 320 240" preserveAspectRatio="none">
        <ellipse className={styles.ring} cx="160" cy="120" rx="145" ry="106" />
        <ellipse className={styles.echo} cx="160" cy="120" rx="126" ry="91" />
      </svg>
      {Array.from({ length: 8 }, (_, index) => <span key={index} className={styles.spark}
        style={{ '--angle': `${index * 45}deg` } as CSSProperties} />)}
    </div>
  </div>;
}
