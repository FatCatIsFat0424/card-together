import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChineseCheckersGameState, GameSeat, PlayerInfo } from '@shared/types';
import type { CcHole } from '@shared/rules/chinesecheckers';

// The matches below start from a late position, so the replay in the validator needs the same starting board.
const start = vi.hoisted(() => ({ holes: null as (CcHole[] | null) }));
vi.mock('@shared/rules/chinesecheckers', async (importOriginal) => {
  const original = await importOriginal<typeof import('@shared/rules/chinesecheckers')>();
  return {
    ...original,
    ccInitialHoles: (corners: readonly number[]) => (start.holes ? [...start.holes] : original.ccInitialHoles(corners)),
  };
});

import { CC_HOLES, CC_NEIGHBOURS, CC_TRIANGLES, ccNode, ccTarget } from '@shared/rules/chinesecheckers';
import * as checkers from '../../src/managers/games/chinesecheckers-game';
import { coherentChineseCheckersGame } from '../../src/managers/games/chinesecheckers-validation';

const CODE = 'CCLEG1';
const SEATS: readonly GameSeat[] = ['N', 'E', 'S'];
const player = (seat: GameSeat): PlayerInfo => ({
  id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
});

const game = (): ChineseCheckersGameState => checkers.getGameState(CODE)!;
const coherent = (): boolean => coherentChineseCheckersGame(structuredClone(game()));

interface Late {
  readonly hole: string;
  readonly outside: string;
  /** A step North can take and undo, and one East can take and undo with its spare marble */
  readonly north: readonly [string, string];
  readonly east: readonly [string, string];
}

/**
 * East holds nine of its ten target holes plus a spare marble; South stands next to the tenth. The board is the
 * start of a match, so every position after it comes from logged moves.
 */
function lateMatch(): Late {
  const target = CC_TRIANGLES[ccTarget(2)];
  const hole = target.find((index) => CC_NEIGHBOURS[index].some((next) => next >= 0 && !target.includes(next)))!;
  const outside = CC_NEIGHBOURS[hole].find((next) => next >= 0 && !target.includes(next))!;
  const holes: CcHole[] = new Array<CcHole>(CC_HOLES).fill(null);
  for (const index of target) if (index !== hole) holes[index] = 2;
  holes[outside] = 4;
  const northFrom = CC_TRIANGLES[2][0];
  const eastFrom = CC_TRIANGLES[3][0];
  holes[northFrom] = 0;
  holes[eastFrom] = 2;
  const step = (from: number): string => ccNode(CC_NEIGHBOURS[from].find((next) => next >= 0 && holes[next] === null)!);
  start.holes = holes;
  checkers.startGame(CODE, Object.fromEntries(SEATS.map((seat) => [seat, player(seat)])), 1_000);
  return {
    hole: ccNode(hole), outside: ccNode(outside),
    north: [ccNode(northFrom), step(northFrom)], east: [ccNode(eastFrom), step(eastFrom)],
  };
}

/** North and East step out, then South fills East's last target hole under the old rules. */
function playLegacyPrefix(late: Late): void {
  expect(checkers.move(CODE, 'N', late.north[0], late.north[1], 2_000)).toEqual({ success: true });
  expect(checkers.move(CODE, 'E', late.east[0], late.east[1], 3_000)).toEqual({ success: true });
  expect(checkers.applyMove(game(), 'S', late.outside, late.hole, 4_000, false)).toEqual({ success: true });
}

afterEach(() => {
  checkers.abortGame(CODE);
  start.holes = null;
});

describe('Chinese checkers matches stored before rival wins were settled', () => {
  it('ends the match on the next move after a rival target was completed', () => {
    const late = lateMatch();
    playLegacyPrefix(late);
    expect(game()).toMatchObject({ phase: 'playing', result: null, currentTurnSeat: 'N' });
    expect(coherent()).toBe(true);

    expect(checkers.move(CODE, 'N', late.north[1], late.north[0], 5_000)).toEqual({ success: true });
    expect(game()).toMatchObject({ phase: 'scoring', result: { winners: ['E'], reason: 'all-home' } });
    expect(coherent()).toBe(true);
  });

  it('accepts a match that played on past the completed target until the seat itself moved', () => {
    const late = lateMatch();
    playLegacyPrefix(late);
    expect(checkers.applyMove(game(), 'N', late.north[1], late.north[0], 5_000, false)).toEqual({ success: true });
    expect(game().phase).toBe('playing');
    expect(coherent()).toBe(true);
    // East's own move leaves its full target alone, so East finishes as the mover.
    expect(checkers.move(CODE, 'E', late.east[1], late.east[0], 6_000)).toEqual({ success: true });
    expect(game()).toMatchObject({ phase: 'scoring', result: { winners: ['E'], reason: 'all-home' } });
    expect(coherent()).toBe(true);
  });

  it('rejects a stored result that names a winner the log does not support', () => {
    const late = lateMatch();
    expect(checkers.move(CODE, 'N', late.north[0], late.north[1], 2_000)).toEqual({ success: true });
    expect(checkers.move(CODE, 'E', late.east[0], late.east[1], 3_000)).toEqual({ success: true });
    expect(checkers.move(CODE, 'S', late.outside, late.hole, 4_000)).toEqual({ success: true });
    const stored = structuredClone(game());
    expect(stored.result).toMatchObject({ winners: ['E'] });
    stored.result = { ...stored.result!, winners: ['S'], ranks: { ...stored.result!.ranks, S: 1, E: 2 } };
    expect(coherentChineseCheckersGame(stored)).toBe(false);
  });
});
