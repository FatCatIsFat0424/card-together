import { afterEach, describe, expect, it } from 'vitest';
import { matchStanding } from '@shared/rules/match-standing';
import { gameFacts } from '@shared/stats/registry';
import { STATS_RECORDS } from '@shared/stats/definitions';
import type { GameSeat, PlayerInfo, ReplaySnapshot, ReversiMatchResult } from '@shared/types';
import * as reversi from '../../src/managers/games/reversi-game';

const CODE = 'REVST1';
const player = (seat: GameSeat): PlayerInfo => ({
  id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
});

afterEach(() => reversi.abortGame(CODE));

function result(overrides: Partial<ReversiMatchResult> = {}): ReversiMatchResult {
  return { gameType: 'reversi', seats: ['N', 'S'], discs: { N: 40, S: 24 }, moves: 60, winners: ['N'], reason: 'disc-count',
    ...overrides };
}

describe('Reversi statistics', () => {
  it('declares its special records at version 1', () => {
    expect(STATS_RECORDS.reversi.map((record) => [record.id, record.source, record.kind, record.version])).toEqual([
      ['topDiscs', 'result', 'max', 1], ['wipeouts', 'result', 'count', 1], ['corners', 'log', 'count', 1],
      ['biggestFlip', 'log', 'max', 1],
    ]);
  });

  it('records the final disc total and wipeouts from the result', () => {
    expect(gameFacts('reversi', result(), 'N', null)).toMatchObject({ values: { topDiscs: 40 }, counts: {} });
    expect(gameFacts('reversi', result({ discs: { N: 12, S: 0 }, moves: 8 }), 'N', null).counts).toEqual({ wipeouts: 1 });
    // Only the winner gets credit for a wipeout.
    expect(gameFacts('reversi', result({ discs: { N: 12, S: 0 }, winners: ['N'] }), 'S', null).counts).toEqual({});
  });

  it('counts corners taken and the biggest flip from the public log', () => {
    reversi.startGame(CODE, { N: player('N'), S: player('S') }, 1_000);
    const game = reversi.getGameState(CODE)!;
    game.log.push(
      { seat: 'N', to: '0,0', flips: ['1,0', '2,0', '3,0'], timestamp: 1 },
      { seat: 'S', to: '3,3', flips: ['3,4'], timestamp: 2 },
      { seat: 'N', to: '7,7', flips: ['6,6'], timestamp: 3 },
      { seat: 'S', flips: [], timestamp: 4 },
    );
    const frame = reversi.getPlayerVisibleState(CODE, 'N') as unknown as ReplaySnapshot;
    expect(gameFacts('reversi', result(), 'N', frame)).toMatchObject({ counts: { corners: 2 }, values: { biggestFlip: 3 } });
    expect(gameFacts('reversi', result(), 'S', frame)).toMatchObject({ counts: {}, values: { biggestFlip: 1 } });
  });

  it('ranks a win first, a loss second, and a draw first for both with a tie', () => {
    expect(matchStanding(result(), 'N')).toMatchObject({ rank: 1, won: true, tied: false, players: 2 });
    expect(matchStanding(result(), 'S')).toMatchObject({ rank: 2, won: false, tied: false });
    const draw = result({ discs: { N: 32, S: 32 }, winners: [] });
    expect(matchStanding(draw, 'N')).toMatchObject({ rank: 1, won: true, tied: true });
    expect(matchStanding(draw, 'S')).toMatchObject({ rank: 1, won: true, tied: true });
    expect(matchStanding(draw, 'E')).toBeNull();
  });
});
