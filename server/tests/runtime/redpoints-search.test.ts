import { describe, expect, it } from 'vitest';
import type { Card, PlayerInfo, RedPointsLogEntry, RedPointsVisibleState } from '@shared/types';
import { rpPairOptions } from '@shared/rules/redpoints';
import { readKnowledge, rpIndex } from '../../src/bots/redpoints-model';
import { redPointsSearch } from '../../src/bots/redpoints-search';
import { getRedPointsBotAction, scoreRedPointsOptions } from '../../src/bots/redpoints-strategy';
import type { SearchContext } from '../../src/bots/search/search-types';
import { seededRandom } from '../../src/bots/search/seeded-random';
import { createDeck, shuffleDeck } from '../../src/engine/deck';
import * as redpoints from '../../src/managers/games/redpoints-game';
import { runSeededGame } from './seeded-game-runner';

const CODE = 'RPS123';
const card = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank });
const player = (id: string): PlayerInfo => ({
  id, username: id, nickname: id, color: '#123456', avatar: 'cat', avatarImage: null,
});
const PLAYERS = { N: player('north'), E: player('east'), S: player('south'), W: player('west') };

function state(overrides: Partial<RedPointsVisibleState> = {}): RedPointsVisibleState {
  return {
    gameType: 'redpoints', phase: 'playing', mySeat: 'N', myHand: [],
    handCounts: { N: 6, E: 6, S: 6, W: 6 }, table: [], stockCount: 24,
    captured: { N: [], E: [], S: [], W: [] }, currentTurnSeat: 'N', step: 'play',
    pendingFlip: null, log: [], result: null, ...overrides,
  };
}

/** A budget that runs out after `checks` look-ups, so a search's result depends only on its seed. */
function checkedBudget(checks: number): SearchContext['budget'] {
  let used = 0;
  return { maxDepth: undefined, timeLeftMs: () => 1000, expired: () => ++used > checks };
}

describe('Red Points knowledge', () => {
  it('recovers the table each other seat faced and what it held then', () => {
    const log: RedPointsLogEntry[] = [
      { type: 'play', seat: 'W', card: card('clubs', 3), captured: card('hearts', 7), timestamp: 0 },
      { type: 'flip', seat: 'W', card: card('spades', 12), captured: null, timestamp: 0 },
      { type: 'play', seat: 'S', card: card('diamonds', 13), captured: null, timestamp: 0 },
      { type: 'flip', seat: 'S', card: card('clubs', 5), captured: card('hearts', 5), timestamp: 0 },
      { type: 'play', seat: 'W', card: card('clubs', 9), captured: null, timestamp: 0 },
      { type: 'flip', seat: 'W', card: card('spades', 4), captured: null, timestamp: 0 },
    ];
    const table = [card('spades', 12), card('diamonds', 13), card('clubs', 9), card('spades', 4), card('clubs', 2)];
    const knowledge = readKnowledge(state({
      myHand: [card('hearts', 14)], table, log,
      captured: { N: [], E: [], S: [card('clubs', 5), card('hearts', 5)], W: [card('clubs', 3), card('hearts', 7)] },
    }));
    const sorted = (cards: readonly number[]): number[] => [...cards].sort((a, b) => a - b);
    const [lastW, firstS, firstW] = knowledge.plays;
    expect(sorted(firstW.table)).toEqual(sorted([card('hearts', 7), card('hearts', 5), card('clubs', 2)].map(rpIndex)));
    expect(firstW).toMatchObject({ seat: 3, gained: 7, heldSince: [rpIndex(card('clubs', 9)), rpIndex(card('clubs', 3))] });
    expect(firstS).toMatchObject({ seat: 2, gained: 0 });
    expect(sorted(lastW.table)).toEqual(sorted([card('spades', 12), card('diamonds', 13), card('clubs', 2)].map(rpIndex)));
    expect(knowledge.scores).toEqual([0, 0, 5, 7]);
    expect(knowledge.unseen).not.toContain(rpIndex(card('hearts', 14)));
  });
});

