import { beforeEach, describe, expect, it } from 'vitest';
import type { Card, GameSeat, PlayerInfo, StudAction, StudVisibleState } from '@shared/types';
import { GAME_SEAT_ORDER } from '@shared/constants';
import { createDeck } from '../../src/engine/deck';
import { getBotAction } from '../../src/bots/bot-decisions';
import type { BotAction } from '../../src/bots/bot-decisions';
import { gameBot } from '../../src/bots/bot-registry';
import { cardId } from '../../src/bots/holdem-evaluator';
import { seededRandom } from '../../src/bots/search/seeded-random';
import type { SearchContext } from '../../src/bots/search/search-types';
import { holeLikelihoods, lineObservations } from '../../src/bots/stud-model';
import type { LineObservation } from '../../src/bots/stud-model';
import { studSearch } from '../../src/bots/stud-search';
import { studDecision } from '../../src/bots/stud-strategy';
import { studStrength } from '../../src/bots/stud-strength';
import * as stud from '../../src/managers/games/stud-game';

const CODE = 'SB0001';
/** Few worlds per decision keep whole seeded matches fast; the decision logic is the same. */
const QUICK = { minWorlds: 6, maxWorlds: 12, timeLeftMs: () => 1 };

function players(seats: readonly GameSeat[]): Partial<Record<GameSeat, PlayerInfo>> {
  return Object.fromEntries(seats.map((seat) => [seat, {
    id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
  }]));
}

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const card = (rank: Card['rank'], suit: Card['suit'] = 'spades'): Card => ({ suit, rank });
const key = (value: Card): string => `${value.suit}${value.rank}`;

