import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { GAME_TYPES } from '@shared/constants';
import type { GameType, Seat, TimeControl } from '@shared/types';
import { DEFAULT_TIME_CONTROL } from '@shared/time-control';
import { socket } from '../socket';
import { mediaUrl } from '../media';
import { useAccountStore } from '../stores/account-store';
import { usePlayerStore } from '../stores/player-store';
import { useRoomStore } from '../stores/room-store';
import { useGameStore } from '../stores/game-store';
import { useI18nStore } from '../stores/i18n-store';
import { PlayerLink } from '../components/PlayerLink';
import { ChatPanel } from '../components/ChatPanel';
import { InviteFriends } from '../components/InviteFriends';
import { TimeControlSettings } from '../components/TimeControlSettings';
import styles from './RoomPage.module.css';

const SEAT_STYLE_MAP: Record<Seat, string> = {
  N: styles.seatNorth, E: styles.seatEast, S: styles.seatSouth, W: styles.seatWest,
};

export function RoomPage(): ReactNode {
  const { roomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const tableBackground = useAccountStore((state) => state.account?.tableBackground);
  const playerId = usePlayerStore((state) => state.playerId);
  const roomInfo = useRoomStore((state) => state.roomInfo);
  const mySeat = useRoomStore((state) => state.mySeat);
  const phase = useGameStore((state) => state.phase);
  const { t } = useI18nStore();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const attemptedRoom = useRef<string | null>(null);
  const hadRoom = useRef(false);
  const leaving = useRef(false);
  const isReady = mySeat ? roomInfo?.seats[mySeat].isReady ?? false : false;
  const isHost = Boolean(playerId) && roomInfo?.hostId === playerId;
  const hasEmptySeat = roomInfo ? Object.values(roomInfo.seats).some(({ player }) => !player) : false;

  useEffect(() => {
    if (leaving.current) return;
    if (!roomCode) { navigate('/', { replace: true }); return; }
    if (roomInfo) {
      hadRoom.current = true;
      attemptedRoom.current = roomInfo.code;
      if (phase) navigate(`/game/${roomInfo.code}`, { replace: true });
      else if (roomInfo.code !== roomCode) navigate(`/room/${roomInfo.code}`, { replace: true });
    } else if (attemptedRoom.current !== roomCode) {
      attemptedRoom.current = roomCode;
      socket.timeout(10000).emit('room:join', { roomCode }, (timeout, result) => {
        if (timeout) setError(t('auth.connectionError'));
        else if (!result.success) setError(result.error ?? t('common.error'));
      });
    } else if (hadRoom.current) {
      navigate('/', { replace: true });
    }
  }, [roomCode, roomInfo, phase, navigate, t]);

  const handleResult = (timeout: Error | null, result?: { success: boolean; error?: string }): void => {
    setBusy(false);
    if (timeout) setError(t('auth.connectionError'));
    else if (!result?.success) setError(result?.error ?? t('common.error'));
  };
  const changeSeat = (seat: Seat): void => {
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('room:changeSeat', { seat }, handleResult);
  };
  const ready = (): void => {
    if (!mySeat) return;
    setBusy(true);
    setError('');
    socket.timeout(10000).emit(isReady ? 'room:unready' : 'room:ready', handleResult);
  };
  const setGameType = (gameType: GameType): void => {
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('room:setGameType', { gameType }, handleResult);
  };
  const setTimeControl = (settings: TimeControl): void => {
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('room:setTimeControl', settings, handleResult);
  };
  const addBot = (seat: Seat): void => {
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('room:addBot', { seat }, handleResult);
  };
  const removeBot = (seat: Seat): void => {
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('room:removeBot', { seat }, handleResult);
  };
  const fillBots = (): void => {
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('room:fillBots', handleResult);
  };
  const leave = (): void => {
    leaving.current = true;
    setBusy(true);
    socket.timeout(10000).emit('room:leave', (timeout, result) => {
      handleResult(timeout, result);
      if (!timeout && result.success) navigate('/');
      else leaving.current = false;
    });
  };

  if (!roomInfo || !roomCode) return <main className={styles.roomContainer}>
    <p role={error ? 'alert' : 'status'}>{error || t('common.loading')}</p>
    {error && <Link to="/">{t('nav.lobby')}</Link>}
  </main>;

  return (
    <main className={`${styles.roomContainer} ${styles.roomLayout} ${chatOpen ? styles.chatOpen : ''}`}>
      <div className={styles.roomHeader}>
        <div><div className={styles.roomCodeLabel}>{t('room.code')}</div>
          <div className={styles.roomCode}>{roomInfo.code}</div></div>
        <div className={styles.gameTypeRow}>
          <span className={styles.gameTypeLabel}>{t('gameType.label')}</span>
          <div className={styles.segmented} role="radiogroup" aria-label={t('gameType.label')}
            title={isHost ? undefined : t('room.hostOnly')}>
            {GAME_TYPES.map((gameType) => (
              <button key={gameType} type="button" role="radio" aria-checked={roomInfo.gameType === gameType}
                className={roomInfo.gameType === gameType ? styles.segmentActive : styles.segment}
                disabled={!isHost || busy || roomInfo.gameType === gameType}
                onClick={() => setGameType(gameType)}>
                {t(`gameType.${gameType}`)}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={`btn btn-outline ${styles.chatToggle}`}
            aria-pressed={chatOpen} aria-controls="room-chat" onClick={() => setChatOpen((open) => !open)}>
            {t('chat.title')}
          </button>
          <InviteFriends />
          <button className="btn btn-outline" onClick={leave} disabled={busy}>{t('room.leave')}</button>
        </div>
        <TimeControlSettings
          key={`${roomInfo.code}:${roomInfo.hostId}:${roomInfo.timeControl?.baseSeconds}:${roomInfo.timeControl?.bankSeconds}`}
          value={roomInfo.timeControl ?? DEFAULT_TIME_CONTROL}
          disabled={!isHost || busy || roomInfo.status !== 'waiting'} onSave={setTimeControl} />
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={`${styles.tableArea} ${tableBackground ? styles.customTable : ''}`}
        style={tableBackground
          ? { '--table-image': `url("${mediaUrl(tableBackground)}")` } as CSSProperties : undefined}>
      <div className={styles.seatLayout}>
        {(['N', 'E', 'S', 'W'] as Seat[]).map((seat) => {
          const seatInfo = roomInfo.seats[seat];
          const player = seatInfo.player;
          const className = [styles.seatSlot, SEAT_STYLE_MAP[seat],
            player ? styles.seatSlotOccupied : '',
            player?.id === playerId ? styles.seatSlotMine : ''].filter(Boolean).join(' ');
          if (player) return (
            <div key={seat} className={className}>
              <div className={styles.seatLabel}>{t(`seat.${seat}`)}</div>
              <PlayerLink player={player} size="medium" />
              <div className={styles.seatStatus}>
                {player.id === roomInfo.hostId &&
                  <span className={styles.hostBadge} title={t('room.host')}>👑 {t('room.host')}</span>}
                {player.id === playerId && <span>{t('common.me')}</span>}
                <span className={seatInfo.isReady ? styles.seatReadyBadge : styles.seatNotReadyBadge}>
                  {t(player.isBot ? 'room.botReady' : seatInfo.isReady ? 'room.ready.status' : 'room.seatTaken')}</span>
              </div>
              {isHost && player.isBot && <button type="button" className={`btn btn-outline ${styles.botAction}`}
                disabled={busy} onClick={() => removeBot(seat)}>{t('room.removeBot')}</button>}
            </div>
          );
          return (
            <div key={seat} className={`${className} ${styles.emptySlot}`}>
              <button type="button" disabled={busy} className={styles.seatChoice}
                onClick={() => changeSeat(seat)}>
                <div className={styles.seatLabel}>{t(`seat.${seat}`)}</div>
                <div className={styles.seatEmpty}>{t('room.seatEmpty')}</div>
              </button>
              {isHost && <button type="button" className={`btn btn-outline ${styles.botAction}`}
                disabled={busy} onClick={() => addBot(seat)}>{t('room.addBot')}</button>}
            </div>
          );
        })}
        <div className={styles.tableCenter}>
          <div className={styles.tableCenterText}>
          {t('room.waiting')}</div></div>
      </div>
      <div className={styles.roomFooter}>
        {isHost && <button type="button" className="btn btn-outline" onClick={fillBots}
          disabled={busy || !hasEmptySeat}>{t('room.fillBots')}</button>}
        <button className={`btn ${isReady ? 'btn-danger' : 'btn-success'} ${styles.readyBtn}`}
          onClick={ready} disabled={busy || !mySeat}>{t(isReady ? 'room.unready' : 'room.ready')}</button>
      </div>
      </div>
      <div className={styles.chat} id="room-chat"><ChatPanel /></div>
    </main>
  );
}
