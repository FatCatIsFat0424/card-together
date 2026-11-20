import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Card, PlayerInfo, Seat } from '@shared/types';
import type { GongZhuPlay, GongZhuTrick, GongZhuVisibleState } from '@shared/games/gongzhu/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { gongZhuLegalCards, gongZhuSeatMap, gongZhuTrickWinner } from '@shared/rules/gongzhu';
import { gameBot } from '../../src/bots/bot-registry';
import { getGongZhuBotAction } from '../../src/bots/gongzhu-strategy';
import { gongZhuSearch } from '../../src/bots/gongzhu-search';
import type { SearchContext } from '../../src/bots/search/search-types';
import { seededRandom } from '../../src/bots/search/seeded-random';
import { createDeck, shuffleDeck } from '../../src/engine/deck';
import * as game from '../../src/managers/games/gongzhu-game';

const c = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank });
const seeds = Array.from({ length: 16 }, (_, index) => index + 1);
const CODE = 'GZBOTS';
const PLAYERS = gongZhuSeatMap((seat): PlayerInfo => ({ id: seat, username: seat, nickname: seat, color: '#123456',
  avatar: 'cat', avatarImage: null }));

function context(seed: number, budgetMs = 2000): SearchContext {
  const began = performance.now();
  const timeLeftMs = (): number => Math.max(0, budgetMs - (performance.now() - began));
  return { random: seededRandom(seed), budget: { maxDepth: undefined, timeLeftMs, expired: () => timeLeftMs() === 0 } };
}

/** A finished trick; `cards` are in seat order from `lead`. */
function trick(lead: Seat, cards: readonly Card[]): GongZhuTrick {
  const start = SEAT_ORDER_CLOCKWISE.indexOf(lead);
  const plays = cards.map((card, index) => ({ seat: SEAT_ORDER_CLOCKWISE[(start + index) % 4], card }));
  return { plays, winner: gongZhuTrickWinner(plays) };
}

/** N's view with `history` finished and N to act on `open`; captures and hand counts follow the record. */
function view(myHand: readonly Card[], open: readonly GongZhuPlay[], history: readonly GongZhuTrick[] = [],
  overrides: Partial<GongZhuVisibleState> = {}): GongZhuVisibleState {
  const captures = gongZhuSeatMap((): Card[] => []);
  for (const record of history) captures[record.winner].push(...record.plays.map((play) => play.card));
  const handCounts = gongZhuSeatMap((seat) => (seat === 'N' ? myHand.length
    : 13 - history.length - (open.some((play) => play.seat === seat) ? 1 : 0)));
  return { gameType: 'gongzhu', phase: 'playing', mySeat: 'N', myHand,
    validCards: gongZhuLegalCards(myHand, open, history.length === 0), handCounts,
    hand: 1, captures, trick: open, tricks: history, currentTurnSeat: 'N',
    scores: gongZhuSeatMap(() => 0), handResults: [], log: [], result: null, ...overrides };
}

function played(visible: GongZhuVisibleState, seed = 1): Card {
  const action = getGongZhuBotAction(visible, seededRandom(seed));
  if (action?.type !== 'game-action' || action.request.gameType !== 'gongzhu') throw new Error('Expected a Gong Zhu play.');
  return action.request.action.card;
}

function searched(visible: GongZhuVisibleState, seed = 1, budgetMs = 2000): Card {
  const action = gongZhuSearch(visible, context(seed, budgetMs));
  if (action?.type !== 'game-action' || action.request.gameType !== 'gongzhu') throw new Error('Expected a Gong Zhu play.');
  return action.request.action.card;
}

const OPENING = [trick('N', [c('clubs', 2), c('clubs', 9), c('clubs', 5), c('clubs', 4)])];

afterEach(() => { game.restoreGames([]); vi.restoreAllMocks(); });

