import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent, ReactNode } from 'react';
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

/** Phones in either orientation show the draggable one-line pill instead of the full card. */
const COMPACT_QUERY = '(max-width: 767px), (max-height: 500px) and (min-width: 600px)';
const LANDSCAPE_QUERY = '(max-height: 500px) and (min-width: 600px)';

/** Uses the existing room snapshots; navigating away never creates another room connection. */
export function FloatingRoomCard(): ReactNode {
  const { pathname } = useLocation();
  const { t } = useI18nStore();
  const accountId = useAccountStore((state) => state.account?.id);
  const connection = useAccountStore((state) => state.connection);
  const roomCode = useRoomStore((state) => state.currentRoomCode);
  const room = useRoomStore((state) => state.roomInfo);
  const phase = useGameStore((state) => state.phase);
  // Short landscape screens start at the right edge so the lobby's room details stay uncovered.
  const [corner, setCorner] = useState<'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'>(
    () => typeof window !== 'undefined' && window.matchMedia?.(LANDSCAPE_QUERY).matches ? 'bottom-right' : 'bottom-left');
  const hidden = !accountId || !roomCode || !room || room.code !== roomCode
    || pathname.startsWith('/room/') || pathname.startsWith('/game/')
    || pathname === '/login' || pathname === '/register';
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; rect: DOMRect; dx: number; dy: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  // Pages reserve room below their content while the pill floats over the viewport.
  useEffect(() => {
    if (hidden) return;
    document.documentElement.dataset.roomCard = '';
    return () => { delete document.documentElement.dataset.roomCard; };
  }, [hidden]);

  useEffect(() => {
    const cancel = (): void => { drag.current = null; setOffset(null); };
    window.addEventListener('resize', cancel);
    window.addEventListener('blur', cancel);
    return () => { window.removeEventListener('resize', cancel); window.removeEventListener('blur', cancel); };
  }, []);

  const move = (event: PointerEvent<HTMLAnchorElement>): void => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.moved && Math.hypot(dx, dy) < 6) return;
    current.moved = true;
    suppressClick.current = true;
    const rootStyle = getComputedStyle(document.documentElement);
    const top = (Number.parseFloat(rootStyle.getPropertyValue('--topbar-height')) || 0) + 8;
    const left = (Number.parseFloat(rootStyle.getPropertyValue('--rail-width')) || 0) + 8;
    current.dx = Math.max(left, Math.min(innerWidth - current.rect.width - 8, current.rect.left + dx)) - current.rect.left;
    current.dy = Math.max(top, Math.min(innerHeight - current.rect.height - 8, current.rect.top + dy)) - current.rect.top;
    setOffset({ x: current.dx, y: current.dy });
    event.preventDefault();
  };

  const finish = (event: PointerEvent<HTMLAnchorElement>): void => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    drag.current = null;
    setOffset(null);
    if (current.moved && event.type === 'pointerup') {
      const vertical = current.rect.top + current.dy + current.rect.height / 2 < innerHeight / 2 ? 'top' : 'bottom';
      const horizontal = current.rect.left + current.dx + current.rect.width / 2 < innerWidth / 2 ? 'left' : 'right';
      setCorner(`${vertical}-${horizontal}`);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  if (hidden) return null;

  const seats = GAME_SEAT_ORDER.flatMap((seat) => {
    const info = roomSeatInfo(room, seat);
    return info ? [info] : [];
  });
  const occupied = seats.filter((seat) => seat.player !== null);
  const playing = Boolean(phase) || room.status === 'playing';
  const path = `/${playing ? 'game' : 'room'}/${encodeURIComponent(roomCode)}`;
  const replaying = !playing && room.status === 'replaying';
  const status = connection !== 'ready' ? 'roomCard.reconnecting'
    : phase === 'scoring' ? 'roomCard.finished'
    : playing ? 'roomCard.playing'
    : replaying ? 'replay.sharedInProgress'
    : roomCanStart(room) ? 'roomCard.ready' : 'roomCard.waiting';
  const gameName = t(`gameType.${room.gameType}`);

  return <aside className={styles.card} aria-label={t('roomCard.title')} data-corner={corner}
    data-dragging={offset ? true : undefined}
    style={offset ? { '--drag-x': `${offset.x}px`, '--drag-y': `${offset.y}px` } as CSSProperties : undefined}>
    <Link className={styles.link} to={path} aria-label={t('roomCard.open', { game: gameName, code: roomCode })}
      onDragStart={(event) => { if (drag.current) event.preventDefault(); }}
      onPointerDown={(event) => {
        suppressClick.current = false;
        if (!event.isPrimary || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey
          || !window.matchMedia(COMPACT_QUERY).matches) return;
        const rect = event.currentTarget.parentElement!.getBoundingClientRect();
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, rect, dx: 0, dy: 0, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
      onKeyDown={(event) => { if (event.key === 'Enter') suppressClick.current = false; }}
      onClick={(event) => {
        if (suppressClick.current) { event.preventDefault(); suppressClick.current = false; }
      }}>
      <div className={styles.heading}>
        <span className={`${styles.compactDot} ${styles.dot} ${connection !== 'ready' ? styles.disconnected : playing ? styles.playing : ''}`}
          role="status" aria-label={t(status)} title={t(status)} />
        <strong>{gameName}</strong>
        <span className={styles.compactCount}>({occupied.length}/{seats.length})</span>
        <span className={styles.code}>{roomCode}</span><AppIcon name="nextPage" />
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
        {!playing && !replaying && connection === 'ready' && <span>
          {t('roomCard.prepared', { ready: String(occupied.filter((seat) => seat.isReady).length), total: String(occupied.length) })}</span>}
        {(room.spectators?.length ?? 0) > 0 && <span>{t('roomCard.spectators', { count: String(room.spectators!.length) })}</span>}
      </div>
    </Link>
  </aside>;
}
