import { create } from 'zustand';

interface ShellStore {
  /** Bumped by page controls that toggle the top bar's notification panel. */
  readonly notificationsRequest: number;
  readonly requestNotifications: () => void;
}

/** Lets a page ask the app shell to toggle one of its panels without owning the panel. */
export const useShellStore = create<ShellStore>((set) => ({
  notificationsRequest: 0,
  requestNotifications: () => set((state) => ({ notificationsRequest: state.notificationsRequest + 1 })),
}));
