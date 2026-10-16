import { create } from 'zustand';
import type { GameType } from '@shared/types';

export type HandSort = 'suit' | 'rank';

interface HandSortState {
  gameType: GameType | null;
  order: HandSort | null;
  revision: number;
  sort: (gameType: GameType, order: HandSort) => void;
}

export const useHandSortStore = create<HandSortState>((set) => ({
  gameType: null, order: null, revision: 0,
  sort: (gameType, order) => set((state) => ({
    gameType, order: state.gameType === gameType && state.order === order ? null : order,
    revision: state.revision + 1,
  })),
}));
