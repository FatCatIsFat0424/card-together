import { create } from 'zustand';
import type { ChatMessage } from '@shared/types';
import { readPreference, writePreference } from '../utils/preference-storage';

export type ChatMentionMode = 'sound' | 'visual' | 'off';

const MODE_KEY = 'chat.mentions.mode';
export const MENTION_SOUND_COOLDOWN_MS = 5000;

function savedMode(): ChatMentionMode {
  const value = readPreference(MODE_KEY);
  return value === 'visual' || value === 'off' ? value : 'sound';
}

interface ChatMentionState {
  mode: ChatMentionMode;
  unreadIds: readonly string[];
  notice: ChatMessage | null;
  targetMessageId: string | null;
  soundCueId: string | null;
  readerVisible: boolean;
  readerAtBottom: boolean;
  setMode: (mode: ChatMentionMode) => void;
  setReading: (visible: boolean, atBottom: boolean) => void;
  receive: (message: ChatMessage, accountId: string, foreground: boolean, now?: number) => void;
  syncHistory: (messages: readonly ChatMessage[]) => void;
  markRead: (ids: readonly string[]) => void;
  dismissNotice: (messageId: string) => void;
  requestJump: (messageId: string) => void;
  finishJump: (messageId: string) => void;
  reset: () => void;
}

const initialSession = {
  unreadIds: [] as readonly string[],
  notice: null,
  targetMessageId: null,
  soundCueId: null,
  readerVisible: false,
  readerAtBottom: false,
};

export const useChatMentionStore = create<ChatMentionState>((set, get) => {
  const knownIds = new Set<string>();
  let lastSoundAt = -Infinity;
  return {
    ...initialSession,
    mode: savedMode(),
    setMode: (mode) => {
      if (mode !== 'sound' && mode !== 'visual' && mode !== 'off') return;
      writePreference(MODE_KEY, mode);
      set(mode === 'off' ? { mode, unreadIds: [], notice: null, soundCueId: null, targetMessageId: null }
        : { mode, soundCueId: null });
    },
    setReading: (visible, atBottom) => set((state) =>
      state.readerVisible === visible && state.readerAtBottom === atBottom ? state
        : { readerVisible: visible, readerAtBottom: atBottom }),
    receive: (message, accountId, foreground, now = Date.now()) => {
      if (knownIds.has(message.id)) return;
      knownIds.add(message.id);
      const state = get();
      if (state.mode === 'off' || message.system || message.sender.id === accountId
        || !message.mentions?.some((mention) => mention.playerId === accountId)) return;
      const reading = foreground && state.readerVisible && state.readerAtBottom;
      const sound = !reading && state.mode === 'sound' && now - lastSoundAt >= MENTION_SOUND_COOLDOWN_MS;
      if (sound) lastSoundAt = now;
      set({
        unreadIds: [...state.unreadIds, message.id],
        ...(!reading && { notice: message }),
        ...(sound && { soundCueId: message.id }),
      });
    },
    syncHistory: (messages) => {
      const ids = new Set(messages.map((message) => message.id));
      for (const id of ids) knownIds.add(id);
      set((state) => {
        const unreadIds = state.unreadIds.filter((id) => ids.has(id));
        const notice = state.notice && ids.has(state.notice.id) ? state.notice : null;
        const targetMessageId = state.targetMessageId && ids.has(state.targetMessageId) ? state.targetMessageId : null;
        return unreadIds.length === state.unreadIds.length && notice === state.notice
          && targetMessageId === state.targetMessageId ? state : { unreadIds, notice, targetMessageId };
      });
    },
    markRead: (ids) => {
      if (ids.length === 0) return;
      const read = new Set(ids);
      set((state) => {
        const unreadIds = state.unreadIds.filter((id) => !read.has(id));
        const notice = state.notice && read.has(state.notice.id) ? null : state.notice;
        return unreadIds.length === state.unreadIds.length && notice === state.notice ? state : { unreadIds, notice };
      });
    },
    dismissNotice: (messageId) => set((state) => state.notice?.id === messageId ? { notice: null } : state),
    requestJump: (messageId) => set({ targetMessageId: messageId, notice: null }),
    finishJump: (messageId) => set((state) =>
      state.targetMessageId === messageId ? { targetMessageId: null } : state),
    reset: () => {
      knownIds.clear();
      lastSoundAt = -Infinity;
      set(initialSession);
    },
  };
});
