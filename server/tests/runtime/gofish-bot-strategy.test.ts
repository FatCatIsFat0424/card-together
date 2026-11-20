import { beforeEach, describe, expect, it } from 'vitest';
import { GAME_SEAT_ORDER } from '@shared/constants';
import type { Card, GameSeat, PlayerInfo, Rank, Suit } from '@shared/types';
import type { GoFishLogEntry, GoFishVisibleState } from '@shared/games/gofish/types';
import { GF_BOOKS_PER_HAND, GF_HANDS } from '@shared/rules/gofish';
import { getBotAction } from '../../src/bots/bot-decisions';
import type { BotAction } from '../../src/bots/bot-decisions';
import { gameBot } from '../../src/bots/bot-registry';
import { certainHolder, GF_RANKS, goFishKnowledge, rankIndex, sampleGoFishWorld } from '../../src/bots/gofish-knowledge';
import type { GoFishKnowledge } from '../../src/bots/gofish-knowledge';
import { goFishSearch } from '../../src/bots/gofish-search';
import { scoreGoFishAsks } from '../../src/bots/gofish-strategy';
import type { SearchContext } from '../../src/bots/search/search-types';
import { seededRandom } from '../../src/bots/search/seeded-random';
import { firstLegalAction } from '../../src/runtime/automated-action';
import * as gf from '../../src/managers/games/gofish-game';
import { runSeededGame } from './seeded-game-runner';

const card = (suit: Suit, rank: Rank): Card => ({ suit, rank });

function counts(entries: Partial<Record<GameSeat, number>>): Record<GameSeat, number> {
  return Object.fromEntries(GAME_SEAT_ORDER.map((seat) => [seat, entries[seat] ?? 0])) as Record<GameSeat, number>;
}

/** A view whose stock holds every card not in a hand or a book, unless the test sets it. */
function view(myHand: Card[], overrides: Partial<GoFishVisibleState> = {}): GoFishVisibleState {
  const base: GoFishVisibleState = {
    gameType: 'gofish', phase: 'playing', mySeat: 'N', seats: ['N', 'E', 'S', 'W'], myHand,
    handCounts: counts({ N: myHand.length, E: 5, S: 5, W: 5 }), hand: 1,
    books: Object.fromEntries(GAME_SEAT_ORDER.map((seat) => [seat, []])) as unknown as Record<GameSeat, Rank[]>,
    scores: counts({}), currentTurnSeat: 'N', stockCount: 0, log: [], result: null, ...overrides,
  };
  const held = Object.values(base.handCounts).reduce((sum, value) => sum + value, 0);
  const booked = Object.values(base.books).reduce((sum, ranks) => sum + ranks.length, 0);
  return overrides.stockCount === undefined ? { ...base, stockCount: 52 - held - 4 * booked } : base;
}

const dealt: GoFishLogEntry = { type: 'hand', hand: 1, first: 'N', timestamp: 0 };

const ask = (seat: GameSeat, target: GameSeat, rank: Rank, given = 0, fished: 'lucky' | 'miss' | 'empty' | null = null): GoFishLogEntry => ({
  type: 'ask', seat, target, rank, given, fished: given > 0 ? null : fished ?? 'miss', timestamp: 1,
});

function chosen(action: BotAction | null): { target: GameSeat; rank: Rank } {
  if (action?.type !== 'game-action' || action.request.gameType !== 'gofish') throw new Error('Expected an ask');
  const { target, rank } = action.request.action;
  return { target, rank };
}

function context(seed: number, budgetMs: number): SearchContext {
  const began = performance.now();
  const timeLeftMs = (): number => Math.max(0, budgetMs - (performance.now() - began));
  return { random: seededRandom(seed), budget: { maxDepth: undefined, timeLeftMs, expired: () => timeLeftMs() === 0 } };
}

/** Chance the estimate gives `target` holding `rank`, over many deals. */
function chance(visible: GoFishVisibleState, target: GameSeat, rank: Rank): number {
  const asks = scoreGoFishAsks(visible, goFishKnowledge(visible), seededRandom(3), 400);
  const found = asks.find((entry) => entry.target === target && entry.rank === rank);
  if (!found) throw new Error('No such ask');
  const knowledge = goFishKnowledge(visible);
  const seat = knowledge.seats.indexOf(target);
  let held = 0;
  const random = seededRandom(7);
  for (let deal = 0; deal < 400; deal++) if (sampleGoFishWorld(knowledge, random)!.counts[seat * GF_RANKS + rankIndex(rank)] > 0) held++;
  return held / 400;
}

const samples = [0, 0.3, 0.6, 0.9999];

