import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Card, PlayerInfo, Seat, SevensVisibleState } from '@shared/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { svIsPlayable } from '@shared/rules/sevens';
import { GAME_BOTS } from '../../src/bots/bot-registry';
import { buildSevensKnowledge, sevensLiveProbability, svCardAt, svIndex } from '../../src/bots/sevens-knowledge';
import { sampleSevensWorld, sevensSearch } from '../../src/bots/sevens-search';
import type { SearchContext } from '../../src/bots/search/search-types';
import { seededRandom } from '../../src/bots/search/seeded-random';
import * as sevens from '../../src/managers/games/sevens-game';
import { runSeededGame } from './seeded-game-runner';

const CODE = 'SVSRCH';
const player = (seat: Seat): PlayerInfo => ({ id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null });
const players = { N: player('N'), E: player('E'), S: player('S'), W: player('W') };
const card = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank });

function context(seed: number, budgetMs: number): SearchContext {
  const began = performance.now();
  const timeLeftMs = (): number => Math.max(0, budgetMs - (performance.now() - began));
  return { random: seededRandom(seed), budget: { maxDepth: undefined, timeLeftMs, expired: () => timeLeftMs() === 0 } };
}

function apply(seat: Seat, action: ReturnType<typeof sevensSearch>): void {
  if (action?.type === 'sevens-play') expect(sevens.play(CODE, seat, action.card).success).toBe(true);
  else if (action?.type === 'sevens-cover') expect(sevens.cover(CODE, seat, action.card).success).toBe(true);
  else throw new Error('Expected a Sevens action');
}

/** Hands of the opponents in a sampled world, by seat. */
function worldHands(visible: SevensVisibleState, seed: number): Record<Seat, number[]> | null {
  const world = sampleSevensWorld(visible, seededRandom(seed));
  if (!world) return null;
  const hands = {} as Record<Seat, number[]>;
  SEAT_ORDER_CLOCKWISE.forEach((seat, index) => {
    hands[seat] = [];
    for (let suit = 0; suit < 4; suit++) {
      for (let order = 1; order <= 13; order++) {
        if (world.hands[index * 4 + suit] & (1 << (order - 1))) hands[seat].push(suit * 13 + order - 1);
      }
    }
  });
  return hands;
}

