import { afterEach, describe, expect, it } from 'vitest';
import type { Card, Seat } from '@shared/types';
import type { HeartsTrickRecord, HeartsVisibleState } from '@shared/games/hearts/types';
import { HEARTS_SEATS, heartsPassError, heartsValidCards } from '@shared/rules/hearts';
import { getBotAction } from '../../src/bots/bot-decisions';
import { gameBot } from '../../src/bots/bot-registry';
import { getHeartsBotAction } from '../../src/bots/hearts-strategy';
import { heartsSearch } from '../../src/bots/hearts-search';
import { firstLegalAction } from '../../src/runtime/automated-action';
import type { SearchContext } from '../../src/bots/search/search-types';
import { seededRandom } from '../../src/bots/search/seeded-random';
import * as hearts from '../../src/managers/games/hearts-game';
import { HEARTS_PLAYERS, heartsAction, heartsActor, heartsRandom, heartsShuffle, heartsView } from '../helpers/hearts';

const c = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank });
const seeds = Array.from({ length: 16 }, (_, index) => index + 1);
const CODE = 'HBOTS';

function context(seed: number, budgetMs = 2000): SearchContext {
  const began = performance.now();
  const timeLeftMs = (): number => Math.max(0, budgetMs - (performance.now() - began));
  return { random: seededRandom(seed), budget: { maxDepth: undefined, timeLeftMs, expired: () => timeLeftMs() === 0 } };
}

function played(view: HeartsVisibleState, seed = 1): Card {
  const action = heartsAction(getHeartsBotAction(view, seededRandom(seed)));
  if (action.type !== 'play') throw new Error('Expected a Hearts play.');
  return action.card;
}

function searched(view: HeartsVisibleState, seed = 1): Card {
  const action = heartsAction(heartsSearch(view, context(seed)));
  if (action.type !== 'play') throw new Error('Expected a Hearts play.');
  return action.card;
}

/** A finished trick record; `cards` are in seat order from `lead`. */
function trick(lead: Seat, winner: Seat, cards: readonly Card[]): HeartsTrickRecord {
  const start = HEARTS_SEATS.indexOf(lead);
  return { leadSeat: lead, winner, plays: cards.map((card, index) => ({ seat: HEARTS_SEATS[(start + index) % 4], card })) };
}

/** N's view mid-hand: `history` finished, N to act on the open trick, hand counts consistent with the record. */
function midHand(hand: readonly Card[], history: readonly HeartsTrickRecord[], open: HeartsVisibleState['trick'],
  overrides: Partial<HeartsVisibleState> = {}): HeartsVisibleState {
  const counts = Object.fromEntries(HEARTS_SEATS.map((seat) => [seat, 13 - history.length
    - (open?.plays.some((play) => play.seat === seat) ? 1 : 0)])) as Record<Seat, number>;
  counts.N = hand.length;
  const broken = history.some((record) => record.plays.some((play) => play.card.suit === 'hearts'));
  const view = heartsView(hand, { tricks: history, trick: open, handCounts: counts, heartsBroken: broken, ...overrides });
  return { ...view, validCards: heartsValidCards(hand, open!, history.length === 0, view.heartsBroken) };
}

/** Three early tricks in clubs and diamonds that leave every hand with ten cards. */
const OPENING = [
  trick('W', 'E', [c('clubs', 2), c('clubs', 10), c('clubs', 12), c('clubs', 9)]),
  trick('E', 'S', [c('diamonds', 3), c('diamonds', 9), c('diamonds', 6), c('diamonds', 4)]),
  trick('S', 'E', [c('diamonds', 2), c('diamonds', 5), c('diamonds', 7), c('diamonds', 8)]),
].map((record) => record);

afterEach(() => { hearts.restoreGames([]); });

