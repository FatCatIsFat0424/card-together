import { create } from 'zustand';
import type { GameCategory } from '@shared/games/game-definition';

interface ShellStore {
  /** Bumped by page controls that toggle the notification panel. */
  readonly notificationsRequest: number;
  readonly requestNotifications: () => void;
  /** Lobby category chosen in the lobby's tabs; null until the lobby picks its default. */
  readonly lobbyCategory: GameCategory | null;
  readonly setLobbyCategory: (category: GameCategory) => void;
}

/** Lets a page and the app shell share state without either owning the other's controls. */
export const useShellStore = create<ShellStore>((set) => ({
  notificationsRequest: 0,
  requestNotifications: () => set((state) => ({ notificationsRequest: state.notificationsRequest + 1 })),
  lobbyCategory: null,
  setLobbyCategory: (lobbyCategory) => set({ lobbyCategory }),
}));
