import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { RANK_DISPLAY, SUIT_SYMBOLS } from '@shared/constants';
import { frameLogIndex } from '@shared/game-presentation';
import type { Card, PlayerVisibleGameState } from '@shared/types';
import { useI18nStore } from '../stores/i18n-store';
import { comboLabelKey } from './bigtwo/bigtwo-view';
import { signedChips } from './blackjack/blackjack-view';
import { deriveRoundHistory } from './round-history';
import type { HistoryRound } from './round-history';
import styles from './RoundHistory.module.css';
import { useSeatName } from './seat-names';
import { useGamePresentation } from './use-game-presentation';

function cardLabel(card: Card): string {
  return `${SUIT_SYMBOLS[card.suit]}${RANK_DISPLAY[card.rank]}`;
}

function Round({ round }: { round: HistoryRound }): ReactNode {
  const [open, setOpen] = useState(false);
  const { t } = useI18nStore();
  const name = useSeatName();
  return <details className={styles.round} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{t('history.round', { n: String(round.number),
      status: t(round.complete ? 'history.complete' : 'history.ongoing') })}
    {round.tableFace && <> · {t('liarsdeck.tableCard')} {t(`liarsdeck.face.${round.tableFace}`)}</>}</summary>
    {open && <ol className={styles.actions}>{round.actions.map((action, index) => <li key={index}>
      <strong>{action.seat ? name(action.seat) : t('blackjack.dealer')}</strong> {t(`history.${action.kind}`)}
      {action.handIndex !== undefined && <span> ({t('blackjack.handIndex', { n: String(action.handIndex + 1) })})</span>}
      {action.cards.length > 0 && <span className={styles.cards}> {action.cards.map(cardLabel).join(' ')}</span>}
      {action.comboType && <span> · {t(comboLabelKey(action.comboType))}</span>}
      {action.captured !== undefined && <span> · {action.captured
        ? t('history.captured', { card: cardLabel(action.captured) }) : t('history.stay')}</span>}
      {action.points !== undefined && <span> · {t('history.points', { n: String(action.points) })}</span>}
      {action.total !== undefined && <span> · {action.previousTotal} → {action.total}</span>}
      {action.choice && <span> ({action.choice === 'plus' ? '+' : '−'}{action.cards[0]?.rank === 12 ? 20 : 10})</span>}
      {action.count !== undefined && <span> · {t('liarsdeck.logPlay', { n: String(action.count) })}</span>}
      {action.faces && <span> · {t('liarsdeck.logCall', { name: action.target ? name(action.target) : action.seat ? name(action.seat) : '' })}:
        {' '}{action.faces.map((face) => t(`liarsdeck.face.${face}`)).join(' ')}
        {' '}({t(action.lied ? 'liarsdeck.logLied' : 'liarsdeck.logHonest')})</span>}
      {action.shot !== undefined && <span> · {t(action.survived ? 'liarsdeck.logSurvived' : 'liarsdeck.logKilled',
        { n: String(action.shot) })}</span>}
      {action.target && !action.faces && <span> · {t('history.target', { name: name(action.target) })}</span>}
      {action.handTotal !== undefined && <span> · {t('blackjack.totalShort', { n: String(action.handTotal) })}</span>}
      {action.bet !== undefined && <span> · {t('blackjack.bet', { n: String(action.bet) })}
        {action.auto && ` (${t('blackjack.auto')})`}</span>}
      {action.outcomes && <span> · {action.outcomes.map((outcome) => t(`blackjack.outcome.${outcome}`)).join(' / ')}</span>}
      {action.net !== undefined && <strong> {signedChips(action.net)}</strong>}
      {action.pending && <span> · {t('history.pending')}</span>}
    </li>)}</ol>}
  </details>;
}

export function RoundHistory({ game }: { game: PlayerVisibleGameState }): ReactNode {
  const [open, setOpen] = useState(false);
  const { t } = useI18nStore();
  const { frame } = useGamePresentation();
  // Blackjack history follows the presentation so a settlement is not listed before its frame.
  const index = game.gameType === 'blackjack' && frame ? frameLogIndex(frame) : null;
  const end = index === null ? game.log.length : index + 1;
  const rounds = useMemo(() => deriveRoundHistory(game.gameType === 'blackjack'
    ? { ...game, log: game.log.slice(0, end) } : game), [game, end]);
  if (game.gameType === 'bridge' || game.gameType === 'chinesepoker') return null;
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
