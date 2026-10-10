import type { ReactNode } from 'react';
import type { PresentationFrame } from '@shared/game-presentation';
import type { Seat } from '@shared/types';
import { useI18nStore } from '../../stores/i18n-store';
import { LiarCardFace } from './LiarCardFace';
import { AppIcon } from '../../components/AppIcon';
import styles from './LiarsDeckFrame.module.css';

/** Body of a Liar's Deck presentation frame; the shared frame supplies the heading and timing. */
export function LiarsDeckFrame({ frame, name }: { frame: PresentationFrame; name: (seat: Seat) => string }): ReactNode {
  const { t } = useI18nStore();
  if (frame.kind === 'deal' && frame.tableFace) {
    return <div className={styles.body}>
      <LiarCardFace face={frame.tableFace} variant={0} className={`${styles.card} ${styles.flip}`}
        label={t(`liarsdeck.face.${frame.tableFace}`)} />
      <strong className={styles.callout}>
        {t('presentation.tableFace', { face: t(`liarsdeck.face.${frame.tableFace}`) })}
      </strong>
    </div>;
  }
  if (frame.kind === 'play' && frame.count) {
    return <div className={`${styles.body} ${styles.row}`}>
      <div className={`${styles.cards} ${styles.arrive}`} aria-hidden="true">
        {Array.from({ length: frame.count }, (_, index) => <span key={index} className={`${styles.card} ${styles.back}`} />)}
      </div>
      <strong className={styles.count}>×{frame.count}</strong>
    </div>;
  }
  if (frame.kind === 'challenge' && frame.liarFaces) {
    return <div className={styles.body}>
      {frame.target && <span>{t('presentation.callOn', { name: name(frame.target) })}</span>}
      <div className={styles.cards}>
        {frame.liarFaces.map((face, index) => <LiarCardFace key={index} face={face} variant={index}
          className={`${styles.card} ${styles.flip} ${styles.delayed}`} label={t(`liarsdeck.face.${face}`)} />)}
      </div>
      <strong className={`${styles.callout} ${styles.delayed} ${frame.lied ? styles.bad : styles.good}`}>
        {t(frame.lied ? 'presentation.lied' : 'presentation.honest')}
      </strong>
    </div>;
  }
  if ((frame.kind === 'roulette' || frame.kind === 'shot') && frame.shot) {
    const resolved = frame.kind === 'shot';
    return <div className={styles.body}>
      <span className={`${styles.revolver} ${resolved ? '' : styles.spin}`} aria-hidden="true">
        {resolved && !frame.survived ? <AppIcon name="burst" /> : '🔫'}
      </span>
      <span>{t('presentation.pull', { n: String(frame.shot) })}</span>
      {resolved && <strong className={`${styles.callout} ${frame.survived ? styles.good : styles.bad}`}>
        {t(frame.survived ? 'presentation.survived' : 'presentation.killed')}
      </strong>}
    </div>;
  }
  return null;
}
