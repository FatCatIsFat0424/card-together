import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { RANK_DISPLAY, SUIT_SYMBOLS } from '@shared/constants';
import type { Card, PlayerVisibleGameState } from '@shared/types';
import { useI18nStore } from '../stores/i18n-store';
import { comboLabelKey } from './bigtwo/bigtwo-view';
import { deriveRoundHistory } from './round-history';
import type { HistoryRound } from './round-history';
import styles from './RoundHistory.module.css';
import { useSeatName } from './seat-names';

function cardLabel(card: Card): string {
  return `${SUIT_SYMBOLS[card.suit]}${RANK_DISPLAY[card.rank]}`;
}

function Round({ round }: { round: HistoryRound }): ReactNode {
  const [open, setOpen] = useState(false);
  const { t } = useI18nStore();
  const name = useSeatName();
  return <details className={styles.round} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{t('history.round', { n: String(round.number),
      status: t(round.complete ? 'history.complete' : 'history.ongoing') })}</summary>
    {open && <ol className={styles.actions}>{round.actions.map((action, index) => <li key={index}>
      <strong>{name(action.seat)}</strong> {t(`history.${action.kind}`)}
      {action.cards.length > 0 && <span className={styles.cards}> {action.cards.map(cardLabel).join(' ')}</span>}
      {action.comboType && <span> · {t(comboLabelKey(action.comboType))}</span>}
      {action.captured !== undefined && <span> · {action.captured
        ? t('history.captured', { card: cardLabel(action.captured) }) : t('history.stay')}</span>}
      {action.points !== undefined && <span> · {t('history.points', { n: String(action.points) })}</span>}
      {action.total !== undefined && <span> · {action.previousTotal} → {action.total}</span>}
      {action.choice && <span> ({action.choice === 'plus' ? '+' : '−'}{action.cards[0]?.rank === 12 ? 20 : 10})</span>}
      {action.target && <span> · {t('history.target', { name: name(action.target) })}</span>}
      {action.pending && <span> · {t('history.pending')}</span>}
    </li>)}</ol>}
  </details>;
}

export function RoundHistory({ game }: { game: PlayerVisibleGameState }): ReactNode {
  const [open, setOpen] = useState(false);
  const { t } = useI18nStore();
  const rounds = useMemo(() => deriveRoundHistory(game), [game]);
  if (game.gameType === 'bridge') return null;
  return <details className={styles.history} onToggle={(event) => {
    if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
  }}>
    <summary>{t('history.title')} ({rounds.length})</summary>
    {open && <div className={styles.scroll}>
      {rounds.length === 0 ? <p>{t('history.empty')}</p>
        : rounds.map((round) => <Round key={round.number} round={round} />)}
    </div>}
  </details>;
}
