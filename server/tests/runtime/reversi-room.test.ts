import { afterEach, describe, expect, it } from 'vitest';
import type { PlayerInfo } from '@shared/types';
import { roomCanStart, roomPlayers } from '@shared/rules/seats';
import * as games from '../../src/managers/game-manager';
import * as players from '../../src/managers/player-manager';
import * as rooms from '../../src/managers/room-manager';

const human: PlayerInfo = {
  id: 'human', username: 'human', nickname: 'Human', color: '#123456', avatar: 'cat', avatarImage: null,
};

let code = '';

afterEach(() => {
  games.removeGame(code);
  rooms.removeRoom(code);
});

describe('a two-player room', () => {
  it('fills only the second seat with a bot, which is enough to start', () => {
    players.attachPlayer('socket', human);
    code = rooms.createRoom('reversi', human.id);
    players.setPlayerRoom(human.id, code);
    expect(rooms.changeSeat(code, human, 'N')).toEqual({ success: true });
    expect(rooms.fillBots(code, human.id)).toEqual({ success: true });
    const info = rooms.getRoomInfo(code)!;
    expect(Object.keys(roomPlayers(info))).toEqual(['N', 'E']);
    expect(info.seats.S.player).toBeNull();
    expect(info.seats.W.player).toBeNull();
    expect(rooms.setReady(code, human.id, true)).toEqual({ success: true });
    expect(roomCanStart(rooms.getRoomInfo(code)!)).toBe(true);
  });

  it('still fills all four seats for a four-player game', () => {
    players.attachPlayer('socket', human);
    code = rooms.createRoom('bridge', human.id);
    players.setPlayerRoom(human.id, code);
    rooms.changeSeat(code, human, 'N');
    rooms.fillBots(code, human.id);
    expect(Object.keys(roomPlayers(rooms.getRoomInfo(code)!))).toHaveLength(4);
  });
});
