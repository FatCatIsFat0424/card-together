import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { GAME_TYPES } from '@shared/constants';
import type { GameType, PlayerInfo, Seat, TimeControl } from '@shared/types';
import { DEFAULT_TIME_CONTROL } from '@shared/time-control';
import { socket } from '../socket';
import { tableBackgroundStyle } from '../account-appearance';
import { useAccountStore } from '../stores/account-store';
import { usePlayerStore } from '../stores/player-store';
import { useRoomStore } from '../stores/room-store';
import { useChatStore } from '../stores/chat-store';
import { useGameStore } from '../stores/game-store';
import { useI18nStore } from '../stores/i18n-store';
import { PlayerLink } from '../components/PlayerLink';
import { ChatPanel } from '../components/ChatPanel';
import { InviteFriends } from '../components/InviteFriends';
import { TimeControlSettings } from '../components/TimeControlSettings';
import { useConnectionReady } from '../games/use-connection-ready';
import styles from './RoomPage.module.css';
import { roomProgress, unreadCount } from './room-progress';

const COPIED_MS = 2000;

const SEAT_STYLE_MAP: Record<Seat, string> = {
  N: styles.seatNorth, E: styles.seatEast, S: styles.seatSouth, W: styles.seatWest,
};

/** Two overlapping sheets, drawn so the icon matches the surrounding text color. */
function CopyIcon(): ReactNode {
  return <svg className={styles.copyIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 3.5v-.5a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5" />
  </svg>;
}

export function RoomPage(): ReactNode {
  const { roomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const account = useAccountStore((state) => state.account);
  const tableStyle = tableBackgroundStyle(account);
  const playerId = usePlayerStore((state) => state.playerId);
  const roomInfo = useRoomStore((state) => state.roomInfo);
  const mySeat = useRoomStore((state) => state.mySeat);
  const phase = useGameStore((state) => state.phase);
  const { t } = useI18nStore();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const messageCount = useChatStore((state) => state.messages.length);
  const [seenMessages, setSeenMessages] = useState(messageCount);
  const unread = unreadCount(messageCount, seenMessages, chatOpen);
  const attemptedRoom = useRef<string | null>(null);
  const hadRoom = useRef(false);
  const leaving = useRef(false);
  const connectionReady = useConnectionReady();
  const blocked = busy || !connectionReady;
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

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copyCode = (code: string): void => {
    if (!navigator.clipboard) {
      setError(t('room.copyFailed'));
      return;
    }
    navigator.clipboard.writeText(code).then(() => setCopied(true), () => setError(t('room.copyFailed')));
  };
  const toggleChat = (): void => {
    setSeenMessages(messageCount);
    setChatOpen((open) => !open);
  };

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
  const kick = (player: PlayerInfo): void => {
    if (!window.confirm(t('room.kickConfirm', { nickname: player.nickname }))) return;
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('room:kick', { accountId: player.id }, handleResult);
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
      if (!timeout && result.success) {
        // Clear the room before navigating so the lobby does not redirect back to it.
        useRoomStore.getState().leaveRoom();
        navigate('/');
      }
      else leaving.current = false;
    });
  };

  if (!roomInfo || !roomCode) return <main className={styles.roomContainer}>
    <p role={error ? 'alert' : 'status'}>{error || t('common.loading')}</p>
    {error && <Link to="/">{t('nav.lobby')}</Link>}
  </main>;

  const progress = roomProgress(roomInfo.seats);
  const progressText = t('room.progress', { seated: String(progress.seated), ready: String(progress.ready) });
  const hintKey = !mySeat ? 'room.pickSeat' : progress.seated < 4 ? 'room.waiting'
    : isReady ? 'room.waitingReady' : 'room.pressReady';

  return (
    <main className={`${styles.roomContainer} ${styles.roomLayout} ${chatOpen ? styles.chatOpen : ''}`}>
      <div className={styles.roomHeader}>
        <div className={styles.codeBlock}>
          <span className={styles.roomCodeLabel}>{t('room.code')}</span>
          {/* The code itself is the copy control, so the action reads as part of the code. */}
          <button type="button" className={`touch-target ${styles.codePill}`} onClick={() => copyCode(roomInfo.code)}
            aria-label={`${t('room.copyCode')} ${roomInfo.code}`} title={t('room.copyCode')}>
            <span className={styles.roomCode}>{roomInfo.code}</span>
            <span className={`${styles.copyState} ${copied ? styles.copiedState : ''}`} aria-hidden="true">
              {copied ? <>✓<span className={styles.copyText}>{t('room.copied')}</span></> : <CopyIcon />}
            </span>
          </button>
          <span className={styles.srOnly} role="status">{copied ? t('room.copied') : ''}</span>
        </div>
        <div className={styles.headerActions}>
          <TimeControlSettings
            key={`${roomInfo.code}:${roomInfo.hostId}:${roomInfo.timeControl?.baseSeconds}:${roomInfo.timeControl?.bankSeconds}`}
            value={roomInfo.timeControl ?? DEFAULT_TIME_CONTROL}
            disabled={!isHost || blocked || roomInfo.status !== 'waiting'} onSave={setTimeControl} />
          <button type="button" className={`btn btn-outline touch-target ${styles.chatToggle}`}
            aria-pressed={chatOpen} aria-controls="room-chat" onClick={toggleChat}>
            {t('chat.title')}
            {unread > 0 && <span className={styles.unread} aria-label={t('room.unread', { n: String(unread) })}>
              {unread}</span>}
          </button>
          <InviteFriends />
          <button type="button" className="btn btn-outline touch-target" onClick={leave} disabled={blocked}>{t('room.leave')}</button>
        </div>
        <div className={styles.gameTypeRow}>
          <span className={styles.gameTypeLabel} id="room-game-label">{t('gameType.label')}</span>
          <div className={styles.segmented} role="radiogroup" aria-labelledby="room-game-label"
            title={isHost ? undefined : t('room.hostOnly')}>
            {GAME_TYPES.map((gameType) => (
              <button key={gameType} type="button" role="radio" aria-checked={roomInfo.gameType === gameType}
                className={roomInfo.gameType === gameType ? styles.segmentActive : styles.segment}
                disabled={!isHost || blocked || roomInfo.gameType === gameType}
                onClick={() => setGameType(gameType)}>
                {t(`gameType.${gameType}`)}
              </button>
            ))}
          </div>
        </div>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={`${styles.tableArea} ${tableStyle ? styles.customTable : ''}`} style={tableStyle}>
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
              {isHost && player.isBot && <button type="button" className={`btn btn-outline touch-target ${styles.botAction}`}
                disabled={blocked} onClick={() => removeBot(seat)}>{t('room.removeBot')}</button>}
              {isHost && !player.isBot && player.id !== playerId && roomInfo.status === 'waiting' &&
                <button type="button" className={`btn btn-outline touch-target ${styles.botAction}`}
                  disabled={blocked} onClick={() => kick(player)}>{t('room.kick')}</button>}
            </div>
          );
          return (
            <div key={seat} className={`${className} ${styles.emptySlot}`}>
              <button type="button" disabled={blocked} className={styles.seatChoice}
                onClick={() => changeSeat(seat)}>
                <span className={styles.seatLabel}>{t(`seat.${seat}`)}</span>
                <span className={styles.seatEmpty}>{t('room.seatEmpty')}</span>
              </button>
              {isHost && <button type="button" className={`btn btn-outline touch-target ${styles.botAction}`}
                disabled={blocked} onClick={() => addBot(seat)}>{t('room.addBot')}</button>}
            </div>
          );
        })}
        <div className={styles.tableCenter}>
          <div className={styles.tableCenterText}>
            <strong>{progressText}</strong>
            <span>{t(hintKey)}</span>
          </div>
        </div>
      </div>
      <div className={styles.roomFooter}>
        <p className={styles.progress} role="status">{progressText}</p>
        {isHost && <button type="button" className="btn btn-outline" onClick={fillBots}
          disabled={blocked || !hasEmptySeat}>{t('room.fillBots')}</button>}
        <button className={`btn ${isReady ? 'btn-danger' : 'btn-success'} ${styles.readyBtn}`}
          onClick={ready} disabled={blocked || !mySeat}>{t(isReady ? 'room.unready' : 'room.ready')}</button>
      </div>
      </div>
      <div className={styles.chat} id="room-chat"><ChatPanel /></div>
    </main>
  );
}
