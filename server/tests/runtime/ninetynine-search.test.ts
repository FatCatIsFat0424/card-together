import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Card, GameSeat, NinetyNineVisibleState, PlayerInfo } from '@shared/types';
import { GAME_SEAT_ORDER } from '@shared/constants';
import { GAME_BOTS } from '../../src/bots/bot-registry';
import { ninetyNineDiscard, ninetyNineSearch, nnCode, sampleNinetyNineWorld } from '../../src/bots/ninetynine-search';
import { ninetyNineOptions, unseenCards } from '../../src/bots/ninetynine-strategy';
import type { SearchContext } from '../../src/bots/search/search-types';
import { seededRandom } from '../../src/bots/search/seeded-random';
import * as ninetynine from '../../src/managers/games/ninetynine-game';
import { gameSeatValues } from '../helpers/game-seat-values';
import { runSeededGame } from './seeded-game-runner';

const CODE = 'NNSRCH';
const player = (seat: GameSeat): PlayerInfo => ({ id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null });
const card = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank });

function context(seed: number, budgetMs: number): SearchContext {
  const began = performance.now();
  const timeLeftMs = (): number => Math.max(0, budgetMs - (performance.now() - began));
  return { random: seededRandom(seed), budget: { maxDepth: undefined, timeLeftMs, expired: () => timeLeftMs() === 0 } };
}

function apply(seat: GameSeat, action: ReturnType<typeof ninetyNineSearch>): void {
  if (action?.type !== 'ninetynine-play') throw new Error('Expected a Ninety-Nine play');
  expect(ninetynine.play(CODE, seat, action.card, action.choice, action.target)).toEqual({ success: true });
}

describe('Ninety-Nine search bot', () => {
  afterEach(() => {
    ninetynine.restoreGames([]);
    vi.restoreAllMocks();
  });

  it('is registered for the worker pool with the heuristic as fallback', () => {
    expect(GAME_BOTS.ninetynine.search?.strategy.exportName).toBe('ninetyNineSearch');
    expect(GAME_BOTS.ninetynine.search?.budgetMs).toBeLessThanOrEqual(1500);
  });

  it.each([
    { seats: ['N', 'E', 'S', 'W'] as GameSeat[], twoDecks: false },
    { seats: ['N', 'S'] as GameSeat[], twoDecks: false },
    { seats: ['N', 'E', 'S', 'W', 'P5'] as GameSeat[], twoDecks: true },
  ])('plays whole games legally without mutating the view ($seats.length seats, two decks $twoDecks)', ({ seats, twoDecks }) => {
    vi.spyOn(Math, 'random').mockImplementation(seededRandom(seats.length * 7 + (twoDecks ? 1 : 0)));
    ninetynine.startGame(CODE, Object.fromEntries(seats.map((seat) => [seat, player(seat)])), undefined, undefined, { twoDecks });
    let step = 0;
    runSeededGame('ninetynine-search/full', 3000, () => ninetynine.getGameState(CODE)?.phase === 'scoring', () => {
      const seat = ninetynine.getGameState(CODE)!.currentTurnSeat;
      const visible = ninetynine.getPlayerVisibleState(CODE, seat)!;
      const before = structuredClone(visible);
      // Every few turns, check the sampled world against the real counts.
      if (step % 7 === 0) {
        const world = sampleNinetyNineWorld(visible, seededRandom(step))!;
        const game = ninetynine.getGameState(CODE)!;
        expect(world.stock).toHaveLength(game.stock.length);
        expect(world.discard).toHaveLength(game.discard.length);
        for (const other of seats) expect(world.hands[GAME_SEAT_ORDER.indexOf(other)]).toHaveLength(game.hands[other].length);
        expect(world.discard.at(-1)).toBe(game.discard.length ? nnCode(game.discard.at(-1)!) : undefined);
      }
      const began = performance.now();
      const action = ninetyNineSearch(visible, context(step++, 15));
      expect(performance.now() - began).toBeLessThan(500);
      expect(visible).toEqual(before);
      apply(seat, action);
    });
    expect(ninetynine.getGameState(CODE)?.result).not.toBeNull();
  });

  it('reconstructs the discard pile, counting eliminated hands face down', () => {
    const visible: NinetyNineVisibleState = gameSeatValues({
      gameType: 'ninetynine', phase: 'playing', mySeat: 'N', myHand: [card('clubs', 2)],
      handCounts: { N: 5, E: 5, S: 0, W: 5 }, total: 50, direction: 'ccw', currentTurnSeat: 'N', lastPlayed: card('hearts', 9),
      stockCount: 52 - 15 - 7, eliminated: ['S'],
      log: [
        { type: 'play', seat: 'W', card: card('hearts', 3), choice: null, target: null, total: 3, timestamp: 0 },
        { type: 'eliminated', seat: 'S', timestamp: 1 },
        { type: 'play', seat: 'E', card: card('hearts', 9), choice: null, target: null, total: 50, timestamp: 2 },
      ],
      result: null,
    });
    expect(ninetyNineDiscard(visible)).toEqual({ known: [card('hearts', 3), card('hearts', 9)], faceDown: 5 });
  });
});

describe('Ninety-Nine heuristic', () => {
  it('prices the risk of an opponent setting 99 with a K before its next turn', () => {
    const hand = [card('clubs', 9), card('clubs', 8), card('clubs', 7), card('clubs', 6), card('clubs', 2)];
    const base: NinetyNineVisibleState = gameSeatValues({
      gameType: 'ninetynine', phase: 'playing', mySeat: 'N', myHand: hand,
      handCounts: { N: 5, E: 5, S: 5, W: 5 }, total: 30, direction: 'ccw', currentTurnSeat: 'N', lastPlayed: null,
      stockCount: 20, eliminated: [], log: [], result: null,
    });
    const kings = (['spades', 'hearts', 'clubs', 'diamonds'] as const).map((suit, index) => ({
      type: 'play' as const, seat: 'E' as const, card: card(suit, 13), choice: null, target: null, total: 99, timestamp: index,
    }));
    const seen = { ...base, log: kings };
    expect(unseenCards(seen).some((entry) => entry.rank === 13)).toBe(false);
    const scoreOf = (visible: NinetyNineVisibleState): number =>
      ninetyNineOptions(visible).find((option) => option.value.card.rank === 9)!.score;
    expect(scoreOf(base)).toBeLessThan(scoreOf(seen));
  });
});
