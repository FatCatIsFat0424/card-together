// ─── GamePage: pick the table by game type ───

import { Suspense, useEffect } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useGameStore } from '../stores/game-store';
import { useRoomStore } from '../stores/room-store';
import { useI18nStore } from '../stores/i18n-store';
import { gameUi } from '../games/ui-registry';
import styles from './AccountPages.module.css';

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
  const Table = gameType ? gameUi(gameType).table : null;
  return Table ? <Suspense fallback={<main className={styles.status}><p role="status">{t('common.loading')}</p></main>}>
    <Table />
  </Suspense> : null;
}
