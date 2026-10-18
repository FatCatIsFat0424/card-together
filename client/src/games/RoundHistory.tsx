import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { frameLogIndex } from '@shared/game-presentation';
import type { GameSeat, PlayerVisibleGameState } from '@shared/types';
import { useI18nStore } from '../stores/i18n-store';
import { BigTwoRounds } from './bigtwo/BigTwoHistory';
import { BlackjackRounds } from './blackjack/BlackjackHistory';
import { HoldemRounds } from './holdem/HoldemHistory';
import { LiarsDeckRounds } from './liarsdeck/LiarsDeckHistory';
import { NinetyNineRounds } from './ninetynine/NinetyNineHistory';
import { isSpectator } from './observer-view';
import { RedPointsRounds } from './redpoints/RedPointsHistory';
import { deriveRoundHistory } from './round-history';
import type { HistoryRound } from './round-history';
import styles from './RoundHistory.module.css';
import { SevensRounds } from './sevens/SevensHistory';
import { useGamePresentation } from './use-game-presentation';

type RoundsView = (props: { rounds: readonly HistoryRound[]; mySeat: GameSeat | null }) => ReactNode;

const ROUND_VIEWS: Partial<Record<PlayerVisibleGameState['gameType'], RoundsView>> = {
  bigtwo: BigTwoRounds,
  redpoints: RedPointsRounds,
  ninetynine: NinetyNineRounds,
  sevens: SevensRounds,
  liarsdeck: LiarsDeckRounds,
  blackjack: BlackjackRounds,
  holdem: HoldemRounds,
};

export function RoundHistory({ game }: { game: PlayerVisibleGameState }): ReactNode {
  const [open, setOpen] = useState(false);
  const { t } = useI18nStore();
  const { frame } = useGamePresentation();
  // Blackjack and Hold'em history follows the presentation so results are not listed before their frames.
  const follows = game.gameType === 'blackjack' || game.gameType === 'holdem';
  const index = follows && frame ? frameLogIndex(frame) : null;
  const end = index === null ? game.log.length : index + 1;
  const rounds = useMemo(() => deriveRoundHistory(game.gameType === 'blackjack'
    ? { ...game, log: game.log.slice(0, end) }
    : game.gameType === 'holdem' ? { ...game, log: game.log.slice(0, end) } : game), [game, end]);
  // Bridge and Napoleon list tricks in their own panels; Chinese Poker shows its showdown in the result.
  const Rounds = ROUND_VIEWS[game.gameType];
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
