import type { ReactNode } from 'react';
import { frameLogIndex } from '@shared/game-presentation';
import type { PresentationFrame } from '@shared/game-presentation';
import type { GameSeat } from '@shared/types';
import { ChipIcon } from '../ChipIcon';
import { signedChips } from '../blackjack/blackjack-view';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { ThCards, ThHand } from './TenHalfCards';
import { autoBetSeats, replayTenHalf } from './tenhalf-view';
import styles from './TenHalfFrame.module.css';

/**
 * Body of a Ten and a Half presentation frame, drawn from the table as of the frame's own log entry; the
 * shared frame supplies the heading and timing. Face-down cards stay hidden until the showdown frame.
 */
export function TenHalfFrame({ frame, name }: { frame: PresentationFrame; name: (seat: GameSeat) => string }): ReactNode {
  const { t } = useI18nStore();
  const log = useGameStore((state) => state.tenhalf?.log);
  const seats = useGameStore((state) => state.tenhalf?.seats);
  const totalHands = useGameStore((state) => state.tenhalf?.totalHands);
  const index = frameLogIndex(frame);
  if (!log || !seats || !totalHands || index === null) return null;
  const view = replayTenHalf(log, seats, index + 1);
  const bankerLabel = view.banker ? t('tenhalf.bankerOf', { name: name(view.banker) }) : undefined;

  if (frame.kind === 'deal') {
    const auto = autoBetSeats(log, index + 1);
    return <div className={styles.body}>
      <span className={styles.caption}>{t('tenhalf.handOf', { n: String(view.hand), total: String(totalHands) })}</span>
      {bankerLabel && <span className={styles.name}>{bankerLabel}</span>}
      <ul className={styles.seats}>{view.dealt.filter((seat) => seat !== view.banker).map((seat) => (
        <li key={seat} className={styles.seat}>
          <span className={styles.name}>{name(seat)}</span>
          <ThCards ups={[]} hole={null} hidden size="sm" freshFrom={0} />
          <span><ChipIcon />{view.bets[seat]}</span>
          {auto.includes(seat) && <span className={styles.auto}>{t('tenhalf.auto')}</span>}
        </li>
      ))}</ul>
    </div>;
  }

  if ((frame.kind === 'hit' || frame.kind === 'stand') && frame.seat) {
    const ups = view.ups[frame.seat];
    return <div className={`${styles.body} ${styles.row}`}>
      <ThHand ups={ups} hole={null} hidden size="md" done={view.done[frame.seat]}
        freshFrom={frame.kind === 'hit' ? ups.length - 1 : undefined} />
    </div>;
  }

  if (frame.kind === 'showdown' || (frame.kind === 'settle' && view.settlement)) {
    const settlement = frame.kind === 'settle' ? view.settlement : null;
    return <div className={styles.body}>
      {bankerLabel && <span className={styles.caption}>{bankerLabel}</span>}
      <ul className={styles.seats}>{view.dealt.map((seat) => {
        const net = settlement?.net[seat];
        return <li key={seat} className={styles.seat}>
          <span className={styles.name}>{name(seat)}</span>
          <ThHand ups={view.ups[seat]} hole={view.holes[seat]} hidden={false} size="sm"
            outcome={seat === view.banker ? null : settlement?.outcomes[seat]} net={net} />
          {net !== undefined && <strong className={net > 0 ? styles.good : net < 0 ? styles.bad : undefined}>
            {signedChips(net)}
          </strong>}
        </li>;
      })}</ul>
    </div>;
  }
  return null;
}
