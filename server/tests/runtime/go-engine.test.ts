import { describe, expect, it } from 'vitest';
import { GO_KOMI, goHashOf, goParsePoint, goPlay, goStart } from '@shared/rules/go';
import type { GoCell, GoPosition, GoSide, GoSize } from '@shared/rules/go';
import { boardFromPosition, boardHash, playMove, playPass } from '../../src/bots/go-board';
import { CAPTURE_LAST, CAPTURE_MANY, ESCAPE_LADDERED, ESCAPE_SAFE, analyzeMoves } from '../../src/bots/go-features';
import { TREE_BYTES, TREE_CAPACITY } from '../../src/bots/go-mcts';
import { MOGO_PATTERN, canonicalCode, patternCode, swapColours } from '../../src/bots/go-patterns';
import { createPlayoutState, playoutMove } from '../../src/bots/go-playout';
import { ladderAttack } from '../../src/bots/go-tactics';
import { seededRandom } from '../../src/bots/search/seeded-random';

/** A position from rows drawn top to bottom: `X` black, `O` white, `.` empty. */
function position(rows: readonly string[], toMove: GoSide = 0): GoPosition {
  const size = rows.length as GoSize;
  const stones: GoCell[] = rows.flatMap((row) => [...row].map((char) => (char === 'X' ? 0 : char === 'O' ? 1 : null)));
  return { size, stones, toMove, komi: GO_KOMI, captures: [0, 0], passes: 0, moves: 20 };
}

const at = (name: string): number => goParsePoint(9, name)!;

/** White's C7 has two liberties; black chases it towards the top right edge, or down the left side. */
const LADDER = ['.........', '..X......', '.XO......', '...X.....', '.........', '.........', '.........', '.........', '.........'];
/** The same with white stones on both ladder paths. */
const BROKEN_LADDER = ['.........', '..X.O....', '.XO......', '...X.....', '.O.......', '.........', '.........', '.........', '.........'];

describe('Go bot board', () => {
  it('agrees with the rules, captures and hashes included, over whole policy playouts', () => {
    for (const size of [9, 19] as const) {
      const random = seededRandom(size);
      for (let game = 0; game < 6; game++) {
        let current = goStart({ size, handicap: 0 }).position;
        const board = boardFromPosition(current);
        const state = createPlayoutState(board, random, false);
        for (let step = 0; step < size * size * 2 && board.passes < 2; step++) {
          const move = playoutMove(board, state);
          if (move < 0) {
            playPass(board);
            current = goPlay(current, 'pass', [])!.position;
            continue;
          }
          const result = goPlay(current, board.geometry.layout.toIndex[move], []);
          expect(result, `step ${step}`).not.toBeNull();
          playMove(board, move);
          current = result!.position;
          expect(boardHash(board)).toBe(goHashOf(current.stones));
        }
        const stones = Array.from(board.geometry.layout.toPoint, (point) => board.colour[point]);
        expect(stones).toEqual(current.stones.map((cell) => (cell === null ? 0 : cell + 1)));
      }
    }
  });
});

describe('Go bot patterns and tactics', () => {
  it('matches MoGo shapes in every orientation and colour, and folds symmetric codes together', () => {
    // A hane at C5 against the white D6 stone with black at C6 above it: "XO? / X.. / x.?" turned on its side.
    const hane = boardFromPosition(position(['.........', '.........', '.........', '..XO.....', '.........', '.........', '.........', '.........', '.........']));
    const point = hane.geometry.layout.toPoint[at('C5')];
    const code = patternCode(hane, point);
    expect(MOGO_PATTERN[code]).toBe(1);
    const mirrored = boardFromPosition(position(['.........', '.........', '.........', '.....OX..', '.........', '.........', '.........', '.........', '.........']));
    const mirroredCode = patternCode(mirrored, mirrored.geometry.layout.toPoint[at('G5')]);
    expect(canonicalCode(mirroredCode)).toBe(canonicalCode(code));
    expect(swapColours(swapColours(code))).toBe(code);
    expect(MOGO_PATTERN[swapColours(code)]).toBe(1);
    expect(MOGO_PATTERN[0]).toBe(0);
  });

  it('reads a ladder that works and one that a stone on its path breaks', () => {
    const board = boardFromPosition(position(LADDER));
    const { toPoint } = board.geometry.layout;
    expect([toPoint[at('C6')], toPoint[at('D7')]]).toContain(ladderAttack(board, toPoint[at('C7')]));
    const broken = boardFromPosition(position(BROKEN_LADDER));
    expect(ladderAttack(broken, toPoint[at('C7')])).toBe(-1);
  });

  it('labels captures of the last move, larger captures, and escapes by whether a ladder catches them', () => {
    // White's C6–D6 is in atari at D5: a capture of the last move after white's D6, a plain one otherwise.
    const take = boardFromPosition(position([
      '.........', '.........', '..XX.....', '.XOOX....', '..X......', '.........', '.........', '.........', '.........',
    ]));
    const { toPoint } = take.geometry.layout;
    take.last = toPoint[at('D6')];
    expect(analyzeMoves(take).capture[toPoint[at('D5')]]).toBe(CAPTURE_LAST);
    take.last = -1;
    expect(analyzeMoves(take).capture[toPoint[at('D5')]]).toBe(CAPTURE_MANY);
    // Black's E5 stone runs out to three liberties at E4.
    const run = boardFromPosition(position([
      '.........', '.........', '.........', '....O....', '...OXO...', '.........', '.........', '.........', '.........',
    ]));
    expect(analyzeMoves(run).escape[toPoint[at('E4')]]).toBe(ESCAPE_SAFE);
    // White's C7 runs to C6 with two liberties, and black's ladder down the left side catches it.
    const laddered = boardFromPosition(position([
      '.........', '..X......', '.XOX.....', '...X.....', '.........', '.........', '.........', '.........', '.........',
    ], 1));
    expect(analyzeMoves(laddered).escape[toPoint[at('C6')]]).toBe(ESCAPE_LADDERED);
  });
});

describe('Go bot memory', () => {
  it('bounds the search tree to a fixed typed-array budget', () => {
    expect(TREE_CAPACITY).toBeGreaterThanOrEqual(200_000);
    expect(TREE_BYTES).toBeLessThanOrEqual(24 * 1024 * 1024);
  });
});