describe('Hearts bot passing', () => {
  it('passes exactly three held cards from its own view and nothing while waiting', () => {
    const hand = [c('clubs', 2), c('clubs', 14), c('spades', 12), c('spades', 14), c('hearts', 13)];
    const view = heartsView(hand, { phase: 'passing', currentTurnSeat: null, validCards: [] });
    const before = structuredClone(view);
    for (const seed of seeds) {
      const action = heartsAction(getBotAction(view, seededRandom(seed)));
      expect(action.type).toBe('pass');
      if (action.type === 'pass') expect(heartsPassError(hand, action.cards)).toBeNull();
    }
    expect(view).toEqual(before);
    expect(getBotAction({ ...view, passedSeats: ['N'] }, () => 0)).toBeNull();
    expect(getBotAction({ ...view, observedHands: { E: hand } }, () => 0)).toEqual(getBotAction(view, () => 0));
  });

  it('passes a short queen of spades but keeps a well-guarded one', () => {
    const short = [c('spades', 12), c('spades', 3), c('clubs', 2), c('clubs', 5), c('clubs', 7), c('clubs', 9),
      c('diamonds', 4), c('diamonds', 6), c('diamonds', 8), c('hearts', 2), c('hearts', 3), c('hearts', 4), c('hearts', 6)];
    const long = [c('spades', 12), c('spades', 2), c('spades', 3), c('spades', 5), c('spades', 7), c('clubs', 2),
      c('clubs', 14), c('diamonds', 4), c('diamonds', 6), c('diamonds', 13), c('hearts', 3), c('hearts', 4), c('hearts', 14)];
    for (const seed of seeds) {
      const passShort = heartsAction(getHeartsBotAction(heartsView(short, { phase: 'passing' }), seededRandom(seed)));
      const passLong = heartsAction(getHeartsBotAction(heartsView(long, { phase: 'passing' }), seededRandom(seed)));
      if (passShort.type !== 'pass' || passLong.type !== 'pass') throw new Error('Expected passes.');
      expect(passShort.cards).toContainEqual(c('spades', 12));
      expect(passLong.cards).not.toContainEqual(c('spades', 12));
      expect(passLong.cards).toContainEqual(c('hearts', 14));
    }
  });

  it('empties a short side suit to create a void', () => {
    const hand = [c('diamonds', 13), c('diamonds', 10), c('spades', 2), c('spades', 4), c('spades', 6), c('spades', 8),
      c('clubs', 2), c('clubs', 3), c('clubs', 5), c('clubs', 6), c('hearts', 2), c('hearts', 5), c('hearts', 7)];
    const action = heartsAction(getHeartsBotAction(heartsView(hand, { phase: 'passing' }), seededRandom(1)));
    if (action.type !== 'pass') throw new Error('Expected a pass.');
    expect(action.cards).toEqual(expect.arrayContaining([c('diamonds', 13), c('diamonds', 10)]));
  });
});

