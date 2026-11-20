import { describe, expect, it } from 'vitest';
import { GO_KOMI, goHashOf, goLegalPoints, goParsePoint, goPlay, goScore, goStart } from '@shared/rules/go';
import type { GoCell, GoHash, GoMove, GoPosition, GoSide, GoSize } from '@shared/rules/go';
import { goEstimateDead } from '@shared/rules/go-ownership';
import { goOpeningMove } from '../../src/bots/go-opening';
import { goBestMove, goSearchKomi, goShouldContestMarking } from '../../src/bots/go-search';
import { seededRandom } from '../../src/bots/search/seeded-random';

/** A position from rows drawn top to bottom: `X` black, `O` white, `.` empty. */
function position(rows: readonly string[], toMove: GoSide = 0, passes = 0): GoPosition {
  const size = rows.length as GoSize;
  const stones: GoCell[] = rows.flatMap((row) => [...row].map((char) => (char === 'X' ? 0 : char === 'O' ? 1 : null)));
  return { size, stones, toMove, komi: GO_KOMI, captures: [0, 0], passes, moves: 40 };
}

/** A uniformly random legal point, passing only when none is left: the weak baseline the search has to beat. */
function randomMove(start: GoPosition, seen: readonly GoHash[], random: () => number): GoMove {
  const points = goLegalPoints(start, seen);
  return points.length > 0 ? points[Math.floor(random() * points.length)] : 'pass';
}

const at = (name: string): number => goParsePoint(9, name)!;
const history = (start: GoPosition): GoHash[] => [goHashOf(start.stones)];
const hard = (start: GoPosition, seed: number, maxIterations = 2_000, recent: GoMove[] = []): GoMove =>
  goBestMove(start, history(start), { random: seededRandom(seed), maxIterations, recent });

/**
 * A capturing race in the top left: white's six stones have one liberty, A6, and black's five inside have one, A9.
 * Without komi whoever captures first wins the game.
 */
const SEMEAI = (toMove: GoSide): GoPosition => ({
  ...position(['.XXOX....', 'XXXOX....', 'OOOOX....', '.XXX..O..', '.........', '..O...O..', '.........', '.........', '.........'], toMove),
  komi: 0,
});

/** Black's C6–E6 has one liberty, E5, which connects it to E4. */
const ATARI_TO_ESCAPE = position([
  '.........', '.........', '..OOO....', '.OXXXO...', '..OO.....', '....X....', '.........', '.........', '.........',
]);

/** Two eyes for black (A9, C9) and an open board. */
const EYES = position([
  '.X.X.....', 'XXXX.....', '.........', '.........', '.....O...', '.........', '..O......', '.........', '.........',
]);

/** Every point filled except each side's eyes: black A9 and A7, white J9 and J7. */
const FINISHED = position([
  '.XXXOOOO.', 'XXXXOOOOO', '.XXXOOOO.', 'XXXXOOOOO', 'XXXXOOOOO', 'XXXXOOOOO', 'XXXXOOOOO', 'XXXXOOOOO', 'XXXXOOOOO',
]);

/** Black leads by 9 on the board; white keeps a two-point eye black could still play into. */
const BLACK_AHEAD = position([
  '.XXXXOOO.', 'XXXXXOOO.', '.XXXXOOOO', 'XXXXXOOO.', 'XXXXXOOOO', 'XXXXXOOOO', 'XXXXXOOOO', 'XXXXXOOOO', 'XXXXXOOOO',
], 0, 1);

describe('Go hard search', () => {
  it('wins a capturing race with either colour', () => {
    for (const seed of [1, 2]) {
      expect(hard(SEMEAI(0), seed, 2_000, [at('G6')])).toBe(at('A6'));
      expect(hard(SEMEAI(1), seed, 2_000, [at('G6')])).toBe(at('A9'));
    }
  }, 60_000);

  it('saves its own group from atari', () => {
    for (const seed of [1, 2]) expect(hard(ATARI_TO_ESCAPE, seed)).toBe(at('E5'));
  }, 30_000);

  it('never fills its own eye', () => {
    for (const seed of [1, 2, 3, 4]) expect([at('A9'), at('C9')]).not.toContain(hard(EYES, seed, 400));
  });

  it('passes when only its own eyes are left', () => {
    expect(hard(FINISHED, 1)).toBe('pass');
  });

  it('passes after the opponent passes when the count already wins', () => {
    expect(goEstimateDead(BLACK_AHEAD)).toEqual([]);
    expect(goScore(9, BLACK_AHEAD.stones, [], GO_KOMI).winner).toBe(0);
    expect(hard(BLACK_AHEAD, 1)).toBe('pass');
  });

  it('stops at its time budget', () => {
    const start = goStart({ size: 19, handicap: 0 });
    const began = performance.now();
    const move = goBestMove(start.position, start.history, {
      random: seededRandom(3), budget: { expired: () => performance.now() - began >= 150 }, noBook: true,
    });
    expect(performance.now() - began).toBeLessThan(400);
    expect(move).not.toBe('pass');
  });

  it('is reproducible for a seed when capped by iterations', () => {
    const midgame = position([
      '.........', '...O.....', '..XXO....', '...XO.O..', '..X.X....', '...O.X...', '......O..', '.....O...', '.........',
    ]);
    const first = hard(midgame, 77, 800);
    expect(hard(midgame, 77, 800)).toBe(first);
  });
});