describe('Gong Zhu bot', () => {
  it('reads only its own view and varies only among near-equal cards', () => {
    const visible = view([c('clubs', 13), c('diamonds', 13), c('diamonds', 11)], [{ seat: 'W', card: c('spades', 14) }], OPENING);
    const before = structuredClone(visible);
    const choices = seeds.map((seed) => played(visible, seed));
    expect(choices.every((card) => card.rank === 13)).toBe(true);
    expect(seeds.map((seed) => played(visible, seed))).toEqual(choices);
    expect(visible).toEqual(before);
    Object.defineProperty(visible, 'observedHands', { get: () => { throw new Error('Spectator data read.'); } });
    expect(seeds.map((seed) => played(visible, seed))).toEqual(choices);
  });

  it('dumps the pig when void and wins the goat as the last player', () => {
    const dump = view([c('spades', 12), c('hearts', 14), c('diamonds', 11)], [{ seat: 'W', card: c('clubs', 14) }], OPENING);
    const win = view([c('diamonds', 12), c('diamonds', 14), c('diamonds', 2)], [
      { seat: 'E', card: c('diamonds', 11) }, { seat: 'S', card: c('diamonds', 3) }, { seat: 'W', card: c('diamonds', 4) },
    ], OPENING, { currentTurnSeat: 'N' });
    for (const seed of seeds) {
      expect(played(dump, seed)).toEqual(c('spades', 12));
      expect(played(win, seed).rank).toBeGreaterThan(11);
    }
  });

  it('counts the pig: no high spade lead while it is out', () => {
    const hand = [c('spades', 14), c('spades', 13), c('clubs', 13), c('diamonds', 3), c('diamonds', 5)];
    for (const seed of seeds) expect(played(view(hand, [], OPENING), seed).suit).not.toBe('spades');
    const pigGone = [...OPENING, trick('E', [c('spades', 2), c('spades', 12), c('spades', 3), c('spades', 4)])];
    const after = view([c('spades', 14), c('spades', 13), c('clubs', 13)], [{ seat: 'E', card: c('spades', 9) },
      { seat: 'S', card: c('spades', 10) }, { seat: 'W', card: c('spades', 7) }], pigGone);
    expect(played(after).rank).toBeGreaterThan(12);
  });

  it('dumps the transformer on a negative capture but not on a positive one', () => {
    const hand = [c('clubs', 10), c('clubs', 3), c('spades', 5)];
    const open: GongZhuPlay[] = [{ seat: 'E', card: c('diamonds', 9) }, { seat: 'S', card: c('diamonds', 13) },
      { seat: 'W', card: c('diamonds', 4) }];
    const negative = [trick('S', [c('hearts', 14), c('hearts', 2), c('hearts', 3), c('hearts', 4)])];
    const positive = [trick('S', [c('diamonds', 14), c('diamonds', 11), c('diamonds', 2), c('diamonds', 3)])];
    expect(played(view(hand, open, negative))).toEqual(c('clubs', 10));
    expect(played(view(hand, open, positive))).not.toEqual(c('clubs', 10));
  });

  it('blocks a heart sweep by taking the last heart', () => {
    // E captured every heart but the ace, which N holds with the lead.
    const history = [
      trick('N', [c('clubs', 2), c('clubs', 14), c('clubs', 3), c('clubs', 4)]),
      trick('E', [c('hearts', 13), c('hearts', 2), c('hearts', 3), c('hearts', 4)]),
      trick('E', [c('hearts', 12), c('hearts', 5), c('hearts', 6), c('hearts', 7)]),
      trick('E', [c('diamonds', 14), c('hearts', 8), c('diamonds', 3), c('diamonds', 4)]),
      trick('E', [c('diamonds', 13), c('hearts', 9), c('diamonds', 5), c('diamonds', 6)]),
      trick('E', [c('clubs', 13), c('clubs', 5), c('clubs', 8), c('clubs', 6)]),
      trick('E', [c('spades', 14), c('spades', 2), c('hearts', 11), c('spades', 3)]),
      trick('E', [c('diamonds', 12), c('hearts', 10), c('diamonds', 7), c('diamonds', 8)]),
      trick('E', [c('diamonds', 2), c('clubs', 7), c('diamonds', 9), c('diamonds', 10)]),
      trick('N', [c('spades', 8), c('spades', 4), c('spades', 6), c('clubs', 9)]),
    ];
    expect(history.map((record) => record.winner)).toEqual(['E', 'E', 'E', 'E', 'E', 'E', 'E', 'E', 'N', 'N']);
    const hand = [c('hearts', 14), c('clubs', 11), c('spades', 9)];
    const visible = view(hand, [], history);
    expect(visible.handCounts).toEqual({ N: 3, E: 3, S: 3, W: 3 });
    for (const seed of seeds) expect(played(visible, seed)).toEqual(c('hearts', 14));
  });
});

describe('Gong Zhu search', () => {
  it('plays legal cards from its own view without changing it, through a whole hand', () => {
    const random = seededRandom(9);
    game.startGame(CODE, PLAYERS, shuffleDeck(createDeck(), random));
    expect(gameBot('gongzhu').search?.budgetMs).toBeGreaterThanOrEqual(1000);
    let steps = 0;
    while (game.getGameState(CODE)!.hand === 1) {
      const seat = game.getGameState(CODE)!.currentTurnSeat;
      const visible = structuredClone(game.getPlayerVisibleState(CODE, seat)!);
      const before = structuredClone(visible);
      const card = searched(visible, steps, 40);
      expect(visible).toEqual(before);
      expect(visible.validCards).toContainEqual(card);
      expect(game.playCard(CODE, seat, card).success).toBe(true);
      steps++;
    }
    expect(steps).toBe(52);
    const spectator = { ...game.getPlayerVisibleState(CODE, 'N')!, observer: 'spectator' } as GongZhuVisibleState;
    expect(gongZhuSearch(spectator, context(1, 40))).toBeNull();
  }, 30_000);

  it('stops within its budget', () => {
    const random = seededRandom(4);
    game.startGame(CODE, PLAYERS, shuffleDeck(createDeck(), random));
    const first = game.getGameState(CODE)!.currentTurnSeat;
    expect(game.playCard(CODE, first, c('clubs', 2)).success).toBe(true);
    const seat = game.getGameState(CODE)!.currentTurnSeat;
    const visible = game.getPlayerVisibleState(CODE, seat)!;
    const began = performance.now();
    gongZhuSearch(visible, context(2, 25));
    expect(performance.now() - began).toBeLessThan(25 + 150);
  });
});