describe('Go Fish fallback and turn guards', () => {
  const hand = [card('clubs', 3), card('hearts', 9), card('spades', 9), card('hearts', 2)];

  it('asks only a held rank of an opponent with cards', () => {
    const visible = view(hand, { handCounts: counts({ N: 4, E: 5, S: 0, W: 3 }) });
    for (const sample of samples) {
      const pick = chosen(getBotAction(visible, () => sample));
      expect([9, 3, 2]).toContain(pick.rank);
      expect(['E', 'W']).toContain(pick.target);
    }
  });

  it('makes the timeout and fallback choices legal too', () => {
    const visible = view(hand, { handCounts: counts({ N: 4, E: 0, S: 2, W: 0 }) });
    expect(chosen(firstLegalAction(visible))).toEqual({ target: 'S', rank: 9 });
    const bot = gameBot('gofish');
    expect(bot.turnTimeout).toBeUndefined();
    const timeout = chosen(bot.decide(visible, () => 0.5));
    expect(timeout.target).toBe('S');
    expect(hand.some((own) => own.rank === timeout.rank)).toBe(true);
  });

  it('does nothing off turn or with nobody to ask', () => {
    expect(getBotAction(view(hand, { currentTurnSeat: 'E' }), () => 0.5)).toBeNull();
    expect(getBotAction(view(hand, { handCounts: counts({ N: 4 }) }), () => 0.5)).toBeNull();
    expect(getBotAction(view([]), () => 0.5)).toBeNull();
    expect(firstLegalAction(view(hand, { currentTurnSeat: 'S' }))).toBeNull();
    expect(goFishSearch(view(hand, { currentTurnSeat: 'E' }), context(1, 200))).toBeNull();
  });
});

describe('Go Fish knowledge', () => {
  const hand = [card('clubs', 4), card('hearts', 9), card('spades', 9), card('hearts', 2)];

  it('asks a seat known from the public log to hold the rank', () => {
    // E asked S for a 9 and was refused, so E still holds at least one 9.
    const visible = view(hand, { log: [dealt, ask('E', 'S', 9)], handCounts: counts({ N: 4, E: 6, S: 5, W: 5 }) });
    expect(goFishKnowledge(visible).exact).toBe(true);
    for (const sample of samples) expect(chosen(getBotAction(visible, () => sample))).toEqual({ target: 'E', rank: 9 });
  });

  it('follows the cards: a taker holds the rank and the old holder no longer does', () => {
    const visible = view(hand, { log: [dealt, ask('E', 'S', 9), ask('W', 'E', 9, 1)], handCounts: counts({ N: 4, E: 5, S: 5, W: 6 }) });
    expect(goFishKnowledge(visible).exact).toBe(true);
    for (const sample of samples) expect(chosen(getBotAction(visible, () => sample))).toEqual({ target: 'W', rank: 9 });
  });

  it('forgets a holder once the rank is booked or a new hand is dealt', () => {
    const booked = view([card('clubs', 4)], {
      log: [dealt, ask('E', 'S', 9, 3), { type: 'book', seat: 'E', rank: 9, timestamp: 2 }],
      handCounts: counts({ N: 1, E: 4, S: 2, W: 5 }), books: { ...view([]).books, E: [9] },
    });
    expect(goFishKnowledge(booked).exact).toBe(true);
    expect(goFishKnowledge(booked).hidden[rankIndex(9)]).toBe(0);
    expect(goFishKnowledge(booked).hands[1].known[rankIndex(9)]).toBe(0);
    const redealt = view(hand, { log: [dealt, ask('E', 'S', 9), { type: 'hand', hand: 2, first: 'N', timestamp: 2 }], hand: 2 });
    expect(goFishKnowledge(redealt).hands[1].known[rankIndex(9)]).toBe(0);
  });

  it('counts the four copies: none is left for anyone else once they are all accounted for', () => {
    // N holds two 9s and W was shown taking the other two, so E and S cannot hold one.
    const visible = view(hand, { log: [dealt, ask('W', 'S', 9, 1)], handCounts: counts({ N: 4, E: 5, S: 4, W: 6 }) });
    const knowledge = goFishKnowledge(visible);
    expect(knowledge.exact).toBe(true);
    expect(knowledge.hands[3].known[rankIndex(9)]).toBe(2);
    expect(knowledge.hidden[rankIndex(9)]).toBe(0);
    expect(chance(visible, 'E', 9)).toBe(0);
    expect(chance(visible, 'S', 9)).toBe(0);
  });

  it('keeps a refusal for the cards held then, and only frees the cards drawn since', () => {
    // E refused S a 9 and later fished for a 3: of E's six cards only the new one may be a 9.
    const log = [dealt, ask('S', 'E', 9), ask('N', 'S', 9, 1), ask('E', 'W', 3, 0, 'miss')];
    const visible = view([card('hearts', 9), card('spades', 9)], { handCounts: counts({ N: 2, E: 6, S: 5, W: 5 }), log });
    const knowledge = goFishKnowledge(visible);
    expect(knowledge.exact).toBe(true);
    const nines = knowledge.hands[1].unknown.filter((mask) => (mask & (1 << rankIndex(9))) !== 0);
    expect(nines).toHaveLength(1);
    // That card is the missed draw, which was not the 3 E asked for.
    expect(nines[0] & (1 << rankIndex(3))).toBe(0);
    expect(chance(visible, 'E', 9)).toBeLessThan(chance(visible, 'W', 9));
  });

  it('deduces the holder once the stock is empty and the others are ruled out', () => {
    const no5 = ((1 << GF_RANKS) - 1) & ~(1 << rankIndex(5));
    const any = (1 << GF_RANKS) - 1;
    const hidden = new Array<number>(GF_RANKS).fill(0);
    hidden[rankIndex(5)] = 3;
    hidden[rankIndex(8)] = 4;
    const empty = (): number[] => new Array<number>(GF_RANKS).fill(0);
    const knowledge: GoFishKnowledge = {
      seats: ['N', 'E', 'S', 'W'], mine: 0, own: hidden.map((_, rank) => (rank === rankIndex(5) ? 1 : 0)), booked: 0, stock: 0,
      hidden, exact: true,
      hands: [
        { known: empty(), unknown: [] },
        { known: empty(), unknown: [no5, no5] },
        { known: empty(), unknown: [no5] },
        { known: empty(), unknown: [any, any, any, any] },
      ],
    };
    expect(certainHolder(knowledge, 3, rankIndex(5))).toBe(true);
    expect(certainHolder(knowledge, 1, rankIndex(5))).toBe(false);
    const random = seededRandom(11);
    for (let deal = 0; deal < 50; deal++) expect(sampleGoFishWorld(knowledge, random)!.counts[3 * GF_RANKS + rankIndex(5)]).toBe(3);
    // With a card left in the stock, a 5 may still be there.
    expect(certainHolder({ ...knowledge, stock: 1 }, 3, rankIndex(5))).toBe(false);
  });

  it('prefers the rank it holds most of when nothing is known', () => {
    const visible = view([card('clubs', 7), card('hearts', 7), card('spades', 7), card('hearts', 2)], { log: [dealt] });
    expect(goFishKnowledge(visible).exact).toBe(true);
    for (const sample of samples) expect(chosen(getBotAction(visible, () => sample)).rank).toBe(7);
  });

  it('does not mutate the filtered view', () => {
    const visible = view(hand, { log: [dealt, ask('E', 'S', 9), ask('W', 'E', 9, 1)], handCounts: counts({ N: 4, E: 5, S: 5, W: 6 }) });
    const original = structuredClone(visible);
    for (const sample of samples) getBotAction(visible, () => sample);
    goFishSearch(visible, context(2, 100));
    expect(visible).toEqual(original);
  });
});

