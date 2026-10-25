import { scopedStore } from './scoped-store';
import type { GameSeat } from '@shared/types';

interface TablePerspectiveStore {
  seat: GameSeat;
  selectSeat: (seat: GameSeat) => void;
  reset: () => void;
}

export const useTablePerspectiveStore = scopedStore<TablePerspectiveStore>((set) => ({
  seat: 'S',
  selectSeat: (seat) => set({ seat }),
  reset: () => set({ seat: 'S' }),
}));
