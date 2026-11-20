import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  DiceFace, GameSeat, LiarsDiceLogEntry, LiarsDiceStandingBid, LiarsDiceVisibleState, PlayerInfo,
} from '@shared/types';
import { GAME_SEAT_ORDER } from '@shared/constants';
import { ldiIsLegalBid, ldiLegalBids, ldiTotalDice } from '@shared/rules/liarsdice';
import { gameSeatMap } from '@shared/rules/seats';
import type { BotAction } from '../../src/bots/bot-decisions';
import { getBotAction } from '../../src/bots/bot-decisions';
import { gameBot } from '../../src/bots/bot-registry';
import { cupPosterior, diceHistory, estimateSharpness, PRIOR_SHARPNESS } from '../../src/bots/liarsdice-belief';
import type { CupPosterior } from '../../src/bots/liarsdice-belief';
import { liarsDiceSearch, winChances } from '../../src/bots/liarsdice-search';
import { getLiarsDiceBotAction, liarsDiceFirstLegalAction } from '../../src/bots/liarsdice-strategy';
import type { SearchContext } from '../../src/bots/search/search-types';
import { seededRandom } from '../../src/bots/search/seeded-random';
import { firstLegalAction } from '../../src/runtime/automated-action';
import * as dice from '../../src/managers/games/liarsdice-game';
import { runSeededGame } from './seeded-game-runner';

const CODE = 'DICEBOT';

function view(
  myDice: DiceFace[], overrides: Partial<LiarsDiceVisibleState> & { others?: Partial<Record<GameSeat, number>> } = {},
): LiarsDiceVisibleState {
  const { others = { E: 5, S: 5 }, ...rest } = overrides;
  return {
    gameType: 'liarsdice', phase: 'playing', mySeat: 'N', seats: ['N', 'E', 'S'], myDice,
    diceCounts: gameSeatMap((seat) => seat === 'N' ? myDice.length : others[seat] ?? 0), round: 1, bid: null, onesWild: true,
    currentTurnSeat: 'N', eliminated: [], log: [], result: null, ...rest,
  };
}

const bidBy = (seat: GameSeat, quantity: number, face: DiceFace): LiarsDiceStandingBid => ({ seat, quantity, face });
const roundEntry = (counts: Partial<Record<GameSeat, number>>, starter: GameSeat = 'N'): LiarsDiceLogEntry =>
  ({ type: 'round', round: 1, starter, counts: gameSeatMap((seat) => counts[seat] ?? 0), timestamp: 0 });
const bidEntry = (seat: GameSeat, quantity: number, face: DiceFace): LiarsDiceLogEntry =>
  ({ type: 'bid', seat, quantity, face, timestamp: 0 });

/** A search context with a wall-clock budget; a seeded generator makes equal views give equal answers. */
function context(seed: number, budgetMs: number): SearchContext {
  const began = performance.now();
  const timeLeftMs = (): number => Math.max(0, budgetMs - (performance.now() - began));
  return { random: seededRandom(seed), budget: { maxDepth: undefined, timeLeftMs, expired: () => timeLeftMs() === 0 } };
}

function move(action: BotAction | null): { type: 'bid'; quantity: number; face: DiceFace } | { type: 'challenge' } {
  if (action?.type !== 'game-action' || action.request.gameType !== 'liarsdice') throw new Error('Expected a dice action');
  return action.request.action;
}

/** Plays a fixed number of searches per decision so equal views always give equal answers. */
function decided(visible: LiarsDiceVisibleState, seed = 3, samples = 300): ReturnType<typeof move> {
  return move(liarsDiceSearch(visible, context(seed, 5_000), { maxSamples: samples }));
}

