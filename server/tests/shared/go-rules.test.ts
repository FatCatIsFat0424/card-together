import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GO_OPTIONS, GO_HANDICAP_KOMI, GO_KOMI, goChain, goHandicapPoints, goHashOf, goInitialPosition,
  goLegalPoints, goMaxHandicap, goMoveError, goMoveLimit, goNode, goParsePoint, goPlay, goPlayEnd, goPointName,
  goPointOfNode, goReplay, goScore, goStarPoints, goStart, goToggleDead, isGoOptions, isGoStones,
} from '@shared/rules/go';
import type { GoCell, GoHash, GoMove, GoPosition, GoSide, GoSize } from '@shared/rules/go';
import {
  goBoardHash, goBoardPass, goBoardPlay, goEstimateDead, goLayout, goOwnership, goPlayoutBoard, goUnconditionallyAlive,
} from '@shared/rules/go-ownership';
import { seededRandom } from '../../src/bots/search/seeded-random';

/** A position from rows drawn top to bottom: `X` black, `O` white, `.` empty (spaces ignored). */
function position(rows: readonly string[], toMove: GoSide = 0, komi = GO_KOMI): GoPosition {
  const size = rows.length as GoSize;
  const stones: GoCell[] = rows.flatMap((row) => [...row.replace(/ /g, '')].map((char) => (char === 'X' ? 0 : char === 'O' ? 1 : null)));
  return { size, stones, toMove, komi, captures: [0, 0], passes: 0, moves: 0 };
}

const at = (size: GoSize, name: string): number => goParsePoint(size, name)!;

/** Plays named moves in order, keeping the superko history; throws on an illegal move. */
function play(start: GoPosition, moves: readonly string[]): { position: GoPosition; history: GoHash[] } {
  let current = start;
  const history = [goHashOf(start.stones)];
  for (const name of moves) {
    const move: GoMove = name === 'pass' ? 'pass' : at(start.size, name);
    const result = goPlay(current, move, history);
    if (!result) throw new Error(`illegal move ${name}`);
    current = result.position;
    if (move !== 'pass') history.push(result.hash);
  }
  return { position: current, history };
}

describe('Go options, coordinates, and notation', () => {
  it('validates room options and stored grids', () => {
    expect(DEFAULT_GO_OPTIONS).toEqual({ size: 9, handicap: 0 });
    expect(isGoOptions({ size: 19, handicap: 9 })).toBe(true);
    expect(isGoOptions({ size: 13, handicap: 2 })).toBe(true);
    expect(isGoOptions({ size: 9, handicap: 5 })).toBe(true);
    expect(isGoOptions({ size: 9, handicap: 6 })).toBe(false);
    expect(isGoOptions({ size: 9, handicap: 1 })).toBe(false);
    expect(isGoOptions({ size: 9, handicap: 2.5 })).toBe(false);
    expect(isGoOptions({ size: 15, handicap: 0 })).toBe(false);
    expect(isGoOptions({ size: 9, handicap: 0, extra: true })).toBe(false);
    expect(isGoOptions(null)).toBe(false);
    expect(goMaxHandicap(9)).toBe(5);
    expect(goMaxHandicap(19)).toBe(9);
    expect(isGoStones(goInitialPosition(DEFAULT_GO_OPTIONS).stones, 9)).toBe(true);
    expect(isGoStones(new Array(81).fill(2), 9)).toBe(false);
    expect(isGoStones(new Array(80).fill(null), 9)).toBe(false);
  });

  it('names points with column letters that skip I and rows counted from the bottom', () => {
    expect(goPointName(19, 15 * 19 + 3)).toBe('D4');
    expect(goPointName(19, 0)).toBe('A19');
    expect(goPointName(19, 18)).toBe('T19');
    expect(goPointName(9, 8)).toBe('J9');
    expect(goPointName(9, 80)).toBe('J1');
    expect(goParsePoint(19, 'K10')).toBe(9 * 19 + 9);
    expect(goParsePoint(19, 'd4')).toBe(15 * 19 + 3);
    for (const bad of ['I5', 'K10', 'A0', 'A10', 'Z1', '', 'D']) expect(goParsePoint(9, bad)).toBeNull();
    for (let index = 0; index < 361; index++) expect(goParsePoint(19, goPointName(19, index))).toBe(index);
  });

  it('maps board node ids to points and back', () => {
    expect(goNode(9, at(9, 'A9'))).toBe('0,0');
    expect(goPointOfNode(13, goNode(13, 100))).toBe(100);
    for (const bad of ['9,0', '0,9', 'a,1', 3, null]) expect(goPointOfNode(9, bad)).toBeNull();
  });
});

