import { afterEach, describe, expect, it } from 'vitest';
import { matchStanding } from '@shared/rules/match-standing';
import { gameFacts } from '@shared/stats/registry';
import { STATS_RECORDS } from '@shared/stats/definitions';
import type { GameSeat, JungleMatchResult, PlayerInfo, ReplaySnapshot } from '@shared/types';
import * as jungle from '../../src/managers/games/jungle-game';

const CODE = 'JUNST1';
const player = (seat: GameSeat): PlayerInfo => ({
  id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
});

afterEach(() => jungle.abortGame(CODE));

function result(overrides: Partial<JungleMatchResult> = {}): JungleMatchResult {
  return { gameType: 'jungle', seats: ['N', 'S'], pieces: { N: 5, S: 0 }, moves: 60, winners: ['N'], reason: 'all-captured',
    ...overrides };
}

describe('Jungle statistics', () => {
  it('declares its special records at version 1', () => {
    expect(STATS_RECORDS.jungle.map((record) => [record.id, record.source, record.kind, record.version])).toEqual([
      ['denWins', 'result', 'count', 1], ['topCaptures', 'log', 'max', 1], ['ratSlays', 'log', 'count', 1],
      ['jumps', 'log', 'count', 1],
    ]);
  });

  it('counts a den victory for the winner only', () => {
    const den = result({ reason: 'den-entered', pieces: { N: 3, S: 4 } });
    expect(gameFacts('jungle', den, 'N', null).counts).toEqual({ denWins: 1 });
    expect(gameFacts('jungle', den, 'S', null).counts).toEqual({});
    expect(gameFacts('jungle', result(), 'N', null).counts).toEqual({});
  });

  it('counts captures, rat takes elephant, and river jumps from the public log', () => {
    jungle.startGame(CODE, { N: player('N'), S: player('S') }, 1_000);
    const game = jungle.getGameState(CODE)!;
    game.log.push(
      { seat: 'N', from: '1,2', to: '1,6', piece: 7, capture: false, timestamp: 1 },
      { seat: 'S', from: '3,3', to: '3,4', piece: 4, capture: true, captured: 2, timestamp: 2 },
      { seat: 'N', from: '3,4', to: '3,3', piece: 1, capture: true, captured: 8, timestamp: 3 },
      { seat: 'N', from: '0,3', to: '3,3', piece: 6, capture: true, captured: 3, timestamp: 4 },
      { seat: 'N', from: '2,2', to: '2,1', piece: 5, capture: false, timestamp: 5 },
    );
    const frame = jungle.getPlayerVisibleState(CODE, 'N') as unknown as ReplaySnapshot;
    expect(gameFacts('jungle', result(), 'N', frame)).toMatchObject({ counts: { jumps: 2, ratSlays: 1 }, values: { topCaptures: 2 } });
    expect(gameFacts('jungle', result(), 'S', frame)).toMatchObject({ counts: {}, values: { topCaptures: 1 } });
  });

  it('ranks a win first, a loss second, and a draw first for both with a tie', () => {
    expect(matchStanding(result(), 'N')).toMatchObject({ rank: 1, won: true, tied: false, players: 2 });
    expect(matchStanding(result(), 'S')).toMatchObject({ rank: 2, won: false, tied: false });
    const draw = result({ pieces: { N: 3, S: 3 }, winners: [], reason: 'no-capture-limit' });
    expect(matchStanding(draw, 'N')).toMatchObject({ rank: 1, won: true, tied: true });
    expect(matchStanding(draw, 'S')).toMatchObject({ rank: 1, won: true, tied: true });
    expect(matchStanding(draw, 'E')).toBeNull();
  });
});
