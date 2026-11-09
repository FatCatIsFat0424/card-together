import { describe, expect, it } from 'vitest';
import type { GameSeat } from '@shared/types';
import type { DominoPlacement, DominoTile } from '@shared/games/dominoes/types';
import {
  dmAllTiles, dmBlocked, dmEnds, dmFittingSides, dmHandSize, dmKnownVoids, dmLeaders, dmMatchOver, dmOpening,
  dmPlacement, dmResolveSide, dmScoreRound, dmSortHand, dmTurnOptions, DM_MAX_ROUNDS,
} from '@shared/rules/dominoes';

const t = (a: number, b: number): DominoTile => [Math.min(a, b), Math.max(a, b)] as unknown as DominoTile;
const placed = (tile: DominoTile, left: number, right: number): DominoPlacement => ({ tile, left, right }) as DominoPlacement;

describe('Dominoes tiles and dealing', () => {
  it('builds the 28-tile double-six set once', () => {
    const tiles = dmAllTiles();
    expect(tiles).toHaveLength(28);
    expect(new Set(tiles.map(([low, high]) => `${low}-${high}`)).size).toBe(28);
    expect(tiles.every(([low, high]) => low <= high)).toBe(true);
  });

  it('deals seven tiles to two players and five to three or four', () => {
    expect([2, 3, 4].map(dmHandSize)).toEqual([7, 5, 5]);
  });

  it('sorts hands heaviest first', () => {
    expect(dmSortHand([t(0, 1), t(6, 6), t(2, 5), t(3, 3)])).toEqual([t(6, 6), t(2, 5), t(3, 3), t(0, 1)]);
  });
});

describe('Dominoes opening tile', () => {
  const seats: GameSeat[] = ['N', 'E', 'S'];

  it('goes to the holder of the highest double', () => {
    const hands = { N: [t(5, 5), t(6, 4)], E: [t(3, 3), t(6, 5)], S: [t(4, 4), t(1, 2)] };
    expect(dmOpening(hands, seats)).toEqual({ seat: 'N', tile: t(5, 5) });
  });

  it('falls back to the heaviest tile when nobody holds a double, breaking ties on the higher half', () => {
    const hands = { N: [t(1, 6), t(0, 2)], E: [t(3, 4), t(2, 4)], S: [t(0, 5), t(1, 2)] };
    expect(dmOpening(hands, seats)).toEqual({ seat: 'N', tile: t(1, 6) });
  });
});

describe('Dominoes line and legal plays', () => {
  const line = [placed(t(2, 5), 2, 5), placed(t(5, 5), 5, 5), placed(t(5, 6), 5, 6)];

  it('reports the open numbers at both ends', () => {
    expect(dmEnds([])).toBeNull();
    expect(dmEnds(line)).toEqual({ left: 2, right: 6 });
  });

  it('places a tile with its matching half touching the line', () => {
    expect(dmPlacement(t(2, 4), 'left', line)).toEqual({ tile: t(2, 4), left: 4, right: 2 });
    expect(dmPlacement(t(0, 6), 'right', line)).toEqual({ tile: t(0, 6), left: 6, right: 0 });
    expect(dmPlacement(t(3, 3), 'right', line)).toBeNull();
    expect(dmPlacement(t(3, 4), null, [])).toEqual({ tile: t(3, 4), left: 3, right: 4 });
  });

  it('lays a double crosswise with one open number', () => {
    const ends = dmPlacement(t(6, 6), 'right', line);
    expect(ends).toEqual({ tile: t(6, 6), left: 6, right: 6 });
  });

  it('offers both ends only when a tile fits both and they differ', () => {
    expect(dmFittingSides(t(2, 6), line)).toEqual(['left', 'right']);
    expect(dmResolveSide(t(2, 6), line, undefined)).toEqual({ error: 'Choose an end for the tile.' });
    expect(dmResolveSide(t(2, 6), line, 'left')).toEqual({ side: 'left' });
    expect(dmResolveSide(t(4, 6), line, undefined)).toEqual({ side: 'right' });
    expect(dmResolveSide(t(4, 6), line, 'left')).toEqual({ error: 'That tile does not match that end.' });
    expect(dmResolveSide(t(0, 1), line, undefined)).toEqual({ error: 'That tile does not match an end.' });
    const same = [placed(t(3, 3), 3, 3)];
    expect(dmResolveSide(t(3, 4), same, undefined)).toEqual({ side: 'right' });
  });

  it('lists a tile once per fitting end, and forces the opening tile on an empty line', () => {
    const options = dmTurnOptions([t(2, 6), t(4, 6), t(0, 1)], line, 5, null);
    expect(options.plays).toEqual([
      { tile: t(2, 6), side: 'left' }, { tile: t(2, 6), side: 'right' }, { tile: t(4, 6), side: 'right' },
    ]);
    expect(options).toMatchObject({ canDraw: false, canPass: false });
    const opening = dmTurnOptions([t(3, 3), t(6, 6)], [], 5, t(6, 6));
    expect(opening.plays).toEqual([{ tile: t(6, 6), side: null }]);
    expect(dmTurnOptions([t(3, 3), t(6, 6)], [], 5, null).plays).toHaveLength(2);
  });

  it('draws while the boneyard has tiles, and passes when it is empty', () => {
    expect(dmTurnOptions([t(0, 1)], line, 3, null)).toEqual({ plays: [], canDraw: true, canPass: false });
    expect(dmTurnOptions([t(0, 1)], line, 0, null)).toEqual({ plays: [], canDraw: false, canPass: true });
  });
});