describe('Hearts bot play', () => {
  it('ducks under the winner, dumps the queen when void, and keeps a legal fallback', () => {
    const early = [trick('N', 'W', [c('clubs', 2), c('clubs', 3), c('clubs', 5), c('clubs', 6)])];
    const open = { leadSeat: 'W' as const, plays: [{ seat: 'W' as const, card: c('clubs', 10) }] };
    const follow = midHand([c('clubs', 4), c('clubs', 8), c('clubs', 14)], early, open);
    expect(played(follow)).toEqual(c('clubs', 8));
    const voided = midHand([c('spades', 12), c('hearts', 14), c('diamonds', 14)], early, open);
    expect(played(voided)).toEqual(c('spades', 12));
    // The first trick forbids penalty cards while the hand holds anything else.
    const first = heartsView([c('spades', 12), c('hearts', 14), c('diamonds', 14)], { trick: { leadSeat: 'W',
      plays: [{ seat: 'W', card: c('clubs', 2) }] }, validCards: [c('diamonds', 14)] });
    expect(played(first)).toEqual(c('diamonds', 14));
    expect(heartsAction(firstLegalAction(follow))).toEqual({ type: 'play', card: c('clubs', 4) });
    expect(getBotAction({ ...follow, currentTurnSeat: 'E', validCards: [] }, () => 0)).toBeNull();
    expect(getBotAction({ ...follow, phase: 'scoring', validCards: [] }, () => 0)).toBeNull();
  });

  it('sheds a high card on a clean last play but ducks when the trick holds points', () => {
    const clean = heartsView([c('clubs', 3), c('clubs', 8), c('clubs', 14)], {
      trick: { leadSeat: 'E', plays: [{ seat: 'E', card: c('clubs', 10) }, { seat: 'S', card: c('clubs', 4) },
        { seat: 'W', card: c('clubs', 6) }] },
    });
    const dirty = { ...clean, trick: { ...clean.trick!, plays: [...clean.trick!.plays.slice(0, 2),
      { seat: 'W' as const, card: c('hearts', 2) }] } };
    for (const seed of seeds) {
      expect(played(clean, seed)).toEqual(c('clubs', 14));
      expect(played(dirty, seed)).toEqual(c('clubs', 8));
    }
  });

  it('counts the queen of spades: no high spade lead while it is out, a safe one once it fell', () => {
    const hand = [c('spades', 14), c('spades', 13), c('clubs', 13), c('clubs', 14), c('diamonds', 14),
      c('diamonds', 13), c('hearts', 13), c('hearts', 14), c('hearts', 12), c('hearts', 11)];
    const out = midHand(hand, OPENING, { leadSeat: 'N', plays: [] });
    for (const seed of seeds) expect(played(out, seed).suit).not.toBe('spades');
    // With the queen out and E still to play, duck under the spade lead rather than offer the ace.
    const third = midHand([c('spades', 14), c('spades', 5), c('clubs', 13)], OPENING, { leadSeat: 'S', plays: [
      { seat: 'S', card: c('spades', 9) }, { seat: 'W', card: c('spades', 10) }] });
    expect(played(third)).toEqual(c('spades', 5));
    // Once the queen fell, a clean last play takes the trick with the ace.
    const queenGone = [...OPENING, trick('E', 'S', [c('spades', 2), c('spades', 13), c('spades', 12), c('spades', 3)])];
    const last = midHand([c('spades', 14), c('spades', 5), c('clubs', 13)], queenGone, { leadSeat: 'E', plays: [
      { seat: 'E', card: c('spades', 9) }, { seat: 'S', card: c('spades', 7) }, { seat: 'W', card: c('spades', 10) }] });
    expect(played(last)).toEqual(c('spades', 14));
  });

  it('dumps the queen on a rival unless that ends the match with someone else ahead', () => {
    const hand = [c('spades', 12), c('diamonds', 13), c('diamonds', 10)];
    const open = { leadSeat: 'E' as const, plays: [{ seat: 'E' as const, card: c('clubs', 9) },
      { seat: 'S' as const, card: c('clubs', 13) }, { seat: 'W' as const, card: c('clubs', 4) }] };
    const history = [trick('N', 'W', [c('clubs', 2), c('clubs', 3), c('clubs', 5), c('clubs', 6)])];
    const base = midHand(hand, history, open);
    expect(played({ ...base, scores: { N: 40, E: 50, S: 60, W: 55 } })).toEqual(c('spades', 12));
    // S at 95 would end the match with W lowest, so N keeps the queen and sheds a high diamond.
    expect(played({ ...base, scores: { N: 60, E: 70, S: 95, W: 30 } }).suit).toBe('diamonds');
    // When N would win the match by it, the queen goes.
    expect(played({ ...base, scores: { N: 20, E: 70, S: 95, W: 30 } })).toEqual(c('spades', 12));
  });

  it('blocks a moon by taking the last heart, in the heuristic and the search', () => {
    // E took every point so far (the queen and twelve hearts); N holds the last heart and the lead.
    const history: HeartsTrickRecord[] = [
      trick('N', 'E', [c('clubs', 2), c('clubs', 14), c('clubs', 3), c('clubs', 4)]),
      trick('E', 'E', [c('spades', 14), c('spades', 2), c('spades', 12), c('spades', 3)]),
      trick('E', 'E', [c('diamonds', 14), c('hearts', 4), c('diamonds', 3), c('diamonds', 4)]),
      trick('E', 'E', [c('hearts', 13), c('hearts', 5), c('hearts', 6), c('hearts', 2)]),
      trick('E', 'E', [c('hearts', 12), c('hearts', 7), c('hearts', 8), c('hearts', 3)]),
      trick('E', 'E', [c('diamonds', 13), c('hearts', 9), c('diamonds', 5), c('diamonds', 6)]),
      trick('E', 'E', [c('diamonds', 12), c('hearts', 10), c('diamonds', 7), c('diamonds', 8)]),
      trick('E', 'E', [c('clubs', 13), c('clubs', 5), c('hearts', 11), c('clubs', 6)]),
      trick('E', 'E', [c('spades', 13), c('spades', 4), c('spades', 5), c('spades', 6)]),
      trick('E', 'N', [c('diamonds', 2), c('clubs', 10), c('diamonds', 9), c('diamonds', 10)]),
    ];
    const hand = [c('hearts', 14), c('clubs', 8), c('spades', 7)];
    const view = midHand(hand, history, { leadSeat: 'N', plays: [] });
    expect(view.handCounts).toEqual({ N: 3, E: 3, S: 3, W: 3 });
    for (const seed of seeds.slice(0, 4)) {
      expect(played(view, seed)).toEqual(c('hearts', 14));
      expect(searched(view, seed)).toEqual(c('hearts', 14));
    }
  });
});