describe('Go opening and handicap', () => {
  it('opens on tengen on 9 × 9 and takes an empty corner on the larger boards', () => {
    expect(goOpeningMove(goStart({ size: 9, handicap: 0 }).position, seededRandom(1))).toBe(at('E5'));
    for (const seed of [1, 2, 3, 4]) {
      const point = goOpeningMove(goStart({ size: 19, handicap: 0 }).position, seededRandom(seed))!;
      const [col, row] = [point % 19, Math.floor(point / 19)];
      const line = (value: number): number => Math.min(value, 18 - value) + 1;
      expect([[3, 4], [4, 3], [4, 4]]).toContainEqual([line(col), line(row)]);
    }
    // Four handicap stones hold every corner: white searches instead.
    expect(goOpeningMove(goStart({ size: 19, handicap: 4 }).position, seededRandom(1))).toBeNull();
    expect(goOpeningMove(goStart({ size: 13, handicap: 2 }).position, seededRandom(1))).not.toBeNull();
  });

  it('scores handicap playouts with a dynamic komi that fades to the real one', () => {
    const start = goStart({ size: 19, handicap: 4 }).position;
    expect(goSearchKomi(start, 4)).toBeGreaterThan(start.komi + 20);
    expect(goSearchKomi({ ...start, moves: 100 }, 4)).toBeLessThan(goSearchKomi(start, 4));
    expect(goSearchKomi({ ...start, moves: 200 }, 4)).toBe(start.komi);
    expect(goSearchKomi(goStart({ size: 9, handicap: 0 }).position, 0)).toBe(GO_KOMI);
  });
});

describe('Go search against a random mover', () => {
  it('wins a seeded 9 × 9 mini-match at least 8 games of 10', () => {
    let botWins = 0;
    for (let game = 0; game < 10; game++) {
      const random = seededRandom(1_000 + game);
      const botSide: GoSide = game % 2 === 0 ? 0 : 1;
      const start = goStart({ size: 9, handicap: 0 });
      let current = start.position;
      const seen = [...start.history];
      while (current.passes < 2 && current.moves < 243) {
        const move = current.toMove === botSide
          ? goBestMove(current, seen, { random, maxIterations: 100 })
          : randomMove(current, seen, random);
        const result = goPlay(current, move, seen);
        expect(result).not.toBeNull();
        if (move !== 'pass') seen.push(result!.hash);
        current = result!.position;
      }
      const score = goScore(9, current.stones, goEstimateDead(current), current.komi);
      if (score.winner === botSide) botWins++;
    }
    expect(botWins).toBeGreaterThanOrEqual(8);
  }, 30_000);
});

describe('Go marking check', () => {
  it('resumes play when a dead opponent chain marked alive costs it the count', () => {
    // White's lone B5 stone sits in black's narrow area: left on the board it turns that area neutral and loses the
    // count, which black wins by 3.5 with the stone removed (a komi of -30.5 evens out white's larger area).
    const intruder = { ...position([
      '..XO.....', '..XO.....', '..XO.....', '..XO.....', '.OXO.....', '..XO.....', '..XO.....', '..XO.....', '..XO.....',
    ]), komi: -30.5 };
    expect(goScore(9, intruder.stones, [], intruder.komi).winner).toBe(1);
    expect(goScore(9, intruder.stones, [at('B5')], intruder.komi).winner).toBe(0);
    expect(goShouldContestMarking(intruder, 0, [], seededRandom(1))).toBe(true);
    expect(goShouldContestMarking(intruder, 0, [at('B5')], seededRandom(1))).toBe(false);
    expect(goShouldContestMarking(intruder, 1, [at('B5')], seededRandom(1))).toBe(false);
  });

  it('resumes play when its living group is marked dead, and accepts a fair marking', () => {
    const blackGroup = FINISHED.stones.flatMap((cell, point) => (cell === 0 ? [point] : []));
    expect(goShouldContestMarking(FINISHED, 0, blackGroup, seededRandom(1))).toBe(true);
    expect(goShouldContestMarking(FINISHED, 0, [], seededRandom(1))).toBe(false);

    const loneStone = position([
      '...XO....', '...XO....', '...XO....', '...XO....', '.O.XO....', '...XO....', '...XO....', '...XO....', '...XO....',
    ]);
    expect(goShouldContestMarking(loneStone, 1, [at('B5')], seededRandom(1))).toBe(false);
    expect(goShouldContestMarking(loneStone, 0, [at('B5')], seededRandom(1))).toBe(false);
  });
});
