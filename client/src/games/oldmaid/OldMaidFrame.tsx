import type { CSSProperties, ReactNode } from 'react';
import type { PresentationFrame } from '@shared/game-presentation';
import { GAME_SEAT_ORDER, RANK_DISPLAY } from '@shared/constants';
import type { GameSeat } from '@shared/types';
import { CardBackArt } from '../../cosmetics/art-layers/CardBackArt';
import { useI18nStore } from '../../stores/i18n-store';
import cardStyles from '../blackjack/BlackjackCards.module.css';
import styles from './OldMaidFrame.module.css';

/** Body of an Old Maid presentation frame; the shared frame supplies the heading, timing, and a drawn pair. */
export function OldMaidFrame({ frame, name }: { frame: PresentationFrame; name: (seat: GameSeat) => string }): ReactNode {
  const { t, locale } = useI18nStore();
  const data = frame.oldMaid;
  if (!data) return null;

  if (frame.kind === 'deal') {
    const listed = GAME_SEAT_ORDER.filter((seat) => (data.discards?.[seat]?.length ?? 0) > 0);
    return <div className={styles.body}>
      <span className={styles.heading}>{t('oldmaid.dealing')}</span>
      {listed.length === 0 ? <span>{t('oldmaid.nothingDiscarded')}</span>
        : <ul className={styles.grid} data-seats={listed.length}>{listed.map((seat, index) => {
          const cards = data.discards?.[seat] ?? [];
          const ranks = [...new Set(cards.map((card) => card.rank))];
          return <li key={seat} className={styles.seat} style={{ '--row': index } as CSSProperties}>
            <span className={styles.seatName}>{name(seat)}</span>
            <span className={styles.pairs}>
              <strong>{cards.length / 2}</strong>
              <span className={styles.ranks}>{ranks.map((rank) => RANK_DISPLAY[rank]).join(' ')}</span>
            </span>
          </li>;
        })}</ul>}
    </div>;
  }

  if (frame.kind === 'draw' && frame.seat && frame.target) {
    const out = data.finished ?? [];
    return <div className={styles.body}>
      <span>{t('oldmaid.drawsFrom', { n: String((frame.handIndex ?? 0) + 1), name: name(frame.target) })}</span>
      <span className={`${cardStyles.card} ${cardStyles.back} ${styles.flying}`} aria-hidden="true"><CardBackArt /></span>
      {frame.cards.length > 0 && <strong className={styles.pair}>{t('oldmaid.pairMade')}</strong>}
      {out.length > 0 && <span className={styles.out}>
        {t('oldmaid.outNow', { names: out.map(name).join(locale === 'zh-TW' ? '、' : ', ') })}</span>}
    </div>;
  }

  if (frame.kind === 'settle' && data.order) {
    return <div className={styles.body}>
      <span className={styles.heading}>{t('oldmaid.settleOrder')}</span>
      <ol className={styles.order}>{data.order.map((seat, index) => {
        const last = index === (data.order?.length ?? 0) - 1;
        return <li key={seat} className={last ? styles.loser : undefined}>
          <span>{last ? t('oldmaid.joker') : t('oldmaid.place', { n: String(index + 1) })}</span>
          <strong>{name(seat)}</strong>
          <span className={styles.gain}>+{data.points?.[seat] ?? 0}</span>
        </li>;
      })}</ol>
    </div>;
  }
  return null;
}
