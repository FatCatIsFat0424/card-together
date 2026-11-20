import { describe, expect, it } from 'vitest';
import { GM_CELLS, gmForbidden, gmLegalMoves } from '@shared/rules/gomoku';
import type { GmCell } from '@shared/rules/gomoku';
import { shapeOf, FOUR, FIVE, OPEN_FOUR, OPEN_THREE, THREE } from '../../src/bots/gomoku-patterns';
import { CELL_OF, INDEX_OF, Position } from '../../src/bots/gomoku-position';
import { searchBestMove } from '../../src/bots/gomoku-search';
import type { GomokuSearchOptions } from '../../src/bots/gomoku-search';
import { SearchContext, WIN, vcf, vct, winThreat } from '../../src/bots/gomoku-threats';
import { seededRandom } from '../../src/bots/search/seeded-random';

const at = (name: string): number => (15 - Number(name.slice(1))) * 15 + name.charCodeAt(0) - 97;

/** A position from coordinates: `black` and `white` list the stones. */
function build(black: string, white: string, renju = false): Position {
  const stones: GmCell[] = new Array<GmCell>(GM_CELLS).fill(null);
  for (const name of black.split(' ').filter(Boolean)) stones[at(name)] = 0;
  for (const name of white.split(' ').filter(Boolean)) stones[at(name)] = 1;
  return new Position(stones, renju);
}

const context = (position: Position, maxNodes = Infinity): SearchContext => new SearchContext(position, () => false, maxNodes);

const options = (seed = 1): GomokuSearchOptions => ({
  maxDepth: 6, expired: () => false, maxNodes: 60_000, random: seededRandom(seed),
});

describe('Gomoku line shapes', () => {
  const window = (cells: string): number => {
    // Nine cells: '.' empty, 'x' black, 'o' white, '|' wall; the fifth is the cell being played.
    let key = 0;
    [...cells].forEach((char, i) => { key |= ({ '.': 0, x: 1, o: 2, '|': 3 }[char] ?? 0) << (2 * i); });
    return key;
  };

  it('classifies what a stone makes by the stones around it', () => {
    expect(shapeOf(0, window('xxxx.....'))).toBe(FIVE);
    expect(shapeOf(0, window('.xxx.....'))).toBe(OPEN_FOUR);
    expect(shapeOf(0, window('oxxx.....'))).toBe(FOUR);
    expect(shapeOf(0, window('..xx.....'))).toBe(OPEN_THREE);
    expect(shapeOf(0, window('.oxx.....'))).toBe(THREE);
    expect(shapeOf(0, window('.|xx.....'))).toBe(THREE);
    expect(shapeOf(1, window('.xxx.....'))).toBe(0);
    expect(shapeOf(1, window('.ooo.....'))).toBe(OPEN_FOUR);
  });

  it('keeps one threat per cell and side consistent with the rules', () => {
    const position = build('f8 g8 h8', 'e8 a1 o1');
    const set = position.fours[0];
    const found = [...set.list.subarray(0, set.size)].map((cell) => INDEX_OF[cell]).sort((a, b) => a - b);
    expect(found).toEqual([at('i8'), at('j8')].sort((a, b) => a - b));
  });
});

describe('Gomoku continuous fours', () => {
  it('finds a four that forces a fork', () => {
    const position = build('f8 g8 h8 i9 i10', 'e8 a1 o1 a15 o15');
    const first = vcf(context(position), 0, 8);
    expect(INDEX_OF[first]).toBe(at('i8'));
    const choice = searchBestMove(position, 0, false, options());
    expect(choice?.index).toBe(at('i8'));
    expect(choice!.score).toBeGreaterThan(WIN / 2);
  });

  it('does not claim a win the defender can parry', () => {
    const position = build('f8 g8 h8 i9', 'e8 a1 o1 a15');
    expect(vcf(context(position), 0, 8)).toBe(-1);
  });

  it('wins with a double four, and not with the one that Renju forbids black', () => {
    const open = build('f8 g8 h8 i9 i10 i11', 'e8 i12 a1 o1 a15 o15');
    expect(INDEX_OF[vcf(context(open), 0, 8)]).toBe(at('i8'));
    const renju = build('f8 g8 h8 i9 i10 i11', 'e8 i12 a1 o1 a15 o15', true);
    expect(gmForbidden(renju.stones, at('i8'))).toBe(true);
    expect(vcf(context(renju), 0, 8)).toBe(-1);
    const white = build('a1 o1 a15 o15 a8 o8', 'f8 g8 h8 i9 i10 i11', true);
    expect(white.legal(CELL_OF[at('i8')], 1)).toBe(true);
  });

  it('leaves the position as it found it', () => {
    const position = build('f8 g8 h8 i9 i10', 'e8 a1 o1 a15 o15');
    const stones = [...position.stones];
    const hash = [position.hashA, position.hashB];
    vcf(context(position), 0, 8);
    vct(context(position), 0, 4);
    expect([...position.stones]).toEqual(stones);
    expect([position.hashA, position.hashB]).toEqual(hash);
  });
});

