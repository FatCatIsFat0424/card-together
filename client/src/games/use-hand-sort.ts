import type { GameType, NapoleonCard } from '@shared/types';
import { useHandSortStore } from '../stores/hand-sort-store';
import { sortHand } from './hand-sort';

export function useSortedHand<T extends NapoleonCard>(cards: readonly T[], game: GameType, enabled = true): readonly T[] {
  const sorting = useHandSortStore();
  return enabled && sorting.gameType === game && sorting.order ? sortHand(cards, sorting.order, game) : cards;
}
