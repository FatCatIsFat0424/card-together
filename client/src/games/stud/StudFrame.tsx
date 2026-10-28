import type { ReactNode } from 'react';
import { GAME_SEAT_ORDER } from '@shared/constants';
import { frameLogIndex } from '@shared/game-presentation';
import type { PresentationFrame } from '@shared/game-presentation';
import { STUD_HANDS } from '@shared/rules/stud';
import type { GameSeat } from '@shared/types';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { ChipIcon } from '../ChipIcon';
import { ChipAmount, HeCards } from '../holdem/HoldemCards';
import { potLines, potTotal } from '../holdem/holdem-view';
import { usePotLabel } from '../holdem/HoldemFrame';
import styles from '../holdem/HoldemFrame.module.css';
import { replayStud, studCategory, studChipsAdded } from './stud-view';

/**
 * Body of a Five-Card Stud presentation frame, drawn from the table as of the frame's own log entry
 * so up cards and the pot never run ahead; the shared frame supplies the heading and timing.
 */
export function StudFrame({ frame, name }: { frame: PresentationFrame; name: (seat: GameSeat) => string }): ReactNode {
  const { t } = useI18nStore();
  const log = useGameStore((state) => state.stud?.log);
  const seats = useGameStore((state) => state.stud?.seats);
  const potLabel = usePotLabel();
  const index = frameLogIndex(frame);
  if (!log || !seats || index === null || !log[index]) return null;
  const view = replayStud(log, seats, index + 1);
  const entry = log[index];
  const pot = <span className={styles.pot}>{t('holdem.pot')} <ChipAmount amount={potTotal(view)} /></span>;
  const showing = GAME_SEAT_ORDER.filter((seat) => view.dealt.includes(seat) && !view.folded.includes(seat));

  if (entry.type === 'hand') {
    return <div className={styles.body}>
      <span className={styles.caption}>
        {t('holdem.handOf', { n: String(entry.hand), total: String(STUD_HANDS) })} ·
        {' '}{t('stud.stakes', { ante: String(entry.ante), bet: String(entry.minBet) })}
      </span>
      <span className={styles.caption}>{t('stud.antesIn', { n: String(entry.ante) })}</span>
      {pot}
    </div>;
  }

  if (entry.type === 'street') {
    return <div className={styles.body}>
      <span className={styles.caption}>{t(`stud.street.${entry.street}`)}</span>
      <ul className={styles.hands}>{showing.map((seat) => <li key={seat} className={styles.hand}>
        <span className={styles.name}>{name(seat)}</span>
        <HeCards cards={view.up[seat]} backs={1} size="xs" overlap freshFrom={view.up[seat].length - 1} />
      </li>)}</ul>
      {pot}
    </div>;
  }

  if (entry.type === 'action') {
    const amount = entry.action === 'call' ? studChipsAdded(log, index) : entry.to;
    return <div className={styles.body}>
      {entry.action !== 'fold' && entry.action !== 'check' && <strong className={styles.amount}>
        {entry.action === 'raise' && '→ '}<ChipIcon />{amount}
      </strong>}
      {pot}
    </div>;
  }

  if (entry.type === 'showdown') {
    return <div className={styles.body}>
      <ul className={styles.hands}>{showing.map((seat) => {
        const category = studCategory(entry.cards[seat], view.up[seat]);
        return <li key={seat} className={styles.hand}>
          <span className={styles.name}>{name(seat)}</span>
          <HeCards cards={[...entry.cards[seat], ...view.up[seat]]} size="xs" overlap freshFrom={0} />
          {category && <span className={styles.category}>{t(`holdem.category.${category}`)}</span>}
        </li>;
      })}</ul>
    </div>;
  }

  const award = view.award;
  if (!award) return null;
  const pots = potLines(view);
  return <div className={styles.body}>
    <ul className={styles.list}>{pots.map((line, potIndex) => <li key={potIndex}>
      <span className={styles.tag}>{potLabel(line, potIndex, pots.length)}</span>
      {' '}<ChipAmount amount={line.amount} /> → <strong>{line.winners.map(name).join(' · ')}</strong>
    </li>)}</ul>
    <ul className={styles.list}>{GAME_SEAT_ORDER.filter((seat) => award.payouts[seat] > 0).map((seat) => <li key={seat}>
      <span className={styles.name}>{name(seat)}</span> <strong className={styles.good}>+{award.payouts[seat]}</strong>
    </li>)}</ul>
    {award.eliminated.length > 0 && <p className={styles.bad}>
      {award.eliminated.map((seat) => `${name(seat)} ${t('holdem.log.eliminated')}`).join(' · ')}
    </p>}
  </div>;
}
