import { describe, expect, it } from 'vitest';
import { formatChatTime } from '../../../client/src/components/chat-time';

describe('room chat time', () => {
  it('should format local time with padded fields', () => {
    expect(formatChatTime(new Date(2026, 9, 14, 16, 47, 59).getTime())).toBe('2026/10/14 16:47');
    expect(formatChatTime(new Date(2026, 0, 5, 9, 3).getTime())).toBe('2026/01/05 09:03');
  });
});
