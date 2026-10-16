import { create } from 'zustand';
import type { MouseEvent } from 'react';

interface MessagesWindowStore {
  /** Where to go once the messages window has animated out; null while it is open. */
  closingTo: string | null;
  close: (to: string) => void;
  reset: () => void;
}

export const useMessagesWindowStore = create<MessagesWindowStore>((set) => ({
  closingTo: null,
  close: (to) => set({ closingTo: to }),
  reset: () => set({ closingTo: null }),
}));

/** Modified clicks (new tab, new window) keep normal link behaviour instead of animating the window out. */
export function closeMessagesWindow(event: MouseEvent<HTMLAnchorElement>, to: string): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  useMessagesWindowStore.getState().close(to);
}
