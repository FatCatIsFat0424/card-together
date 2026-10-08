// ─── CardHand 元件：手牌顯示（扇形） ───

import { useRef, useState } from 'react';
import type { CSSProperties, PointerEvent, ReactNode } from 'react';
import type { Card } from '@shared/types';
import { SUIT_SYMBOLS, RANK_DISPLAY } from '@shared/constants';
import { moveHandCard } from './card-hand-order';
import { cardImageUrl } from '../cards';
import styles from './CardHand.module.css';

interface CardHandProps {
  cards: readonly Card[];
  playableCards?: readonly Card[];
  onCardClick?: (card: Card) => void;
  disabled?: boolean;
  onReorder?: (cards: readonly Card[]) => void;
  onCardPreview?: (card: Card | null) => void;
  /** 多選模式：每張牌皆可點擊切換，已選的牌升起（取代 playableCards 標示） */
  selectedCards?: readonly Card[];
  /** 額外標示的牌（99：出了會超過 99） */
  markedCards?: readonly Card[];
  markedLabel?: string;
}

function containsCard(card: Card, list?: readonly Card[]): boolean {
  if (!list) return false;
  return list.some((c) => c.suit === card.suit && c.rank === card.rank);
}

export function CardHand({
  cards, playableCards, onCardClick, disabled, selectedCards, markedCards, markedLabel, onCardPreview, onReorder,
}: CardHandProps): ReactNode {
  const gesture = useRef<{
    pointerId: number; card: Card; startX: number; startY: number;
    source: number; centers: number[]; target: number; moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const [drag, setDrag] = useState<{ card: Card; offset: number; target: number } | null>(null);

  const finishDrag = (event: PointerEvent<HTMLButtonElement>, cancelled: boolean): void => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    gesture.current = null;
    setDrag(null);
    suppressClick.current = current.moved;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!cancelled && current.moved && !disabled) {
      onReorder?.(moveHandCard(cards, current.card, current.target));
    }
  };

  const middle = (cards.length - 1) / 2;
  const selectMode = selectedCards !== undefined;
  return (
    <div className={styles.handContainer}
      style={{ '--hand-card-count': Math.max(cards.length, 1) } as CSSProperties}>
      {cards.map((card, index) => {
        const playable = selectMode || containsCard(card, playableCards);
        const selected = containsCard(card, selectedCards);
        const marked = containsCard(card, markedCards);
        const cardClasses = [
          styles.card,
          playable && !disabled && !selectMode ? styles.cardPlayable : '',
          selected ? styles.cardSelected : '',
          marked ? styles.cardMarked : '',
          onReorder && !disabled ? styles.cardReorderable : '',
          drag && containsCard(card, [drag.card]) ? styles.cardDragging : '',
          drag?.target === index ? styles.cardDropTarget : '',
        ].filter(Boolean).join(' ');

        return (
          <button
            key={`${card.suit}-${card.rank}`}
            className={cardClasses}
            style={{
              '--fan': index - middle,
              '--drag-x': `${drag && containsCard(card, [drag.card]) ? drag.offset : 0}px`,
            } as CSSProperties}
            onPointerDown={(event) => {
              if (!onReorder || disabled || !event.isPrimary || event.button !== 0) return;
              suppressClick.current = false;
              const buttons = event.currentTarget.parentElement?.querySelectorAll('button');
              if (!buttons) return;
              gesture.current = {
                pointerId: event.pointerId, card, startX: event.clientX, startY: event.clientY,
                source: index, target: index, moved: false,
                centers: Array.from(buttons, (button) => {
                  const rect = button.getBoundingClientRect();
                  return rect.left + rect.width / 2;
                }),
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const current = gesture.current;
              if (!current || current.pointerId !== event.pointerId || disabled) return;
              const offset = event.clientX - current.startX;
              if (!current.moved && Math.hypot(offset, event.clientY - current.startY) < 8) return;
              current.moved = true;
              const center = current.centers[current.source] + offset;
              current.target = current.centers.reduce((nearest, value, candidate) =>
                Math.abs(value - center) < Math.abs(current.centers[nearest] - center) ? candidate : nearest, 0);
              onCardPreview?.(null);
              setDrag({ card: current.card, offset, target: current.target });
            }}
            onPointerUp={(event) => finishDrag(event, false)}
            onPointerCancel={(event) => finishDrag(event, true)}
            onLostPointerCapture={(event) => finishDrag(event, true)}
            onKeyDown={(event) => {
              if (!onReorder || disabled || !event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
              event.preventDefault();
              onReorder(moveHandCard(cards, card, index + (event.key === 'ArrowLeft' ? -1 : 1)));
            }}
            onClick={(event) => {
              if (suppressClick.current && event.detail !== 0) {
                suppressClick.current = false;
                return;
              }
              if (playable && !disabled) onCardClick?.(card);
            }}
            onPointerEnter={(event) => {
              if (event.pointerType === 'mouse' && playable && !disabled) onCardPreview?.(card);
            }}
            onPointerLeave={() => onCardPreview?.(null)}
            onFocus={() => { if (playable && !disabled) onCardPreview?.(card); }}
            onBlur={() => onCardPreview?.(null)}
            disabled={disabled || (!playable && !onReorder)}
            aria-pressed={selectMode ? selected : undefined}
            aria-label={`${RANK_DISPLAY[card.rank]}${SUIT_SYMBOLS[card.suit]}${marked && markedLabel ? ` (${markedLabel})` : ''}`}
            title={marked ? markedLabel : undefined}
          >
            <img src={cardImageUrl(card)} alt="" draggable={false} />
          </button>
        );
      })}
    </div>
  );
}
