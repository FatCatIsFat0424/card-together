import { describe, expect, it } from 'vitest';
import type { ReversiMatchResult, ReversiVisibleState } from '@shared/types';
import { NO_DRAW_OFFER } from '@shared/rules/board/match-controls';
import { rvInitialDiscs } from '@shared/rules/reversi';
import {
  reversiDiscCounts, reversiLastMove, reversiPassedSeat, reversiPieces, reversiPlacements, reversiSide, reversiTargets,
} from '../../../client/src/games/reversi/reversi-view';
import { clientGame } from '../../../client/src/games/registry';
import { confirmsMove, tapBoard } from '../../../client/src/games/board/board-input';

function game(overrides: Partial<ReversiVisibleState> = {}): ReversiVisibleState {
  return {
    gameType: 'reversi', phase: 'playing', mySeat: 'N', seats: ['N', 'S'], discs: rvInitialDiscs(), currentTurnSeat: 'N',
    drawOffer: NO_DRAW_OFFER, log: [], result: null, ...overrides,
  };
}

describe('Reversi view helpers', () => {
  it('draws one piece per disc and counts them by seat', () => {
    expect(reversiPieces(game().discs)).toHaveLength(4);
    expect(reversiDiscCounts(game())).toEqual({ N: 2, S: 2 });
    expect([reversiSide(game(), 'N'), reversiSide(game(), 'S')]).toEqual([0, 1]);
  });

  it('offers the four opening cells only to the seat on turn', () => {
    expect([...reversiTargets(game(), 'N')].sort()).toEqual(['2,4', '3,5', '4,2', '5,3']);
    expect(reversiTargets(game(), 'S')).toEqual([]);
    expect(reversiTargets(game(), null)).toEqual([]);
    expect(reversiTargets(game({ phase: 'scoring' }), 'N')).toEqual([]);
  });

  it('finds the last placement and a skipped turn, but only while the match runs', () => {
    const log = [
      { seat: 'N' as const, to: '3,5', flips: ['3,4'], timestamp: 1 },
      { seat: 'S' as const, flips: [], timestamp: 1 },
    ];
    expect(reversiLastMove(game({ log }))).toEqual({ to: '3,5' });
    expect(reversiLastMove(game())).toBeNull();
    expect(reversiPassedSeat(game({ log }))).toBe('S');
    expect(reversiPassedSeat(game({ log: log.slice(0, 1) }))).toBeNull();
    expect(reversiPassedSeat(game({ log, phase: 'scoring' }))).toBeNull();
    expect(reversiPlacements(game({ log }))).toBe(1);
  });
});

describe('Reversi board input', () => {
  const rules = { movable: [], targets: (from: string | null) => (from === null ? ['3,5', '2,4'] : []) };

  it('plays a legal cell at once with a mouse and waits for confirmation on touch', () => {
    const state = { selected: null, pending: null };
    expect(tapBoard(state, '3,5', rules, confirmsMove('mouse', false))).toMatchObject({ submit: { to: '3,5' } });
    const touched = tapBoard(state, '3,5', rules, confirmsMove('touch', false));
    expect(touched.submit).toBeNull();
    expect(touched.state.pending).toEqual({ to: '3,5' });
    // The same cell again, or the Confirm button, plays it.
    expect(tapBoard(touched.state, '3,5', rules, true).submit).toEqual({ to: '3,5' });
    // A one-tap player never sees the confirmation step.
    expect(tapBoard(state, '3,5', rules, confirmsMove('touch', true)).submit).toEqual({ to: '3,5' });
  });

  it('ignores cells that are not legal', () => {
    expect(tapBoard({ selected: null, pending: null }, '0,0', rules, false)).toEqual({
      state: { selected: null, pending: null }, submit: null,
    });
  });
});

describe('Reversi client module', () => {
  it('summarizes results for the history list', () => {
    const client = clientGame('reversi');
    const t = ((key: string) => key) as never;
    const win: ReversiMatchResult = {
      gameType: 'reversi', seats: ['N', 'S'], discs: { N: 40, S: 24 }, moves: 60, winners: ['N'], reason: 'disc-count',
    };
    expect(client.result.winners(win)).toEqual(['N']);
    expect(client.result.summary(win, 'N', t)).toMatchObject({ kind: 'winners', winners: ['N'] });
    expect(client.result.summary({ ...win, winners: [], reason: 'agreed-draw' }, 'N', t)).toMatchObject({ kind: 'text' });
  });

  it('restores a snapshot as a running game with the seat on turn', () => {
    const client = clientGame('reversi');
    const retain = <T,>(_previous: T | null, next: T): T => next;
    expect(client.restoreSnapshot(game({ currentTurnSeat: 'S' }), { state: { reversi: null } as never, retain }))
      .toMatchObject({ phase: 'playing', currentTurnSeat: 'S' });
    expect(client.restoreSnapshot(game({ phase: 'scoring' }), { state: { reversi: null } as never, retain }))
      .toMatchObject({ phase: 'scoring', currentTurnSeat: null });
  });
});