describe('Sevens search bot', () => {
  afterEach(() => {
    sevens.restoreGames([]);
    vi.restoreAllMocks();
  });

  it('is registered for the worker pool with the heuristic as fallback', () => {
    expect(GAME_BOTS.sevens.search?.strategy.exportName).toBe('sevensSearch');
    expect(GAME_BOTS.sevens.search?.budgetMs).toBeLessThanOrEqual(1500);
  });

  it.each([false, true])('plays whole games with legal moves only, never mutating the view (Dragon Slaying %s)', (closeOnEnd) => {
    vi.spyOn(Math, 'random').mockImplementation(seededRandom(closeOnEnd ? 3 : 4));
    sevens.startGame(CODE, players, undefined, { closeOnEnd });
    let step = 0;
    runSeededGame('sevens-search/full', 60, () => sevens.getGameState(CODE)?.phase === 'scoring', () => {
      const seat = sevens.getGameState(CODE)!.currentTurnSeat;
      const visible = sevens.getPlayerVisibleState(CODE, seat)!;
      const before = structuredClone(visible);
      const began = performance.now();
      const action = sevensSearch(visible, context(step++, 20));
      // The budget is checked between worlds, so a decision overruns it by at most one world.
      expect(performance.now() - began).toBeLessThan(500);
      expect(visible).toEqual(before);
      apply(seat, action);
    });
    expect(sevens.getGameState(CODE)?.result).not.toBeNull();
  });

  it('deals worlds that honor hand sizes and what forced covers proved', () => {
    vi.spyOn(Math, 'random').mockImplementation(seededRandom(11));
    sevens.startGame(CODE, players, undefined, { closeOnEnd: false });
    const heuristic = seededRandom(5);
    let covers = 0;
    runSeededGame('sevens-search/sample', 60, () => covers >= 6 || sevens.getGameState(CODE)?.phase === 'scoring', () => {
      const seat = sevens.getGameState(CODE)!.currentTurnSeat;
      const action = GAME_BOTS.sevens.decide(sevens.getPlayerVisibleState(CODE, seat)!, heuristic);
      if (action?.type === 'sevens-cover') covers++;
      apply(seat, action);
    });
    const game = sevens.getGameState(CODE)!;
    for (const seat of SEAT_ORDER_CLOCKWISE) {
      const visible = sevens.getPlayerVisibleState(CODE, seat)!;
      for (let seed = 0; seed < 20; seed++) {
        const hands = worldHands(visible, seed)!;
        expect(hands[seat].sort()).toEqual(visible.myHand.map(svIndex).sort());
        for (const other of SEAT_ORDER_CLOCKWISE.filter((entry) => entry !== seat)) {
          expect(hands[other]).toHaveLength(visible.handCounts[other]);
        }
      }
    }
    // Replaying the log: no sampled hand holds a card that was playable when that seat had to cover.
    const visible = sevens.getPlayerVisibleState(CODE, 'N')!;
    let table = { spades: null, hearts: null, clubs: null, diamonds: null } as SevensVisibleState['table'];
    const banned = new Map<Seat, Set<number>>();
    let first = true;
    for (const entry of game.log) {
      if (entry.type === 'play') {
        const row = table[entry.card.suit];
        const order = entry.card.rank === 14 ? 1 : entry.card.rank;
        table = { ...table, [entry.card.suit]: row ? { low: Math.min(row.low, order), high: Math.max(row.high, order) } : { low: order, high: order } };
        first = false;
        continue;
      }
      const set = banned.get(entry.seat) ?? new Set<number>();
      for (let index = 0; index < 52; index++) if (svIsPlayable(table, svCardAt(index), first)) set.add(index);
      banned.set(entry.seat, set);
    }
    for (let seed = 0; seed < 20; seed++) {
      const hands = worldHands(visible, seed)!;
      for (const [seat, set] of banned) {
        if (seat === 'N') continue;
        for (const held of hands[seat]) expect(set.has(held)).toBe(false);
      }
    }
  });

  it('returns null off turn', () => {
    vi.spyOn(Math, 'random').mockImplementation(seededRandom(8));
    sevens.startGame(CODE, players, undefined, { closeOnEnd: true });
    const seat = sevens.getGameState(CODE)!.currentTurnSeat;
    const other = SEAT_ORDER_CLOCKWISE.find((entry) => entry !== seat)!;
    expect(sevensSearch(sevens.getPlayerVisibleState(CODE, other)!, context(1, 50))).toBeNull();
  });
});

describe('Sevens knowledge', () => {
  it('renormalizes holders jointly: a card one seat cannot hold is shared by the others', () => {
    // E covered while hearts 8 was playable, so it cannot hold it; S and W share it.
    const visible: SevensVisibleState = {
      gameType: 'sevens', phase: 'playing', mySeat: 'N', myHand: [card('clubs', 2)], myCovered: [],
      handCounts: { N: 1, E: 1, S: 1, W: 1 }, coveredCounts: { N: 0, E: 0, S: 0, W: 0 },
      table: { spades: null, hearts: null, clubs: null, diamonds: null }, validCards: [], currentTurnSeat: 'N',
      log: [], result: null,
    };
    const knowledge = buildSevensKnowledge(visible);
    expect(sevensLiveProbability(knowledge, card('clubs', 2))).toBe(1);
  });

  it('counts hidden covers as cards that can no longer be played', () => {
    // Three unseen cards: two in hands, one covered by E after spades 8 became playable.
    const base: Omit<SevensVisibleState, 'log' | 'coveredCounts' | 'handCounts'> = {
      gameType: 'sevens', phase: 'playing', mySeat: 'N', myHand: [], myCovered: [],
      table: { spades: { low: 7, high: 7 }, hearts: null, clubs: null, diamonds: null }, validCards: [], currentTurnSeat: 'N',
      result: null,
    };
    const visible: SevensVisibleState = {
      ...base, handCounts: { N: 0, E: 1, S: 1, W: 1 }, coveredCounts: { N: 0, E: 1, S: 0, W: 0 },
      log: [{ type: 'play', seat: 'N', card: card('spades', 7), timestamp: 0 }, { type: 'cover', seat: 'E', timestamp: 1 }],
    };
    const knowledge = buildSevensKnowledge(visible);
    // The playable spade 8 was in no hand of E at its cover and cannot be E's cover either.
    expect(knowledge.liveProbabilities.get('spades:8')?.E).toBe(0);
  });
});