describe('Go star points and handicaps', () => {
  it('marks five star points on 9 and 13 lines and nine on 19', () => {
    expect(goStarPoints(9).map((point) => goPointName(9, point)).sort()).toEqual(['C3', 'C7', 'E5', 'G3', 'G7']);
    expect(goStarPoints(13).map((point) => goPointName(13, point)).sort()).toEqual(['D10', 'D4', 'G7', 'K10', 'K4']);
    expect(goStarPoints(19)).toHaveLength(9);
  });

  it('places the usual fixed layouts', () => {
    const names = (size: GoSize, count: number): string[] => goHandicapPoints(size, count).map((point) => goPointName(size, point)).sort();
    expect(names(19, 2)).toEqual(['D4', 'Q16']);
    expect(names(19, 3)).toEqual(['D4', 'Q16', 'Q4']);
    expect(names(19, 5)).toEqual(['D16', 'D4', 'K10', 'Q16', 'Q4']);
    expect(names(19, 6)).toEqual(['D10', 'D16', 'D4', 'Q10', 'Q16', 'Q4']);
    expect(names(19, 8)).toEqual(['D10', 'D16', 'D4', 'K16', 'K4', 'Q10', 'Q16', 'Q4']);
    expect(names(19, 9)).toEqual(goStarPoints(19).map((point) => goPointName(19, point)).sort());
    expect(names(9, 5)).toEqual(['C3', 'C7', 'E5', 'G3', 'G7']);
    expect(names(13, 9)).toContain('D7');
    expect(goHandicapPoints(9, 6)).toEqual([]);
    expect(goHandicapPoints(19, 1)).toEqual([]);
  });

  it('starts with white to move and a half-point komi when there is a handicap', () => {
    const even = goInitialPosition({ size: 19, handicap: 0 });
    expect(even.toMove).toBe(0);
    expect(even.komi).toBe(GO_KOMI);
    expect(even.stones.every((cell) => cell === null)).toBe(true);
    const given = goInitialPosition({ size: 13, handicap: 4 });
    expect(given.toMove).toBe(1);
    expect(given.komi).toBe(GO_HANDICAP_KOMI);
    expect(given.stones.filter((cell) => cell === 0)).toHaveLength(4);
  });
});

describe('Go captures and illegal moves', () => {
  it('captures a stone with its last liberty and counts it', () => {
    const start = position([
      '.........', '.........', '.........', '....X....', '...XO....', '....X....', '.........', '.........', '.........',
    ]);
    const result = goPlay(start, at(9, 'F5'), [goHashOf(start.stones)])!;
    expect(result.captured).toEqual([at(9, 'E5')]);
    expect(result.position.stones[at(9, 'E5')]).toBeNull();
    expect(result.position.captures).toEqual([1, 0]);
    expect(result.position.toMove).toBe(1);
  });

  it('captures several groups with one move', () => {
    const start = position([
      'O.OX.....', 'XOX......', '.X.......', '.........', '.........', '.........', '.........', '.........', '.........',
    ]);
    // B9 joins nothing but takes the last liberty of both corner stones and the B8 stone.
    const result = goPlay(start, at(9, 'B9'), [goHashOf(start.stones)])!;
    expect([...result.captured].sort((a, b) => a - b)).toEqual([at(9, 'A9'), at(9, 'C9'), at(9, 'B8')].sort((a, b) => a - b));
    expect(result.position.captures[0]).toBe(3);
  });

  it('forbids suicide but allows a move that captures first', () => {
    const eye = position([
      '.O.......', 'O.O......', '.O.......', '.........', '.........', '.........', '.........', '.........', '.........',
    ]);
    expect(goMoveError(eye, at(9, 'B8'), [])).toBe('suicide');
    expect(goMoveError(eye, at(9, 'A9'), [])).toBe('suicide');
    const groupSuicide = position([
      'XX.O.....', 'OOOO.....', '.........', '.........', '.........', '.........', '.........', '.........', '.........',
    ]);
    expect(goMoveError(groupSuicide, at(9, 'C9'), [])).toBe('suicide');
    const capturing = position([
      '.OX......', 'OX.......', '.........', '.........', '.........', '.........', '.........', '.........', '.........',
    ]);
    // A9 has no liberty of its own but takes B9's last one.
    expect(goMoveError(capturing, at(9, 'A9'), [])).toBeNull();
    expect(goPlay(capturing, at(9, 'A9'), [])!.captured).toEqual([at(9, 'B9')]);
    expect(goMoveError(eye, at(9, 'B9'), [])).toBe('occupied');
    expect(goMoveError(eye, -1, [])).toBe('outside');
    expect(goMoveError(eye, 81, [])).toBe('outside');
  });

  it('forbids retaking a ko at once but allows it after moves elsewhere', () => {
    const start = position([
      '.........', '.XO......', 'XO.O.....', '.XO......', '.........', '.........', '.........', '.........', '.........',
    ]);
    const taken = play(start, ['C7']);
    expect(taken.position.stones[at(9, 'B7')]).toBeNull();
    expect(goMoveError(taken.position, at(9, 'B7'), taken.history)).toBe('superko');
    const later = play(start, ['C7', 'H2', 'H8']);
    expect(goMoveError(later.position, at(9, 'B7'), later.history)).toBeNull();
  });

  it('forbids recreating an earlier board through a double-ko cycle (positional superko)', () => {
    const start = position([
      '.........', '.XO......', 'XO.O.....', '.XO......', '.........', '.....OX..', '....OX.X.', '.....OX..', '.........',
    ]);
    // Black takes the left ko, white the right one, black passes, white retakes the left ko: retaking the right one
    // now would recreate the starting board even though it is not an immediate recapture.
    const cycle = play(start, ['C7', 'G3', 'pass', 'B7']);
    expect(cycle.position.toMove).toBe(0);
    expect(goMoveError(cycle.position, at(9, 'F3'), cycle.history)).toBe('superko');
    expect(goLegalPoints(cycle.position, cycle.history)).not.toContain(at(9, 'F3'));
    expect(goLegalPoints(cycle.position, [])).toContain(at(9, 'F3'));
  });
});

