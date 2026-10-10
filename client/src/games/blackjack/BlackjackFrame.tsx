import type { ReactNode } from 'react';
import { frameLogIndex } from '@shared/game-presentation';
import type { PresentationFrame } from '@shared/game-presentation';
import { BJ_HANDS } from '@shared/rules/blackjack';
import type { Seat } from '@shared/types';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { BjHand, DealerHand } from './BlackjackCards';
import { BJ_SEATS, autoBetSeats, replayBlackjack, signedChips } from './blackjack-view';
import styles from './BlackjackFrame.module.css';

/**
 * Body of a Blackjack presentation frame, drawn from the table as of the frame's own log entry;
 * the shared frame supplies the heading and timing.
 */
export function BlackjackFrame({ frame, name }: { frame: PresentationFrame; name: (seat: Seat) => string }): ReactNode {
  const { t } = useI18nStore();
  const log = useGameStore((state) => state.blackjack?.log);
  const index = frameLogIndex(frame);
  if (!log || index === null) return null;
  const view = replayBlackjack(log, index + 1);
  const seated = BJ_SEATS.filter((seat) => view.hands[seat].length > 0);

  if (frame.kind === 'deal') {
    const auto = autoBetSeats(log, index + 1);
    return <div className={styles.body}>
      <span className={styles.caption}>{t('blackjack.handOf', { n: String(view.hand), total: String(BJ_HANDS) })}</span>
      <DealerHand cards={view.dealer} holeHidden={view.holeHidden} size="sm" freshFrom={0} />
      <ul className={styles.seats}>{seated.map((seat) => <li key={seat} className={styles.seat}>
        <span className={styles.name}>{name(seat)}</span>
        <BjHand hand={view.hands[seat][0]} size="sm" freshFrom={0} />
        {auto.includes(seat) && <span className={styles.auto}>{t('blackjack.auto')}</span>}
      </li>)}</ul>
    </div>;
  }

  if ((frame.kind === 'hit' || frame.kind === 'double' || frame.kind === 'stand' || frame.kind === 'split')
    && frame.seat && frame.handIndex !== undefined) {
    const hands = view.hands[frame.seat];
    const shown = frame.kind === 'split' ? [frame.handIndex, frame.handIndex + 1] : [frame.handIndex];
    return <div className={`${styles.body} ${styles.row}`}>
      {shown.filter((handIndex) => hands[handIndex]).map((handIndex) => {
        const hand = hands[handIndex];
        const freshFrom = frame.kind === 'stand' ? undefined : frame.kind === 'split' ? 1 : hand.cards.length - 1;
        return <BjHand key={handIndex} hand={hand} size="md" freshFrom={freshFrom}
          label={hands.length > 1 ? t('blackjack.handIndex', { n: String(handIndex + 1) }) : undefined} />;
      })}
    </div>;
  }

  if (frame.kind === 'dealerReveal' || frame.kind === 'dealerHit') {
    return <div className={styles.body}>
      <DealerHand cards={view.dealer} holeHidden={false} size="md"
        freshFrom={frame.kind === 'dealerReveal' ? 1 : view.dealer.length - 1} />
    </div>;
  }

  if (frame.kind === 'settle' && view.settlement) {
    const { outcomes, net } = view.settlement;
    return <div className={styles.body}>
      <DealerHand cards={view.dealer} holeHidden={false} size="sm" />
      <ul className={styles.seats}>{seated.map((seat) => <li key={seat} className={styles.seat}>
        <span className={styles.name}>{name(seat)}</span>
        <span className={styles.hands}>{view.hands[seat].map((hand, handIndex) => (
          <BjHand key={handIndex} hand={hand} size="sm" outcome={outcomes[seat][handIndex]} />
        ))}</span>
        <strong className={net[seat] > 0 ? styles.good : net[seat] < 0 ? styles.bad : undefined}>
          {signedChips(net[seat])}
        </strong>
      </li>)}</ul>
    </div>;
  }
  return null;
}
