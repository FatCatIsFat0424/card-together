import { describe, expect, it } from 'vitest';
import type { PlayerInfo, SeatMap } from '@shared/types';
import { t } from '../../../client/src/i18n';
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

  it('should fill every occurrence of a placeholder in the flexible-seat progress', () => {
    expect(t('room.progressFlexible', 'en', { seated: '2', ready: '1' })).toBe('2/4 seated · 1/2 ready');
    expect(t('room.progressFlexible', 'zh-TW', { seated: '3', ready: '3' })).toBe('3/4 就座 · 3/3 準備');
  });

  it('should count unread chat only while the panel is hidden', () => {
    expect(unreadCount(5, 3, false)).toBe(2);
    expect(unreadCount(5, 3, true)).toBe(0);
    expect(unreadCount(2, 4, false)).toBe(0);
  });
});