describe('Hearts search', () => {
  it('plays legal cards from its own view without changing it, through whole hands', () => {
    const random = heartsRandom(5);
    hearts.startGame(CODE, HEARTS_PLAYERS, 30000, heartsShuffle(random), 1000);
    const bot = gameBot('hearts');
    expect(bot.search?.budgetMs).toBeGreaterThanOrEqual(1000);
    let steps = 0;
    while (hearts.getGameState(CODE)!.hand <= 2 && !hearts.getGameState(CODE)!.result) {
      const seat = heartsActor(hearts.getGameState(CODE)!);
      const view = structuredClone(hearts.getPlayerVisibleState(CODE, seat)!);
      const before = structuredClone(view);
      const poisoned = { ...view, observedHands: { N: [c('spades', 12)], E: [], S: [], W: [] } };
      const action = heartsAction(heartsSearch(view, context(steps, 40)));
      expect(view).toEqual(before);
      if (steps % 9 === 0) expect(heartsAction(heartsSearch(poisoned, context(steps, 40)))).toBeDefined();
      if (action.type === 'play') expect(view.validCards).toContainEqual(action.card);
      expect(hearts.act(CODE, seat, action, 1001 + steps, () => heartsShuffle(random))).toEqual({ success: true });
      steps++;
    }
    expect(steps).toBeGreaterThan(100);
  }, 60_000);

  it('searches the pass and every play within its budget', () => {
    const random = heartsRandom(11);
    hearts.startGame(CODE, HEARTS_PLAYERS, 30000, heartsShuffle(random), 1000);
    for (const seat of HEARTS_SEATS) {
      const view = hearts.getPlayerVisibleState(CODE, seat)!;
      const began = performance.now();
      const action = heartsAction(heartsSearch(view, context(seat.charCodeAt(0), 60)));
      expect(performance.now() - began).toBeLessThan(60 + 150);
      if (action.type !== 'pass') throw new Error('Expected a pass.');
      expect(heartsPassError(view.myHand, action.cards)).toBeNull();
      expect(hearts.act(CODE, seat, action, 1001)).toEqual({ success: true });
    }
    const seat = heartsActor(hearts.getGameState(CODE)!);
    hearts.act(CODE, seat, { type: 'play', card: c('clubs', 2) }, 1002);
    const next = heartsActor(hearts.getGameState(CODE)!);
    const view = hearts.getPlayerVisibleState(CODE, next)!;
    expect(view.myPass).toHaveLength(3);
    const began = performance.now();
    heartsSearch(view, context(3, 25));
    expect(performance.now() - began).toBeLessThan(25 + 150);
  });
});