describe('Red Points heuristic', () => {
  it('fears a red discard more when the next seat is the leader', () => {
    const base = {
      myHand: [card('hearts', 9), card('clubs', 13)], handCounts: { N: 2, E: 2, S: 2, W: 2 }, stockCount: 8,
    };
    const lead = [card('hearts', 13), card('diamonds', 13), card('hearts', 12), card('diamonds', 12), card('hearts', 11), card('diamonds', 11)];
    const leaderNext = scoreRedPointsOptions(state({ ...base, captured: { N: [], E: [], S: [], W: lead } }));
    const trailerNext = scoreRedPointsOptions(state({ ...base, captured: { N: [], E: lead, S: [], W: [] } }));
    const discard = (options: typeof leaderNext): number =>
      options.find((option) => option.move.card === rpIndex(card('hearts', 9)))!.score;
    expect(discard(leaderNext)).toBeLessThan(discard(trailerNext));
  });
});

describe('Red Points search', () => {
  it('returns the same choice for the same seed, never mutates its view, and falls back without time', () => {
    const visible = state({
      myHand: [card('clubs', 9), card('hearts', 9), card('spades', 13)],
      table: [card('hearts', 14), card('clubs', 14), card('diamonds', 13)],
      handCounts: { N: 3, E: 3, S: 3, W: 3 }, stockCount: 12,
      captured: {
        N: [card('clubs', 2), card('spades', 8)], E: [card('clubs', 4), card('spades', 6)],
        S: [card('clubs', 5), card('spades', 5)], W: [card('clubs', 7), card('spades', 3)],
      },
    });
    const original = structuredClone(visible);
    const first = redPointsSearch(visible, { random: seededRandom(4), budget: checkedBudget(800) });
    expect(redPointsSearch(visible, { random: seededRandom(4), budget: checkedBudget(800) })).toEqual(first);
    expect(first).toMatchObject({ type: 'redpoints-play', capture: card('hearts', 14) });
    expect(visible).toEqual(original);
    const expired = { maxDepth: undefined, timeLeftMs: () => 0, expired: () => true };
    expect(redPointsSearch(visible, { random: () => 0, budget: expired })).toEqual(getRedPointsBotAction(visible, () => 0));
  });

  it('stays within a wall-clock budget', () => {
    const deck = shuffleDeck(createDeck(), seededRandom(5));
    const visible = state({ myHand: deck.slice(0, 6), table: deck.slice(24, 28) });
    const deadline = performance.now() + 150;
    const started = performance.now();
    redPointsSearch(visible, { random: seededRandom(1), budget: {
      maxDepth: undefined, timeLeftMs: () => Math.max(0, deadline - performance.now()), expired: () => performance.now() >= deadline,
    } });
    expect(performance.now() - started).toBeLessThan(400);
  });

  it.each([3, 17, 29])('plays legal, non-mutating moves through seeded games with seed %i', (seed) => {
    const random = seededRandom(seed);
    redpoints.restoreGames([]);
    redpoints.startGame(CODE, PLAYERS, shuffleDeck(createDeck(), random), 'N');
    runSeededGame(`redpoints/${seed}`, 100, () => redpoints.getGameState(CODE)?.phase === 'scoring', (index) => {
      const game = redpoints.getGameState(CODE)!;
      const seat = game.currentTurnSeat;
      const visible = redpoints.getPlayerVisibleState(CODE, seat)!;
      const original = structuredClone(visible);
      const action = index % 2 === 0
        ? redPointsSearch(visible, { random, budget: checkedBudget(300) })
        : getRedPointsBotAction(visible, random);
      expect(visible).toEqual(original);
      if (action?.type === 'redpoints-play') {
        const options = rpPairOptions(action.card, game.table);
        expect(action.capture === undefined).toBe(options.length === 0);
        expect(redpoints.play(CODE, seat, action.card, action.capture).success).toBe(true);
      } else if (action?.type === 'redpoints-flip') {
        expect(redpoints.chooseFlip(CODE, seat, action.capture).success).toBe(true);
      } else throw new Error('Unexpected bot action');
    });
    expect(redpoints.getGameState(CODE)?.result).not.toBeNull();
    redpoints.restoreGames([]);
  });
});
