import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { SOUND_PACKS } from '@shared/constants';
import type { SoundPackId } from '@shared/types';
import { playSoundPackPreview, stopCardSounds } from '../../audio/card-sound';
import { useI18nStore } from '../../stores/i18n-store';
import { useMotionStore } from '../../stores/motion-store';
import type { PreviewAccount } from '../preview-props';
import { resolveSoundPack } from './sound-packs';
import styles from './SoundPackPreview.module.css';

interface Look {
  /** Two colours taken from the series' card back. */
  readonly colors: readonly [string, string];
  /** Relative bar heights, shaped after how the pack sounds. */
  readonly bars: readonly number[];
}

const LOOKS: Readonly<Record<string, Look>> = {
  starfleet: { colors: ['#65dff5', '#f7cf70'], bars: [0.2, 0.4, 0.8, 1, 0.8, 0.4, 0.2, 0.5, 0.8, 1, 0.4] },
  shrine: { colors: ['#ed7450', '#68dfca'], bars: [1, 0.8, 0.55, 0.4, 0.3, 0.8, 0.6, 0.4, 0.3, 0.2, 0.15] },
  ironfront: { colors: ['#a6b77d', '#e8c16b'], bars: [0.8, 0.25, 0.8, 0.25, 1, 0.3, 0.8, 0.25, 0.8, 0.25, 1] },
  neoncity: { colors: ['#ef68dd', '#78f7f5'], bars: [1, 0.2, 0.9, 0.15, 0.7, 1, 0.2, 0.8, 0.3, 1, 0.2] },
  crownrealm: { colors: ['#f1cd73', '#4878c4'], bars: [0.4, 0.7, 1, 0.7, 0.4, 0.6, 0.9, 0.6, 0.4, 0.7, 0.4] },
  aurora: { colors: ['#58e7c2', '#ab9cf2'], bars: [0.35, 0.55, 0.75, 0.9, 1, 0.9, 0.75, 0.55, 0.4, 0.55, 0.35] },
  tide: { colors: ['#69d7de', '#cee9dd'], bars: [0.4, 0.7, 0.9, 0.7, 0.4, 0.3, 0.5, 0.75, 0.9, 0.65, 0.35] },
  sakura: { colors: ['#f5aec3', '#f6ddcb'], bars: [1, 0.45, 0.8, 0.35, 0.6, 0.28, 0.45, 0.2, 0.3, 0.15, 0.2] },
  constellation: { colors: ['#93b5eb', '#ead5a2'], bars: [0.3, 0.9, 0.2, 0.6, 0.15, 1, 0.25, 0.7, 0.2, 0.5, 0.3] },
  bamboo: { colors: ['#8bc6a3', '#e7d8ac'], bars: [1, 0.25, 0.7, 0.25, 1, 0.25, 0.7, 0.25, 1, 0.25, 0.7] },
  gilded: { colors: ['#c9975b', '#f2d79c'], bars: [1, 0.85, 0.7, 0.58, 0.48, 0.4, 0.33, 0.27, 0.22, 0.17, 0.13] },
  ember: { colors: ['#ec8256', '#ffd1a0'], bars: [0.5, 0.3, 0.7, 0.4, 0.85, 0.35, 0.6, 0.3, 0.5, 0.25, 0.4] },
  lotus: { colors: ['#e5b3c3', '#e9dbb3'], bars: [0.25, 0.35, 0.45, 0.55, 0.6, 0.65, 0.6, 0.55, 0.45, 0.35, 0.25] },
  frost: { colors: ['#99d4e1', '#e4f4fa'], bars: [0.2, 0.4, 0.3, 0.6, 0.5, 0.8, 0.7, 1, 0.85, 0.6, 0.35] },
  dune: { colors: ['#d7a378', '#f6dba3'], bars: [1, 0.3, 0.3, 0.7, 0.3, 1, 0.3, 0.3, 0.7, 0.3, 0.5] },
};
/** Unequipped players hear the classic tones; a neutral plate stands in for them. */
const CLASSIC_LOOK: Look = { colors: ['#8fa3bf', '#d5dde8'], bars: [0.3, 0.5, 0.7, 0.5, 0.3, 0.45, 0.7, 0.9, 0.7, 0.45, 0.3] };

/** Pause after the last sound so the bars settle when playback has finished. */
const SETTLE_MS = 150;

/** A series-tinted equaliser with a button that plays the pack's turn cue and a card play. */
export function SoundPackPreview({ id }: { readonly id: SoundPackId | null; readonly account: PreviewAccount }): ReactNode {
  const { t } = useI18nStore();
  const reducedMotion = useMotionStore((state) => state.reducedMotion);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const started = useRef(false);
  const look = LOOKS[SOUND_PACKS.find((item) => item.id === id)?.design ?? ''] ?? CLASSIC_LOOK;

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
    if (started.current) stopCardSounds();
  }, []);

  const play = (event: MouseEvent<HTMLButtonElement>): void => {
    // The preview sits in a product card and a dialog; a click here must never reach their handlers.
    event.stopPropagation();
    const seconds = playSoundPackPreview(resolveSoundPack(id));
    if (timer.current !== null) clearTimeout(timer.current);
    if (seconds <= 0) {
      setPlaying(false);
      return;
    }
    started.current = true;
    setPlaying(true);
    timer.current = setTimeout(() => { timer.current = null; setPlaying(false); }, seconds * 1000 + SETTLE_MS);
  };

  return <div className={styles.preview} style={{ '--sound-a': look.colors[0], '--sound-b': look.colors[1] } as CSSProperties}>
    <div className={`${styles.plate} ${playing ? styles.playing : ''} ${reducedMotion ? styles.still : ''}`} aria-hidden="true">
      {look.bars.map((height, index) => <span key={index} className={styles.bar}
        style={{ '--height': height, '--delay': `${(index % 5) * 70}ms` } as CSSProperties} />)}
    </div>
    <button type="button" className={styles.play} onClick={play}>
      <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
        <path d="M3 1.5v9l7.5-4.5z" fill="currentColor" />
      </svg>
      {t('shop.soundPreview.play')}
    </button>
  </div>;
}
