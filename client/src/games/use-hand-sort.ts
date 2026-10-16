import { useState } from 'react';
import type { GameType } from '@shared/types';
import { reconcileOrder } from '../components/card-hand-order';
import { useHandSortStore } from '../stores/hand-sort-store';
import { sameHandCard, sortHand } from './hand-sort';
import type { SortableCard } from './hand-sort';

export function useSortedHand<T extends SortableCard>(incoming: readonly T[], game: GameType | null, enabled = true): {
  cards: readonly T[]; canReorder: boolean; reorder: (cards: readonly T[]) => void;
} {
  const sorting = useHandSortStore();
  const mode = enabled && sorting.gameType === game ? sorting.order : null;
  const [saved, setSaved] = useState({ game, mode, cards: [] as readonly T[] });
  let order = saved;
  if (saved.game !== game || saved.mode !== mode) {
    // Turning sorting off freezes the displayed order as the starting manual order.
    order = { game, mode, cards: saved.game === game && saved.mode && !mode && game
      ? sortHand(incoming, saved.mode, game) : [] };
    setSaved(order);
  }
  const cards = mode && game ? sortHand(incoming, mode, game) : reconcileOrder(incoming, order.cards, sameHandCard);
  return { cards, canReorder: enabled && !mode, reorder: (next) => setSaved({ game, mode, cards: next }) };
}
