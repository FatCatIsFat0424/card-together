import { describe, expect, it } from 'vitest';
import type { PlayerInfo, SeatMap } from '@shared/types';
import { roomProgress, unreadCount } from '../../../client/src/pages/room-progress';

const player = (id: string, isBot = false): PlayerInfo => ({
  id, username: id, nickname: id, color: '#4a9eff', avatar: 'cat', avatarImage: null, ...(isBot && { isBot }),
});

describe('room progress', () => {
  it('should count seated players and ready seats, treating bots as ready', () => {
    const seats: SeatMap = {
      N: { player: player('a'), isReady: true },
      E: { player: player('bot', true), isReady: false },
      S: { player: player('b'), isReady: false },
      W: { player: null, isReady: false },
    };
    expect(roomProgress(seats)).toEqual({ seated: 3, ready: 2 });
  });

  it('should report an empty room', () => {
    const empty = { player: null, isReady: false };
    expect(roomProgress({ N: empty, E: empty, S: empty, W: empty })).toEqual({ seated: 0, ready: 0 });
  });

  it('should count unread chat only while the panel is hidden', () => {
    expect(unreadCount(5, 3, false)).toBe(2);
    expect(unreadCount(5, 3, true)).toBe(0);
    expect(unreadCount(2, 4, false)).toBe(0);
  });
});
