import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent, PointerEvent } from 'react';
import type { PlayerInfo, RoomSeatTarget, Seat } from '@shared/types';

function targetFromElement(element: Element | null): { key: string; target: RoomSeatTarget } | null {
  const key = element?.closest('[data-room-drop]')?.getAttribute('data-room-drop');
  if (key === 'spectator') return { key, target: { type: 'spectator' } };
  if (key && ['N', 'E', 'S', 'W'].includes(key)) return { key, target: { type: 'seat', seat: key as Seat } };
  if (key?.startsWith('additional-')) {
    const index = Number(key.slice('additional-'.length));
    if (Number.isInteger(index) && index >= 0) return { key, target: { type: 'additional', index } };
  }
  return null;
}

interface SeatDrag {
  readonly player: PlayerInfo;
  readonly x: number;
  readonly y: number;
  readonly targetKey: string | null;
}

interface RoomSeatDragController {
  readonly selected: PlayerInfo | null;
  readonly drag: SeatDrag | null;
  start(event: PointerEvent<HTMLElement>, player: PlayerInfo): void;
  move(event: PointerEvent<HTMLElement>): void;
  finish(event: PointerEvent<HTMLElement>): void;
  cancel(): void;
  choose(event: MouseEvent<HTMLElement>): void;
  select(player: PlayerInfo): void;
}

/** Pointer capture handles mouse and touch; selecting the handle also allows click placement. */
export function useRoomSeatDrag(
  enabled: boolean, onMove: (player: PlayerInfo, target: RoomSeatTarget) => void,
): RoomSeatDragController {
  const [selected, setSelected] = useState<PlayerInfo | null>(null);
  const [drag, setDrag] = useState<SeatDrag | null>(null);
  const pending = useRef<{ player: PlayerInfo; pointerId: number; x: number; y: number; started: boolean } | null>(null);
  const suppressClick = useRef(false);

  const cancel = useCallback((): void => {
    pending.current = null;
    setSelected(null);
    setDrag(null);
  }, []);

  useEffect(() => {
    const keyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') cancel(); };
    window.addEventListener('keydown', keyDown);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('blur', cancel);
    };
  }, [cancel]);

  const start = (event: PointerEvent<HTMLElement>, player: PlayerInfo): void => {
    if (!enabled || player.isBot || !event.isPrimary || event.button !== 0) return;
    const element = event.target instanceof Element ? event.target : null;
    suppressClick.current = false;
    pending.current = { player, pointerId: event.pointerId, x: event.clientX, y: event.clientY, started: false };
    // Keep taps/clicks on links and buttons intact until movement starts a drag.
    (element?.closest('a, button') ?? element ?? event.currentTarget).setPointerCapture(event.pointerId);
  };

  const move = (event: PointerEvent<HTMLElement>): void => {
    const current = pending.current;
    if (!enabled || !current || current.pointerId !== event.pointerId) return;
    if (!current.started && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6) return;
    if (!current.started) event.currentTarget.setPointerCapture(event.pointerId);
    current.started = true;
    event.preventDefault();
    setSelected(null);
    const destination = targetFromElement(document.elementFromPoint(event.clientX, event.clientY));
    setDrag({ player: current.player, x: event.clientX, y: event.clientY, targetKey: destination?.key ?? null });
  };

  const finish = (event: PointerEvent<HTMLElement>): void => {
    const current = pending.current;
    if (!current || current.pointerId !== event.pointerId) return;
    pending.current = null;
    setDrag(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!current.started) return;
    // Prevent the release from activating a profile link or sitting in the drop seat.
    suppressClick.current = true;
    window.setTimeout(() => { suppressClick.current = false; }, 0);
    event.preventDefault();
    const destination = targetFromElement(document.elementFromPoint(event.clientX, event.clientY));
    if (enabled && destination) onMove(current.player, destination.target);
  };

  const choose = (event: MouseEvent<HTMLElement>): void => {
    if (suppressClick.current) {
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!enabled || !selected) return;
    const element = event.target instanceof Element ? event.target : null;
    if (element?.closest('[data-seat-drag-handle]')) return;
    const destination = targetFromElement(element);
    if (!destination) return;
    event.preventDefault();
    event.stopPropagation();
    setSelected(null);
    onMove(selected, destination.target);
  };

  return {
    selected: enabled ? selected : null,
    drag: enabled ? drag : null,
    start, move, finish, cancel, choose,
    select: (player: PlayerInfo): void => {
      if (enabled) setSelected((previous) => previous?.id === player.id ? null : player);
    },
  };
}