describe('Go play end and replay', () => {
  it('ends play after two consecutive passes or at the move limit', () => {
    const start = goStart(DEFAULT_GO_OPTIONS);
    const onePass = goPlay(start.position, 'pass', start.history)!.position;
    expect(goPlayEnd(onePass)).toBeNull();
    const resumed = goPlay(onePass, at(9, 'E5'), start.history)!.position;
    expect(resumed.passes).toBe(0);
    const twoPasses = goPlay(goPlay(resumed, 'pass', start.history)!.position, 'pass', start.history)!.position;
    expect(goPlayEnd(twoPasses)).toBe('passes');
    expect(goPlay(twoPasses, at(9, 'D5'), start.history)).toBeNull();
    expect(goMoveError(twoPasses, at(9, 'D5'), start.history)).toBe('over');
    expect(goMoveLimit(9)).toBe(243);
    expect(goPlayEnd({ ...start.position, moves: 243 })).toBe('move-limit');
  });

  it('replays a move list with its board history and rejects an illegal one', () => {
    const game = goReplay({ size: 9, handicap: 2 }, [at(9, 'E5'), 'pass', at(9, 'D5')])!;
    expect(game.position.moves).toBe(3);
    expect(game.position.toMove).toBe(0);
    expect(game.history).toHaveLength(3);
    expect(game.history[2]).toBe(goHashOf(game.position.stones));
    expect(goReplay({ size: 9, handicap: 0 }, [at(9, 'E5'), at(9, 'E5')])).toBeNull();
  });

  it('keeps the playout board identical to the rules over random games, hashes included', () => {
    const random = seededRandom(42);
    for (const size of [9, 13] as const) {
      for (let game = 0; game < 6; game++) {
        let current = goInitialPosition({ size, handicap: game % 2 === 0 ? 0 : 3 });
        const history = [goHashOf(current.stones)];
        const board = goPlayoutBoard(current);
        const { toPoint } = goLayout(size);
        for (let ply = 0; ply < size * size * 2 && goPlayEnd(current) === null; ply++) {
          const legal = goLegalPoints(current, history);
          const move: GoMove = legal.length === 0 || random() < 0.02 ? 'pass' : legal[Math.floor(random() * legal.length)];
          const result = goPlay(current, move, history)!;
          if (move === 'pass') goBoardPass(board);
          else {
            goBoardPlay(board, toPoint[move]);
            history.push(result.hash);
          }
          current = result.position;
          expect(goBoardHash(board)).toBe(result.hash);
        }
        current.stones.forEach((cell, index) => expect(board.colour[toPoint[index]]).toBe(cell === null ? 0 : cell + 1));
        expect(goBoardHash(goPlayoutBoard(current))).toBe(goHashOf(current.stones));
      }
    }
  });
});

