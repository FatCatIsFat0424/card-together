import { describe, expect, it, vi } from 'vitest';
import type { AcceptedFriendNotification, IncomingFriendNotification } from '@shared/types/direct-message';

vi.mock('../../../client/src/api', () => ({ apiRequest: vi.fn() }));
vi.mock('../../../client/src/socket', () => ({ socket: {} }));
vi.mock('../../../client/src/deployment', () => ({ API_BASE_URL: '', APP_BASE_PATH: '/' }));

import { notificationGroups, notificationTime } from '../../../client/src/components/NotificationPanel';
import { matchesConversation } from '../../../client/src/components/MessageConversations';

const BOB = { id: 'bob', username: 'fr_bob', nickname: 'Bob', color: '#123456', avatar: 'cat', avatarImage: null } as const;
const NOW = new Date(2026, 9, 28, 15, 0).getTime();
const MINUTE_MS = 60_000;

function incoming(id: string, createdAt: number, readAt: number | null = null): IncomingFriendNotification {
  return { id, requester: BOB, recipient: { ...BOB, id: 'me' }, createdAt, readAt };
}

function accepted(id: string, createdAt: number, readAt: number | null = null): AcceptedFriendNotification {
  return { id, account: BOB, createdAt, readAt };
}

describe('notification panel', () => {
  it('merges requests and accepted notices newest first, split into today and earlier', () => {
    const groups = notificationGroups(
      [incoming('request', NOW - 2 * MINUTE_MS), incoming('old-request', new Date(2026, 9, 20).getTime(), 5)],
      [accepted('ken', NOW - 15 * MINUTE_MS), accepted('morning', new Date(2026, 9, 28, 0, 5).getTime(), 9),
        accepted('yesterday', new Date(2026, 9, 27, 23, 55).getTime())],
      NOW,
    );
    expect(groups.today.map((entry) => `${entry.kind}:${entry.id}`)).toEqual(['incoming:request', 'accepted:ken', 'accepted:morning']);
    expect(groups.earlier.map((entry) => entry.id)).toEqual(['yesterday', 'old-request']);
    expect(groups.earlier[1].readAt).toBe(5);
  });

  it('shows minutes within the hour, the time later today, and the date before today', () => {
    expect(notificationTime(NOW - 2 * MINUTE_MS, 'zh-TW', NOW)).toBe('2 分鐘前');
    expect(notificationTime(NOW - 10_000, 'en', NOW)).toBe('1 minute ago');
    expect(notificationTime(new Date(2026, 9, 28, 9, 5).getTime(), 'en', NOW)).toMatch(/9:05/);
    expect(notificationTime(new Date(2026, 9, 25, 9, 5).getTime(), 'zh-TW', NOW)).toBe('10月25日');
  });
});

describe('conversation search', () => {
  const entry = {
    account: BOB,
    conversation: { account: BOB, canSend: true, unreadCount: 0, lastMessage: { id: 'm', clientId: 'c', sender: BOB,
      recipientId: 'me', content: 'See you on Saturday', timestamp: NOW } },
  };

  it('matches nickname, username or the last message, ignoring case', () => {
    expect(matchesConversation(entry, '')).toBe(true);
    expect(matchesConversation(entry, 'bob')).toBe(true);
    expect(matchesConversation(entry, 'FR_')).toBe(true);
    expect(matchesConversation(entry, 'saturday')).toBe(true);
    expect(matchesConversation(entry, 'sunday')).toBe(false);
    expect(matchesConversation({ account: BOB, conversation: null }, 'saturday')).toBe(false);
  });
});
