import { afterEach, describe, expect, it, vi } from 'vitest';
import { GAME_SEAT_ORDER } from '@shared/constants';
import type { Card, GameSeat, PlayerInfo, Suit } from '@shared/types';
import type { CrazyEightsLogEntry, CrazyEightsVisibleState } from '@shared/games/crazyeights/types';
import { ceIsPlayable } from '@shared/rules/crazyeights';
import type { BotAction } from '../../src/bots/bot-decisions';
import { GAME_BOTS } from '../../src/bots/bot-registry';
import { crazyEightsHandGroups, crazyEightsSearch, crazyEightsUnseen, sampleCrazyEightsWorld } from '../../src/bots/crazyeights-search';
import { getCrazyEightsBotAction } from '../../src/bots/crazyeights-strategy';
import type { SearchContext } from '../../src/bots/search/search-types';
import { seededRandom } from '../../src/bots/search/seeded-random';
import * as ce from '../../src/managers/games/crazyeights-game';
import { runSeededGame } from './seeded-game-runner';

const card = (suit: Suit, rank: Card['rank']): Card => ({ suit, rank });
const code = (entry: Card): number => ['spades', 'hearts', 'clubs', 'diamonds'].indexOf(entry.suit) * 16 + entry.rank;

function context(seed: number, budgetMs: number): SearchContext {
  const began = performance.now();
  const timeLeftMs = (): number => Math.max(0, budgetMs - (performance.now() - began));
  return { random: seededRandom(seed), budget: { maxDepth: undefined, timeLeftMs, expired: () => timeLeftMs() === 0 } };
}

function playersOf(count: number): Partial<Record<GameSeat, PlayerInfo>> {
  return Object.fromEntries(GAME_SEAT_ORDER.slice(0, count).map((seat) => [seat, {
    id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
  }]));
}

function counts(entries: Partial<Record<GameSeat, number>>): Record<GameSeat, number> {
  return Object.fromEntries(GAME_SEAT_ORDER.map((seat) => [seat, entries[seat] ?? 0])) as Record<GameSeat, number>;
}

function view(myHand: Card[], overrides: Partial<CrazyEightsVisibleState> = {}): CrazyEightsVisibleState {
  return {
    gameType: 'crazyeights', phase: 'playing', options: { actionCards: false }, mySeat: 'N', seats: ['N', 'E', 'S', 'W'],
    myHand, handCounts: counts({ N: myHand.length, E: 5, S: 5, W: 5 }), hand: 1, scores: counts({}), direction: 'ccw',
    currentTurnSeat: 'N', drawn: false, lastPlayed: card('hearts', 6), activeSuit: 'hearts', stockCount: 20, reserveCount: 0,
    log: [], result: null, ...overrides,
  };
}

function apply(gameCode: string, seat: GameSeat, action: BotAction | null): void {
  if (action?.type !== 'game-action' || action.request.gameType !== 'crazyeights') throw new Error('Expected a Crazy Eights action');
  const move = action.request.action;
  const result = move.type === 'play' ? ce.play(gameCode, seat, move.card, move.suit)
    : move.type === 'draw' ? ce.draw(gameCode, seat) : ce.pass(gameCode, seat);
  expect(result).toEqual({ success: true });
}

