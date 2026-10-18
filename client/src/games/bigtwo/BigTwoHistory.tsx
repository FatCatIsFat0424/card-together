// ─── BigTwoHistory: Big Two rounds, newest first, as aligned name / cards rows ───

import { useState } from 'react';
import type { ReactNode } from 'react';
import { RANK_DISPLAY, SUIT_SYMBOLS } from '@shared/constants';
import type { Card, GameSeat } from '@shared/types';
import { AppIcon } from '../../components/AppIcon';
import { useI18nStore } from '../../stores/i18n-store';
import type { HistoryRound } from '../round-history';
import { useSeatName } from '../seat-names';
import { comboLabelKey, summarizeBigTwoRound } from './bigtwo-view';
import styles from './BigTwoHistory.module.css';

function CardChip({ card }: { card: Card }): ReactNode {
  const red = card.suit === 'hearts' || card.suit === 'diamonds';
  return <span className={`${styles.card} ${red ? styles.red : ''}`}>
    {SUIT_SYMBOLS[card.suit]}{RANK_DISPLAY[card.rank]}</span>;
}

function Round({ round, latest, mySeat }: {
  round: HistoryRound; latest: boolean; mySeat: GameSeat | null;
}): ReactNode {
  const { t } = useI18nStore();
  const name = useSeatName();
  // The latest round stays open as play moves on until the viewer toggles it themselves.
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? latest;
  const { leadCombo, winnerSeat, winningIndex } = summarizeBigTwoRound(round);
  return <details className={styles.round} open={open} onToggle={(event) => {
    if (event.currentTarget.open !== open) setToggled(event.currentTarget.open);
  }}>
    <summary className={styles.summary}>
      <strong className={styles.number}>{t('history.roundNumber', { n: String(round.number) })}</strong>
      {leadCombo && <span className={styles.combo}>{t(comboLabelKey(leadCombo))}</span>}
      {winnerSeat ? <span className={styles.winner} title={t('bigtwo.historyLeader', { name: name(winnerSeat) })}>
        <AppIcon name="trophy" /><span className={styles.ellipsis}>{name(winnerSeat)}</span>
      </span> : !round.complete && <span className={styles.ongoing}>{t('history.ongoing')}</span>}
    </summary>
    {open && <ol className={styles.actions}>{round.actions.map((action, index) => {
      if (action.kind === 'round_end' || !action.seat) return null;
      const won = index === winningIndex;
      const bomb = action.comboType && action.comboType !== leadCombo ? action.comboType : null;
      return <li key={index} className={[styles.action, action.kind === 'pass' ? styles.pass : '',
        won ? styles.won : '', action.seat === mySeat ? styles.mine : ''].join(' ')}>
        <span className={`${styles.name} ${styles.ellipsis}`} title={name(action.seat)}>{name(action.seat)}</span>
        {action.kind === 'play'
          ? <span className={styles.cards}>{action.cards.map((card) =>
            <CardChip key={`${card.suit}-${card.rank}`} card={card} />)}</span>
          : <span className={styles.note}>{t(`history.${action.kind}`)}</span>}
        <span className={styles.marks}>
          {bomb && <span className={styles.bomb}>{t(comboLabelKey(bomb))}</span>}
          {won && <span className={styles.trophy} title={t('bigtwo.historyLeader', { name: name(action.seat) })}>
            <AppIcon name="trophy" /></span>}
        </span>
      </li>;
    })}</ol>}
  </details>;
}

export function BigTwoRounds({ rounds, mySeat }: {
  rounds: readonly HistoryRound[]; mySeat: GameSeat | null;
}): ReactNode {
  const latest = rounds.at(-1)?.number;
  return <ol className={styles.rounds}>
    {[...rounds].reverse().map((round) => <li key={round.number}>
      <Round round={round} latest={round.number === latest} mySeat={mySeat} />
    </li>)}
  </ol>;
}
