import { scopedStore } from './scoped-store';
import type { GameSeat } from '@shared/types';

interface TablePerspectiveStore {
  seat: GameSeat;
  /** The spectator picked `seat`; until then board games show the first player's view. */
  chosen: boolean;
  selectSeat: (seat: GameSeat) => void;
  reset: () => void;
}

export const useTablePerspectiveStore = scopedStore<TablePerspectiveStore>((set) => ({
  seat: 'S',
  chosen: false,
  selectSeat: (seat) => set({ seat, chosen: true }),
  reset: () => set({ seat: 'S', chosen: false }),
}));