function playersOf(count: number): Partial<Record<GameSeat, PlayerInfo>> {
  return Object.fromEntries(GAME_SEAT_ORDER.slice(0, count).map((seat) => [seat, {
    id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
  }]));
}

function apply(code: string, seat: GameSeat, action: BotAction | null): void {
  if (action?.type !== 'game-action' || action.request.gameType !== 'gofish') throw new Error('Expected a Go Fish action');
  expect(gf.ask(code, seat, action.request.action.target, action.request.action.rank)).toEqual({ success: true });
}

/** Whether the true hidden cards fit the knowledge: every shown card is there and the rest match the possibilities. */
function truthFits(rankCounts: number[], known: readonly number[], unknown: readonly number[]): boolean {
  const rest: number[] = [];
  for (let rank = 0; rank < GF_RANKS; rank++) {
    if (rankCounts[rank] < known[rank]) return false;
    for (let copy = known[rank]; copy < rankCounts[rank]; copy++) rest.push(rank);
  }
  if (rest.length !== unknown.length) return false;
  const owner = new Array<number>(unknown.length).fill(-1);
  const place = (cardIndex: number, seen: boolean[]): boolean => unknown.some((mask, slot) => {
    if (seen[slot] || (mask & (1 << rest[cardIndex])) === 0) return false;
    seen[slot] = true;
    if (owner[slot] >= 0 && !place(owner[slot], seen)) return false;
    owner[slot] = cardIndex;
    return true;
  });
  return rest.every((_, index) => place(index, new Array<boolean>(unknown.length).fill(false)));
}

