import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GameSeat } from '@shared/types';
import { loadArenaBot } from '../../../scripts/bot-arena/arena-bots';
import type { ArenaBot } from '../../../scripts/bot-arena/arena-bots';
import { arenaSeats, playMatch, seatSides } from '../../../scripts/bot-arena/arena-match';
import type { MatchRecord, Side } from '../../../scripts/bot-arena/arena-match';
import { installSeededRandom } from '../../../scripts/bot-arena/arena-random';
import { signTestPValue, summarize } from '../../../scripts/bot-arena/arena-report';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

function record(pair: number, swapped: boolean, winners: readonly Side[]): MatchRecord {
  const tally = { decisions: 1, totalMs: 2, maxMs: 2, fallbacks: 0 };
  return {
    pair, swapped, steps: 1, fallbackReasons: [], tally: { candidate: tally, baseline: tally },
    seats: (['N', 'S'] as const).map((seat, index) => ({
      seat, side: index === 0 ? 'candidate' : 'baseline', won: winners.includes(index === 0 ? 'candidate' : 'baseline'), score: null,
    })),
  };
}

describe('bot arena seating', () => {
  it('chooses seats by player count', () => {
    expect(arenaSeats('hearts')).toEqual(['N', 'E', 'S', 'W']);
    expect(arenaSeats('reversi')).toEqual(['N', 'S']);
    expect(arenaSeats('doudizhu')).toEqual(['N', 'E', 'S']);
    expect(() => arenaSeats('hearts', 3)).toThrow('cannot be played');
  });

  it('puts each side on one team in partnership games and swaps them within a pair', () => {
    const seats = arenaSeats('bridge');
    for (const pair of [0, 1]) {
      const first = seatSides('bridge', seats, pair, false);
      const second = seatSides('bridge', seats, pair, true);
      expect(first.N).toBe(first.S);
      expect(first.E).toBe(first.W);
      expect(first.N).not.toBe(first.E);
      for (const seat of seats) expect(second[seat]).not.toBe(first[seat]);
    }
  });

  it('gives each side every seat once per pair and rotates the split', () => {
    for (const seats of [arenaSeats('hearts'), arenaSeats('doudizhu'), arenaSeats('chess')]) {
      const splits = new Set<string>();
      for (let pair = 0; pair < seats.length; pair++) {
        const first = seatSides('hearts', seats, pair, false);
        const second = seatSides('hearts', seats, pair, true);
        for (const seat of seats) expect(new Set([first[seat], second[seat]])).toEqual(new Set(['candidate', 'baseline']));
        splits.add(seats.map((seat: GameSeat) => first[seat]).join());
      }
      // Three seats split 2–1 three different ways; even tables alternate.
      expect(splits.size).toBe(seats.length === 3 ? 3 : 2);
    }
  });
});

describe('bot arena report', () => {
  it('computes an exact two-sided sign test', () => {
    expect(signTestPValue(0, 0)).toBe(1);
    expect(signTestPValue(5, 5)).toBe(1);
    expect(signTestPValue(10, 0)).toBeCloseTo(2 / 1024, 10);
    expect(signTestPValue(1, 9)).toBeCloseTo(22 / 1024, 10);
    expect(signTestPValue(600, 400)).toBeLessThan(1e-9);
  });

  it('tallies duplicate pairs and win shares', () => {
    const summary = summarize([
      record(0, false, ['candidate']), record(0, true, ['candidate']),
      record(1, false, ['baseline']), record(1, true, ['candidate']),
      record(2, false, ['candidate', 'baseline']), record(2, true, ['candidate']),
      { ...record(3, false, []), seats: null, error: 'stuck' },
    ]);
    expect(summary).toMatchObject({ matches: 6, unfinished: 1, candidateShare: 5 / 7 });
    expect(summary.pairs).toMatchObject({ complete: 3, candidateBoth: 1, baselineBoth: 0, split: 1, candidateAhead: 2, baselineAhead: 0 });
    expect(summary.sides.candidate).toMatchObject({ seats: 6, wins: 5, decisions: 7, meanMs: 2, maxMs: 2 });
    expect(summary.errors).toEqual(['pair 3: stuck']);
  });
});

describe('bot arena matches', () => {
  let restore: () => void = () => undefined;
  let bots: Record<Side, ArenaBot>;

  beforeAll(async () => {
    restore = installSeededRandom();
    const bot = await loadArenaBot(REPO_ROOT, 'oldmaid');
    bots = { candidate: bot, baseline: bot };
  });
  afterAll(() => restore());

  it('replays the same deal with the sides exchanged', () => {
    const seats = arenaSeats('oldmaid');
    const plan = { gameType: 'oldmaid' as const, seats, pair: 0, seed: 42 };
    const first = playMatch({ ...plan, swapped: false }, bots);
    const second = playMatch({ ...plan, swapped: true }, bots);
    expect(first.error).toBeUndefined();
    expect(first.tally.candidate.fallbacks + first.tally.baseline.fallbacks).toBe(0);
    // Identical bots on identical deals play identical games, so each seat's result repeats.
    expect(second.steps).toBe(first.steps);
    expect(second.seats!.map(({ seat, won, score }) => ({ seat, won, score })))
      .toEqual(first.seats!.map(({ seat, won, score }) => ({ seat, won, score })));
    expect(second.seats!.map((seat) => seat.side)).toEqual(first.seats!.map((seat) => (seat.side === 'candidate' ? 'baseline' : 'candidate')));
    expect(summarize([first, second]).candidateShare).toBe(0.5);
  });
});
