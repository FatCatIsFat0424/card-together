import type { CSSProperties, ReactNode } from 'react';
import type { PresentationFrame } from '@shared/game-presentation';
import { GAME_SEAT_ORDER } from '@shared/constants';
import type { GameSeat } from '@shared/types';
import { useI18nStore } from '../../stores/i18n-store';
import { DiceCup, Die } from './Dice';
import { diceThemeVars, useDiceTheme } from './dice-theme';
import { dieMatches, sortDice } from './liarsdice-view';
import styles from './LiarsDiceFrame.module.css';

/** Body of a Liar's Dice presentation frame; the shared frame supplies the heading and timing. */
export function LiarsDiceFrame({ frame, name }: { frame: PresentationFrame; name: (seat: GameSeat) => string }): ReactNode {
  const { t } = useI18nStore();
  const theme = useDiceTheme();
  const data = frame.liarsDice;
  const themed = diceThemeVars(theme);

  if (frame.kind === 'deal') {
    return <div className={styles.body} style={themed}>
      <div className={styles.cups} aria-hidden="true">
        {[0, 1, 2].map((index) => <DiceCup key={index} mode="shaking" style={{ '--enter-delay': `calc(var(--enter-delay, 0ms) + ${index * 90}ms)` } as CSSProperties} />)}
      </div>
      <span>{t('liarsdice.rolling')}</span>
    </div>;
  }
  if (!data) return null;

  if (frame.kind === 'bid' || frame.kind === 'challenge') {
    return <div className={styles.body} style={themed}>
      {frame.kind === 'challenge' && frame.target && <span>{t('liarsdice.callTarget', { name: name(frame.target) })}</span>}
      <span className={`${styles.bid} ${styles.arrive}`}>
        <strong className={styles.quantity}>{data.quantity}</strong>
        <span aria-hidden="true">×</span>
        <Die value={data.face} label={t('liarsdice.faceLabel', { face: String(data.face) })} className={styles.bigDie} />
      </span>
    </div>;
  }

  if (frame.kind === 'diceReveal' && data.dice) {
    const rows = GAME_SEAT_ORDER.filter((seat) => (data.dice?.[seat]?.length ?? 0) > 0);
    const onesWild = data.wild ?? false;
    return <div className={styles.body} style={themed}>
      <span className={styles.bidLine}>
        {t('liarsdice.bidLine', { n: String(data.quantity) })}
        <Die value={data.face} className={styles.inlineDie} label={t('liarsdice.faceLabel', { face: String(data.face) })} />
        {onesWild && data.face !== 1 && <em className={styles.wildNote}>{t('liarsdice.onesWildNote')}</em>}
      </span>
      <ul className={styles.grid} data-seats={rows.length}>
        {rows.map((seat, index) => <li key={seat} className={`${styles.seat} ${seat === data.loser ? styles.loser : ''}`}
          style={{ '--lift-delay': `calc(var(--enter-delay, 0ms) + ${index * 70}ms)` } as CSSProperties}>
          <span className={styles.seatName}>{name(seat)}</span>
          <span className={styles.cupDice}>
            {sortDice(data.dice?.[seat] ?? []).map((value, slot) => (
              <Die key={slot} value={value} state={dieMatches(value, data.face, onesWild) ? 'match' : 'miss'}
                label={t('liarsdice.faceLabel', { face: String(value) })} />
            ))}
            <DiceCup mode="lifted" className={styles.cover} />
          </span>
        </li>)}
      </ul>
      <strong className={`${styles.tally} ${styles.late}`}>
        {t('liarsdice.found', { count: String(data.count ?? 0), n: String(data.quantity) })}
      </strong>
      {data.loser && <strong className={`${styles.verdict} ${styles.later} ${styles.bad}`}>
        {t(data.eliminated ? 'liarsdice.loserOut' : 'liarsdice.loserLoses', { name: name(data.loser) })}
      </strong>}
    </div>;
  }
  return null;
}
