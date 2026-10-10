// ─── SpectatorLeave: spectators leave the room from the table; their departure never affects the match ───

import { useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '../socket';
import { useI18nStore } from '../stores/i18n-store';
import { useRoomStore } from '../stores/room-store';
import { useConnectionReady } from './use-connection-ready';
import styles from './SpectatorLeave.module.css';

export function SpectatorLeaveButton(): ReactNode {
  const { t } = useI18nStore();
  const navigate = useNavigate();
  const connectionReady = useConnectionReady();
  const inRoom = useRoomStore((state) => state.roomInfo !== null);
  const mySeat = useRoomStore((state) => state.mySeat);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!inRoom || mySeat) return null;

  const leave = (): void => {
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('room:leave', (timeout, result) => {
      setBusy(false);
      if (timeout) setError(t('auth.connectionError'));
      else if (!result.success) setError(result.error ?? t('common.error'));
      else {
        // Clear the room before navigating so the lobby does not redirect back to the table.
        useRoomStore.getState().leaveRoom();
        navigate('/');
      }
    });
  };

  return <div className={styles.rail}>
    <button type="button" className={`btn btn-outline ${styles.button}`} disabled={busy || !connectionReady}
      onClick={leave}>{t('room.leave')}</button>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </div>;
}
