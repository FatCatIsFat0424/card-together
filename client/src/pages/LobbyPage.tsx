import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { GAME_TYPES } from '@shared/constants';
import type { GameType } from '@shared/types';
import { socket } from '../socket';
import { useAccountStore } from '../stores/account-store';
import { useRoomStore } from '../stores/room-store';
import { useGameStore } from '../stores/game-store';
import { useI18nStore } from '../stores/i18n-store';
import { Avatar } from '../components/Avatar';
import styles from './LobbyPage.module.css';

const GAME_ICONS: Record<GameType, string> = { bridge: '♠', bigtwo: '🃏', redpoints: '🔴', ninetynine: '💯' };

export function LobbyPage(): ReactNode {
  const navigate = useNavigate();
  const account = useAccountStore((state) => state.account);
  const currentRoomCode = useRoomStore((state) => state.currentRoomCode);
  const phase = useGameStore((state) => state.phase);
  const { t } = useI18nStore();
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const createRoom = (gameType: GameType): void => {
    setLoading(true);
    setError('');
    socket.timeout(10000).emit('room:create', { gameType }, (timeout, result) => {
      setLoading(false);
      if (timeout) setError(t('auth.connectionError'));
      else if (result.success && result.roomCode) navigate(`/room/${result.roomCode}`);
      else setError(result.error ?? t('common.error'));
    });
  };

  const joinRoom = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const code = roomCodeInput.trim().toUpperCase();
    if (!code) return;
    setLoading(true);
    setError('');
    socket.timeout(10000).emit('room:join', { roomCode: code }, (timeout, result) => {
      setLoading(false);
      if (timeout) setError(t('auth.connectionError'));
      else if (result.success && result.room) navigate(`/room/${code}`);
      else setError(result.error ?? t('common.error'));
    });
  };

  if (!account) return null;
  // A seated player has nothing to do in the lobby, so the lobby link goes straight back to the table.
  if (currentRoomCode) return <Navigate replace to={`/${phase ? 'game' : 'room'}/${currentRoomCode}`} />;
  return (
    <main className={styles.lobbyContainer}>
      <div className={styles.lobbyCard}>
        <div className={styles.lobbyTitle}>
          <Avatar avatar={account.avatar} image={account.avatarImage} color={account.color} size="large" />
          <h1>{t('lobby.welcome', { nickname: account.nickname })}</h1>
          <p>@{account.username} · {t('lobby.subtitle')}</p>
          <Link to="/account">{t('nav.account')}</Link>
        </div>
        <div className={styles.roomActions}>
          <div className={styles.divider}>{t('lobby.createRoom')}</div>
          <div className={styles.gameChoices} role="group" aria-label={t('gameType.choose')}>
            {GAME_TYPES.map((gameType) => (
              <button key={gameType} type="button" className={styles.gameChoice}
                onClick={() => createRoom(gameType)} disabled={loading}>
                <span className={styles.gameIcon} aria-hidden="true">{GAME_ICONS[gameType]}</span>
                <span className={styles.gameName}>{t(`gameType.${gameType}`)}</span>
                <span className={styles.gameDesc}>{t(`gameType.${gameType}Desc`)}</span>
              </button>
            ))}
          </div>
          <div className={styles.divider}>{t('lobby.joinRoom')}</div>
          <form className={styles.joinRow} onSubmit={joinRoom}>
            <input id="room-code-input" type="text" aria-label={t('room.code')}
              placeholder={t('lobby.roomCodePlaceholder')} value={roomCodeInput}
              onChange={(event) => setRoomCodeInput(event.target.value.toUpperCase())}
              maxLength={6} required autoComplete="off" />
            <button type="submit" className="btn btn-outline" disabled={loading}>
              {t('lobby.join')}</button>
          </form>
        </div>
        {error && <p className={styles.errorMsg} role="alert">{error}</p>}
      </div>
    </main>
  );
}