describe('Crazy Eights search bot', () => {
  afterEach(() => {
    ce.restoreGames([]);
    vi.restoreAllMocks();
  });

  it('is registered for the worker pool with the heuristic as fallback', () => {
    expect(GAME_BOTS.crazyeights.search?.strategy.exportName).toBe('crazyEightsSearch');
    expect(GAME_BOTS.crazyeights.search?.budgetMs).toBeLessThanOrEqual(1500);
  });

  it.each([
    { count: 4, actionCards: false }, { count: 2, actionCards: true }, { count: 5, actionCards: true },
  ])('plays whole matches legally without mutating the view ($count players, action cards $actionCards)', ({ count, actionCards }) => {
    vi.spyOn(Math, 'random').mockImplementation(seededRandom(count * 13 + (actionCards ? 1 : 0)));
    const gameCode = `CESR${count}`;
    ce.startGame(gameCode, playersOf(count), undefined, undefined, { actionCards });
    let step = 0;
    runSeededGame('crazyeights-search/full', 5000, () => ce.getGameState(gameCode)?.phase === 'scoring', () => {
      const game = ce.getGameState(gameCode)!;
      const seat = game.currentTurnSeat;
      const visible = ce.getPlayerVisibleState(gameCode, seat)!;
      const before = structuredClone(visible);
      if (step % 5 === 0) {
        // A sampled world matches the real counts and keeps the bot's own hand.
        const world = sampleCrazyEightsWorld(visible, seededRandom(step))!;
        expect(world.stock).toHaveLength(game.stock.length);
        expect(world.discard).toHaveLength(game.discard.length);
        for (const other of visible.seats) expect(world.hands[GAME_SEAT_ORDER.indexOf(other)]).toHaveLength(game.hands[other].length);
        expect([...world.hands[GAME_SEAT_ORDER.indexOf(seat)]].sort()).toEqual(visible.myHand.map(code).sort());
      }
      const began = performance.now();
      const action = crazyEightsSearch(visible, context(step++, 15));
      expect(performance.now() - began).toBeLessThan(500);
      expect(visible).toEqual(before);
      if (action?.type === 'game-action' && action.request.gameType === 'crazyeights' && action.request.action.type === 'play') {
        expect(ceIsPlayable(action.request.action.card, visible.lastPlayed!, visible.activeSuit)).toBe(true);
      }
      apply(gameCode, seat, action);
    });
    expect(ce.getGameState(gameCode)?.result?.handWinners).toHaveLength(3);
  });

  it('keeps cards a seat lacked when it drew out of that hand, and counts later draws as free', () => {
    const log: CrazyEightsLogEntry[] = [
      { type: 'hand', hand: 1, first: 'N', starter: card('hearts', 6), timestamp: 0 },
      { type: 'play', seat: 'N', card: card('hearts', 9), suit: null, effect: null, target: null, drawn: 0, timestamp: 1 },
      { type: 'draw', seat: 'W', timestamp: 2 },
      { type: 'pass', seat: 'W', timestamp: 2 },
    ];
    const visible = view([card('clubs', 3)], {
      log, lastPlayed: card('hearts', 9), reserveCount: 1, stockCount: 52 - 1 - 2 - 5 - 5 - 6,
      handCounts: counts({ N: 1, E: 5, S: 5, W: 6 }), currentTurnSeat: 'N',
    });
    const groups = crazyEightsHandGroups(visible).filter((group) => group.seat === 'W');
    expect(groups.map((group) => group.size)).toEqual([6]);
    const excluded = groups[0].excluded;
    expect(excluded.has(code(card('hearts', 2)))).toBe(true);
    expect(excluded.has(code(card('spades', 9)))).toBe(true);
    expect(excluded.has(code(card('spades', 8)))).toBe(true);
    expect(excluded.has(code(card('clubs', 2)))).toBe(false);
    expect(crazyEightsUnseen(visible)).toHaveLength(5 + 5 + 6 + visible.stockCount);
    for (let seed = 0; seed < 10; seed++) {
      const world = sampleCrazyEightsWorld(visible, seededRandom(seed))!;
      for (const held of world.hands[GAME_SEAT_ORDER.indexOf('W')]) expect(excluded.has(held)).toBe(false);
    }
    // After a later draw, one card of the hand may be anything.
    const later = view([card('clubs', 3)], {
      ...visible, log: [...log, { type: 'draw', seat: 'W', timestamp: 3 }, { type: 'pass', seat: 'W', timestamp: 3 }],
      handCounts: counts({ N: 1, E: 5, S: 5, W: 7 }), stockCount: visible.stockCount - 1,
    });
    expect(crazyEightsHandGroups(later).filter((group) => group.seat === 'W').map((group) => group.size)).toEqual([6, 1]);
  });
});

describe('Crazy Eights heuristic', () => {
  it('sheds an 8 once an opponent is about to go out', () => {
    const hand = [card('spades', 8), card('hearts', 5), card('clubs', 13)];
    const calm = getCrazyEightsBotAction(view(hand), () => 0);
    const pressed = getCrazyEightsBotAction(view(hand, { handCounts: counts({ N: 3, E: 5, S: 1, W: 5 }) }), () => 0);
    const cardOf = (action: BotAction | null): Card | null =>
      (action?.type === 'game-action' && action.request.gameType === 'crazyeights' && action.request.action.type === 'play'
        ? action.request.action.card : null);
    expect(cardOf(calm)).toEqual(card('hearts', 5));
    expect(cardOf(pressed)).toEqual(card('spades', 8));
  });

  it('leaves the suit the next seat most likely lacks, by counting unseen cards', () => {
    // Every unseen heart is gone except one, so a heart lead is hard to follow.
    const placed = [2, 3, 4, 5, 7, 9, 10, 11, 12, 13].map((rank) => card('hearts', rank as Card['rank']));
    const log: CrazyEightsLogEntry[] = [
      { type: 'hand', hand: 1, first: 'N', starter: card('hearts', 14), timestamp: 0 },
      ...placed.map((entry, index): CrazyEightsLogEntry => ({
        type: 'play', seat: 'E', card: entry, suit: null, effect: null, target: null, drawn: 0, timestamp: index + 1,
      })),
    ];
    const hand = [card('spades', 8), card('clubs', 4)];
    const visible = view(hand, {
      log, lastPlayed: card('hearts', 13), activeSuit: 'diamonds', reserveCount: placed.length, handCounts: counts({ N: 2, E: 5, S: 5, W: 5 }),
    });
    const action = getCrazyEightsBotAction(visible, () => 0);
    expect(action).toMatchObject({ request: { action: { card: card('spades', 8), suit: 'hearts' } } });
  });
});
