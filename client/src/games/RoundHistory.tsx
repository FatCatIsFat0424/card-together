import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { frameLogIndex } from '@shared/game-presentation';
import type { PlayerVisibleGameState } from '@shared/types';
import { useI18nStore } from '../stores/i18n-store';
import { isSpectator } from './observer-view';
import { deriveRoundHistory, gameAtLogEnd } from './round-history';
import styles from './RoundHistory.module.css';
import { clientGame } from './registry';
import { gameUi } from './ui-registry';
import { useGamePresentation } from './use-game-presentation';

export function RoundHistory({ game }: { game: PlayerVisibleGameState }): ReactNode {
  const [open, setOpen] = useState(false);
  const { t } = useI18nStore();
  const { frame } = useGamePresentation();
  // Some games list history only up to the frame on screen so results are not listed before their frames.
  const follows = clientGame(game.gameType).roundHistory?.followsPresentation ?? false;
  const index = follows && frame ? frameLogIndex(frame) : null;
  const end = index === null ? game.log.length : index + 1;
  const rounds = useMemo(() => deriveRoundHistory(follows ? gameAtLogEnd(game, end) : game),
    [game, end, follows]);
  // Bridge and Napoleon list tricks in their own panels; Chinese Poker shows its showdown in the result.
  const Rounds = gameUi(game.gameType).roundsView;
  if (!Rounds) return null;
  return <details className={styles.history} onToggle={(event) => {
    if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
  }}>
    <summary>{t('history.title')} ({rounds.length})</summary>
    {open && <div className={styles.scroll}>
      {rounds.length === 0 ? <p>{t('history.empty')}</p>
        : <Rounds rounds={rounds} mySeat={isSpectator(game) ? null : game.mySeat} />}
    </div>}
  </details>;
}
