import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { GAME_SEAT_ORDER } from '@shared/constants';
import { roomCanStart, roomSeatInfo } from '@shared/rules/seats';
import { useAccountStore } from '../stores/account-store';
import { useGameStore } from '../stores/game-store';
import { useRoomStore } from '../stores/room-store';
import { useI18nStore } from '../stores/i18n-store';
import { Avatar } from './Avatar';
import { AppIcon } from './AppIcon';
import styles from './FloatingRoomCard.module.css';

/** Uses the existing room snapshots; navigating away never creates another room connection. */
export function FloatingRoomCard(): ReactNode {
  const { pathname } = useLocation();
  const { t } = useI18nStore();
  const accountId = useAccountStore((state) => state.account?.id);
  const connection = useAccountStore((state) => state.connection);
  const roomCode = useRoomStore((state) => state.currentRoomCode);
  const room = useRoomStore((state) => state.roomInfo);
  const phase = useGameStore((state) => state.phase);

  if (!accountId || !roomCode || !room || room.code !== roomCode
    || pathname.startsWith('/room/') || pathname.startsWith('/game/')
    || pathname === '/login' || pathname === '/register') return null;

  const seats = GAME_SEAT_ORDER.flatMap((seat) => {
    const info = roomSeatInfo(room, seat);
    return info ? [info] : [];
  });
  const occupied = seats.filter((seat) => seat.player !== null);
  const playing = Boolean(phase) || room.status === 'playing';
  const path = `/${playing ? 'game' : 'room'}/${encodeURIComponent(roomCode)}`;
  const status = connection !== 'ready' ? 'roomCard.reconnecting'
    : phase === 'scoring' ? 'roomCard.finished'
    : playing ? 'roomCard.playing'
    : roomCanStart(room) ? 'roomCard.ready' : 'roomCard.waiting';
  const gameName = t(`gameType.${room.gameType}`);

  return <aside className={styles.card} aria-label={t('roomCard.title')}>
    <Link className={styles.link} to={path} aria-label={t('roomCard.open', { game: gameName, code: roomCode })}>
      <div className={styles.heading}>
        <strong>{gameName}</strong><span className={styles.code}>{roomCode}</span><AppIcon name="nextPage" />
      </div>
      <div className={styles.status}>
        <span className={`${styles.dot} ${connection !== 'ready' ? styles.disconnected : playing ? styles.playing : ''}`} aria-hidden="true" />
        <span role="status">{t(status)}</span>
        <small>{occupied.length}/{seats.length}</small>
      </div>
      {occupied.length > 0 ? <ul className={styles.players}>
        {occupied.map(({ player }) => player && <li key={player.id} title={player.nickname}>
          <Avatar avatar={player.avatar} image={player.avatarImage} color={player.color} border={player.avatarBorder} size="small" />
          <span>{player.nickname}</span>
        </li>)}
      </ul> : <p className={styles.empty}>{t('roomCard.empty')}</p>}
      <div className={styles.footer}>
        <span>{!playing && connection === 'ready'
          ? t('roomCard.prepared', { ready: String(occupied.filter((seat) => seat.isReady).length), total: String(occupied.length) })
          : t('roomCard.openHint')}</span>
        {(room.spectators?.length ?? 0) > 0 && <span>{t('roomCard.spectators', { count: String(room.spectators!.length) })}</span>}
      </div>
    </Link>
  </aside>;
}
