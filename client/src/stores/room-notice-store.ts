import { create } from 'zustand';
import type { TranslationKey } from '../i18n';

/**
 * A brief room-wide notice, such as a passed abort vote. A mounted room header shows it in its status pill;
 * without one the app-wide toast shows it instead.
 */
interface RoomNoticeStore {
  readonly notice: { readonly id: number; readonly key: TranslationKey } | null;
  /** Room headers currently mounted. */
  readonly headers: number;
  readonly show: (key: TranslationKey) => void;
  readonly hide: (id: number) => void;
  /** Register a header; returns its release. */
  readonly attachHeader: () => () => void;
}

export const useRoomNoticeStore = create<RoomNoticeStore>((set) => ({
  notice: null,
  headers: 0,
  show: (key) => set({ notice: { id: Date.now(), key } }),
  hide: (id) => set((state) => state.notice?.id === id ? { notice: null } : state),
  attachHeader: () => {
    set((state) => ({ headers: state.headers + 1 }));
    return () => set((state) => ({ headers: Math.max(0, state.headers - 1) }));
  },
}));
