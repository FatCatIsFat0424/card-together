import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountProfile, MatchSummary, PlayerInfo, PlayerSnapshot, RoomInfo, RoomReplaySession } from '@shared/types';

vi.mock('../../../client/src/socket', () => ({ disconnectSocket: vi.fn() }));
vi.mock('../../../client/src/api', () => ({ apiRequest: vi.fn(), invalidateAccountRequests: vi.fn() }));

import { t } from '../../../client/src/i18n';
import {
  fallbackRoomReplayStepDuration, replayableHistory, replayStarterName, roomReplayErrorKey, roomReplayMembers,
  roomReplayPlayback, roomReplayPosition,
} from '../../../client/src/room-replay';
import { applyPlayerSnapshot } from '../../../client/src/stores/player-snapshot';
import { clearAccount, useAccountStore } from '../../../client/src/stores/account-store';
import { useRoomStore } from '../../../client/src/stores/room-store';

function player(id: string, isBot = false): PlayerInfo {
  return { id, username: id, nickname: `${id} name`, color: '#123456', avatar: 'cat', avatarImage: null, ...(isBot ? { isBot } : {}) };
}

const session: RoomReplaySession = {
  matchId: 'match-1', subjectId: 'bob', gameType: 'bigtwo', startedBy: 'carol', lastStep: 10,
  anchorStep: 2, anchorAt: 10_000, playing: true, speed: 1,
};

const room: RoomInfo = {
  code: 'ABC123', gameType: 'bridge', status: 'replaying', createdAt: 1, hostId: 'carol', abortVote: null,
  abortVoteCooldownUntil: null, replay: session,
  seats: {
    N: { player: player('alice'), isReady: false }, E: { player: player('bot:1', true), isReady: true },
    S: { player: player('carol'), isReady: false }, W: { player: null, isReady: false },
  },
  spectators: [player('dave')],
};

describe('shared room replay client helpers', () => {
  afterEach(() => { clearAccount(); vi.useRealTimers(); });

  it('derives the shared position from the server clock offset', () => {
    // Local clock runs 5 s behind the server: local 6,800 is server 11,800.
    const position = roomReplayPosition(session, 5_000, 6_800, fallbackRoomReplayStepDuration);
    expect(position).toEqual({ step: 4, finished: false, nextStepAt: 12_700 });
  });

  it('turns host controls into anchored playback from the visible position', () => {
    const mid = { step: 4, finished: false, nextStepAt: 12_700 };
    const end = { step: 10, finished: true, nextStepAt: null };
    expect(roomReplayPlayback(session, mid, { type: 'pause' })).toEqual({ step: 4, playing: false, speed: 1 });
    expect(roomReplayPlayback({ ...session, playing: false }, mid, { type: 'play' })).toEqual({ step: 4, playing: true, speed: 1 });
    expect(roomReplayPlayback(session, end, { type: 'play' })).toEqual({ step: 0, playing: true, speed: 1 });
    expect(roomReplayPlayback(session, mid, { type: 'seek', step: 99 })).toEqual({ step: 10, playing: true, speed: 1 });
    expect(roomReplayPlayback({ ...session, playing: false }, mid, { type: 'seek', step: -3 }))
      .toEqual({ step: 0, playing: false, speed: 1 });
    expect(roomReplayPlayback(session, end, { type: 'seek', step: 3 })).toEqual({ step: 3, playing: false, speed: 1 });
    expect(roomReplayPlayback(session, mid, { type: 'speed', speed: 8 })).toEqual({ step: 4, playing: true, speed: 4 });
  });

  it('lists human members host first and keeps only recorded matches', () => {
    expect(roomReplayMembers(room).map((member) => member.id)).toEqual(['carol', 'alice', 'dave']);
    const match = (id: string, hasReplay: boolean): MatchSummary => ({
      id, roomCode: 'OLD123', accountIds: ['bob'], finishedAt: 1, ...(hasReplay ? { hasReplay } : {}),
      result: { gameType: 'bigtwo', winnerSeat: 'N', penalties: { N: 0, E: 1, S: 2, W: 3 } } as unknown as MatchSummary['result'],
    });
    expect(replayableHistory({ matches: [match('a', true), match('b', false), match('c', true)], players: {} }))
      .toMatchObject({ status: 'loaded', matches: [{ id: 'a' }, { id: 'c' }] });
  });

  it('names who started the session even after they left the room', () => {
    expect(replayStarterName(room, session)).toBe('carol name');
    const left = { ...session, startedBy: 'erin' };
    expect(replayStarterName(room, left, { erin: { ...player('erin'), nickname: 'Erin' } })).toBe('Erin');
    expect(replayStarterName(room, left)).toBeNull();
  });

  it('translates replay acknowledgements in both languages and falls back to room messages', () => {
    expect(t(roomReplayErrorKey('Only the host can control the replay.'), 'zh-TW')).toBe('只有房主可以控制回放。');
    expect(t(roomReplayErrorKey('Match history is private.'), 'en')).toBe('This player\'s match history is private.');
    expect(t(roomReplayErrorKey('A replay is in progress.'), 'zh-TW')).toBe('回放進行中，請等房主結束回放。');
    expect(roomReplayErrorKey('Room not found')).toBe('room.error.notFound');
    expect(roomReplayErrorKey('Unexpected')).toBe('common.error');
    expect(t('replay.sharedStarted', 'zh-TW', { name: 'Carol' })).toBe('Carol 開始一起觀看回放');
  });

  it('records the server clock offset from replay snapshots only', () => {
    vi.useFakeTimers({ now: 100_000 });
    const account: AccountProfile = { ...player('carol'), coins: 0, tableBackground: null, tableBackgroundOpacity: 100,
      cardBack: null, cardBackOpacity: 100, matchesPublic: false, createdAt: 1, updatedAt: 1 };
    useAccountStore.getState().setAccount(account);
    const snapshot: PlayerSnapshot = { success: true, player: player('carol'), room, serverNow: 103_000 };
    applyPlayerSnapshot(snapshot);
    expect(useRoomStore.getState().replayClockOffset).toBe(3_000);
    vi.setSystemTime(200_000);
    applyPlayerSnapshot({ ...snapshot, serverNow: undefined, room: { ...room, status: 'waiting', replay: undefined } });
    expect(useRoomStore.getState().replayClockOffset).toBe(3_000);
    applyPlayerSnapshot({ success: true, player: player('carol') });
    expect(useRoomStore.getState().replayClockOffset).toBe(0);
  });
});
