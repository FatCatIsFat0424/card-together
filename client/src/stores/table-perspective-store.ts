import { create } from 'zustand';
import type { Seat } from '@shared/types';

interface TablePerspectiveStore {
  seat: Seat;
  selectSeat: (seat: Seat) => void;
  reset: () => void;
}

export const useTablePerspectiveStore = create<TablePerspectiveStore>((set) => ({
  seat: 'S',
  selectSeat: (seat) => set({ seat }),
  reset: () => set({ seat: 'S' }),
}));
