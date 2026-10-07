import { beforeEach, describe, expect, it } from 'vitest';
import { ABORT_VOTE_COOLDOWN_MS, ABORT_VOTE_DURATION_MS } from '@shared/constants';
import type { PlayerInfo, Seat } from '@shared/types';
import * as roomManager from '../../src/managers/room-manager';

const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
const IDS = ['a', 'b', 'c', 'd'];
const NOW = 1_000_000;

function player(id: string): PlayerInfo {
  return { id, username: id, nickname: id, color: '#123456', avatar: 'cat', avatarImage: null };
}

function seatedRoom(): string {
  const code = roomManager.createRoom('bridge', IDS[0]);
  IDS.forEach((id, index) => {
    expect(roomManager.joinRoom(code, id).success).toBe(true);
    expect(roomManager.changeSeat(code, player(id), SEATS[index]).success).toBe(true);
  });
  return code;
}

function playingRoom(): string {
  const code = seatedRoom();
  roomManager.setRoomStatus(code, 'playing');
  return code;
}

describe('room host and game type', () => {
  beforeEach(() => roomManager.restoreRooms([]));

  it('should make the creator host and pass it on in join order', () => {
    const code = seatedRoom();
    expect(roomManager.getRoomInfo(code)?.hostId).toBe('a');
    roomManager.leaveRoom(code, 'c');
    expect(roomManager.getRoomInfo(code)?.hostId).toBe('a');
    roomManager.leaveRoom(code, 'a');
    expect(roomManager.getRoomInfo(code)?.hostId).toBe('b');
    roomManager.leaveRoom(code, 'b');
    expect(roomManager.getRoomInfo(code)?.hostId).toBe('d');
  });

  it('should let only the host change the game type while waiting and reset ready', () => {
    const code = seatedRoom();
    roomManager.setReady(code, 'b', true);
    expect(roomManager.setGameType(code, 'b', 'bigtwo').success).toBe(false);
    expect(roomManager.setGameType(code, 'a', 'bigtwo').success).toBe(true);
    const info = roomManager.getRoomInfo(code)!;
    expect(info.gameType).toBe('bigtwo');
    expect(SEATS.every((seat) => !info.seats[seat].isReady)).toBe(true);
    roomManager.setRoomStatus(code, 'playing');
    expect(roomManager.setGameType(code, 'a', 'bridge').success).toBe(false);
  });
});

describe('vote to abort', () => {
  beforeEach(() => roomManager.restoreRooms([]));

  it('should only start for seated players in a playing room', () => {
    const code = seatedRoom();
    expect(roomManager.startAbortVote(code, 'a', NOW).success).toBe(false);
    roomManager.setRoomStatus(code, 'playing');
    expect(roomManager.startAbortVote(code, 'stranger', NOW).success).toBe(false);
    expect(roomManager.startAbortVote(code, 'a', NOW).success).toBe(true);
    expect(roomManager.getRoomInfo(code)).toMatchObject({
      abortVote: { startedBy: 'a', startedAt: NOW, expiresAt: NOW + ABORT_VOTE_DURATION_MS, yes: ['a'], no: [] },
      abortVoteCooldownUntil: NOW + ABORT_VOTE_COOLDOWN_MS,
    });
  });

  it('should block a second vote while active and during the cooldown', () => {
    const code = playingRoom();
    roomManager.startAbortVote(code, 'a', NOW);
    expect(roomManager.startAbortVote(code, 'b', NOW + 1)).toEqual({
      success: false, reason: 'A vote is already in progress.',
    });
    expect(roomManager.castAbortVote(code, 'b', false, NOW + 1)).toEqual({ success: true, outcome: 'pending' });
    expect(roomManager.castAbortVote(code, 'c', false, NOW + 2)).toEqual({ success: true, outcome: 'failed' });
    expect(roomManager.getRoomInfo(code)?.abortVote).toBeNull();
    expect(roomManager.startAbortVote(code, 'b', NOW + ABORT_VOTE_COOLDOWN_MS - 1).success).toBe(false);
    expect(roomManager.startAbortVote(code, 'b', NOW + ABORT_VOTE_COOLDOWN_MS).success).toBe(true);
  });

  it('should reject double votes and pass at three yes votes', () => {
    const code = playingRoom();
    roomManager.startAbortVote(code, 'a', NOW);
    expect(roomManager.castAbortVote(code, 'a', true, NOW).success).toBe(false);
    expect(roomManager.castAbortVote(code, 'b', true, NOW)).toEqual({ success: true, outcome: 'pending' });
    expect(roomManager.castAbortVote(code, 'b', false, NOW).success).toBe(false);
    expect(roomManager.castAbortVote(code, 'stranger', true, NOW).success).toBe(false);
    expect(roomManager.castAbortVote(code, 'c', true, NOW)).toEqual({ success: true, outcome: 'passed' });
    expect(roomManager.getRoomInfo(code)).toMatchObject({ abortVote: null, abortVoteCooldownUntil: null });
    roomManager.setRoomStatus(code, 'waiting');
    roomManager.setRoomStatus(code, 'playing');
    expect(roomManager.startAbortVote(code, 'b', NOW + 1)).toEqual({ success: true, outcome: 'pending' });
    expect(roomManager.getRoomInfo(code)?.abortVoteCooldownUntil).toBe(NOW + 1 + ABORT_VOTE_COOLDOWN_MS);
  });

  it('should expire a vote at its deadline and keep the cooldown', () => {
    const code = playingRoom();
    roomManager.startAbortVote(code, 'a', NOW);
    const deadline = NOW + ABORT_VOTE_DURATION_MS;
    expect(roomManager.hasExpiredAbortVote(deadline - 1)).toBe(false);
    expect(roomManager.expireAbortVotes(deadline - 1)).toEqual([]);
    expect(roomManager.castAbortVote(code, 'b', true, deadline).success).toBe(false);
    expect(roomManager.hasExpiredAbortVote(deadline)).toBe(true);
    expect(roomManager.expireAbortVotes(deadline)).toEqual([{ code, startedBy: 'a' }]);
    expect(roomManager.getRoomInfo(code)).toMatchObject({
      abortVote: null, abortVoteCooldownUntil: NOW + ABORT_VOTE_COOLDOWN_MS,
    });
  });

  it('should clear an active vote when the room stops playing', () => {
    const code = playingRoom();
    roomManager.startAbortVote(code, 'a', NOW);
    roomManager.setRoomStatus(code, 'waiting');
    expect(roomManager.getRoomInfo(code)?.abortVote).toBeNull();
  });
});
