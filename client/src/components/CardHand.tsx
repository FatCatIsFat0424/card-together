// ─── CardHand 元件：手牌顯示（扇形） ───

import type { CSSProperties, ReactNode } from 'react';
import type { Card } from '@shared/types';
import { SUIT_SYMBOLS, RANK_DISPLAY } from '@shared/constants';
import { cardImageUrl } from '../cards';
import styles from './CardHand.module.css';

interface CardHandProps {
  cards: readonly Card[];
  playableCards?: readonly Card[];
  onCardClick?: (card: Card) => void;
  disabled?: boolean;
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
  cards, playableCards, onCardClick, disabled, selectedCards, markedCards, markedLabel, onCardPreview,
}: CardHandProps): ReactNode {
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
        ].filter(Boolean).join(' ');

        return (
          <button
            key={`${card.suit}-${card.rank}`}
            className={cardClasses}
            style={{ '--fan': index - middle } as CSSProperties}
            onClick={() => playable && onCardClick?.(card)}
            onPointerEnter={(event) => {
              if (event.pointerType === 'mouse' && playable && !disabled) onCardPreview?.(card);
            }}
            onPointerLeave={() => onCardPreview?.(null)}
            onFocus={() => { if (playable && !disabled) onCardPreview?.(card); }}
            onBlur={() => onCardPreview?.(null)}
            disabled={disabled || !playable}
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
