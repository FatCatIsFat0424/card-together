import { beforeEach, describe, expect, it } from 'vitest';
import type { PlayerInfo, Seat } from '@shared/types';
import { MAX_ROOM_MEMBERS, MAX_SPECTATORS } from '@shared/constants';
import * as roomManager from '../../src/managers/room-manager';
import * as gameManager from '../../src/managers/game-manager';
import { isRuntimeSnapshot } from '../../src/runtime/validate';
import type { RuntimeSnapshot } from '../../src/runtime/types';

const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];

function player(id: string): PlayerInfo {
  return { id, username: id, nickname: id, color: '#123456', avatar: 'cat', avatarImage: null };
}

function room(): string {
  const code = roomManager.createRoom('bridge', 'host');
  roomManager.changeSeat(code, player('host'), 'N');
  return code;
}

function snapshot(code: string): RuntimeSnapshot {
  return {
    players: [{ info: player('host'), currentRoomCode: code, disconnectedAt: null }],
    rooms: structuredClone(roomManager.exportRooms()), games: [], chat: [],
  };
}

describe('room bots', () => {
  beforeEach(() => {
    roomManager.restoreRooms([]);
    gameManager.restoreGames([]);
  });

  it('should let only the waiting room host add and remove bots', () => {
    const code = room();
    expect(roomManager.addBot(code, 'guest', 'E').success).toBe(false);
    expect(roomManager.addBot(code, 'host', 'N').success).toBe(false);
    expect(roomManager.addBot(code, 'host', 'E').success).toBe(true);
    const bot = roomManager.getRoomInfo(code)!.seats.E.player!;
    expect(bot).toMatchObject({ isBot: true, nickname: 'Bot E' });
    expect(bot.id).toMatch(/^bot:[0-9a-f-]{36}$/);
    expect(roomManager.getRoomMemberIds(code)).toContain(bot.id);
    expect(roomManager.getRoomInfo(code)!.seats.E.isReady).toBe(true);
    expect(roomManager.removeBot(code, 'guest', 'E').success).toBe(false);
    expect(roomManager.removeBot(code, 'host', 'N').success).toBe(false);
    roomManager.setRoomStatus(code, 'playing');
    expect(roomManager.addBot(code, 'host', 'S').success).toBe(false);
    expect(roomManager.removeBot(code, 'host', 'E').success).toBe(false);
    expect(roomManager.fillBots(code, 'host').success).toBe(false);
    roomManager.setRoomStatus(code, 'waiting');
    expect(roomManager.removeBot(code, 'host', 'E').success).toBe(true);
    expect(roomManager.getRoomInfo(code)!.seats.E).toEqual({ player: null, isReady: false });
    expect(roomManager.getRoomMemberIds(code)).not.toContain(bot.id);
  });

  it('should fill every empty seat and keep unseated humans as spectators', () => {
    const code = room();
    roomManager.joinRoom(code, 'guest');
    expect(roomManager.fillBots(code, 'host').success).toBe(true);
    expect(roomManager.getRoomMemberIds(code)).toHaveLength(5);
    expect(SEATS.slice(1).every((seat) => roomManager.getRoomInfo(code)!.seats[seat].player?.isBot)).toBe(true);
    expect(roomManager.getSpectatorIds(code)).toEqual(['guest']);
    expect(roomManager.changeSeat(code, player('guest'), 'W').success).toBe(false);
    expect(roomManager.removeBot(code, 'host', 'W').success).toBe(true);
    expect(roomManager.changeSeat(code, player('guest'), 'W').success).toBe(true);
    expect(roomManager.getSpectatorIds(code)).toEqual([]);
  });

  it('should cap spectators, admit them during a match, and let seated players stand up', () => {
    const code = room();
    for (let index = 0; index < MAX_SPECTATORS; index += 1) {
      expect(roomManager.joinRoom(code, `watcher-${index}`).success).toBe(true);
    }
    expect(roomManager.joinRoom(code, 'stranger')).toEqual({ success: false, reason: 'Room is full' });
    expect(roomManager.standUp(code, 'host')).toEqual({ success: false, reason: 'The spectator area is full.' });
    expect(roomManager.changeSeat(code, player('watcher-0'), 'E').success).toBe(true);
    expect(roomManager.joinRoom(code, 'stranger').success).toBe(true);
    expect(roomManager.standUp(code, 'watcher-0').success).toBe(false);
    expect(roomManager.leaveRoom(code, 'watcher-7').roomEmpty).toBe(false);
    expect(roomManager.standUp(code, 'watcher-0').success).toBe(true);
    expect(roomManager.getRoomInfo(code)!.seats.E.player).toBeNull();
    roomManager.leaveRoom(code, 'stranger');
    roomManager.setRoomStatus(code, 'playing');
    expect(roomManager.joinRoom(code, 'latecomer').success).toBe(true);
    expect(roomManager.standUp(code, 'host').success).toBe(false);
    expect(roomManager.canKick(code, 'host', 'latecomer').success).toBe(true);
    expect(roomManager.canKick(code, 'host', 'host').success).toBe(false);
  });

  it('should keep bots ready across game changes and readiness resets', () => {
    const code = room();
    roomManager.fillBots(code, 'host');
    roomManager.setReady(code, 'host', true);
    expect(roomManager.isAllReady(code)).toBe(true);
    roomManager.setGameType(code, 'host', 'bigtwo');
    expect(roomManager.isAllReady(code)).toBe(false);
    expect(roomManager.getRoomInfo(code)!.seats.N.isReady).toBe(false);
    expect(SEATS.slice(1).every((seat) => roomManager.getRoomInfo(code)!.seats[seat].isReady)).toBe(true);
  });

  it('should pass host ownership only to humans and delete rooms after the last human leaves', () => {
    const code = room();
    roomManager.addBot(code, 'host', 'E');
    roomManager.joinRoom(code, 'guest');
    roomManager.changeSeat(code, player('guest'), 'S');
    roomManager.fillBots(code, 'host');
    expect(roomManager.leaveRoom(code, 'host').roomEmpty).toBe(false);
    expect(roomManager.getRoomInfo(code)!.hostId).toBe('guest');
    expect(roomManager.leaveRoom(code, 'guest').roomEmpty).toBe(true);
    expect(roomManager.getRoomInfo(code)).toBeNull();
  });

  it('should let only the waiting room host remove other human members', () => {
    const code = room();
    roomManager.joinRoom(code, 'guest');
    roomManager.changeSeat(code, player('guest'), 'S');
    roomManager.addBot(code, 'host', 'E');
    const botId = roomManager.getRoomInfo(code)!.seats.E.player!.id;
    expect(roomManager.canKick(code, 'guest', 'host').success).toBe(false);
    expect(roomManager.canKick(code, 'host', 'host').success).toBe(false);
    expect(roomManager.canKick(code, 'host', botId).success).toBe(false);
    expect(roomManager.canKick(code, 'host', 'stranger').success).toBe(false);
    expect(roomManager.canKick(code, 'host', 'guest')).toEqual({ success: true });
    roomManager.setRoomStatus(code, 'playing');
    expect(roomManager.canKick(code, 'host', 'guest').success).toBe(false);
  });

  it('should allow human votes to end games without votes from bots', () => {
    const solo = room();
    roomManager.fillBots(solo, 'host');
    roomManager.setRoomStatus(solo, 'playing');
    const botId = roomManager.getRoomInfo(solo)!.seats.E.player!.id;
    expect(roomManager.startAbortVote(solo, botId, 1_000).success).toBe(false);
    expect(roomManager.startAbortVote(solo, 'host', 1_000)).toEqual({ success: true, outcome: 'passed' });
    expect(roomManager.getRoomInfo(solo)!.abortVote).toBeNull();
    expect(roomManager.getRoomInfo(solo)!.abortVoteCooldownUntil).toBeNull();

    const duo = room();
    roomManager.joinRoom(duo, 'guest');
    roomManager.changeSeat(duo, player('guest'), 'S');
    roomManager.fillBots(duo, 'host');
    roomManager.setRoomStatus(duo, 'playing');
    expect(roomManager.startAbortVote(duo, 'host', 1_000)).toEqual({ success: true, outcome: 'pending' });
    expect(roomManager.castAbortVote(duo, roomManager.getRoomInfo(duo)!.seats.E.player!.id, true, 1_000).success)
      .toBe(false);
    expect(roomManager.castAbortVote(duo, 'guest', true, 1_000)).toEqual({ success: true, outcome: 'passed' });
    expect(roomManager.getRoomInfo(duo)!.abortVoteCooldownUntil).toBeNull();
  });
});

