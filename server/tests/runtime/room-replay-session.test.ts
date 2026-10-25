import { beforeEach, describe, expect, it } from 'vitest';
import type { PlayerInfo, RoomInfo, Seat } from '@shared/types';
import { roomCanStart } from '@shared/rules/seats';
import * as roomManager from '../../src/managers/room-manager';
import { isRuntimeSnapshot } from '../../src/runtime/validate';
import type { RuntimeSnapshot } from '../../src/runtime/types';

const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
const IDS = ['a', 'b', 'c', 'd'];
const NOW = 1_000_000;
const SOURCE = { matchId: 'match-1', subjectId: 'a', gameType: 'bigtwo', lastStep: 12 } as const;

function player(id: string): PlayerInfo {
  return { id, username: id, nickname: id, color: '#123456', avatar: 'cat', avatarImage: null };
}

/** Three seated members, one spectator, everyone ready. */
function replayingRoom(): string {
  const code = roomManager.createRoom('bridge', IDS[0]);
  IDS.forEach((id, index) => {
    expect(roomManager.joinRoom(code, id).success).toBe(true);
    if (index < 3) {
      expect(roomManager.changeSeat(code, player(id), SEATS[index]).success).toBe(true);
      expect(roomManager.setReady(code, id, true).success).toBe(true);
    }
  });
  expect(roomManager.startReplay(code, 'a', SOURCE, NOW)).toEqual({ success: true });
  return code;
}

function snapshot(info: RoomInfo, memberIds: readonly string[]): RuntimeSnapshot {
  return {
    players: memberIds.map((id) => ({ info: player(id), currentRoomCode: info.code, disconnectedAt: null })),
    rooms: [{ info, memberIds: [...memberIds] }], games: [], chat: [{ roomCode: info.code, messages: [] }],
  };
}

