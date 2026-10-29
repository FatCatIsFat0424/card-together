import { beforeEach, describe, expect, it } from 'vitest';
import { GAME_SEAT_ORDER } from '@shared/constants';
import type { Card, GameSeat, PlayerInfo, Rank, Suit } from '@shared/types';
import type { GoFishLogEntry, GoFishVisibleState } from '@shared/games/gofish/types';
import { GF_BOOKS_PER_HAND, GF_HANDS } from '@shared/rules/gofish';
import { getBotAction } from '../../src/bots/bot-decisions';
import type { BotAction } from '../../src/bots/bot-decisions';
import { gameBot } from '../../src/bots/bot-registry';
import { firstLegalAction } from '../../src/runtime/automated-action';
import * as gf from '../../src/managers/games/gofish-game';
import { runSeededGame } from './seeded-game-runner';

const card = (suit: Suit, rank: Rank): Card => ({ suit, rank });

function seeded(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function counts(entries: Partial<Record<GameSeat, number>>): Record<GameSeat, number> {
  return Object.fromEntries(GAME_SEAT_ORDER.map((seat) => [seat, entries[seat] ?? 0])) as Record<GameSeat, number>;
}

function view(myHand: Card[], overrides: Partial<GoFishVisibleState> = {}): GoFishVisibleState {
  return {
    gameType: 'gofish', phase: 'playing', mySeat: 'N', seats: ['N', 'E', 'S', 'W'], myHand,
    handCounts: counts({ N: myHand.length, E: 5, S: 5, W: 5 }), hand: 1,
    books: Object.fromEntries(GAME_SEAT_ORDER.map((seat) => [seat, []])) as unknown as Record<GameSeat, Rank[]>,
    scores: counts({}), currentTurnSeat: 'N', stockCount: 20, log: [], result: null, ...overrides,
  };
}

const ask = (seat: GameSeat, target: GameSeat, rank: Rank, given = 0, fished: 'lucky' | 'miss' | 'empty' | null = null): GoFishLogEntry => ({
  type: 'ask', seat, target, rank, given, fished: given > 0 ? null : fished ?? 'miss', timestamp: 1,
});

function chosen(action: BotAction | null): { target: GameSeat; rank: Rank } {
  if (action?.type !== 'game-action' || action.request.gameType !== 'gofish') throw new Error('Expected an ask');
  const { target, rank } = action.request.action;
  return { target, rank };
}

const samples = [0, 0.3, 0.6, 0.9999];

describe('Go Fish easy and fallback bots', () => {
  const hand = [card('clubs', 3), card('hearts', 9), card('spades', 9), card('hearts', 2)];

  it('asks a random held rank of a random opponent with cards', () => {
    const visible = view(hand, { handCounts: counts({ N: 4, E: 5, S: 0, W: 3 }) });
    const picks = samples.map((sample) => chosen(getBotAction(visible, () => sample, 'easy')));
    for (const pick of picks) {
      expect([9, 3, 2]).toContain(pick.rank);
      expect(['E', 'W']).toContain(pick.target);
    }
    expect(new Set(picks.map((pick) => pick.rank)).size).toBeGreaterThan(1);
    expect(new Set(picks.map((pick) => pick.target)).size).toBe(2);
  });

  it('makes the timeout and fallback choices legal too', () => {
    const visible = view(hand, { handCounts: counts({ N: 4, E: 0, S: 2, W: 0 }) });
    expect(chosen(firstLegalAction(visible))).toEqual({ target: 'S', rank: 9 });
    const timeout = gameBot('gofish').turnTimeout?.(visible, { isBot: false, strategy: () => null });
    expect(chosen(timeout ?? null).target).toBe('S');
    expect(hand.some((own) => own.rank === chosen(timeout ?? null).rank)).toBe(true);
  });

  it('does nothing off turn or with nobody to ask', () => {
    for (const difficulty of ['easy', 'hard'] as const) {
      expect(getBotAction(view(hand, { currentTurnSeat: 'E' }), () => 0.5, difficulty)).toBeNull();
      expect(getBotAction(view(hand, { handCounts: counts({ N: 4 }) }), () => 0.5, difficulty)).toBeNull();
      expect(getBotAction(view([]), () => 0.5, difficulty)).toBeNull();
    }
    expect(firstLegalAction(view(hand, { currentTurnSeat: 'S' }))).toBeNull();
  });
});

describe('Go Fish hard bot', () => {
  const hand = [card('clubs', 4), card('hearts', 9), card('spades', 9), card('hearts', 2)];

  it('asks a seat known from the public log to hold the rank', () => {
    // E asked S for a 9 and was refused, so E still holds at least one 9.
    const visible = view(hand, { log: [ask('E', 'S', 9)] });
    for (const sample of samples) expect(chosen(getBotAction(visible, () => sample, 'hard'))).toEqual({ target: 'E', rank: 9 });
  });

  it('follows the cards: a taker holds the rank and the old holder no longer does', () => {
    const visible = view(hand, { log: [ask('E', 'S', 9), ask('W', 'E', 9, 1)] });
    for (const sample of samples) expect(chosen(getBotAction(visible, () => sample, 'hard'))).toEqual({ target: 'W', rank: 9 });
  });

  it('forgets a holder once the rank is booked or a new hand is dealt', () => {
    const base = [ask('E', 'S', 9)];
    const booked = view(hand, { log: [...base, { type: 'book', seat: 'E', rank: 9, timestamp: 2 }] });
    const dealt = view(hand, { log: [...base, { type: 'hand', hand: 2, first: 'N', timestamp: 2 }], hand: 2 });
    for (const visible of [booked, dealt]) {
      const picks = samples.map((sample) => chosen(getBotAction(visible, () => sample, 'hard')));
      expect(picks.every((pick) => pick.target === 'E' && pick.rank === 9)).toBe(false);
    }
  });

  it('avoids seats found without the rank when no seat is known to hold it', () => {
    // S asked E for a 9; then the bot took S's 9. E and S both lack a 9 now, so only W could still hold one.
    const visible = view([card('clubs', 4), card('hearts', 9), card('spades', 9)], { log: [ask('S', 'E', 9), ask('N', 'S', 9, 1)] });
    expect(chosen(getBotAction(visible, () => 0.5, 'hard'))).toEqual({ target: 'W', rank: 9 });
  });

  it('forgets what a seat lacked after it draws a card', () => {
    const lacked = view([card('hearts', 9), card('spades', 9)], { handCounts: counts({ N: 2, E: 20, S: 1, W: 1 }), stockCount: 5,
      log: [ask('S', 'E', 9), ask('N', 'S', 9, 1)] });
    expect(chosen(getBotAction(lacked, () => 0.5, 'hard'))).toEqual({ target: 'W', rank: 9 });
    // E drew a card since, so the earlier refusal says nothing about its large hand now.
    const redrawn = view([card('hearts', 9), card('spades', 9)], { handCounts: counts({ N: 2, E: 20, S: 1, W: 1 }), stockCount: 5,
      log: [...lacked.log, ask('E', 'W', 3, 0, 'miss')] });
    expect(chosen(getBotAction(redrawn, () => 0.5, 'hard'))).toEqual({ target: 'E', rank: 9 });
  });

  it('prefers the rank it holds most of when nothing is known', () => {
    const visible = view([card('clubs', 7), card('hearts', 7), card('spades', 7), card('hearts', 2)]);
    for (const sample of samples) expect(chosen(getBotAction(visible, () => sample, 'hard')).rank).toBe(7);
  });

  it('does not mutate the filtered view', () => {
    const visible = view(hand, { log: [ask('E', 'S', 9), ask('W', 'E', 9, 1)] });
    const original = structuredClone(visible);
    for (const sample of samples) getBotAction(visible, () => sample, 'hard');
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

describe('Go Fish full matches between bots', () => {
  beforeEach(() => gf.restoreGames([]));

  it.each([2, 3, 4, 5, 6])('finishes with %i players, using only legal asks', (count) => {
    const code = `GFB${count}`;
    const random = seeded(count * 31);
    gf.startGame(code, playersOf(count));
    const difficulties = ['hard', 'easy'] as const;
    const actions = runSeededGame(code, 20000, () => gf.getGameState(code)?.phase === 'scoring', () => {
      const game = gf.getGameState(code)!;
      const seat = game.currentTurnSeat;
      const visible = gf.getPlayerVisibleState(code, seat)!;
      // Alternate difficulties by seat so hard and easy bots share every table.
      const chosenAction = getBotAction(visible, random, difficulties[GAME_SEAT_ORDER.indexOf(seat) % 2]);
      apply(code, seat, chosenAction);
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

  it('asks only for held ranks of seats with cards', () => {
    const code = 'GFBPL1';
    const random = seeded(5);
    gf.startGame(code, playersOf(5));
    runSeededGame(code, 20000, () => gf.getGameState(code)?.phase === 'scoring', () => {
      const game = gf.getGameState(code)!;
      const seat = game.currentTurnSeat;
      const visible = gf.getPlayerVisibleState(code, seat)!;
      const action = getBotAction(visible, random, 'hard');
      const { target, rank } = chosen(action);
      expect(visible.myHand.some((own) => own.rank === rank)).toBe(true);
      expect(target).not.toBe(seat);
      expect(visible.handCounts[target]).toBeGreaterThan(0);
      apply(code, seat, action);
    });
  });
});