/** Mean number of dice counting toward `face` in a posterior. */
function meanMatches(posterior: CupPosterior, face: number): number {
  let before = 0;
  let mean = 0;
  posterior.counts.forEach((cup, index) => {
    mean += (posterior.cumulative[index] - before) * cup[face];
    before = posterior.cumulative[index];
  });
  return mean;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

describe("Liar's Dice win chances", () => {
  it('should treat every die as a life: the race to run out is even only at equal stacks', () => {
    expect(winChances([3, 3])).toEqual([0.5, 0.5]);
    const [ahead, behind] = winChances([4, 1]);
    expect(ahead).toBeCloseTo(15 / 16, 10);
    expect(behind).toBeCloseTo(1 / 16, 10);
  });

  it('should sum to one over the seats alive and give an eliminated seat nothing', () => {
    for (const sizes of [[5, 5, 5, 5], [5, 3, 0, 1], [2, 1, 1], [5, 5, 5, 5, 5, 5, 5, 5]]) {
      const chances = winChances(sizes);
      expect(chances.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 10);
      sizes.forEach((size, index) => { if (size === 0) expect(chances[index]).toBe(0); });
    }
  });

  it('should reward taking a die from someone else and treat losing the last one as the end', () => {
    const start = winChances([5, 5, 5, 5])[0];
    expect(start).toBeCloseTo(0.25, 10);
    expect(winChances([4, 5, 5, 5])[0]).toBeLessThan(start);
    expect(winChances([5, 4, 5, 5])[0]).toBeGreaterThan(start);
    expect(winChances([5, 1, 5, 5])[0]).toBeGreaterThan(winChances([5, 4, 5, 5])[0]);
    expect(winChances([0, 5, 5, 5])[0]).toBe(0);
  });
});

describe("Liar's Dice belief", () => {
  it('should read the round in progress and the wild state each bid was made under', () => {
    const visible = view([1, 2, 3, 4, 5], {
      log: [roundEntry({ N: 5, E: 5, S: 5 }), bidEntry('N', 2, 3), bidEntry('E', 2, 1), bidEntry('S', 3, 1)],
    });
    const history = diceHistory(visible);
    expect(history.lifted).toHaveLength(0);
    expect(history.current.map((bid) => [bid.seat, bid.quantity, bid.face, bid.wild])).toEqual([
      ['N', 2, 3, true], ['E', 2, 1, true], ['S', 3, 1, false],
    ]);
  });

  it('should be uniform without evidence and lean toward the face a seat named', () => {
    const plain = cupPosterior(5, [], PRIOR_SHARPNESS);
    expect(plain.cumulative[plain.cumulative.length - 1]).toBeCloseTo(1, 10);
    expect(meanMatches(plain, 6)).toBeCloseTo(5 / 6, 10);
    const bid = { seat: 'E' as GameSeat, quantity: 3, face: 6 as DiceFace, wild: true };
    const named = cupPosterior(5, [bid, bid], PRIOR_SHARPNESS);
    expect(meanMatches(named, 6)).toBeGreaterThan(meanMatches(plain, 6) + 0.4);
    expect(meanMatches(named, 3)).toBeLessThan(meanMatches(plain, 3));
    expect(meanMatches(cupPosterior(5, [bid, bid], 0), 6)).toBeCloseTo(5 / 6, 10);
  });

  /** A log of `rounds` lifted rounds in which E bids the face it holds most of (or the face it holds least of). */
  function liftedLog(rounds: number, honest: boolean): LiarsDiceLogEntry[] {
    const random = seededRandom(11);
    const log: LiarsDiceLogEntry[] = [];
    for (let round = 0; round < rounds; round++) {
      const eDice = Array.from({ length: 5 }, () => 1 + Math.floor(random() * 6)) as DiceFace[];
      const tally = [1, 2, 3, 4, 5, 6].map((face) => ({ face: face as DiceFace, count: eDice.filter((die) => die === face).length }));
      tally.sort((a, b) => (honest ? b.count - a.count : a.count - b.count) || a.face - b.face);
      log.push(roundEntry({ N: 5, E: 5, S: 5 }), bidEntry('E', 2, tally[0].face));
      log.push({
        type: 'challenge', seat: 'S', target: 'E', quantity: 2, face: tally[0].face, wild: false,
        dice: gameSeatMap((seat) => (seat === 'E' ? eDice : [])), count: 0, bidTrue: false, loser: 'E', eliminated: false, timestamp: 0,
      });
    }
    return log;
  }

  it('should fit how sharply the table names faces from the rounds already lifted', () => {
    const none = estimateSharpness(diceHistory(view([1, 2, 3, 4, 5])), 'N');
    expect(none).toBe(PRIOR_SHARPNESS);
    const sharp = estimateSharpness(diceHistory(view([1], { log: liftedLog(30, true) })), 'N');
    const misleading = estimateSharpness(diceHistory(view([1], { log: liftedLog(30, false) })), 'N');
    expect(sharp).toBeGreaterThan(PRIOR_SHARPNESS);
    expect(misleading).toBeLessThan(PRIOR_SHARPNESS);
    // Only other seats count: the bot's own bids say nothing about the table.
    expect(estimateSharpness(diceHistory(view([1], { log: liftedLog(30, true) })), 'E')).toBe(PRIOR_SHARPNESS);
  });
});

describe("Liar's Dice search", () => {
  it('should call a bid that cannot be true and accept one that is almost certain', () => {
    const absurd = view([2, 2, 3, 3, 5], { bid: bidBy('E', 15, 6) });
    expect(decided(absurd)).toEqual({ type: 'challenge' });
    const modest = view([2, 2, 2, 3, 5], { bid: bidBy('E', 1, 2) });
    expect(decided(modest).type).toBe('bid');
  });

  it('should call a bid far above the dice on the table and raise a bid it holds itself', () => {
    expect(decided(view([6, 6, 6, 6, 6], { bid: bidBy('E', 9, 3) }))).toEqual({ type: 'challenge' });
    expect(decided(view([4, 4, 4, 4, 1], { bid: bidBy('E', 4, 4) })).type).toBe('bid');
  });

  it('should open with a bid that fits the table and name a face it can back', () => {
    const holding = view([5, 5, 5, 5, 2], { others: { E: 5 } });
    const opening = decided(holding);
    expect(opening.type).toBe('bid');
    if (opening.type === 'bid') expect(opening.quantity).toBeLessThanOrEqual(ldiTotalDice(holding.diceCounts));
  });

  it('should call when no raise exists', () => {
    const full = view([3], { bid: bidBy('E', 2, 1), others: { E: 1 } });
    expect(ldiLegalBids(full.bid, 2)).toEqual([]);
    for (const action of [getLiarsDiceBotAction(full, () => 0.5), liarsDiceFirstLegalAction(full)]) {
      expect(move(action)).toEqual({ type: 'challenge' });
    }
  });

  it('should do nothing when it is not its turn or the match is over', () => {
    expect(getLiarsDiceBotAction(view([1, 2, 3, 4, 5], { currentTurnSeat: 'E' }), () => 0.5)).toBeNull();
    expect(getBotAction(view([1, 2, 3, 4, 5], { phase: 'scoring' }), () => 0.5)).toBeNull();
    expect(liarsDiceSearch(view([1, 2, 3, 4, 5], { currentTurnSeat: 'E' }), context(1, 50))).toBeNull();
  });

  it('should stay inside its budget and leave the view alone', () => {
    const visible = deepFreeze(view([2, 4, 4, 5, 6], { bid: bidBy('E', 4, 4), others: { E: 5, S: 5 } }));
    const before = structuredClone(visible);
    const started = performance.now();
    expect(liarsDiceSearch(visible, context(5, 60))).not.toBeNull();
    expect(performance.now() - started).toBeLessThan(400);
    expect(visible).toEqual(before);
  });
});

describe("Liar's Dice bot honesty about information", () => {
  it('should decide the same whatever the other cups hold', () => {
    // The visible state never carries other cups, so equal views must give equal moves.
    const own = view([3, 3, 4, 5, 6], { bid: bidBy('E', 4, 3) });
    expect(decided(structuredClone(own))).toEqual(decided(own));
    expect(Object.keys(own)).not.toContain('hands');
  });

  it('should treat a seat that named a face earlier this round as likelier to hold it', () => {
    const calls = (log: LiarsDiceLogEntry[]): number => {
      let called = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const visible = view([2, 3, 4, 4, 5], { bid: bidBy('E', 4, 6), others: { E: 5, S: 5 }, log });
        if (decided(visible, seed, 600).type === 'challenge') called++;
      }
      return called;
    };
    const sixes = [roundEntry({ N: 5, E: 5, S: 5 }), bidEntry('E', 1, 6), bidEntry('S', 2, 6), bidEntry('N', 3, 6), bidEntry('E', 4, 6)];
    const quiet = [roundEntry({ N: 5, E: 5, S: 5 }), bidEntry('E', 4, 6)];
    expect(calls(sixes)).toBeLessThanOrEqual(calls(quiet));
  });
});

