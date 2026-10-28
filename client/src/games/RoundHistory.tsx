import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { frameLogIndex } from '@shared/game-presentation';
import type { PlayerVisibleGameState } from '@shared/types';
import { useI18nStore } from '../stores/i18n-store';
import { isSpectator } from './observer-view';
import type { ResultHistory } from './ResultDialog';
import { deriveRoundHistory, gameAtLogEnd } from './round-history';
import type { HistoryRound } from './round-history';
import styles from './RoundHistory.module.css';
import { clientGame } from './registry';
import { gameUi } from './ui-registry';
import { useGamePresentation } from './use-game-presentation';

/** Rounds listed so far; some games list only up to the frame on screen so results never come before their frames. */
function useRounds(game: PlayerVisibleGameState | null): readonly HistoryRound[] {
  const { frame } = useGamePresentation();
  const follows = game ? clientGame(game.gameType).roundHistory?.followsPresentation ?? false : false;
  const index = follows && frame ? frameLogIndex(frame) : null;
  const end = game ? index === null ? game.log.length : index + 1 : 0;
  return useMemo(() => game ? deriveRoundHistory(follows ? gameAtLogEnd(game, end) : game) : [], [game, end, follows]);
}

function RoundsBody({ game, rounds }: { game: PlayerVisibleGameState; rounds: readonly HistoryRound[] }): ReactNode {
  const { t } = useI18nStore();
  const Rounds = gameUi(game.gameType).roundsView;
  if (!Rounds) return null;
  return rounds.length === 0 ? <p>{t('history.empty')}</p>
    : <Rounds rounds={rounds} mySeat={isSpectator(game) ? null : game.mySeat} />;
}

export function RoundHistory({ game }: { game: PlayerVisibleGameState }): ReactNode {
  const [open, setOpen] = useState(false);
  const { t } = useI18nStore();
  const rounds = useRounds(game);
  // Bridge and Napoleon list tricks in their own panels; Chinese Poker shows its showdown in the result.
  if (!gameUi(game.gameType).roundsView) return null;
  return <details className={styles.history} onToggle={(event) => {
    if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
  }}>
    <summary>{t('history.title')} ({rounds.length})</summary>
    {open && <div className={styles.scroll}><RoundsBody game={game} rounds={rounds} /></div>}
  </details>;
}

/** The round history as the result dialog's expandable section, or null for games without one. */
export function useResultRoundHistory(game: PlayerVisibleGameState | null): ResultHistory | null {
  const { t } = useI18nStore();
  const rounds = useRounds(game);
  if (!game || !gameUi(game.gameType).roundsView) return null;
  return { label: `${t('history.title')} (${rounds.length})`, content: <RoundsBody game={game} rounds={rounds} /> };
}
