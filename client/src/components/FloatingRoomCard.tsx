import { useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent, ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { GAME_SEAT_ORDER } from '@shared/constants';
import { isSeatReady, roomCanStart, roomSeatInfo } from '@shared/rules/seats';
import { useAccountStore } from '../stores/account-store';
import { useGameStore } from '../stores/game-store';
import { useRoomStore } from '../stores/room-store';
import { useI18nStore } from '../stores/i18n-store';
import { clampFloatingCard, defaultFloatingCardPosition, floatingCardArea, floatingCardBounds, floatingCardDragStarted, floatingCardKeyMove, normalizeFloatingCard, restoreFloatingCard } from './floating-room-card-position';
import type { FloatingCardBounds, FloatingCardPoint } from './floating-room-card-position';
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
  const hidden = !accountId || !roomCode || !room || room.code !== roomCode
    || pathname.startsWith('/room/') || pathname.startsWith('/game/')
    || pathname === '/login' || pathname === '/register';
  const cardRef = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<FloatingCardPoint | null>(null);
  const [dragging, setDragging] = useState(false);
  const preferredPosition = useRef<FloatingCardPoint | null>(null);
  const boundsRef = useRef<FloatingCardBounds | null>(null);
  const drag = useRef<{
    id: number; target: HTMLElement; start: FloatingCardPoint; origin: FloatingCardPoint; moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const messages = pathname === '/messages' || pathname.startsWith('/messages/');

  const releaseDrag = (): void => {
    const current = drag.current;
    drag.current = null;
    if (current?.target.hasPointerCapture(current.id)) current.target.releasePointerCapture(current.id);
  };

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (hidden || !card) return;
    const cancel = (): void => { releaseDrag(); setDragging(false); };
    const measure = (): void => {
      const rootStyle = getComputedStyle(document.documentElement);
      const cardStyle = getComputedStyle(card);
      const pixels = (style: CSSStyleDeclaration, name: string): number => Number.parseFloat(style.getPropertyValue(name)) || 0;
      const viewport = window.visualViewport;
      const area = floatingCardArea({
        left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0,
        width: viewport?.width ?? window.innerWidth, height: viewport?.height ?? window.innerHeight,
      }, { left: pixels(rootStyle, '--rail-width'), top: pixels(rootStyle, '--topbar-height') }, {
        left: pixels(cardStyle, '--safe-left'), top: pixels(cardStyle, '--safe-top'),
        right: pixels(cardStyle, '--safe-right'), bottom: pixels(cardStyle, '--safe-bottom'),
      });
      // Limit the rendered size before measuring so the card stays inside even a short keyboard viewport.
      card.style.setProperty('--card-max-width', `${area.right - area.left}px`);
      card.style.setProperty('--card-max-height', `${area.bottom - area.top}px`);
      const bounds = floatingCardBounds(area, card.getBoundingClientRect());
      boundsRef.current = bounds;
      const preferred = preferredPosition.current ?? defaultFloatingCardPosition(
        messages, window.matchMedia(COMPACT_QUERY).matches, window.matchMedia(LANDSCAPE_QUERY).matches,
      );
      const next = restoreFloatingCard(preferred, bounds);
      setPosition((previous) => previous?.x === next.x && previous.y === next.y ? previous : next);
    };
    const refresh = (): void => { cancel(); measure(); };
    refresh();
    // Moving can shift the card's size by subpixels, so its own resizes keep an ongoing drag.
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    window.addEventListener('resize', refresh);
    window.addEventListener('orientationchange', refresh);
    window.addEventListener('blur', cancel);
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', refresh);
    viewport?.addEventListener('scroll', refresh);
    return () => {
      releaseDrag();
      boundsRef.current = null;
      observer.disconnect();
      window.removeEventListener('resize', refresh);
      window.removeEventListener('orientationchange', refresh);
      window.removeEventListener('blur', cancel);
      viewport?.removeEventListener('resize', refresh);
      viewport?.removeEventListener('scroll', refresh);
    };
  }, [hidden, messages, pathname]);

  const place = (point: FloatingCardPoint): void => {
    const bounds = boundsRef.current;
    if (!bounds) return;
    const next = clampFloatingCard(point, bounds);
    preferredPosition.current = normalizeFloatingCard(next, bounds);
    setPosition(next);
  };

  const move = (event: PointerEvent<HTMLElement>): void => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const point = { x: event.clientX, y: event.clientY };
    if (!current.moved && !floatingCardDragStarted(current.start, point)) return;
    // Capture only once dragging, so a plain click still reaches the link.
    if (!current.moved) current.target.setPointerCapture(current.id);
    current.moved = true;
    suppressClick.current = true;
    setDragging(true);
    place({ x: current.origin.x + point.x - current.start.x, y: current.origin.y + point.y - current.start.y });
    event.preventDefault();
  };

  const finish = (event: PointerEvent<HTMLElement>): void => {
    if (drag.current?.id !== event.pointerId) return;
    releaseDrag();
    setDragging(false);
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

  return <aside ref={cardRef} className={styles.card} aria-label={t('roomCard.title')}
    data-messages={messages || undefined} data-dragging={dragging || undefined}
    style={position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : undefined}
    onDragStart={(event) => event.preventDefault()}
    onPointerDown={(event) => {
      suppressClick.current = false;
      // A press on the card's own box, outside the link, can only be its scrollbar.
      if (drag.current?.moved || event.target === event.currentTarget || !event.isPrimary || event.button !== 0
        || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const rect = event.currentTarget.getBoundingClientRect();
      drag.current = { id: event.pointerId, target: event.currentTarget,
        start: { x: event.clientX, y: event.clientY }, origin: { x: rect.left, y: rect.top }, moved: false };
    }}
    onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}
    // Touch input implicitly captures to the pressed child, which loses it once the card takes over.
    onLostPointerCapture={(event) => { if (event.target === event.currentTarget) finish(event); }}>
    <Link className={styles.link} to={path} aria-label={t('roomCard.open', { game: gameName, code: roomCode })}
      aria-description={t('roomCard.moveHint')}
      onKeyDown={(event) => {
        suppressClick.current = false;
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const delta = floatingCardKeyMove(event.key, event.shiftKey);
        const rect = cardRef.current?.getBoundingClientRect();
        if (!delta || !rect) return;
        event.preventDefault();
        releaseDrag();
        setDragging(false);
        place({ x: rect.left + delta.x, y: rect.top + delta.y });
      }}
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
          {t('roomCard.prepared', { ready: String(occupied.filter((seat) => isSeatReady(room, seat)).length), total: String(occupied.length) })}</span>}
        {(room.spectators?.length ?? 0) > 0 && <span>{t('roomCard.spectators', { count: String(room.spectators!.length) })}</span>}
      </div>
    </Link>
  </aside>;
}