describe("Liar's Dice legality", () => {
  afterEach(() => {
    dice.restoreGames([]);
    vi.restoreAllMocks();
  });

  function player(seat: GameSeat): PlayerInfo {
    return { id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null };
  }

  /** Plays a whole match with the synchronous bot and asserts every move is legal and leaves the view intact. */
  function playMatch(seats: readonly GameSeat[], seed: number): void {
    const random = seededRandom(seed);
    dice.startGame(CODE, Object.fromEntries(seats.map((seat) => [seat, player(seat)])), random);
    runSeededGame('liarsdice bot match', 2_000, () => dice.getGameState(CODE)?.phase === 'scoring', () => {
      const state = dice.getGameState(CODE)!;
      const seat = state.currentTurnSeat;
      const visible = deepFreeze(structuredClone(dice.getPlayerVisibleState(CODE, seat)!));
      const total = ldiTotalDice(visible.diceCounts);
      const choice = move(getBotAction(visible, random));
      if (choice.type === 'challenge') {
        expect(visible.bid).not.toBeNull();
        expect(visible.bid?.seat).not.toBe(seat);
        expect(dice.challenge(CODE, seat, 0, random).success).toBe(true);
      } else {
        expect(ldiIsLegalBid(visible.bid, choice, total)).toBe(true);
        expect(dice.bid(CODE, seat, choice.quantity, choice.face, 0).success).toBe(true);
      }
    });
    expect(dice.getGameState(CODE)?.result).not.toBeNull();
  }

  it('should play complete matches of every table size without an illegal move', () => {
    playMatch(['N', 'E'], 1);
    playMatch(['N', 'E', 'S'], 2);
    playMatch(['N', 'S', 'W', 'P5', 'P7'], 3);
    playMatch(GAME_SEAT_ORDER, 4);
  });

  it('should answer a random view with a legal move from the registry, the fallback and the timeout hook', () => {
    const random = seededRandom(77);
    const bot = gameBot('liarsdice');
    expect(bot.turnTimeout).toBeUndefined();
    expect(bot.search?.budgetMs).toBeGreaterThan(0);
    for (let round = 0; round < 60; round++) {
      const seats = GAME_SEAT_ORDER.filter(() => random() < 0.6);
      const players: GameSeat[] = seats.length >= 2 ? seats : ['N', 'E'];
      const mySeat = players[Math.floor(random() * players.length)];
      const counts = gameSeatMap((seat) => players.includes(seat) ? 1 + Math.floor(random() * 5) : 0);
      const myDice = Array.from({ length: counts[mySeat] }, () => 1 + Math.floor(random() * 6)) as DiceFace[];
      const bids = ldiLegalBids(null, ldiTotalDice(counts));
      const others = players.filter((seat) => seat !== mySeat);
      const standing = random() < 0.3 ? null : { ...bids[Math.floor(random() * bids.length)], seat: others[Math.floor(random() * others.length)] };
      const visible: LiarsDiceVisibleState = {
        gameType: 'liarsdice', phase: 'playing', mySeat, seats: players, myDice, diceCounts: counts, round: 1, bid: standing,
        onesWild: random() < 0.7, currentTurnSeat: mySeat, eliminated: [], log: [], result: null,
      };
      for (const action of [bot.decide(visible, random), bot.firstLegal(visible), firstLegalAction(visible)]) {
        const choice = move(action);
        if (choice.type === 'bid') expect(ldiIsLegalBid(visible.bid, choice, ldiTotalDice(counts))).toBe(true);
        else expect(visible.bid && visible.bid.seat !== visible.mySeat).toBe(true);
      }
    }
  });

  it('should challenge a standing bid and otherwise open with the least bid as the first legal move', () => {
    expect(move(liarsDiceFirstLegalAction(view([1, 2, 3, 4, 5], { bid: bidBy('E', 2, 4) })))).toEqual({ type: 'challenge' });
    expect(move(liarsDiceFirstLegalAction(view([1, 2, 3, 4, 5])))).toEqual({ type: 'bid', quantity: 1, face: 2 });
    expect(liarsDiceFirstLegalAction(view([1, 2, 3, 4, 5], { currentTurnSeat: 'E' }))).toBeNull();
  });
});
