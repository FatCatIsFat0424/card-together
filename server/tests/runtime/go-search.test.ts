import { describe, expect, it } from 'vitest';
import { GO_KOMI, goHashOf, goParsePoint, goPlay, goScore, goStart } from '@shared/rules/go';
import type { GoCell, GoHash, GoMove, GoPosition, GoSide, GoSize } from '@shared/rules/go';
import { goEstimateDead } from '@shared/rules/go-ownership';
import { goBestMove, goEasyMove, goShouldContestMarking } from '../../src/bots/go-search';
import { seededRandom } from '../../src/bots/search/seeded-random';

/** A position from rows drawn top to bottom: `X` black, `O` white, `.` empty. */
function position(rows: readonly string[], toMove: GoSide = 0, passes = 0): GoPosition {
  const size = rows.length as GoSize;
  const stones: GoCell[] = rows.flatMap((row) => [...row].map((char) => (char === 'X' ? 0 : char === 'O' ? 1 : null)));
  return { size, stones, toMove, komi: GO_KOMI, captures: [0, 0], passes, moves: 40 };
}

const at = (name: string): number => goParsePoint(9, name)!;
const history = (start: GoPosition): GoHash[] => [goHashOf(start.stones)];
const hard = (start: GoPosition, seed: number, maxIterations = 6_000): GoMove =>
  goBestMove(start, history(start), { random: seededRandom(seed), maxIterations });

/** White's C6–D6 has one liberty, D5; left alone it connects to D4 and escapes. */
const ATARI_TO_TAKE = position([
  '.........', '.........', '..XX.....', '.XOOX....', '..X......', '...O.....', '......O..', '.........', '.........',
]);

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
  it('captures a group in atari', () => {
    for (const seed of [1, 2]) expect(hard(ATARI_TO_TAKE, seed)).toBe(at('D5'));
  });

  it('saves its own group from atari', () => {
    for (const seed of [1, 2]) expect(hard(ATARI_TO_ESCAPE, seed)).toBe(at('E5'));
  });

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
      random: seededRandom(3), budget: { expired: () => performance.now() - began >= 150 },
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

describe('Go easy move', () => {
  it('captures, then escapes, and never fills its own eye', () => {
    expect(goEasyMove(ATARI_TO_TAKE, history(ATARI_TO_TAKE), seededRandom(1))).toBe(at('D5'));
    expect(goEasyMove(ATARI_TO_ESCAPE, history(ATARI_TO_ESCAPE), seededRandom(1))).toBe(at('E5'));
    for (let seed = 0; seed < 20; seed++) {
      const move = goEasyMove(EYES, history(EYES), seededRandom(seed));
      expect([at('A9'), at('C9'), 'pass']).not.toContain(move);
    }
    expect(goEasyMove(FINISHED, history(FINISHED), seededRandom(1))).toBe('pass');
  });
});

describe('Go hard against easy', () => {
  it('wins a seeded 9 × 9 mini-match at least 8 games of 10', () => {
    let hardWins = 0;
    for (let game = 0; game < 10; game++) {
      const random = seededRandom(1_000 + game);
      const hardSide: GoSide = game % 2 === 0 ? 0 : 1;
      const start = goStart({ size: 9, handicap: 0 });
      let current = start.position;
      const seen = [...start.history];
      while (current.passes < 2 && current.moves < 243) {
        const move = current.toMove === hardSide
          ? goBestMove(current, seen, { random, maxIterations: 300 })
          : goEasyMove(current, seen, random);
        const result = goPlay(current, move, seen);
        expect(result).not.toBeNull();
        if (move !== 'pass') seen.push(result!.hash);
        current = result!.position;
      }
      const score = goScore(9, current.stones, goEstimateDead(current), current.komi);
      if (score.winner === hardSide) hardWins++;
    }
    expect(hardWins).toBeGreaterThanOrEqual(8);
  }, 30_000);
});

describe('Go marking check', () => {
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
