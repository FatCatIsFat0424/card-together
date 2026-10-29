import { describe, expect, it } from 'vitest';
import {
  CC_BOARD, CC_HOLES, CC_HOME_DISTANCE, CC_TIP_DISTANCE, CC_TRIANGLES, ccApply, ccArrived, ccCorners, ccDestinations,
  ccFindMove, ccFinished, ccHasMove, ccIndex, ccInitialHoles, ccMoves, ccNode, ccRanks, ccRemaining, ccTarget, isCcHoles,
} from '@shared/rules/chinesecheckers';
import type { CcHole } from '@shared/rules/chinesecheckers';
import { STAR_CORNERS } from '@shared/rules/board/boards';
import { playerCountAllowed } from '@shared/rules/seats';
import { parseGameAction } from '@shared/games/actions';

/** A board with marbles at the given node ids (`col,row`), keyed by owner corner. */
function board(marbles: Readonly<Record<string, number>>): CcHole[] {
  const holes: CcHole[] = new Array<CcHole>(CC_HOLES).fill(null);
  for (const [node, corner] of Object.entries(marbles)) holes[ccIndex(node)!] = corner;
  return holes;
}

const at = (node: string): number => ccIndex(node)!;
const reach = (holes: readonly CcHole[], from: string): string[] => ccDestinations(holes, at(from)).map((d) => ccNode(d.to)).sort();

describe('Chinese checkers board and corners', () => {
  it('has 121 holes and six ten-hole triangles', () => {
    expect(CC_HOLES).toBe(121);
    expect(CC_TRIANGLES.map((triangle) => triangle.length)).toEqual([10, 10, 10, 10, 10, 10]);
    expect(new Set(CC_TRIANGLES.flat()).size).toBe(60);
  });

  it('assigns fixed corners for 2, 3, 4, and 6 players and none for 5', () => {
    expect(ccCorners(2)).toEqual([0, 3]);
    expect(ccCorners(3)).toEqual([0, 2, 4]);
    expect(ccCorners(4)).toEqual([0, 1, 3, 4]);
    expect(ccCorners(6)).toEqual([0, 1, 2, 3, 4, 5]);
    for (const count of [1, 5, 7]) expect(ccCorners(count)).toBeNull();
    // Three players race into the three empty corners.
    expect(ccCorners(3)!.map(ccTarget)).toEqual([3, 5, 1]);
    expect(STAR_CORNERS[ccTarget(0)]).toBe('top');
  });

  it('accepts only the supported player counts through the shared seat rules', () => {
    expect([2, 3, 4, 5, 6, 7].map((count) => playerCountAllowed('chinesecheckers', count))).toEqual([true, true, true, false, true, false]);
    expect(playerCountAllowed('reversi', 2)).toBe(true);
    expect(playerCountAllowed('reversi', 3)).toBe(false);
  });

  it('measures rows to each tip, 0 at the tip and 16 at the opposite one', () => {
    expect(CC_TIP_DISTANCE[0][at('0,16')]).toBe(0);
    expect(CC_TIP_DISTANCE[0][at('0,0')]).toBe(16);
    expect(CC_TIP_DISTANCE[3][at('0,0')]).toBe(0);
    for (let corner = 0; corner < 6; corner++) {
      expect(Math.min(...CC_TIP_DISTANCE[corner])).toBe(0);
      expect(Math.max(...CC_TIP_DISTANCE[corner])).toBe(16);
      expect(CC_TRIANGLES[corner].map((index) => CC_TIP_DISTANCE[corner][index]).reduce((a, b) => a + b, 0)).toBe(CC_HOME_DISTANCE);
    }
    expect(CC_HOME_DISTANCE).toBe(20);
  });

  it('fills each player corner at the start', () => {
    const holes = ccInitialHoles([0, 3]);
    expect(holes.filter((hole) => hole === 0)).toHaveLength(10);
    expect(holes.filter((hole) => hole === 3)).toHaveLength(10);
    expect(holes[at('0,16')]).toBe(0);
    expect(holes[at('0,0')]).toBe(3);
    expect(ccRemaining(holes, 0)).toBe(120);
    expect(isCcHoles(holes)).toBe(true);
    expect(isCcHoles(holes.slice(1))).toBe(false);
    expect(isCcHoles([...holes.slice(1), 6])).toBe(false);
    expect(isCcHoles([...holes.slice(1), 1.5])).toBe(false);
  });
});

