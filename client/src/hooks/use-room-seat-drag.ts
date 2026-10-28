import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import type { PlayerInfo, RoomSeatTarget, Seat } from '@shared/types';
import type { DragSource } from '../pages/room-moves';

/** A touch must rest this long before a card lifts, so scrolling and taps keep working. */
export const LONG_PRESS_MS = 400;
/** Pointer travel that starts a mouse or pen drag. */
const DRAG_SLOP = 6;
/** Touch travel during the long press that means the finger is swiping, not holding. */
const HOLD_SLOP = 10;
const PICK_UP_VIBRATION_MS = 15;

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

export interface SeatDrag {
  readonly player: PlayerInfo;
  readonly source: DragSource;
  readonly x: number;
  readonly y: number;
  /** `data-room-drop` key under the pointer. */
  readonly targetKey: string | null;
}

export interface RoomSeatDragController {
  readonly drag: SeatDrag | null;
  /** Member whose long press is still running; drives the ring timer. */
  readonly holding: string | null;
  start(event: PointerEvent<HTMLElement>, player: PlayerInfo, source: DragSource): void;
  cancel(): void;
}

interface Pending {
  readonly player: PlayerInfo;
  readonly source: DragSource;
  readonly pointerId: number;
  readonly touch: boolean;
  readonly element: HTMLElement;
  readonly originX: number;
  readonly originY: number;
  x: number;
  y: number;
  started: boolean;
  timer: number | null;
}

/**
 * Pointer-driven drag of a member between seats and the spectator area. Mouse and pen drag after a few pixels;
 * touch lifts after a long press. Listening on the window lets a drag start in the dock or a popover and end on the table.
 */
export function useRoomSeatDrag(
  enabled: boolean,
  onMove: (player: PlayerInfo, target: RoomSeatTarget) => void,
  onPickUp?: () => void,
): RoomSeatDragController {
  const [drag, setDrag] = useState<SeatDrag | null>(null);
  const [holding, setHolding] = useState<string | null>(null);
  const pending = useRef<Pending | null>(null);
  const stopListening = useRef<(() => void) | null>(null);
  const latest = useRef({ enabled, onMove, onPickUp });
  useEffect(() => { latest.current = { enabled, onMove, onPickUp }; });

  const release = useCallback((): void => {
    const current = pending.current;
    if (current?.timer !== null && current?.timer !== undefined) window.clearTimeout(current.timer);
    pending.current = null;
    stopListening.current?.();
    stopListening.current = null;
  }, []);
  const cancel = useCallback((): void => {
    release();
    setHolding(null);
    setDrag(null);
  }, [release]);

  // Losing the right to move members ends a gesture in flight.
  useEffect(() => {
    if (enabled) return;
    release();
    queueMicrotask(() => { setHolding(null); setDrag(null); });
  }, [enabled, release]);

  useEffect(() => {
    const keyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') cancel(); };
    window.addEventListener('keydown', keyDown);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('blur', cancel);
      cancel();
    };
  }, [cancel]);

  const begin = (current: Pending): void => {
    current.started = true;
    if (current.timer !== null) window.clearTimeout(current.timer);
    current.timer = null;
    setHolding(null);
    try { current.element.setPointerCapture(current.pointerId); } catch { /* the element may already be gone */ }
    if (current.touch) navigator.vibrate?.(PICK_UP_VIBRATION_MS);
    latest.current.onPickUp?.();
  };

  const track = (current: Pending): void => {
    const destination = targetFromElement(document.elementFromPoint(current.x, current.y));
    setDrag({ player: current.player, source: current.source, x: current.x, y: current.y,
      targetKey: destination?.key ?? null });
  };

  const start = (event: PointerEvent<HTMLElement>, player: PlayerInfo, source: DragSource): void => {
    if (!latest.current.enabled || player.isBot || !event.isPrimary || event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    // Menus and kick buttons keep their own press.
    if (target?.closest('[data-no-drag]')) return;
    cancel();
    const current: Pending = {
      player, source, pointerId: event.pointerId, touch: event.pointerType === 'touch', element: event.currentTarget,
      originX: event.clientX, originY: event.clientY, x: event.clientX, y: event.clientY, started: false, timer: null,
    };
    pending.current = current;
    if (current.touch) {
      setHolding(player.id);
      current.timer = window.setTimeout(() => {
        current.timer = null;
        if (pending.current !== current) return;
        begin(current);
        track(current);
      }, LONG_PRESS_MS);
    }

    const move = (moveEvent: globalThis.PointerEvent): void => {
      if (pending.current !== current || moveEvent.pointerId !== current.pointerId) return;
      current.x = moveEvent.clientX;
      current.y = moveEvent.clientY;
      if (!current.started) {
        const distance = Math.hypot(current.x - current.originX, current.y - current.originY);
        if (current.touch) {
          // The finger moved on: this is a swipe, not a hold.
          if (distance > HOLD_SLOP) cancel();
          return;
        }
        if (distance < DRAG_SLOP) return;
        begin(current);
      }
      moveEvent.preventDefault();
      track(current);
    };
    const up = (upEvent: globalThis.PointerEvent): void => {
      if (pending.current !== current || upEvent.pointerId !== current.pointerId) return;
      const dragged = current.started;
      const destination = dragged
        ? targetFromElement(document.elementFromPoint(upEvent.clientX, upEvent.clientY)) : null;
      cancel();
      if (!dragged) return;
      // The release must not follow a profile link or press the seat it ends on.
      const swallow = (clickEvent: Event): void => { clickEvent.preventDefault(); clickEvent.stopPropagation(); };
      window.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      if (latest.current.enabled && destination) latest.current.onMove(current.player, destination.target);
    };
    const abort = (abortEvent: globalThis.PointerEvent): void => {
      if (pending.current === current && abortEvent.pointerId === current.pointerId) cancel();
    };
    const contextMenu = (menuEvent: Event): void => { menuEvent.preventDefault(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', abort);
    if (current.touch) window.addEventListener('contextmenu', contextMenu);
    stopListening.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', abort);
      window.removeEventListener('contextmenu', contextMenu);
    };
  };

  return { drag: enabled ? drag : null, holding: enabled ? holding : null, start, cancel };
}
