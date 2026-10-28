import { create } from 'zustand';
import type { GameType } from '@shared/types';

export type HandSort = 'suit' | 'rank';

interface HandSortState {
  /** Game the choice below belongs to; other games use their own default sort. */
  gameType: GameType | null;
  /** Sort the player picked for `gameType` */
  order: HandSort | null;
  /** The player dragged cards, so the hand keeps their arrangement instead of re-sorting. */
  manual: boolean;
  /** Re-pressing the active order keeps it; it also leaves a manual arrangement. */
  sort: (gameType: GameType, order: HandSort) => void;
  /** Keeps the dragged arrangement; `from` is the sort it started from. */
  arrange: (gameType: GameType, from: HandSort) => void;
}

export const useHandSortStore = create<HandSortState>((set) => ({
  gameType: null, order: null, manual: false,
  sort: (gameType, order) => set({ gameType, order, manual: false }),
  arrange: (gameType, from) => set({ gameType, order: from, manual: true }),
}));

/** The sort a game's hand follows, and whether the player has rearranged it by hand since. */
export function handArrangement(
  state: Pick<HandSortState, 'gameType' | 'order' | 'manual'>, gameType: GameType, initial: HandSort,
): { readonly order: HandSort; readonly manual: boolean } {
  const own = state.gameType === gameType;
  return { order: own && state.order ? state.order : initial, manual: own && state.manual };
}
