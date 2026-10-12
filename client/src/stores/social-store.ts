import { create } from 'zustand';
import type { SocialOverview } from '@shared/types/direct-message';
import { apiRequest } from '../api';

export interface SocialNotice {
  readonly id: string;
  readonly kind: 'incoming' | 'accepted' | 'message';
  readonly nickname: string;
  readonly accountId: string;
}

interface SocialStore extends SocialOverview {
  accountId: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string;
  revision: number;
  notices: SocialNotice[];
  initialize: (accountId: string) => void;
  refresh: () => Promise<void>;
  dismissAccepted: (ids: readonly string[]) => Promise<boolean>;
  markRead: (otherId: string, messageId: string) => Promise<boolean>;
  dismissNotice: (id: string) => void;
  reset: () => void;
}

let generation = 0;
let refreshSequence = 0;
const emptyOverview: SocialOverview = { incoming: [], accepted: [], conversations: [] };

export function socialUnreadCount(overview: SocialOverview): number {
  return overview.incoming.length + overview.accepted.length
    + overview.conversations.reduce((total, conversation) => total + conversation.unreadCount, 0);
}

function newNotices(previous: SocialOverview, next: SocialOverview): SocialNotice[] {
  const incoming = new Set(previous.incoming.map((request) => request.id));
  const accepted = new Set(previous.accepted.map((notice) => notice.id));
  const messages = new Map(previous.conversations.map((conversation) =>
    [conversation.account.id, conversation.lastMessage.id]));
  return [
    ...next.incoming.filter((request) => !incoming.has(request.id)).map((request): SocialNotice => ({
      id: `incoming:${request.id}`, kind: 'incoming', nickname: request.requester.nickname,
      accountId: request.requester.id,
    })),
    ...next.accepted.filter((notice) => !accepted.has(notice.id)).map((notice): SocialNotice => ({
      id: `accepted:${notice.id}`, kind: 'accepted', nickname: notice.account.nickname,
      accountId: notice.account.id,
    })),
    ...next.conversations.filter((conversation) => conversation.unreadCount > 0
      && messages.get(conversation.account.id) !== conversation.lastMessage.id
      && conversation.lastMessage.sender.id === conversation.account.id)
      .map((conversation): SocialNotice => ({
        id: `message:${conversation.lastMessage.id}`, kind: 'message',
        nickname: conversation.account.nickname, accountId: conversation.account.id,
      })),
  ];
}

export const useSocialStore = create<SocialStore>((set, get) => ({
  ...emptyOverview, accountId: null, status: 'idle', error: '', revision: 0, notices: [],
  initialize: (accountId) => {
    if (get().accountId === accountId) return;
    generation += 1;
    refreshSequence += 1;
    set({ ...emptyOverview, accountId, status: 'idle', error: '', revision: 0, notices: [] });
  },
  refresh: async () => {
    if (!get().accountId) return;
    const requestGeneration = generation;
    const sequence = ++refreshSequence;
    set((state) => ({ status: state.status === 'idle' ? 'loading' : state.status, error: '' }));
    const result = await apiRequest<SocialOverview>('/api/messages');
    if (requestGeneration !== generation || sequence !== refreshSequence) return;
    if (!result.success) { set({ status: 'error', error: result.error }); return; }
    set((state) => ({
      incoming: result.incoming, accepted: result.accepted, conversations: result.conversations,
      status: 'ready', error: '', revision: state.revision + 1,
      notices: state.revision === 0 ? [] : [...state.notices, ...newNotices(state, result)].slice(-3),
    }));
  },
  dismissAccepted: async (ids) => {
    if (!get().accountId || ids.length === 0) return false;
    const requestGeneration = generation;
    const result = await apiRequest('/api/messages/notifications/read', 'POST', { ids });
    if (requestGeneration !== generation) return false;
    if (!result.success) { set({ error: result.error }); return false; }
    await get().refresh();
    return requestGeneration === generation;
  },
  markRead: async (otherId, messageId) => {
    if (!get().accountId) return false;
    const requestGeneration = generation;
    const result = await apiRequest(`/api/messages/${encodeURIComponent(otherId)}/read`, 'POST', { messageId });
    if (requestGeneration !== generation) return false;
    if (!result.success) { set({ error: result.error }); return false; }
    await get().refresh();
    return requestGeneration === generation;
  },
  dismissNotice: (id) => set((state) => ({ notices: state.notices.filter((notice) => notice.id !== id) })),
  reset: () => {
    generation += 1;
    refreshSequence += 1;
    set({ ...emptyOverview, accountId: null, status: 'idle', error: '', revision: 0, notices: [] });
  },
}));