describe('Chinese checkers moves', () => {
  it('opens with eight steps and six jumps from the bottom corner', () => {
    const holes = ccInitialHoles([0, 3]);
    const moves = ccMoves(holes, 0);
    expect(moves).toHaveLength(14);
    expect(moves.filter((move) => move.jump)).toHaveLength(6);
    expect(reach(holes, '-2,14')).toEqual(['-4,12', '0,12']);
    expect(reach(holes, '0,16')).toEqual([]);
  });

  it('chains jumps over any colour and keeps the landings between start and end', () => {
    const holes = board({ '0,12': 0, '1,11': 3, '3,9': 0 });
    const far = ccDestinations(holes, at('0,12')).find((destination) => destination.to === at('4,8'))!;
    expect(far).toEqual({ to: at('4,8'), path: [at('2,10')], jump: true });
    const near = ccFindMove(holes, 0, at('0,12'), at('2,10'))!;
    expect(near).toEqual({ to: at('2,10'), path: [], jump: true });
    expect(ccFindMove(holes, 0, at('0,12'), at('2,12'))).toEqual({ to: at('2,12'), path: [], jump: false });
  });

  it('finds the shortest chain and never ends where the marble started', () => {
    // A ring of marbles lets the chain come back round to the start; that is not a move.
    const holes = board({ '0,12': 0, '2,12': 1, '3,11': 1, '1,11': 1 });
    const ends = reach(holes, '0,12');
    expect(ends).not.toContain('0,12');
    expect(ends).toContain('4,12');
    expect(ends).toContain('2,10');
    const toFour = ccFindMove(holes, 0, at('0,12'), at('4,12'))!;
    expect(toFour.path).toEqual([]);
  });

  it('cannot jump over an empty hole, two marbles in a row, or off the board', () => {
    expect(reach(board({ '0,12': 0 }), '0,12')).toHaveLength(6);
    // Two marbles in a row block the jump in that direction.
    expect(reach(board({ '0,12': 0, '2,12': 1, '4,12': 1 }), '0,12')).not.toContain('6,12');
    // The bottom tip has only two neighbours, both inside its triangle.
    expect(reach(board({ '0,16': 0 }), '0,16')).toEqual(['-1,15', '1,15']);
  });

  it('rejects moves of another corner, empty holes, and unreachable ends', () => {
    const holes = ccInitialHoles([0, 3]);
    expect(ccFindMove(holes, 3, at('-3,13'), at('-4,12'))).toBeNull();
    expect(ccFindMove(holes, 0, at('0,10'), at('0,8'))).toBeNull();
    expect(ccFindMove(holes, 0, at('-3,13'), at('0,8'))).toBeNull();
    expect(ccIndex('99,99')).toBeNull();
    expect(ccIndex(12)).toBeNull();
  });

  it('applies a move without changing the input board', () => {
    const holes = ccInitialHoles([0, 3]);
    const next = ccApply(holes, at('-3,13'), at('-4,12'));
    expect(next[at('-4,12')]).toBe(0);
    expect(next[at('-3,13')]).toBeNull();
    expect(holes[at('-3,13')]).toBe(0);
  });

  it('reports a fully blocked side', () => {
    const holes = board({ '0,16': 1, '-1,15': 0, '1,15': 0, '-2,14': 0, '2,14': 0 });
    expect(ccHasMove(holes, 1)).toBe(false);
    expect(ccHasMove(holes, 0)).toBe(true);
  });
});

describe('Chinese checkers finishing and progress', () => {
  const top = CC_TRIANGLES[3].map(ccNode);

  it('finishes when the target is full of own marbles', () => {
    const holes = board(Object.fromEntries(top.map((node) => [node, 0])));
    expect(ccFinished(holes, 0)).toBe(true);
    expect(ccRemaining(holes, 0)).toBe(0);
    expect(ccArrived(holes, 0)).toBe(10);
  });

  it('counts opposing marbles left in the target once every other hole is filled (anti-spoiling)', () => {
    const spoiled = board(Object.fromEntries(top.map((node, index) => [node, index < 2 ? 3 : 0])));
    expect(ccFinished(spoiled, 0)).toBe(true);
    expect(ccArrived(spoiled, 0)).toBe(8);
    // One empty hole means the race is not over.
    const gap = board(Object.fromEntries(top.slice(1).map((node) => [node, 0])));
    expect(ccFinished(gap, 0)).toBe(false);
    // A target filled only by others is no finish for a side with no marble there.
    expect(ccFinished(board(Object.fromEntries(top.map((node) => [node, 3]))), 0)).toBe(false);
  });

  it('ranks by distance left after the winners, sharing equal places, with resigned seats last', () => {
    expect(ccRanks(['N', 'E', 'S', 'W'], { N: 0, E: 30, S: 12, W: 30 }, ['N'], [])).toEqual({ N: 1, S: 2, E: 3, W: 3 });
    expect(ccRanks(['N', 'E', 'S'], { N: 0, S: 4 }, ['N'], ['E'])).toEqual({ N: 1, S: 2, E: 3 });
    expect(ccRanks(['N', 'E', 'S'], { S: 0 }, ['S'], ['E', 'N'])).toEqual({ S: 1, N: 2, E: 3 });
  });
});

describe('Chinese checkers actions', () => {
  it('parses moves between holes and the match controls only', () => {
    const parse = (action: unknown): unknown => parseGameAction({ gameType: 'chinesecheckers', action });
    expect(parse({ type: 'move', from: '-3,13', to: '-4,12', extra: 1 }))
      .toEqual({ gameType: 'chinesecheckers', action: { type: 'move', from: '-3,13', to: '-4,12' } });
    expect(parse({ type: 'resign' })).toEqual({ gameType: 'chinesecheckers', action: { type: 'resign' } });
    expect(parse({ type: 'offer-draw' })).toEqual({ gameType: 'chinesecheckers', action: { type: 'offer-draw' } });
    for (const bad of [{ type: 'move', from: '0,1', to: '-4,12' }, { type: 'move', from: '-3,13' }, { type: 'place', to: '0,0' },
      { type: 'answer-draw' }, null, 'resign']) {
      expect(typeof parse(bad)).toBe('string');
    }
    expect(CC_BOARD.nodes.every((node) => ccIndex(node.id) !== null)).toBe(true);
  });
});
