import { afterEach, describe, expect, it } from 'vitest';
import type { GameType, PlayerInfo, RoomInfo, Seat } from '@shared/types';
import { GAME_DEFINITIONS } from '@shared/games/registry';
import { roomCompassSeats, roomPlayers } from '@shared/rules/seats';
import * as rooms from '../../src/managers/room-manager';
import * as players from '../../src/managers/player-manager';

const person = (id: string): PlayerInfo => ({
  id, username: id, nickname: id, color: '#123456', avatar: 'cat', avatarImage: null,
});
const host = person('host');
const guests = ['g1', 'g2', 'g3', 'g4', 'g5'].map(person);

type MutableDefinitions = { -readonly [K in GameType]: (typeof GAME_DEFINITIONS)[K] };
const definitions = GAME_DEFINITIONS as MutableDefinitions;
const originalLiarsDeck = definitions.liarsdeck;

let code = '';
afterEach(() => {
  rooms.removeRoom(code);
  definitions.liarsdeck = originalLiarsDeck;
});

function openRoom(gameType: GameType, members: readonly PlayerInfo[] = []): void {
  for (const member of [host, ...members]) players.attachPlayer(`socket-${member.id}`, member);
  code = rooms.createRoom(gameType, host.id);
  for (const member of members) rooms.joinRoom(code, member.id);
}

const info = (): RoomInfo => rooms.getRoomInfo(code)!;
const occupied = (): string[] => Object.keys(roomPlayers(info()));
const invalid = { success: false, reason: 'Invalid seat.' };

describe('the seats a game offers', () => {
  it('derives compass seats from the player limit', () => {
    expect(roomCompassSeats('reversi')).toEqual(['N', 'S']);
    expect(roomCompassSeats('bridge')).toEqual(['N', 'E', 'S', 'W']);
    expect(roomCompassSeats('holdem')).toEqual(['N', 'E', 'S', 'W']);
    expect(roomCompassSeats('napoleon')).toEqual(['N', 'E', 'S', 'W']);
  });
});

describe('seat paths of a two-seat game', () => {
  it('lets players sit only in the offered seats', () => {
    openRoom('reversi', guests);
    expect(rooms.changeSeat(code, host, 'E')).toEqual(invalid);
    expect(rooms.changeSeat(code, host, 'W')).toEqual(invalid);
    expect(rooms.changeSeat(code, host, 'N')).toEqual({ success: true });
    expect(rooms.changeSeat(code, guests[0], 'S')).toEqual({ success: true });
    expect(rooms.changeSeat(code, guests[1], 'S')).toEqual({ success: false, reason: 'Seat is occupied' });
    expect(rooms.getSpectatorIds(code)).toEqual(guests.slice(1).map(({ id }) => id));
  });

  it('refuses a host move or bot in a closed seat', () => {
    openRoom('reversi', guests);
    rooms.changeSeat(code, host, 'N');
    expect(rooms.movePlayer(code, host.id, guests[0], { type: 'seat', seat: 'E' })).toEqual(invalid);
    expect(rooms.movePlayer(code, host.id, guests[0], { type: 'additional', index: 0 })).toEqual(invalid);
    expect(rooms.addBot(code, host.id, 'W')).toEqual(invalid);
    expect(rooms.movePlayer(code, host.id, guests[0], { type: 'seat', seat: 'S' })).toEqual({ success: true });
    expect(occupied()).toEqual(['N', 'S']);
  });

  it('fills bots without exceeding two players and keeps a seat for a human', () => {
    openRoom('reversi');
    expect(rooms.fillBots(code, host.id)).toEqual({ success: true });
    expect(occupied()).toEqual(['N']);
    rooms.removeBot(code, host.id, 'N');
    rooms.changeSeat(code, host, 'S');
    expect(rooms.fillBots(code, host.id)).toEqual({ success: true });
    expect(occupied()).toEqual(['N', 'S']);
  });
});

describe('seat paths of a three-seat game', () => {
  it('offers N, E and S and closes W', () => {
    definitions.liarsdeck = { ...originalLiarsDeck, seats: {
      minPlayers: 3, maxPlayers: 3, flexible: true, expandable: false, numbered: false,
    } };
    openRoom('liarsdeck', guests);
    expect(roomCompassSeats('liarsdeck')).toEqual(['N', 'E', 'S']);
    expect(rooms.changeSeat(code, host, 'W')).toEqual(invalid);
    for (const [index, seat] of (['N', 'E', 'S'] as Seat[]).entries()) {
      expect(rooms.changeSeat(code, index === 0 ? host : guests[index - 1], seat)).toEqual({ success: true });
    }
    expect(rooms.movePlayer(code, host.id, guests[2], { type: 'seat', seat: 'W' })).toEqual(invalid);
    expect(rooms.addBot(code, host.id, 'W')).toEqual(invalid);
    expect(rooms.fillBots(code, host.id)).toEqual({ success: true });
    expect(occupied()).toEqual(['N', 'E', 'S']);
  });
});

