import type { ReactNode } from 'react';
import { frameLogIndex } from '@shared/game-presentation';
import type { PresentationFrame } from '@shared/game-presentation';
import { HE_HANDS } from '@shared/rules/holdem';
import type { Seat } from '@shared/types';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { ChipIcon } from '../ChipIcon';
import { Board, ChipAmount, HeCards } from './HoldemCards';
import { HE_SEATS, chipsAdded, holdemBlindSeats, holdemCategory, potLines, potTotal, replayHoldem } from './holdem-view';
import type { PotLine } from './holdem-view';
import styles from './HoldemFrame.module.css';

/** Main pot, numbered side pots, and returned excess, as the pot list labels them. */
export function usePotLabel(): (pot: PotLine, index: number, count: number) => string {
  const { t } = useI18nStore();
  return (pot, index, count) => pot.returned ? t('holdem.returned')
    : index === 0 ? count > 1 ? t('holdem.mainPot') : t('holdem.pot') : t('holdem.sidePot', { n: String(index) });
}

/**
 * Body of a Hold'em presentation frame, drawn from the table as of the frame's own log entry so
 * the board and pot never run ahead; the shared frame supplies the heading and timing.
 */
export function HoldemFrame({ frame, name }: { frame: PresentationFrame; name: (seat: Seat) => string }): ReactNode {
  const { t } = useI18nStore();
  const log = useGameStore((state) => state.holdem?.log);
  const potLabel = usePotLabel();
  const index = frameLogIndex(frame);
  if (!log || index === null || !log[index]) return null;
  const view = replayHoldem(log, index + 1);
  const entry = log[index];
  const pot = <span className={styles.pot}>{t('holdem.pot')} <ChipAmount amount={potTotal(view)} /></span>;

  if (entry.type === 'hand') {
    const blinds = holdemBlindSeats(view);
    return <div className={styles.body}>
      <span className={styles.caption}>
        {t('holdem.handOf', { n: String(entry.hand), total: String(HE_HANDS) })} ·
        {' '}{t('holdem.blinds', { sb: String(entry.smallBlind), bb: String(entry.bigBlind) })}
      </span>
      {blinds && <ul className={styles.list}>
        {([[blinds.small, 'holdem.sb'], [blinds.big, 'holdem.bb']] as const).map(([seat, key]) => <li key={key}>
          <span className={styles.tag}>{t(key)}</span> <span className={styles.name}>{name(seat)}</span>
          {' '}<ChipAmount amount={entry.blinds[seat]} />
        </li>)}
      </ul>}
      <HeCards cards={[]} backs={2} size="sm" />
    </div>;
  }

  if (entry.type === 'action') {
    const amount = entry.action === 'call' ? chipsAdded(log, index) : entry.to;
    return <div className={styles.body}>
      {entry.action !== 'fold' && entry.action !== 'check' && <strong className={styles.amount}>
        {entry.action === 'raise' && '→ '}<ChipIcon />{amount}
      </strong>}
      <Board cards={view.board} size="xs" />
      {pot}
    </div>;
  }

  if (entry.type === 'street') {
    return <div className={styles.body}>
      <span className={styles.caption}>{t(`holdem.street.${entry.street}`)}</span>
      <Board cards={view.board} size="sm" freshFrom={view.board.length - entry.cards.length} />
      {pot}
    </div>;
  }

  if (entry.type === 'showdown') {
    return <div className={styles.body}>
      <Board cards={view.board} size="xs" />
      <ul className={styles.hands}>{HE_SEATS.filter((seat) => entry.cards[seat].length > 0).map((seat) => {
        const category = holdemCategory(entry.cards[seat], view.board);
        return <li key={seat} className={styles.hand}>
          <span className={styles.name}>{name(seat)}</span>
          <HeCards cards={entry.cards[seat]} size="sm" freshFrom={0} />
          {category && <span className={styles.category}>{t(`holdem.category.${category}`)}</span>}
        </li>;
      })}</ul>
    </div>;
  }

  const award = view.award;
  if (!award) return null;
  const pots = potLines(view);
  return <div className={styles.body}>
    <Board cards={view.board} size="xs" />
    <ul className={styles.list}>{pots.map((line, potIndex) => <li key={potIndex}>
      <span className={styles.tag}>{potLabel(line, potIndex, pots.length)}</span>
      {' '}<ChipAmount amount={line.amount} /> → <strong>{line.winners.map(name).join(' · ')}</strong>
    </li>)}</ul>
    <ul className={styles.list}>{HE_SEATS.filter((seat) => award.payouts[seat] > 0).map((seat) => <li key={seat}>
      <span className={styles.name}>{name(seat)}</span> <strong className={styles.good}>+{award.payouts[seat]}</strong>
    </li>)}</ul>
    {award.eliminated.length > 0 && <p className={styles.bad}>
      {award.eliminated.map((seat) => `${name(seat)} ${t('holdem.log.eliminated')}`).join(' · ')}
    </p>}
  </div>;
}
