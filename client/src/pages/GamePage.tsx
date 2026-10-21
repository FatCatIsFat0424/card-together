// ─── GamePage: pick the table by game type ───

import { lazy, Suspense, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { GameType } from '@shared/types';
import { useNavigate, useParams } from 'react-router-dom';
import { useGameStore } from '../stores/game-store';
import { useRoomStore } from '../stores/room-store';
import { useI18nStore } from '../stores/i18n-store';
import styles from './AccountPages.module.css';

// Keep each game's rules and controls behind its own import, shared by every visit.
const TABLES = {
  bridge: lazy(() => import('../games/bridge/BridgeTable').then((game) => ({ default: game.BridgeTable }))),
  bigtwo: lazy(() => import('../games/bigtwo/BigTwoTable').then((game) => ({ default: game.BigTwoTable }))),
  redpoints: lazy(() => import('../games/redpoints/RedPointsTable').then((game) => ({ default: game.RedPointsTable }))),
  ninetynine: lazy(() => import('../games/ninetynine/NinetyNineTable').then((game) => ({ default: game.NinetyNineTable }))),
  sevens: lazy(() => import('../games/sevens/SevensTable').then((game) => ({ default: game.SevensTable }))),
  chinesepoker: lazy(() => import('../games/chinesepoker/ChinesePokerTable').then((game) => ({ default: game.ChinesePokerTable }))),
  liarsdeck: lazy(() => import('../games/liarsdeck/LiarsDeckTable').then((game) => ({ default: game.LiarsDeckTable }))),
  blackjack: lazy(() => import('../games/blackjack/BlackjackTable').then((game) => ({ default: game.BlackjackTable }))),
  holdem: lazy(() => import('../games/holdem/HoldemTable').then((game) => ({ default: game.HoldemTable }))),
  napoleon: lazy(() => import('../games/napoleon/NapoleonTable').then((game) => ({ default: game.NapoleonTable }))),
} satisfies Record<GameType, unknown>;

export function GamePage(): ReactNode {
  const { t } = useI18nStore();
  const { roomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const roomInfo = useRoomStore((state) => state.roomInfo);
  const phase = useGameStore((state) => state.phase);
  const gameType = useGameStore((state) => state.gameType);

  useEffect(() => {
    if (!roomInfo) navigate('/', { replace: true });
    else if (!phase) navigate(`/room/${roomInfo.code}`, { replace: true });
    else if (roomCode !== roomInfo.code) navigate(`/game/${roomInfo.code}`, { replace: true });
  }, [roomInfo, phase, roomCode, navigate]);

  if (!phase) return null;
  const Table = gameType ? TABLES[gameType] : null;
  return Table ? <Suspense fallback={<main className={styles.status}><p role="status">{t('common.loading')}</p></main>}>
    <Table />
  </Suspense> : null;
}