/** Fisher-Yates draws that deal `top` first, in order. */
function shuffleDraws(top: readonly Card[]): number[] {
  const rest = createDeck().filter((value) => !top.some((wanted) => key(wanted) === key(value)));
  const target = [...top, ...rest];
  const deck = createDeck();
  const draws: number[] = [];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = deck.findIndex((value) => key(value) === key(target[i]));
    draws.push((j + 0.5) / (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return draws;
}

/** Random source whose first hand deals `deck`: hole cards from the button's left, then up cards the same way. */
function rigged(button: GameSeat, seats: readonly GameSeat[], deck: readonly Card[]): () => number {
  const draws = [(seats.indexOf(button) + 0.5) / seats.length, ...shuffleDraws(deck)];
  let index = 0;
  return () => draws[index++] ?? 0.5;
}

function studAction(action: BotAction | null): StudAction {
  if (action?.type !== 'game-action' || action.request.gameType !== 'stud') throw new Error('Expected a stud action');
  return action.request.action;
}

function freeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Plays a whole match, with each seat on the bot or on the passive check-or-fold fallback, using only its own view. */
function botMatch(seed: number, seats: readonly GameSeat[], passive: (seat: GameSeat) => boolean = () => false): number {
  const random = seeded(seed);
  stud.startGame(CODE, players(seats), random, 0);
  let decisions = 0;
  for (let step = 0; step < 4000 && stud.getGameState(CODE)!.phase !== 'scoring'; step++) {
    const seat = stud.getGameState(CODE)!.currentTurnSeat;
    const view = stud.getPlayerVisibleState(CODE, seat)!;
    const request = passive(seat) ? studAction(gameBot('stud').firstLegal(view)) : studDecision(view, random, QUICK);
    expect(request).not.toBeNull();
    expect(stud.act(CODE, seat, request!, 0, random)).toEqual({ success: true });
    decisions += 1;
  }
  expect(stud.getGameState(CODE)!.phase).toBe('scoring');
  return decisions;
}

function searchContext(random: () => number, budgetMs: number): SearchContext {
  const deadline = performance.now() + budgetMs;
  return {
    random,
    budget: { maxDepth: undefined, timeLeftMs: () => Math.max(0, deadline - performance.now()), expired: () => performance.now() >= deadline },
  };
}

describe('stud bot strategies', () => {
  beforeEach(() => stud.restoreGames([]));

  it('plays only legal actions as bots, and mixed with passive seats, at several table sizes', () => {
    const rosters: readonly (readonly GameSeat[])[] = [['N', 'E'], ['N', 'E', 'S'], ['N', 'E', 'S', 'W'], GAME_SEAT_ORDER];
    for (const [index, seats] of rosters.entries()) {
      expect(botMatch(20 + index, seats)).toBeGreaterThan(0);
      stud.restoreGames([]);
      expect(botMatch(30 + index, seats, (seat) => GAME_SEAT_ORDER.indexOf(seat) % 2 === 1)).toBeGreaterThan(0);
      stud.restoreGames([]);
    }
  }, 60_000);

  it('decides from a frozen view without changing it and without reading other seats\' hole cards', () => {
    const random = seeded(8);
    stud.startGame(CODE, players(['N', 'E', 'S']), random, 0);
    for (let step = 0; step < 30 && stud.getGameState(CODE)!.phase !== 'scoring'; step++) {
      const game = stud.getGameState(CODE)!;
      const view = freeze(structuredClone(stud.getPlayerVisibleState(CODE, game.currentTurnSeat)!));
      const before = JSON.stringify(view);
      const request = studAction(getBotAction(view, random));
      expect(JSON.stringify(view)).toBe(before);
      expect(stud.act(CODE, game.currentTurnSeat, request, 0, random)).toEqual({ success: true });
    }
  });

  it('does not act out of turn or after the match', () => {
    stud.startGame(CODE, players(['N', 'E']), seeded(5), 0);
    const waiting = GAME_SEAT_ORDER.find((seat) => seat !== stud.getGameState(CODE)!.currentTurnSeat && seat in stud.getGameState(CODE)!.players)!;
    const view = stud.getPlayerVisibleState(CODE, waiting)!;
    expect(getBotAction(view, seeded(1))).toBeNull();
    const { phase: _phase, ...rest } = view;
    expect(getBotAction({ ...rest, phase: 'scoring' } as StudVisibleState, seeded(1))).toBeNull();
  });

  it('answers a human timeout and a repeated bot failure with check or fold', () => {
    stud.startGame(CODE, players(['N', 'E', 'S']), seeded(7), 0);
    const seat = stud.getGameState(CODE)!.currentTurnSeat;
    const view = stud.getPlayerVisibleState(CODE, seat)!;
    const bot = gameBot('stud');
    expect(studAction(bot.turnTimeout!(view, { isBot: false, strategy: () => null }))).toEqual({ type: 'check' });
    expect(studAction(bot.firstLegal(view))).toEqual({ type: 'check' });
    // Facing a bet, the passive default folds
    expect(stud.act(CODE, seat, { type: 'raise', to: 20 }, 0).success).toBe(true);
    const next = stud.getGameState(CODE)!.currentTurnSeat;
    expect(studAction(bot.firstLegal(stud.getPlayerVisibleState(CODE, next)!))).toEqual({ type: 'fold' });
  });

  it('bets a made pair of aces and folds a scattered hand to a pot-sized raise, heads-up', () => {
    const seats: readonly GameSeat[] = ['N', 'E'];
    // Button E: holes N E, then up cards N E
    const random = rigged('E', seats, [card(14), card(2, 'clubs'), card(14, 'hearts'), card(7, 'diamonds')]);
    stud.startGame(CODE, players(seats), random, 0);
    expect(stud.getGameState(CODE)!.currentTurnSeat).toBe('N');
    const aces = stud.getPlayerVisibleState(CODE, 'N')!;
    const decision = studDecision(aces, seeded(3), { minWorlds: 300, maxWorlds: 600, timeLeftMs: () => 1000 });
    expect(decision?.type).toBe('raise');
    expect(stud.act(CODE, 'N', { type: 'raise', to: 100 }, 0, random).success).toBe(true);
    const trash = stud.getPlayerVisibleState(CODE, 'E')!;
    expect(studDecision(trash, seeded(4), { minWorlds: 300, maxWorlds: 600, timeLeftMs: () => 1000 })).toEqual({ type: 'fold' });
  });

  it('stays within its time budget in the worker search, and the synchronous decision stays quick at a full table', () => {
    const seats = GAME_SEAT_ORDER;
    const random = seeded(99);
    stud.startGame(CODE, players(seats), random, 0);
    const view = stud.getPlayerVisibleState(CODE, stud.getGameState(CODE)!.currentTurnSeat)!;
    const start = performance.now();
    for (let run = 0; run < 10; run++) getBotAction(view, random);
    expect((performance.now() - start) / 10).toBeLessThan(120);
    const searchStart = performance.now();
    const action = studAction(studSearch(view, searchContext(seededRandom(5), 400)));
    expect(performance.now() - searchStart).toBeLessThan(450);
    expect(['check', 'raise']).toContain(action.type);
  });
});

describe('stud betting-line model', () => {
  const nine = cardId(card(9, 'hearts'));
  const observation = (kind: LineObservation['kind'], extra: Partial<LineObservation> = {}): LineObservation => ({
    seat: 'E', up: [nine], kind, odds: 0, rivals: 1, size: 0.6, ...extra,
  });
  const pair = cardId(card(9, 'spades'));
  const scatter = cardId(card(2, 'clubs'));

  it('weights hole cards evenly without a line and favours strong hands after a bet', () => {
    expect(Array.from(holeLikelihoods([pair, scatter], [], 'E'))).toEqual([1, 1]);
    const [paired, scattered] = holeLikelihoods([pair, scatter], [observation('aggressive')], 'E');
    expect(paired).toBeGreaterThan(2 * scattered);
    // Other seats' lines say nothing about this seat
    expect(Array.from(holeLikelihoods([pair, scatter], [observation('aggressive')], 'S'))).toEqual([1, 1]);
  });

  it('reads a call of a large bet as stronger than a check, and a check as weaker than a bet', () => {
    const [callPair, callScatter] = holeLikelihoods([pair, scatter], [observation('passive', { odds: 0.4 })], 'E');
    const [checkPair, checkScatter] = holeLikelihoods([pair, scatter], [observation('passive')], 'E');
    expect(callPair / callScatter).toBeGreaterThan(checkPair / checkScatter);
    const [betPair, betScatter] = holeLikelihoods([pair, scatter], [observation('aggressive')], 'E');
    expect(betPair / betScatter).toBeGreaterThan(checkPair / checkScatter);
  });

  it('collects only the opponents\' actions of the current hand from the public log', () => {
    const seats: readonly GameSeat[] = ['N', 'E', 'S'];
    const random = seeded(12);
    stud.startGame(CODE, players(seats), random, 0);
    const first = stud.getGameState(CODE)!.currentTurnSeat;
    expect(stud.act(CODE, first, { type: 'raise', to: 60 }, 0, random).success).toBe(true);
    const second = stud.getGameState(CODE)!.currentTurnSeat;
    expect(stud.act(CODE, second, { type: 'call' }, 0, random).success).toBe(true);
    const viewer = stud.getGameState(CODE)!.currentTurnSeat;
    const lines = lineObservations(stud.getPlayerVisibleState(CODE, viewer)!);
    expect(lines.map((line) => [line.seat, line.kind])).toEqual([[first, 'aggressive'], [second, 'passive']]);
    expect(lines[1].odds).toBeGreaterThan(0);
    expect(lines.every((line) => line.up.length === 1)).toBe(true);
  });

  it('rates a pair above a scattered hand and a longer pair line above its first card alone', () => {
    const ids = (cards: readonly Card[]): number[] => cards.map(cardId);
    expect(studStrength(ids([card(14), card(14, 'hearts')]), 2)).toBeGreaterThan(studStrength(ids([card(9), card(3, 'hearts')]), 2));
    expect(studStrength(ids([card(10), card(10, 'hearts'), card(4, 'clubs'), card(6, 'clubs'), card(2, 'diamonds')]), 5))
      .toBeGreaterThan(studStrength(ids([card(10), card(9, 'hearts'), card(4, 'clubs'), card(6, 'clubs'), card(2, 'diamonds')]), 5));
  });
});
