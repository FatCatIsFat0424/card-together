// ─── CardHand: fanned hand display ───

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent, ReactNode } from 'react';
import type { NapoleonCard } from '@shared/types';
import { SUIT_SYMBOLS, RANK_DISPLAY } from '@shared/constants';
import { isNapoleonJoker, sameNapoleonCard } from '@shared/rules/napoleon';
import { moveHandCardAt } from './card-hand-order';
import { useGameStore } from '../stores/game-store';
import { useSortedHand } from '../games/use-hand-sort';
import { cardInput, cardTap, validArmedCard } from './card-hand-touch';
import { useHandFit } from './use-hand-fit';
import { useNapoleonCardImageUrl } from '../games/napoleon/napoleon-card-art';
import { useI18nStore } from '../stores/i18n-store';
import styles from './CardHand.module.css';

/** Suit cards for every game; Napoleon hands may also hold jokers. */
interface CardHandProps<T extends NapoleonCard> {
  cards: readonly T[];
  playableCards?: readonly T[];
  onCardClick?: (card: T) => void;
  disabled?: boolean;
  onReorder?: (cards: readonly T[]) => void;
  onCardPreview?: (card: T | null) => void;
  /** Multi-select mode: every card toggles on click and selected cards rise; playableCards, if given, still glows */
  selectedCards?: readonly T[];
  /** Extra marked cards (Ninety-Nine: playing them would exceed 99) */
  markedCards?: readonly T[];
  markedLabel?: string;
  /** Newly received cards with a corner badge (Napoleon: the picked-up table cards) */
  highlightedCards?: readonly T[];
  highlightedLabel?: string;
  /** Touch taps lift a card first and play it on the second tap; defaults to on outside selection mode. */
  confirmTouch?: boolean;
}

function containsCard(card: NapoleonCard, list?: readonly NapoleonCard[]): boolean {
  if (!list) return false;
  return list.some((c) => sameNapoleonCard(c, card));
}

function cardName(card: NapoleonCard, jokerName: (joker: 'big' | 'small') => string): string {
  return isNapoleonJoker(card) ? jokerName(card.joker) : `${RANK_DISPLAY[card.rank]}${SUIT_SYMBOLS[card.suit]}`;
}

function cardKey(card: NapoleonCard): string {
  return isNapoleonJoker(card) ? `joker-${card.joker}` : `${card.suit}-${card.rank}`;
}

function coarsePointer(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
}

