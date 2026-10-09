// ─── Chat Store ───

import { create } from 'zustand';
import type { ChatMessage } from '@shared/types';
import { retainSnapshotValue } from './snapshot-equality';

interface ChatStoreState {
  messages: ChatMessage[];
}

interface ChatStoreActions {
  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (message: ChatMessage) => void;
  clearMessages: () => void;
}

export const useChatStore = create<ChatStoreState & ChatStoreActions>((set) => ({
  messages: [],
  setMessages: (messages) => set((state) => {
    const nextMessages = retainSnapshotValue(state.messages, messages);
    return nextMessages === state.messages ? state : { messages: nextMessages };
  }),
  // Deltas can overlap a resume snapshot that already contains the message.
  addMessage: (message) => set((state) => state.messages.some((existing) => existing.id === message.id)
    ? state : { messages: [...state.messages, message] }),
  clearMessages: () => set((state) => state.messages.length === 0 ? state : { messages: [] }),
}));
