import { describe, expect, it } from 'vitest';
import type { FriendEntry, FriendRoomPresence } from '@shared/types';
import {
  formatFriendSeenAgo, friendActivityText, friendStatsText,
} from '../../../client/src/components/friend-activity-text';
import {
  canEnterFriendRoom, friendAction, friendActivity, friendGroups,
} from '../../../client/src/components/lobby-friend-activity';

const NOW = Date.UTC(2026, 9, 18, 12);
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function room(overrides: Partial<FriendRoomPresence> = {}): FriendRoomPresence {
  return { code: 'ABC123', gameType: 'bigtwo', status: 'waiting', players: 2, seats: 4, hosting: true,
    joinable: true, spectatable: false, ...overrides };
}

function friend(overrides: Partial<FriendEntry> = {}): FriendEntry {
  return { id: 'ken', username: 'fr_ken', nickname: 'Ken', color: '#123456', avatar: 'cat', avatarImage: null,
    online: true, inRoom: false, hostedRoomCode: null, room: null, lastSeenAt: null, ...overrides };
}

describe('friend last seen', () => {
  it.each([
    [0, '剛剛上線', 'Online just now'],
    [MINUTE_MS, '1 分鐘前上線', 'Online 1 minute ago'],
    [3 * HOUR_MS, '3 小時前上線', 'Online 3 hours ago'],
    [30 * DAY_MS, '30 天前上線', 'Online 30 days ago'],
    [30 * DAY_MS + 1, '超過 30 天前上線', 'Online over 30 days ago'],
  ])('formats %i ms in both languages without exact dates', (elapsed, chinese, english) => {
    expect(formatFriendSeenAgo(NOW - elapsed, 'zh-TW', NOW)).toBe(chinese);
    expect(formatFriendSeenAgo(NOW - elapsed, 'en', NOW)).toBe(english);
  });

  it.each([null, NaN, -1, 1.5])('hides unknown or invalid history (%s)', (value) => {
    expect(formatFriendSeenAgo(value, 'zh-TW', NOW)).toBeNull();
    expect(friendActivityText(friend({ online: false, lastSeenAt: value }), 'zh-TW', NOW)).toBeNull();
  });

  it('treats a time ahead of the client clock as just now', () => {
    expect(formatFriendSeenAgo(NOW + HOUR_MS, 'zh-TW', NOW)).toBe('剛剛上線');
  });
});

describe('friend activity', () => {
  it('describes waiting rooms, matches, replays, the lobby and offline friends', () => {
    expect(friendActivityText(friend({ room: room() }), 'zh-TW', NOW)).toEqual({
      kind: 'waiting', title: '等待中 · 大老二', detail: 'Ken 是房主 · 2/4 人', short: '等待中 · 大老二 2/4',
    });
    expect(friendActivityText(friend({ room: room({ hosting: false }) }), 'zh-TW', NOW)?.detail).toBe('2/4 人');
    expect(friendActivityText(friend({ room: room({ gameType: 'bridge', status: 'playing', players: 4,
      joinable: false, spectatable: true }) }), 'zh-TW', NOW)).toEqual({
      kind: 'playing', title: '正在玩 橋牌', detail: '對局中 · 4/4 人 · 可旁觀', short: '正在玩 橋牌 · 可旁觀',
    });
    expect(friendActivityText(friend({ room: room({ status: 'playing', joinable: false }) }), 'en', NOW)).toMatchObject({
      title: 'Playing Big Two', detail: 'In a match · 2/4 players', short: 'Playing Big Two',
    });
    expect(friendActivityText(friend({ room: room({ status: 'replaying', joinable: false, spectatable: true }) }), 'zh-TW', NOW))
      .toMatchObject({ kind: 'replaying', title: '觀看重播 · 大老二' });
    expect(friendActivityText(friend(), 'zh-TW', NOW)).toEqual({ kind: 'lobby', title: '在大廳', detail: '線上 · 閒置中', short: '在大廳' });
    expect(friendActivityText(friend({ online: false, lastSeenAt: NOW - 3 * HOUR_MS }), 'zh-TW', NOW))
      .toEqual({ kind: 'offline', title: '3 小時前上線', detail: '', short: '3 小時前上線' });
  });

  it('offers join, spectate or invite, never for offline friends or the viewer’s own room', () => {
    expect(friendActivity(friend({ online: false, room: room() }))).toBeNull();
    expect(friendAction(friend({ room: room() }), null)).toBe('join');
    expect(friendAction(friend({ room: room() }), 'OTHER1')).toBe('join');
    expect(friendAction(friend({ room: room() }), 'ABC123')).toBeNull();
    expect(friendAction(friend({ room: room({ status: 'playing', joinable: false, spectatable: true }) }), null)).toBe('spectate');
    expect(friendAction(friend({ room: room({ joinable: false }) }), null)).toBeNull();
    expect(friendAction(friend(), 'OTHER1')).toBe('invite');
    expect(friendAction(friend(), null)).toBeNull();
    expect(friendAction(friend({ online: false }), 'OTHER1')).toBeNull();
    expect(canEnterFriendRoom(friend({ room: room({ joinable: false, spectatable: true }) }))).toBe(true);
    expect(canEnterFriendRoom(friend({ room: room({ joinable: false }) }))).toBe(false);
  });

  it('summarizes shared play and hides the line until statistics load', () => {
    expect(friendStatsText(undefined, 'zh-TW')).toBeNull();
    expect(friendStatsText({ together: 12, favoriteGame: 'bigtwo' }, 'zh-TW')).toEqual(['一起玩過 12 場', '最常玩 大老二']);
    expect(friendStatsText({ together: 0, favoriteGame: null }, 'zh-TW')).toEqual(['還沒一起玩過']);
  });

  it('groups online friends before offline ones and keeps their order', () => {
    const list = [friend({ id: 'a', online: false }), friend({ id: 'b' }), friend({ id: 'c', online: false }), friend({ id: 'd' })];
    const groups = friendGroups(list);
    expect(groups.online.map(({ id }) => id)).toEqual(['b', 'd']);
    expect(groups.offline.map(({ id }) => id)).toEqual(['a', 'c']);
  });
});
