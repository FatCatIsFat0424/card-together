import { useRef } from 'react';
import type { HTMLAttributes, PointerEvent } from 'react';
import { moveHandCardAt } from '../components/card-hand-order';

/** Pointer drag and Alt+arrow movement for flat card rows; dragging never selects a card. */
export function useHandReorder<T>(cards: readonly T[], enabled: boolean, reorder: (cards: readonly T[]) => void):
  (index: number) => HTMLAttributes<HTMLElement> {
  const drag = useRef<{ pointer: number; source: number; x: number; moved: boolean; centers: number[] } | null>(null);
  const suppressClick = useRef(false);
  const move = (source: number, target: number): void => {
    if (!enabled || target < 0 || target >= cards.length) return;
    reorder(moveHandCardAt(cards, source, target));
  };
  const finish = (event: PointerEvent<HTMLElement>, cancelled: boolean): void => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    drag.current = null;
    suppressClick.current = current.moved;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (cancelled || !current.moved) return;
    const center = current.centers[current.source] + event.clientX - current.x;
    const target = current.centers.reduce((nearest, value, index) =>
      Math.abs(value - center) < Math.abs(current.centers[nearest] - center) ? index : nearest, 0);
    move(current.source, target);
  };
  return (index) => enabled ? {
    'data-hand-reorder': true,
    tabIndex: 0,
    style: { touchAction: 'none', cursor: 'grab' },
    onPointerDown: (event) => {
      if (!event.isPrimary || event.button !== 0) return;
      const elements = event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[data-hand-reorder]');
      if (!elements) return;
      suppressClick.current = false;
      drag.current = { pointer: event.pointerId, source: index, x: event.clientX, moved: false,
        centers: [...elements].map((element) => { const rect = element.getBoundingClientRect(); return rect.left + rect.width / 2; }) };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event) => {
      if (drag.current?.pointer === event.pointerId && Math.abs(event.clientX - drag.current.x) >= 8) drag.current.moved = true;
    },
    onPointerUp: (event) => finish(event, false),
    onPointerCancel: (event) => finish(event, true),
    onLostPointerCapture: (event) => finish(event, true),
    onClickCapture: (event) => {
      if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; event.stopPropagation(); event.preventDefault(); }
    },
    onKeyDown: (event) => {
      if (!event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      move(index, index + (event.key === 'ArrowLeft' ? -1 : 1));
    },
  } : {};
}
