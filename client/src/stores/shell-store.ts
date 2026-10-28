import { create } from 'zustand';
import type { GameCategory } from '@shared/games/game-definition';

interface ShellStore {
  /** Bumped by page controls that toggle the top bar's notification panel. */
  readonly notificationsRequest: number;
  readonly requestNotifications: () => void;
  /** Lobby category chosen in the top bar's tabs; null until the lobby picks its default. */
  readonly lobbyCategory: GameCategory | null;
  readonly setLobbyCategory: (category: GameCategory) => void;
  /** The desktop top bar's empty left half, where a page's `PageHeader` renders; null without that bar. */
  readonly headerSlot: HTMLElement | null;
  readonly setHeaderSlot: (slot: HTMLElement | null) => void;
}

/** Lets a page and the app shell share state without either owning the other's controls. */
export const useShellStore = create<ShellStore>((set) => ({
  notificationsRequest: 0,
  requestNotifications: () => set((state) => ({ notificationsRequest: state.notificationsRequest + 1 })),
  lobbyCategory: null,
  setLobbyCategory: (lobbyCategory) => set({ lobbyCategory }),
  headerSlot: null,
  setHeaderSlot: (headerSlot) => set({ headerSlot }),
}));