describe('Go area scoring', () => {
  const split = [
    '...XO....', '...XO....', '...XO....', '...XO....', '...XO....', '...XO....', '...XO....', '...XO....', '...XO....',
  ];

  it('counts stones plus territory and leaves dame neutral', () => {
    const dame = [
      '...X.O...', '...X.O...', '...X.O...', '...X.O...', '...X.O...', '...X.O...', '...X.O...', '...X.O...', '...X.O...',
    ];
    const score = goScore(9, position(dame).stones, [], GO_KOMI);
    expect(score.stones).toEqual([9, 9]);
    expect(score.territory).toEqual([27, 27]);
    expect(score.area).toEqual([36, 36]);
    expect(score.winner).toBe(1);
    expect(score.margin).toBe(7.5);
    expect(score.owner[at(9, 'E5')]).toBeNull();
    expect(score.owner[at(9, 'A1')]).toBe(0);
    expect(score.owner[at(9, 'J9')]).toBe(1);
  });

  it('awards black the win once its area beats white by more than komi', () => {
    const rows = split.map(() => '....XO...');
    const score = goScore(9, position(rows).stones, [], GO_KOMI);
    expect(score.area).toEqual([45, 36]);
    expect(score.winner).toBe(0);
    expect(score.margin).toBe(1.5);
  });

  it('lifts dead stones and gives their points to the surrounding side', () => {
    const rows = [...split];
    rows[4] = '.O.XO....';
    const stones = position(rows).stones;
    const alive = goScore(9, stones, [], GO_KOMI);
    // The white stone spoils black's whole region while it counts as alive.
    expect(alive.area).toEqual([9, 46]);
    const dead = goScore(9, stones, [at(9, 'B5')], GO_KOMI);
    expect(dead.area).toEqual([36, 45]);
    expect(dead.territory).toEqual([27, 36]);
    expect(dead.owner[at(9, 'B5')]).toBe(0);
  });

  it('toggles a whole chain as dead or alive', () => {
    const stones = position([
      '.........', '.OO......', '.........', '.........', '.........', '.........', '.........', '.........', '.........',
    ]).stones;
    const marked = goToggleDead(9, stones, [], at(9, 'B8'));
    expect(marked).toEqual([at(9, 'B8'), at(9, 'C8')]);
    expect(goToggleDead(9, stones, marked, at(9, 'C8'))).toEqual([]);
    expect(goToggleDead(9, stones, marked, at(9, 'E5'))).toEqual(marked);
    expect(goChain(9, stones, at(9, 'C8'))).toHaveLength(2);
  });
});

describe('Go life and dead-stone estimate', () => {
  const living = [
    '.X.X.O...', 'XXXX.O...', '....OO...', '.........', '.........', '.........', '.........', '.........', '.........',
  ];

  it('finds unconditionally alive groups with two true eyes', () => {
    const stones = position(living).stones;
    const alive = goUnconditionallyAlive(9, stones);
    expect(alive[at(9, 'B9')]).toBe(true);
    expect(alive[at(9, 'D8')]).toBe(true);
    expect(alive[at(9, 'F9')]).toBe(false);
    const oneEye = position([
      '.X.......', 'XX.......', '.........', '.........', '.........', '.........', '.........', '.........', '.........',
    ]).stones;
    expect(goUnconditionallyAlive(9, oneEye)[at(9, 'B9')]).toBe(false);
  });

  it('marks a lone stone inside settled territory as dead, deterministically', () => {
    const rows = [
      '...XO....', '...XO....', '...XO....', '...XO....', '.O.XO....', '...XO....', '...XO....', '...XO....', '...XO.X..',
    ];
    const finished = position(rows);
    const dead = goEstimateDead(finished);
    expect(dead).toEqual([at(9, 'B5'), at(9, 'G1')].sort((a, b) => a - b));
    expect(goEstimateDead(finished)).toEqual(dead);
    const ownership = goOwnership(finished);
    expect(ownership[at(9, 'A1')]).toBeGreaterThan(0);
    expect(ownership[at(9, 'J1')]).toBeLessThan(0);
    expect(goEstimateDead(finished, { random: seededRandom(5), playouts: 300 })).toEqual(dead);
  });

  it('finds the dead groups of a played-out game and keeps the living ones', () => {
    const finished = position([
      'XXOOOOOOX', 'XOOOX.OXX', 'XXOOOOOOX', 'XXOXXX.OX', 'X.XOOOOO.', 'XXXXXXXOO', 'XXXXXXXXX', '.X.XXX.XX', 'X.XXX.XX.',
    ], 1);
    const names = goEstimateDead(finished).map((point) => goPointName(9, point)).sort();
    expect(names).toEqual(['D6', 'E6', 'E8', 'F6', 'H8', 'J6', 'J7', 'J8', 'J9']);
  });

  it('estimates a 19 × 19 board inside the synchronous budget', () => {
    const random = seededRandom(9);
    let game = goStart({ size: 19, handicap: 0 });
    const history = [...game.history];
    let current = game.position;
    for (let ply = 0; ply < 200; ply++) {
      const legal = goLegalPoints(current, history);
      const result = goPlay(current, legal[Math.floor(random() * legal.length)], history)!;
      current = result.position;
      history.push(result.hash);
    }
    game = { position: current, history };
    goEstimateDead(game.position);
    const started = performance.now();
    goEstimateDead(game.position);
    // The target is 150 ms; the bound leaves room for a loaded CI machine.
    expect(performance.now() - started).toBeLessThan(600);
  });
});