describe('Dominoes scoring', () => {
  const seats: GameSeat[] = ['N', 'E', 'S'];
  const hands = (n: DominoTile[], e: DominoTile[], s: DominoTile[]): Record<GameSeat, DominoTile[]> =>
    ({ N: n, E: e, S: s, W: [], P5: [], P6: [], P7: [], P8: [] });

  it('scores every opponent hand to the seat that went out', () => {
    expect(dmScoreRound(hands([], [t(6, 6), t(1, 2)], [t(0, 4)]), seats, 'N'))
      .toEqual({ reason: 'domino', winner: 'N', points: 19 });
  });

  it('gives a blocked round to the lowest total, scoring all the other hands', () => {
    expect(dmScoreRound(hands([t(3, 3)], [t(1, 1)], [t(6, 2)]), seats, null))
      .toEqual({ reason: 'blocked', winner: 'E', points: 14 });
  });

  it('scores nothing when the lowest total is tied', () => {
    expect(dmScoreRound(hands([t(1, 2)], [t(0, 3)], [t(6, 6)]), seats, null))
      .toEqual({ reason: 'tie', winner: null, points: 0 });
  });

  it('ends the match at the target or the round cap, and shares a tied lead', () => {
    const scores = { N: 100, E: 100, S: 40, W: 0, P5: 0, P6: 0, P7: 0, P8: 0 };
    expect(dmLeaders(seats, scores)).toEqual(['N', 'E']);
    expect(dmMatchOver(seats, scores, 100, 3)).toBe(true);
    expect(dmMatchOver(seats, scores, 150, 3)).toBe(false);
    expect(dmMatchOver(seats, scores, 150, DM_MAX_ROUNDS)).toBe(true);
  });
});

describe('Dominoes blocked rounds', () => {
  const line = [placed(t(2, 5), 2, 5)];

  it('needs an empty boneyard and no tile for either end', () => {
    expect(dmBlocked([[t(0, 1)], [t(3, 4)]], line, 0)).toBe(true);
    expect(dmBlocked([[t(0, 1)], [t(3, 4)]], line, 1)).toBe(false);
    expect(dmBlocked([[t(0, 2)], [t(3, 4)]], line, 0)).toBe(false);
    expect(dmBlocked([[t(0, 1)]], [], 0)).toBe(false);
  });
});

describe('Dominoes public inference', () => {
  const log = (entries: unknown[]) => entries as Parameters<typeof dmKnownVoids>[0];

  it('marks the open numbers a seat could not match, and clears them when it plays', () => {
    const voids = dmKnownVoids(log([
      { type: 'round', round: 1 },
      { type: 'pass', seat: 'E', ends: { left: 2, right: 6 } },
      { type: 'pass', seat: 'S', ends: { left: 2, right: 6 } },
      { type: 'play', seat: 'S', placement: { tile: t(2, 3), left: 3, right: 2 } },
    ]));
    expect([...voids.get('E') ?? []].sort()).toEqual([2, 6]);
    expect([...voids.get('S') ?? []]).toEqual([6]);
  });

  it('forgets older gaps after a draw, which adds an unseen tile', () => {
    const voids = dmKnownVoids(log([
      { type: 'round', round: 1 },
      { type: 'pass', seat: 'E', ends: { left: 1, right: 1 } },
      { type: 'draw', seat: 'E', ends: { left: 4, right: 5 } },
    ]));
    expect([...voids.get('E') ?? []].sort()).toEqual([4, 5]);
  });
});
