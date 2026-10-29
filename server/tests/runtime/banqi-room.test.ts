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

describe('a Banqi room', () => {
  it('fills only the second seat with a bot, which is enough to start', () => {
    players.attachPlayer('socket', human);
    code = rooms.createRoom('banqi', human.id);
    players.setPlayerRoom(human.id, code);
    expect(rooms.changeSeat(code, human, 'N')).toEqual({ success: true });
    expect(rooms.fillBots(code, human.id)).toEqual({ success: true });
    const info = rooms.getRoomInfo(code)!;
    expect(Object.keys(roomPlayers(info))).toEqual(['N', 'S']);
    expect(rooms.setReady(code, human.id, true)).toEqual({ success: true });
    expect(roomCanStart(rooms.getRoomInfo(code)!)).toBe(true);
  });

  it('starts both variants off and keeps the host choice, clearing readiness when it changes', () => {
    players.attachPlayer('socket', human);
    code = rooms.createRoom('banqi', human.id);
    players.setPlayerRoom(human.id, code);
    expect(rooms.getRoomInfo(code)?.gameOptions?.banqi).toEqual({ chain: false, rookDash: false });
    rooms.changeSeat(code, human, 'N');
    rooms.setReady(code, human.id, true);
    expect(rooms.setGameOptions(code, human.id, { gameType: 'banqi', options: { chain: true, rookDash: false } }))
      .toEqual({ success: true });
    expect(rooms.getRoomInfo(code)?.gameOptions?.banqi).toEqual({ chain: true, rookDash: false });
    expect(rooms.setGameOptions(code, human.id, { gameType: 'banqi', options: { chain: true } } as never))
      .toMatchObject({ success: false });
  });
});
