import { create } from 'zustand';
import type { GameSeat } from '@shared/types';

interface TablePerspectiveStore {
  seat: GameSeat;
  selectSeat: (seat: GameSeat) => void;
  reset: () => void;
}

export const useTablePerspectiveStore = create<TablePerspectiveStore>((set) => ({
  seat: 'S',
  selectSeat: (seat) => set({ seat }),
  reset: () => set({ seat: 'S' }),
}));