describe('seat paths of four- and eight-seat games', () => {
  it('keeps all four compass seats for a four-player game', () => {
    openRoom('bridge', guests);
    for (const [index, seat] of (['N', 'E', 'S', 'W'] as Seat[]).entries()) {
      expect(rooms.changeSeat(code, index === 0 ? host : guests[index - 1], seat)).toEqual({ success: true });
    }
    expect(occupied()).toEqual(['N', 'E', 'S', 'W']);
  });

  it('keeps the four seats plus additional seats up to eight for a flexible game', () => {
    openRoom('holdem', guests);
    for (let added = 0; added < 4; added++) expect(rooms.addSeat(code, host.id)).toEqual({ success: true });
    expect(rooms.addSeat(code, host.id)).toEqual({ success: false, reason: 'Seat limit reached.' });
    expect(rooms.changeSeat(code, host, 'W')).toEqual({ success: true });
    expect(rooms.changeAdditionalSeat(code, guests[0], 0)).toEqual({ success: true });
    expect(rooms.fillBots(code, host.id)).toEqual({ success: true });
    expect(occupied()).toHaveLength(8);
  });
});

describe('switching to a game with fewer seats', () => {
  it('sends players of closed seats to spectators when no offered seat is free', () => {
    openRoom('bridge', guests);
    rooms.changeSeat(code, host, 'E');
    rooms.changeSeat(code, guests[0], 'S');
    rooms.changeSeat(code, guests[1], 'W');
    rooms.changeSeat(code, guests[2], 'N');
    rooms.setReady(code, guests[0].id, true);
    expect(rooms.setGameType(code, host.id, 'reversi')).toEqual({ success: true });
    expect(occupied()).toEqual(['N', 'S']);
    expect(info().seats.N.player?.id).toBe('g3');
    expect(info().seats.S.player?.id).toBe('g1');
    expect(info().seats.S.isReady).toBe(false);
    expect(rooms.getSpectatorIds(code).sort()).toEqual(['g2', 'g4', 'g5', 'host']);
    expect(rooms.getRoomMemberIds(code)).toHaveLength(6);
  });

  it('seats a displaced player in a free offered seat before using the spectator area', () => {
    openRoom('bridge', guests);
    rooms.changeSeat(code, host, 'W');
    rooms.changeSeat(code, guests[0], 'E');
    rooms.setGameType(code, host.id, 'reversi');
    // Seats are processed from N, so the player in E picks first.
    expect(info().seats.N.player?.id).toBe('g1');
    expect(info().seats.S.player?.id).toBe('host');
    expect(rooms.getSpectatorIds(code)).toEqual(['g2', 'g3', 'g4', 'g5']);
  });

  it('removes bots of closed seats and renames the rest', () => {
    openRoom('bridge');
    rooms.changeSeat(code, host, 'N');
    rooms.fillBots(code, host.id);
    expect(rooms.getRoomMemberIds(code)).toHaveLength(4);
    rooms.setGameType(code, host.id, 'reversi');
    expect(occupied()).toEqual(['N', 'S']);
    expect(info().seats.S.player?.nickname).toBe('Bot S');
    expect(rooms.getRoomMemberIds(code)).toHaveLength(2);
  });

  it('leaves the roster alone when the new game has at least as many seats', () => {
    openRoom('reversi');
    rooms.changeSeat(code, host, 'S');
    rooms.setGameType(code, host.id, 'bridge');
    expect(rooms.getPlayerSeat(code, host.id)).toBe('S');
  });
});

describe('restored rooms', () => {
  it('moves people out of closed seats in waiting rooms and after a running match', () => {
    openRoom('bridge', guests);
    rooms.changeSeat(code, host, 'W');
    rooms.changeSeat(code, guests[0], 'E');
    const waiting = structuredClone(rooms.exportRooms());
    waiting[0].info = { ...waiting[0].info, gameType: 'reversi' };
    const playing = structuredClone(waiting);
    playing[0].info = { ...playing[0].info, status: 'playing' };

    rooms.restoreRooms(playing);
    expect(rooms.getPlayerSeat(code, host.id)).toBe('W');
    rooms.setRoomStatus(code, 'waiting');
    expect(occupied()).toEqual(['N', 'S']);

    rooms.restoreRooms(waiting);
    expect(info().seats.N.player?.id).toBe('g1');
    expect(info().seats.S.player?.id).toBe('host');
    expect(rooms.getSpectatorIds(code)).toEqual(['g2', 'g3', 'g4', 'g5']);
  });
});
