import { describe, expect, it } from 'vitest';
import type { DirectMessage } from '@shared/types/direct-message';
import { GROUP_GAP_MS, groupDirectMessages, groupTimeLabel } from '../../../client/src/messages/message-groups';

function message(id: string, sender: string, timestamp: number): DirectMessage {
  return { id, clientId: `client-${id}`, recipientId: sender === 'me' ? 'you' : 'me', content: id, timestamp,
    sender: { id: sender, username: sender, nickname: sender, color: '#2563eb', avatar: 'cat', avatarImage: null, avatarBorder: null } };
}

describe('direct message groups', () => {
  it('groups consecutive messages from one sender', () => {
    const groups = groupDirectMessages([message('a', 'you', 0), message('b', 'you', 1000), message('c', 'me', 2000),
      message('d', 'you', 3000)], 'me');
    expect(groups.map((group) => group.messages.map((entry) => entry.id))).toEqual([['a', 'b'], ['c'], ['d']]);
    expect(groups.map((group) => group.own)).toEqual([false, true, false]);
    expect(groups.map((group) => group.key)).toEqual(['a', 'c', 'd']);
  });

  it('starts a new group after a long pause, but not at exactly the limit', () => {
    const base = message('a', 'you', 0);
    expect(groupDirectMessages([base, message('b', 'you', GROUP_GAP_MS)], 'me')).toHaveLength(1);
    expect(groupDirectMessages([base, message('b', 'you', GROUP_GAP_MS + 1)], 'me')).toHaveLength(2);
  });

  it('returns nothing for an empty conversation', () => {
    expect(groupDirectMessages([], 'me')).toEqual([]);
  });
});

describe('group time label', () => {
  const now = new Date(2026, 9, 28, 15, 0).getTime();
  it('shows only the time for today and adds the date for earlier groups', () => {
    const today = groupTimeLabel(new Date(2026, 9, 28, 9, 5).getTime(), 'en', now);
    const earlier = groupTimeLabel(new Date(2026, 9, 27, 21, 10).getTime(), 'en', now);
    expect(today).toMatch(/9:05/);
    expect(today).not.toMatch(/10\/28/);
    expect(earlier).toMatch(/10\/27/);
    expect(earlier).toMatch(/9:10/);
  });
});