describe('Gomoku continuous threes', () => {
  it('finds a double three that no single move answers', () => {
    const position = build('g8 h8 i9 i10', 'a1 o1 a15 o15');
    expect(vcf(context(position), 0, 8)).toBe(-1);
    const first = vct(context(position), 0, 4);
    expect(INDEX_OF[first]).toBe(at('i8'));
    expect(searchBestMove(position, 0, false, options())!.score).toBeGreaterThan(WIN / 2);
  });

  it('does not find a win in a quiet position', () => {
    const position = build('h8 i9', 'g9 i7');
    expect(vct(context(position), 0, 4)).toBe(-1);
    expect(winThreat(position, 0)).toBe(false);
  });

  it('respects its node limit', () => {
    const position = build('g8 h8 i9 i10', 'a1 o1 a15 o15');
    const limited = context(position);
    limited.limit = 3;
    expect(vct(limited, 0, 4)).toBe(-1);
    expect(limited.nodes).toBeLessThan(10);
  });
});

describe('Gomoku forced defence', () => {
  it('blocks a four, and blocks an open three at one of its ends', () => {
    const four = build('a1 o1 a15 o15', 'f8 g8 h8 i8');
    expect([at('e8'), at('j8')]).toContain(searchBestMove(four, 0, false, options())!.index);
    const three = build('a1 o1 a15', 'f8 g8 h8');
    for (let seed = 1; seed <= 4; seed++) {
      const result = searchBestMove(three, 0, false, options(seed));
      expect([at('e8'), at('i8')]).toContain(result!.index);
    }
  });

  it('answers a four-three threat with a move that stops it', () => {
    const position = build('a1 o1 a15 o15', 'f8 g8 h8 i9 i10');
    expect(winThreat(position, 1)).toBe(true);
    const result = searchBestMove(position, 0, false, options());
    // The fork cell, or the cells that make either of its lines.
    expect([at('i8'), at('e8'), at('j8'), at('i11'), at('i7')]).toContain(result!.index);
  });

  it('loses when the only block is a forbidden point for black', () => {
    const position = build('f8 g8 h9 h10 o15', 'e5 f6 g7 i9 a1', true);
    expect(gmForbidden(position.stones, at('h8'))).toBe(true);
    const result = searchBestMove(position, 0, true, options(2));
    expect(result!.score).toBeLessThan(-WIN / 2);
    expect(gmLegalMoves(position.stones, 0, true)).toContain(result!.index);
  });
});

describe('Gomoku search discipline', () => {
  it('leaves the position untouched and returns an empty point', () => {
    const position = build('h8 g9 i9 f10 j10', 'g8 i8 h9 h7 g10');
    const stones = [...position.stones];
    const hash = [position.hashA, position.hashB];
    const result = searchBestMove(position, 0, false, options());
    expect([...position.stones]).toEqual(stones);
    expect([position.hashA, position.hashB]).toEqual(hash);
    expect(stones[result!.index]).toBeNull();
  });

  it('answers within a small node budget with a legal point', () => {
    const position = build('h8 g9 i9 f10 j10', 'g8 i8 h9 h7 g10');
    const started = performance.now();
    const result = searchBestMove(position, 0, false, { maxDepth: 30, expired: () => false, maxNodes: 1500, random: () => 0.3 });
    expect(performance.now() - started).toBeLessThan(500);
    expect(gmLegalMoves(position.stones, 0, false)).toContain(result!.index);
  });

  it('knows a lost position when white holds an open four', () => {
    const position = build('a1 a3', 'h8 i8 j8 k8', true);
    expect(position.winCells(1)).toBe(2);
    expect(searchBestMove(position, 0, true, options(2))!.score).toBeLessThan(-WIN / 2);
  });
});
