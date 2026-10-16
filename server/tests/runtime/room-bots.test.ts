import { beforeEach, describe, expect, it } from 'vitest';
import type { PlayerInfo, Seat } from '@shared/types';
import { MAX_SPECTATORS } from '@shared/constants';
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
    expect(bot).toMatchObject({ isBot: true, nickname: 'Bot E', botDifficulty: 'hard' });
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

  it('sets independent difficulties only for waiting-room bots and clears human readiness', () => {
    const code = room();
    expect(roomManager.addBot(code, 'host', 'E', 'easy').success).toBe(true);
    roomManager.fillBots(code, 'host');
    roomManager.setReady(code, 'host', true);
    const botId = roomManager.getRoomInfo(code)!.seats.E.player!.id;
    expect(roomManager.setBotDifficulty(code, 'guest', 'E', 'hard').success).toBe(false);
    expect(roomManager.setBotDifficulty(code, 'host', 'N', 'easy').success).toBe(false);
    expect(roomManager.setBotDifficulty(code, 'host', 'E', 'easy').success).toBe(true);
    expect(roomManager.getRoomInfo(code)!.seats.N.isReady).toBe(true);
    expect(roomManager.setBotDifficulty(code, 'host', 'S', 'easy').success).toBe(true);
    const info = roomManager.getRoomInfo(code)!;
    expect(info.seats.E.player).toMatchObject({ id: botId, botDifficulty: 'easy' });
    expect(info.seats.S.player?.botDifficulty).toBe('easy');
    expect(info.seats.W.player?.botDifficulty).toBe('hard');
    expect(info.seats.N.isReady).toBe(false);
    expect(SEATS.slice(1).every((seat) => info.seats[seat].isReady)).toBe(true);
    roomManager.setRoomStatus(code, 'playing');
    expect(roomManager.setBotDifficulty(code, 'host', 'E', 'hard').success).toBe(false);
    expect(roomManager.getRoomInfo(code)!.seats.E.player?.botDifficulty).toBe('easy');
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

  it('preserves mixed difficulties and accepts legacy bots while rejecting invalid difficulty data', () => {
    const code = room();
    roomManager.fillBots(code, 'host');
    roomManager.setBotDifficulty(code, 'host', 'E', 'easy');
    const original = snapshot(code);
    expect(isRuntimeSnapshot(original)).toBe(true);
    roomManager.restoreRooms(structuredClone(original.rooms));
    expect(roomManager.getRoomInfo(code)!.seats.E.player?.botDifficulty).toBe('easy');
    const legacy = structuredClone(original);
    delete (legacy.rooms[0].info.seats.E.player as { botDifficulty?: string }).botDifficulty;
    expect(isRuntimeSnapshot(legacy)).toBe(true);
    for (const difficulty of ['medium', null, 1]) {
      const invalid = structuredClone(original);
      (invalid.rooms[0].info.seats.E.player as unknown as { botDifficulty: unknown }).botDifficulty = difficulty;
      expect(isRuntimeSnapshot(invalid)).toBe(false);
    }
    const humanDifficulty = structuredClone(original);
    humanDifficulty.players[0].info = { ...humanDifficulty.players[0].info, botDifficulty: 'easy' };
    expect(isRuntimeSnapshot(humanDifficulty)).toBe(false);
    roomManager.setRoomStatus(code, 'playing');
    gameManager.startGame(code, 'bridge', roomManager.getSeatPlayers(code)!);
    const active = snapshot(code);
    active.games = structuredClone(gameManager.exportGames());
    expect(isRuntimeSnapshot(active)).toBe(true);
    active.rooms[0].info.seats.E = { ...active.rooms[0].info.seats.E,
      player: { ...active.rooms[0].info.seats.E.player!, botDifficulty: 'hard' },
    };
    expect(isRuntimeSnapshot(active)).toBe(false);
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
    expect(state.rooms[0].memberIds).toHaveLength(4 + MAX_SPECTATORS);
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

  it('places, tunes, and removes bots in additional seats', () => {
    const code = room();
    expect(roomManager.setGameType(code, 'host', 'napoleon').success).toBe(true);
    expect(roomManager.addBot(code, 'host', 'P5').success).toBe(false);
    expect(roomManager.addSeat(code, 'host').success).toBe(true);
    expect(roomManager.addBot(code, 'host', 'P6').success).toBe(false);
    expect(roomManager.addBot(code, 'host', 'P5', 'easy').success).toBe(true);
    const bot = roomManager.getRoomInfo(code)!.additionalSeats![0];
    expect(bot).toMatchObject({ isReady: true, player: { isBot: true, nickname: 'Bot P5', botDifficulty: 'easy' } });
    expect(roomManager.addBot(code, 'host', 'P5').success).toBe(false);
    expect(roomManager.setBotDifficulty(code, 'host', 'P5', 'hard').success).toBe(true);
    expect(roomManager.getRoomInfo(code)!.additionalSeats![0].player?.botDifficulty).toBe('hard');
    expect(roomManager.getSpectatorIds(code)).not.toContain(bot.player!.id);
    expect(roomManager.canKick(code, 'host', bot.player!.id).success).toBe(false);
    expect(isRuntimeSnapshot(snapshot(code))).toBe(true);
    expect(roomManager.removeBot(code, 'host', 'P5').success).toBe(true);
    expect(roomManager.getRoomInfo(code)!.additionalSeats![0]).toEqual({ player: null, isReady: false });
    expect(roomManager.getRoomMemberIds(code)).not.toContain(bot.player!.id);
  });

  it('fills additional seats too and starts a six-seat match with bots', () => {
    const code = room();
    expect(roomManager.setGameType(code, 'host', 'napoleon').success).toBe(true);
    expect(roomManager.addSeat(code, 'host').success).toBe(true);
    expect(roomManager.addSeat(code, 'host').success).toBe(true);
    expect(roomManager.fillBots(code, 'host').success).toBe(true);
    const info = roomManager.getRoomInfo(code)!;
    expect(info.additionalSeats?.every((entry) => entry.player?.isBot && entry.isReady)).toBe(true);
    expect(Object.keys(roomManager.getSeatPlayers(code)!)).toHaveLength(6);
    expect(roomManager.setReady(code, 'host', true).success).toBe(true);
    expect(roomManager.isAllReady(code)).toBe(true);
    expect(isRuntimeSnapshot(snapshot(code))).toBe(true);
    expect(gameManager.startGame(code, 'napoleon', roomManager.getSeatPlayers(code)!).success).toBe(true);
    const game = gameManager.getGameState(code);
    expect(game?.gameType === 'napoleon' && game.players.P6?.isBot).toBe(true);
  });

  it('keeps the last configured seat open for a human when nobody is seated', () => {
    const code = roomManager.createRoom('holdem', 'host');
    expect(roomManager.addSeat(code, 'host').success).toBe(true);
    expect(roomManager.fillBots(code, 'host').success).toBe(true);
    const info = roomManager.getRoomInfo(code)!;
    expect(SEATS.every((seat) => info.seats[seat].player?.isBot)).toBe(true);
    expect(info.additionalSeats?.[0].player).toBeNull();
    expect(roomManager.addBot(code, 'host', 'P5').success).toBe(false);
  });

  it('drops bots from additional seats a new game cannot use but keeps humans in place', () => {
    const code = room();
    expect(roomManager.setGameType(code, 'host', 'holdem').success).toBe(true);
    for (let index = 0; index < 4; index++) expect(roomManager.addSeat(code, 'host').success).toBe(true);
    expect(roomManager.fillBots(code, 'host').success).toBe(true);
    const botIds = roomManager.getRoomInfo(code)!.additionalSeats!.map((entry) => entry.player!.id);
    expect(roomManager.setGameType(code, 'host', 'napoleon').success).toBe(true);
    expect(roomManager.getRoomInfo(code)!.additionalSeats?.map((entry) => entry.player?.id)).toEqual(botIds.slice(0, 2));
    expect(roomManager.getRoomMemberIds(code)).not.toContain(botIds[2]);
    expect(roomManager.setGameType(code, 'host', 'bridge').success).toBe(true);
    expect(roomManager.getRoomInfo(code)!.additionalSeats).toEqual([]);
    expect(roomManager.getRoomMemberIds(code).filter((id) => botIds.includes(id))).toEqual([]);
    expect(isRuntimeSnapshot(snapshot(code))).toBe(true);

    expect(roomManager.setGameType(code, 'host', 'holdem').success).toBe(true);
    expect(roomManager.addSeat(code, 'host').success).toBe(true);
    roomManager.joinRoom(code, 'guest');
    expect(roomManager.changeAdditionalSeat(code, player('guest'), 0).success).toBe(true);
    expect(roomManager.setGameType(code, 'host', 'bridge').success).toBe(false);
  });
});
