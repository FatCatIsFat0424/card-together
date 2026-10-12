import { describe, expect, it } from 'vitest';
import type { DirectMessage } from '@shared/types/direct-message';
import { latestIncomingMessageId, mergeDirectMessages } from '../../../client/src/messages/message-history';

const PEER = {
  id: 'alice', username: 'alice', nickname: 'Alice', color: '#123456', avatar: 'cat', avatarImage: null,
} as const;
const NOW = Date.now();

function message(id: string, timestamp = NOW, senderId = 'alice'): DirectMessage {
  return {
    id, clientId: `client-${id}`, sender: { ...PEER, id: senderId },
    recipientId: senderId === 'alice' ? 'bob' : 'alice', timestamp, content: id,
  };
}

describe('direct message history ordering', () => {
  it('preserves insertion order and the latest incoming cursor for equal timestamps', () => {
    const messages = mergeDirectMessages([], [message('z-first'), message('a-second')], 'after', NOW);
    expect(messages.map((entry) => entry.id)).toEqual(['z-first', 'a-second']);
    expect(latestIncomingMessageId(messages, 'bob', 'alice')).toBe('a-second');
  });

  it('prepends an older page without changing the newest equal-timestamp cursor', () => {
    const current = [message('a-second'), message('m-third')];
    const messages = mergeDirectMessages(current, [message('z-first'), message('a-second')], 'before', NOW);
    expect(messages.map((entry) => entry.id)).toEqual(['z-first', 'a-second', 'm-third']);
    expect(latestIncomingMessageId(messages, 'bob', 'alice')).toBe('m-third');
    expect(current.map((entry) => entry.id)).toEqual(['a-second', 'm-third']);
  });

  it('uses authoritative latest-page ordering after optimistic sends and overlap', () => {
    const messages = mergeDirectMessages([message('b-outgoing', NOW, 'bob')],
      [message('z-first'), message('b-outgoing', NOW, 'bob'), message('a-last')], 'after', NOW);
    expect(messages.map((entry) => entry.id)).toEqual(['z-first', 'b-outgoing', 'a-last']);
    expect(latestIncomingMessageId(messages, 'bob', 'alice')).toBe('a-last');
  });

  it('ignores outgoing messages and filters locally retained expired history', () => {
    const messages = mergeDirectMessages([message('expired', NOW - 90 * 24 * 60 * 60_000)],
      [message('incoming'), message('outgoing', NOW, 'bob')], 'after', NOW);
    expect(messages.map((entry) => entry.id)).toEqual(['incoming', 'outgoing']);
    expect(latestIncomingMessageId(messages, 'bob', 'alice')).toBe('incoming');
    expect(latestIncomingMessageId([message('outgoing', NOW, 'bob')], 'bob', 'alice')).toBeUndefined();
  });
});