export function CardHand<T extends NapoleonCard>({
  cards: incoming, playableCards, onCardClick, disabled, selectedCards, markedCards, markedLabel, highlightedCards,
  highlightedLabel, onCardPreview, onReorder: reorder, confirmTouch,
}: CardHandProps<T>): ReactNode {
  const gameType = useGameStore((state) => state.gameType);
  const observer = useGameStore((state) => state.visible?.observer);
  const sorting = useSortedHand(incoming, gameType, !observer);
  const { cards } = sorting;
  const onReorder = sorting.canReorder ? (next: readonly T[]): void => {
    sorting.reorder(next);
    reorder?.(next);
  } : undefined;
  const napoleonCardImageUrl = useNapoleonCardImageUrl();
  const gesture = useRef<{
    pointerId: number; card: T; startX: number; startY: number;
    source: number; centers: number[]; target: number; moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const lastPointer = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ card: T; offset: number; target: number } | null>(null);
  const [armedCard, setArmedCard] = useState<T | null>(null);
  const fitStyle = useHandFit(containerRef, cards.length);
  const { t } = useI18nStore();
  const selectMode = selectedCards !== undefined;
  // Big Two keeps its own toggle selection; two-step touch play applies to immediate-play hands.
  const twoStep = confirmTouch ?? !selectMode;
  const armed = twoStep ? validArmedCard(armedCard, selectMode ? cards : playableCards, !disabled) : null;

  useEffect(() => {
    if (!armed) return;
    const disarm = (event: Event): void => {
      if (event.target instanceof Node && containerRef.current?.contains(event.target)) return;
      setArmedCard(null);
    };
    document.addEventListener('pointerdown', disarm);
    return () => document.removeEventListener('pointerdown', disarm);
  }, [armed]);

  const finishDrag = (event: PointerEvent<HTMLButtonElement>, cancelled: boolean): void => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    gesture.current = null;
    setDrag(null);
    suppressClick.current = current.moved;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!cancelled && current.moved) {
      onReorder?.(moveHandCardAt(cards, current.source, current.target));
    }
  };

  const middle = (cards.length - 1) / 2;
  return (
    <div className={styles.handContainer} ref={containerRef} role="group" data-card-hand
      aria-label={t('hand.label', { n: String(cards.length) })}
      style={{ '--hand-card-count': Math.max(cards.length, 1), ...fitStyle } as CSSProperties}>
      {cards.map((card, index) => {
        const playable = selectMode || containsCard(card, playableCards);
        const selected = containsCard(card, selectedCards);
        const marked = containsCard(card, markedCards);
        const highlighted = containsCard(card, highlightedCards);
        const hinted = !disabled && !selected && containsCard(card, playableCards);
        const cardClasses = [
          styles.card,
          hinted ? styles.cardPlayable : '',
          selected ? styles.cardSelected : '',
          marked ? styles.cardMarked : '',
          highlighted ? styles.cardHighlighted : '',
          armed && containsCard(card, [armed]) ? styles.cardArmed : '',
          onReorder ? styles.cardReorderable : '',
          drag && containsCard(card, [drag.card]) ? styles.cardDragging : '',
          drag?.target === index ? styles.cardDropTarget : '',
        ].filter(Boolean).join(' ');
        // Two-deck Ninety-Nine can deal both copies of a card to one hand.
        const copy = cards.slice(0, index).filter((other) => containsCard(other, [card])).length;

        return (
          <button
            key={`${cardKey(card)}-${copy}`}
            className={cardClasses}
            style={{
              '--fan': index - middle,
              '--drag-x': `${drag && containsCard(card, [drag.card]) ? drag.offset : 0}px`,
            } as CSSProperties}
            onPointerDown={(event) => {
              lastPointer.current = event.pointerType;
              if (!onReorder || !event.isPrimary || event.button !== 0) return;
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
              if (!current || current.pointerId !== event.pointerId || !onReorder) return;
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
              if (!onReorder || !event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
              event.preventDefault();
              onReorder(moveHandCardAt(cards, index, index + (event.key === 'ArrowLeft' ? -1 : 1)));
            }}
            onClick={(event) => {
              if (suppressClick.current && event.detail !== 0) {
                suppressClick.current = false;
                return;
              }
              const pointerType = lastPointer.current;
              lastPointer.current = null;
              if (!playable || disabled) return;
              if (!twoStep || containsCard(card, selectedCards)) {
                setArmedCard(null);
                onCardClick?.(card);
                return;
              }
              const input = event.detail === 0 ? 'keyboard' : cardInput(pointerType, coarsePointer());
              const tap = cardTap(armed, card, input);
              if (tap.type === 'arm') {
                setArmedCard(card);
                onCardPreview?.(card);
                return;
              }
              setArmedCard(null);
              onCardClick?.(card);
            }}
            onPointerEnter={(event) => {
              if (event.pointerType === 'mouse' && playable && !disabled) onCardPreview?.(card);
            }}
            onPointerLeave={(event) => {
              // Touch pointers leave right after lifting; keep the armed card's preview.
              if (event.pointerType === 'mouse') onCardPreview?.(null);
            }}
            onFocus={() => { if (playable && !disabled) onCardPreview?.(card); }}
            onBlur={() => onCardPreview?.(null)}
            // aria-disabled keeps every card focusable and readable; activation is still blocked above.
            aria-disabled={disabled || !playable}
            aria-pressed={selectMode ? selected : undefined}
            aria-label={`${cardName(card, (joker) => t(`napoleon.joker.${joker}`))}${marked && markedLabel ? ` (${markedLabel})` : ''}${
              highlighted && highlightedLabel ? ` (${highlightedLabel})` : ''}${
              armed && containsCard(card, [armed]) ? ` — ${t('hand.tapAgain')}` : ''}`}
            title={marked ? markedLabel : highlighted ? highlightedLabel : undefined}
          >
            <img src={napoleonCardImageUrl(card)} alt="" draggable={false} />
          </button>
        );
      })}
    </div>
  );
}
