import { useState } from 'react';
import type { GameType } from '@shared/types';
import { reconcileOrder } from '../components/card-hand-order';
import { useGameStore } from '../stores/game-store';
import { handArrangement, useHandSortStore } from '../stores/hand-sort-store';
import type { HandSort } from '../stores/hand-sort-store';
import { sameHandCard, sortHand } from './hand-sort';
import type { SortableCard } from './hand-sort';
import { clientGame } from './registry';

/** The viewer's sort for a game and whether they have rearranged the hand by hand since. */
export function useHandArrangement(game: GameType | null): { readonly order: HandSort; readonly manual: boolean } | null {
  const gameType = useHandSortStore((state) => state.gameType);
  const order = useHandSortStore((state) => state.order);
  const manual = useHandSortStore((state) => state.manual);
  return game ? handArrangement({ gameType, order, manual }, game, clientGame(game).handSort.initial) : null;
}

/**
 * The hand is always sorted by suit or rank. Dragging a card keeps the arrangement on screen as a manual order;
 * cards dealt afterwards join it in sorted order. `enabled` false (spectators) shows the cards as received.
 */
export function useSortedHand<T extends SortableCard>(incoming: readonly T[], game: GameType | null, enabled = true): {
  cards: readonly T[]; canReorder: boolean; reorder: (cards: readonly T[]) => void;
} {
  const arrange = useHandSortStore((state) => state.arrange);
  const trump = useGameStore((state) => game === 'napoleon' ? state.napoleon?.contract?.suit ?? null : null);
  const arrangement = useHandArrangement(game);
  const active = enabled && game && arrangement ? arrangement : null;
  // Without a game type (no table yet) the hand can still be arranged by hand.
  const mode: HandSort | 'manual' | null = !enabled ? null : !active || active.manual ? 'manual' : active.order;
  const [saved, setSaved] = useState({ game, mode, cards: [] as readonly T[] });
  let order = saved;
  if (saved.game !== game || saved.mode !== mode) {
    // Another hand switched to a manual arrangement: start from the sorted order on screen.
    order = { game, mode, cards: saved.game === game && mode === 'manual' && saved.mode && saved.mode !== 'manual' && game
      ? sortHand(incoming, saved.mode, game, trump) : [] };
    setSaved(order);
  }
  const sorted = active && game ? sortHand(incoming, active.order, game, trump) : incoming;
  const cards = mode === 'manual' ? reconcileOrder(sorted, order.cards, sameHandCard) : sorted;
  return {
    cards,
    canReorder: enabled,
    reorder: (next) => {
      setSaved({ game, mode: 'manual', cards: next });
      if (active && game && !active.manual) arrange(game, active.order);
    },
  };
}