describe('persisted bot identities', () => {
  beforeEach(() => {
    roomManager.restoreRooms([]);
    gameManager.restoreGames([]);
  });

  it('should accept seated ready bots without account player records', () => {
    const code = room();
    roomManager.fillBots(code, 'host');
    expect(isRuntimeSnapshot(snapshot(code))).toBe(true);
    const players = roomManager.getSeatPlayers(code)!;
    roomManager.setRoomStatus(code, 'playing');
    expect(gameManager.startGame(code, 'bridge', players).success).toBe(true);
    const active = snapshot(code);
    active.games = structuredClone(gameManager.exportGames());
    expect(isRuntimeSnapshot(active)).toBe(true);
  });

  it('should persist full spectator areas, spectator returns, and observer chat', () => {
    const code = room();
    roomManager.fillBots(code, 'host');
    const watchers = Array.from({ length: MAX_SPECTATORS }, (_, index) => `watcher-${index}`);
    for (const id of watchers) expect(roomManager.joinRoom(code, id).success).toBe(true);
    const state = snapshot(code);
    state.players.push(...watchers.map((id) => ({ info: player(id), currentRoomCode: code, disconnectedAt: null })));
    state.chat = [{ roomCode: code, messages: [
      { id: 'm1', sender: player('watcher-0'), content: 'psst', timestamp: 1, audience: 'observers' },
    ] }];
    expect(state.rooms[0].memberIds).toHaveLength(MAX_ROOM_MEMBERS);
    expect(isRuntimeSnapshot(state)).toBe(true);

    const active = structuredClone(state);
    const players = roomManager.getSeatPlayers(code)!;
    expect(gameManager.startGame(code, 'bridge', players).success).toBe(true);
    const game = structuredClone(gameManager.exportGames()[0]);
    active.rooms[0].info = { ...active.rooms[0].info, status: 'playing' };
    active.games = [game];
    expect(isRuntimeSnapshot(active)).toBe(true);
    // Only a finished board records returned spectators.
    active.games = [{ ...game, returnedViewers: ['watcher-0'] }];
    expect(isRuntimeSnapshot(active)).toBe(false);

    const crowded = structuredClone(state);
    crowded.rooms[0].memberIds.push('stranger');
    crowded.players.push({ info: player('stranger'), currentRoomCode: code, disconnectedAt: null });
    expect(isRuntimeSnapshot(crowded)).toBe(false);
    const whisper = structuredClone(state);
    (whisper.chat[0].messages[0] as { audience: string }).audience = 'players';
    expect(isRuntimeSnapshot(whisper)).toBe(false);
  });

  it('should reject fake bot flags, bot accounts, bot hosts and unseated or unready bots', () => {
    const code = room();
    roomManager.fillBots(code, 'host');
    const original = snapshot(code);
    const mutations: ((state: RuntimeSnapshot) => void)[] = [
      (state) => { state.players[0].info = { ...state.players[0].info, isBot: true }; },
      (state) => {
        state.players.push({ info: state.rooms[0].info.seats.E.player!, currentRoomCode: code, disconnectedAt: null });
      },
      (state) => { state.rooms[0].info = { ...state.rooms[0].info, hostId: state.rooms[0].info.seats.E.player!.id }; },
      (state) => {
        state.rooms[0].info.seats.E = { player: null, isReady: false };
      },
      (state) => { state.rooms[0].info.seats.E = { ...state.rooms[0].info.seats.E, isReady: false }; },
      (state) => {
        state.rooms[0].info.seats.E = {
          ...state.rooms[0].info.seats.E, player: { ...state.rooms[0].info.seats.E.player!, isBot: false },
        };
      },
    ];
    for (const mutate of mutations) {
      const modified = structuredClone(original);
      mutate(modified);
      expect(isRuntimeSnapshot(modified)).toBe(false);
    }
  });
});