describe('Go Fish full matches between bots', () => {
  beforeEach(() => gf.restoreGames([]));

  it.each([2, 3, 4, 5, 6])('finishes with %i players, using only legal asks', (count) => {
    const code = `GFB${count}`;
    const random = seededRandom(count * 31);
    gf.startGame(code, playersOf(count));
    const actions = runSeededGame(code, 20000, () => gf.getGameState(code)?.phase === 'scoring', () => {
      const game = gf.getGameState(code)!;
      const seat = game.currentTurnSeat;
      const visible = gf.getPlayerVisibleState(code, seat)!;
      const action = getBotAction(visible, random);
      const { target, rank } = chosen(action);
      expect(visible.myHand.some((own) => own.rank === rank)).toBe(true);
      expect(target).not.toBe(seat);
      expect(visible.handCounts[target]).toBeGreaterThan(0);
      apply(code, seat, action);
    });
    const game = gf.getGameState(code)!;
    expect(actions).toBeGreaterThan(count);
    expect(game.result?.handBooks).toHaveLength(GF_HANDS);
    for (const books of game.result!.handBooks) {
      expect(Object.values(books).reduce((sum, value) => sum + value, 0)).toBe(GF_BOOKS_PER_HAND);
    }
  });

  it('plays the first legal action when the strategy is bypassed', () => {
    const code = 'GFBFL1';
    gf.startGame(code, playersOf(4));
    runSeededGame(code, 20000, () => gf.getGameState(code)?.phase === 'scoring', () => {
      const game = gf.getGameState(code)!;
      const seat = game.currentTurnSeat;
      apply(code, seat, firstLegalAction(gf.getPlayerVisibleState(code, seat)!));
    });
    expect(gf.getGameState(code)?.result).not.toBeNull();
  });

  it('keeps its knowledge true to the hidden hands and deals only consistent worlds', () => {
    for (const count of [2, 4, 6]) {
      const code = `GFBK${count}`;
      const random = seededRandom(count * 17);
      gf.startGame(code, playersOf(count));
      runSeededGame(code, 20000, () => gf.getGameState(code)?.phase === 'scoring', () => {
        const game = gf.getGameState(code)!;
        const seat = game.currentTurnSeat;
        const visible = structuredClone(gf.getPlayerVisibleState(code, seat)!);
        const knowledge = goFishKnowledge(visible);
        expect(knowledge.exact).toBe(true);
        knowledge.seats.forEach((other, index) => {
          if (index === knowledge.mine) return;
          const truth = new Array<number>(GF_RANKS).fill(0);
          for (const own of game.hands[other]) truth[rankIndex(own.rank)]++;
          expect(truthFits(truth, knowledge.hands[index].known, knowledge.hands[index].unknown)).toBe(true);
        });
        const world = sampleGoFishWorld(knowledge, random)!;
        knowledge.seats.forEach((other, index) => {
          let size = 0;
          for (let rank = 0; rank < GF_RANKS; rank++) size += world.counts[index * GF_RANKS + rank];
          expect(size).toBe(visible.handCounts[other]);
        });
        expect(world.stock).toHaveLength(visible.stockCount);
        apply(code, seat, getBotAction(visible, random));
      });
    }
  });
});

describe('Go Fish search', () => {
  beforeEach(() => gf.restoreGames([]));

  it('plays legal asks within its budget without touching the view', () => {
    const code = 'GFBS1';
    gf.startGame(code, playersOf(4));
    const heuristic = seededRandom(9);
    let searched = 0;
    runSeededGame(code, 20000, () => gf.getGameState(code)?.phase === 'scoring', (step) => {
      const game = gf.getGameState(code)!;
      const seat = game.currentTurnSeat;
      const visible = gf.getPlayerVisibleState(code, seat)!;
      if (step % 9 !== 0) {
        apply(code, seat, getBotAction(visible, heuristic));
        return;
      }
      const before = structuredClone(visible);
      const started = performance.now();
      const action = goFishSearch(visible, context(step, 60));
      expect(performance.now() - started).toBeLessThan(400);
      expect(visible).toEqual(before);
      searched++;
      apply(code, seat, action);
    });
    expect(searched).toBeGreaterThan(5);
  });

  it('takes a certain ask, and the estimate repeats its choice for the same seed', () => {
    const hand = [card('clubs', 4), card('hearts', 9), card('spades', 9), card('hearts', 2)];
    const certain = view(hand, { log: [dealt, ask('E', 'S', 9)], handCounts: counts({ N: 4, E: 6, S: 5, W: 5 }) });
    expect(chosen(goFishSearch(certain, context(4, 200)))).toEqual({ target: 'E', rank: 9 });
    const open = view(hand, { log: [dealt, ask('W', 'E', 3, 0, 'miss')], handCounts: counts({ N: 4, E: 5, S: 5, W: 6 }) });
    expect(goFishKnowledge(open).exact).toBe(true);
    expect(getBotAction(open, seededRandom(5))).toEqual(getBotAction(open, seededRandom(5)));
  });
});
