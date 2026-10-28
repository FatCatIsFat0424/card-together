import { describe, expect, it } from 'vitest';
import type { DirectMessage } from '@shared/types/direct-message';
import {
  GROUP_GAP_MS, groupDirectMessages, groupTimeLabel, messageDay, startsNewDay,
} from '../../../client/src/messages/message-groups';

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

describe('group time label and day separators', () => {
  const now = new Date(2026, 9, 28, 15, 0).getTime();

  it('shows only the time on groups', () => {
    const label = groupTimeLabel(new Date(2026, 9, 27, 21, 10).getTime(), 'en');
    expect(label).toMatch(/9:10/);
    expect(label).not.toMatch(/10\/27/);
  });

  it('names today, yesterday, and earlier dates, adding the year only when it differs', () => {
    expect(messageDay(new Date(2026, 9, 28, 0, 1).getTime(), 'zh-TW', now)).toEqual({ kind: 'today' });
    expect(messageDay(new Date(2026, 9, 27, 23, 59).getTime(), 'zh-TW', now)).toEqual({ kind: 'yesterday' });
    expect(messageDay(new Date(2026, 9, 26, 12).getTime(), 'zh-TW', now)).toEqual({ kind: 'date', label: '10月26日' });
    expect(messageDay(new Date(2025, 9, 26, 12).getTime(), 'zh-TW', now)).toEqual({ kind: 'date', label: '2025年10月26日' });
  });

  it('splits a run at midnight and marks where each day starts', () => {
    const late = new Date(2026, 9, 27, 23, 59).getTime();
    const groups = groupDirectMessages([message('a', 'you', late), message('b', 'you', late + 2 * 60_000)], 'me');
    expect(groups).toHaveLength(2);
    expect(startsNewDay(groups[0], undefined)).toBe(true);
    expect(startsNewDay(groups[1], groups[0])).toBe(true);
    const same = groupDirectMessages([message('a', 'you', late - GROUP_GAP_MS * 2), message('b', 'me', late)], 'me');
    expect(startsNewDay(same[1], same[0])).toBe(false);
  });
});