describe('room replay session', () => {
  beforeEach(() => roomManager.restoreRooms([]));

  it('starts only for the host of a waiting room and anchors playback at the first step', () => {
    const code = roomManager.createRoom('bridge', 'a');
    roomManager.joinRoom(code, 'b');
    expect(roomManager.startReplay(code, 'b', SOURCE, NOW)).toEqual({
      success: false, reason: 'Only the host can control the replay.',
    });
    roomManager.setRoomStatus(code, 'playing');
    expect(roomManager.startReplay(code, 'a', SOURCE, NOW)).toEqual({
      success: false, reason: 'Replays start from the waiting room.',
    });
    roomManager.setRoomStatus(code, 'waiting');
    expect(roomManager.startReplay(code, 'a', SOURCE, NOW)).toEqual({ success: true });
    expect(roomManager.getRoomInfo(code)).toMatchObject({
      status: 'replaying', gameType: 'bridge', abortVote: null,
      replay: { ...SOURCE, startedBy: 'a', anchorStep: 0, anchorAt: NOW, playing: true, speed: 1 },
    });
    expect(roomManager.startReplay(code, 'a', SOURCE, NOW)).toMatchObject({ success: false });
  });

  it('locks seats, readiness, bots, settings, and starting like a match in progress', () => {
    const code = replayingRoom();
    const before = structuredClone(roomManager.getRoomInfo(code));
    const results = [
      roomManager.changeSeat(code, player('d'), 'W'),
      roomManager.changeAdditionalSeat(code, player('d'), 0),
      roomManager.standUp(code, 'b'),
      roomManager.movePlayer(code, 'a', player('d'), { type: 'seat', seat: 'W' }),
      roomManager.setReady(code, 'b', false),
      roomManager.addBot(code, 'a', 'W'),
      roomManager.fillBots(code, 'a'),
      roomManager.setGameType(code, 'a', 'bigtwo'),
      roomManager.setTimeControl(code, 'a', { baseSeconds: 60, bankSeconds: 60 }),
      roomManager.setShuffleSeats(code, 'a', true),
      roomManager.addSeat(code, 'a'),
      roomManager.canKick(code, 'a', 'b'),
      roomManager.startAbortVote(code, 'a', NOW),
    ];
    expect(results.every((result) => !result.success)).toBe(true);
    expect(roomCanStart(roomManager.getRoomInfo(code)!)).toBe(false);
    expect(roomManager.getRoomInfo(code)).toEqual(before);
    // Spectators can still be removed and anyone may join to watch.
    expect(roomManager.canKick(code, 'a', 'd')).toEqual({ success: true });
    expect(roomManager.joinRoom(code, 'late')).toEqual({ success: true });
  });

  it('lets only the current host control or end playback, and host transfer keeps the session', () => {
    const code = replayingRoom();
    const playback = { step: 5, playing: false, speed: 2 };
    expect(roomManager.controlReplay(code, 'b', playback, NOW + 10)).toEqual({
      success: false, reason: 'Only the host can control the replay.',
    });
    expect(roomManager.controlReplay(code, 'a', { ...playback, step: 13 }, NOW + 10)).toEqual({
      success: false, reason: 'Invalid replay position.',
    });
    expect(roomManager.controlReplay(code, 'a', playback, NOW + 10)).toEqual({ success: true });
    expect(roomManager.getRoomInfo(code)?.replay).toMatchObject({ anchorStep: 5, anchorAt: NOW + 10, playing: false, speed: 2 });
    roomManager.leaveRoom(code, 'a');
    const info = roomManager.getRoomInfo(code)!;
    expect(info).toMatchObject({ hostId: 'b', status: 'replaying', replay: { startedBy: 'a', anchorStep: 5 } });
    expect(roomManager.controlReplay(code, 'a', playback, NOW + 20)).toMatchObject({ success: false });
    expect(roomManager.endReplay(code, 'c')).toMatchObject({ success: false });
    expect(roomManager.controlReplay(code, 'b', { step: 12, playing: true, speed: 0.5 }, NOW + 20)).toEqual({ success: true });
    expect(roomManager.endReplay(code, 'b')).toEqual({ success: true });
    const ended = roomManager.getRoomInfo(code)!;
    expect(ended.status).toBe('waiting');
    expect('replay' in ended).toBe(false);
    expect(roomManager.endReplay(code, 'b')).toEqual({ success: false, reason: 'No replay in progress.' });
  });

  it('keeps readiness through the replay but asks flexible tables to confirm after a seated member leaves', () => {
    const code = replayingRoom();
    expect(roomManager.endReplay(code, 'a')).toEqual({ success: true });
    expect(SEATS.slice(0, 3).every((seat) => roomManager.getRoomInfo(code)!.seats[seat].isReady)).toBe(true);
    const flexible = roomManager.createRoom('holdem', 'a');
    for (const [index, id] of IDS.slice(0, 3).entries()) {
      roomManager.joinRoom(flexible, id);
      roomManager.changeSeat(flexible, player(id), SEATS[index]);
      roomManager.setReady(flexible, id, true);
    }
    roomManager.startReplay(flexible, 'a', SOURCE, NOW);
    roomManager.leaveRoom(flexible, 'c');
    expect(roomManager.getRoomInfo(flexible)!.seats.N.isReady).toBe(false);
  });

  it('ends with the room when its last human leaves', () => {
    const code = replayingRoom();
    for (const id of IDS) roomManager.leaveRoom(code, id);
    expect(roomManager.getRoomInfo(code)).toBeNull();
  });

  it('starting a match status clears any session so the two states never mix', () => {
    const code = replayingRoom();
    roomManager.setRoomStatus(code, 'playing');
    expect(roomManager.getRoomInfo(code)?.replay).toBeUndefined();
  });

  it('persists the session in runtime snapshots and rejects inconsistent ones', () => {
    const code = replayingRoom();
    const [room] = roomManager.exportRooms();
    const valid = snapshot(room.info, room.memberIds);
    expect(isRuntimeSnapshot(structuredClone(valid))).toBe(true);
    roomManager.restoreRooms(structuredClone(valid.rooms));
    expect(roomManager.getRoomInfo(code)?.replay).toEqual(room.info.replay);
    const { replay, ...withoutReplay } = room.info;
    for (const info of [
      withoutReplay,
      { ...room.info, status: 'waiting' },
      { ...room.info, replay: { ...replay!, anchorStep: replay!.lastStep + 1 } },
      { ...room.info, replay: { ...replay!, speed: 8 } },
      { ...room.info, replay: { ...replay!, matchId: '../match' } },
      { ...room.info, replay: { ...replay!, extra: true } },
    ]) {
      expect(isRuntimeSnapshot(snapshot(info as RoomInfo, room.memberIds))).toBe(false);
    }
  });
});
