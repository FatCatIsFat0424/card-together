import { describe, expect, it } from 'vitest';
import type { Card, Seat } from '@shared/types';
import type { SpadesPlay, SpadesPosition, SpadesVisibleState } from '@shared/games/spades/types';
import { applySpadesMove, newSpadesHand, scoreSpadesHand, SPADES_SEATS, spadesLegalCards, spadesSeatMap, spadesTeam,
  spadesTrickWinner } from '@shared/rules/spades';
import { easySpadesAction, getSpadesBotAction } from '../../src/bots/spades-strategy';
import { seededRandom } from '../../src/bots/search/seeded-random';
import { createDeck, shuffleDeck } from '../../src/engine/deck';

const c = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank });
const seeds = Array.from({ length: 64 }, (_, index) => index + 1);

function view(hand: readonly Card[], trick: readonly SpadesPlay[] = [], overrides: Partial<SpadesPosition> = {}): SpadesVisibleState {
  const position: SpadesPosition = { ...newSpadesHand('W'), phase: 'playing', bids: { N: 3, E: 3, S: 3, W: 3 },
    currentTurnSeat: 'N', broken: true, trick, ...overrides };
  return { gameType: 'spades', phase: 'playing', mySeat: 'N', myHand: hand, handCounts: spadesSeatMap(() => hand.length),
    position, currentTurnSeat: 'N', dealerSeat: 'W', validCards: spadesLegalCards(hand, trick, true),
    scores: { NS: 0, EW: 0 }, bags: { NS: 0, EW: 0 }, handResults: [], log: [], result: null };
}

function played(visible: SpadesVisibleState, seed: number): Card {
  const action = getSpadesBotAction(visible, seededRandom(seed));
  if (action?.type !== 'game-action' || action.request.gameType !== 'spades' || action.request.action.type !== 'play') {
    throw new Error('Expected a Spades play.');
  }
  return action.request.action.card;
}

describe('Spades hard bot variety and cooperation', () => {
  it('varies equivalent low leads without spending a high card or reading spectator hands', () => {
    const visible = view([c('clubs', 2), c('diamonds', 2), c('hearts', 2), c('clubs', 12)]);
    const before = structuredClone(visible);
    const choices = seeds.map((seed) => played(visible, seed));
    expect(new Set(choices.map((card) => card.suit)).size).toBe(3);
    expect(choices.every((card) => card.rank === 2)).toBe(true);
    expect(seeds.map((seed) => played(visible, seed))).toEqual(choices);
    expect(visible).toEqual(before);
    Object.defineProperty(visible, 'observedHands', { get: () => { throw new Error('Spectator data read.'); } });
    expect(seeds.map((seed) => played(visible, seed))).toEqual(choices);
  });

  it('varies touching winners but preserves a higher card separated by an unseen rank', () => {
    const visible = view([c('clubs', 10), c('clubs', 11), c('clubs', 12), c('clubs', 14)], [
      { seat: 'S', card: c('clubs', 8) }, { seat: 'W', card: c('clubs', 9) },
    ]);
    const ranks = seeds.map((seed) => played(visible, seed).rank);
    expect(new Set(ranks)).toEqual(new Set([10, 11, 12]));
  });

  it('leaves a safe partner in control and secures a vulnerable partner before the final opponent', () => {
    const hand = [c('clubs', 2), c('clubs', 14), c('spades', 14)];
    const vulnerable = view(hand, [{ seat: 'S', card: c('clubs', 10) }, { seat: 'W', card: c('clubs', 3) }]);
    const safe = view(hand, [{ seat: 'E', card: c('clubs', 10) }, { seat: 'S', card: c('clubs', 13) },
      { seat: 'W', card: c('clubs', 3) }]);
    for (const seed of seeds) {
      expect(played(vulnerable, seed)).toEqual(c('clubs', 14));
      expect(played(safe, seed)).toEqual(c('clubs', 2));
    }
  });

  it('covers a live partner nil and ducks its own nil across seeds', () => {
    const trick: SpadesPlay[] = [{ seat: 'S', card: c('clubs', 5) }, { seat: 'W', card: c('clubs', 3) }];
    const cover = view([c('clubs', 8), c('clubs', 9), c('clubs', 14)], trick, { bids: { N: 3, E: 3, S: 0, W: 3 } });
    const nil = view([c('clubs', 2), c('clubs', 4), c('clubs', 14)], trick, { bids: { N: 0, E: 3, S: 3, W: 3 } });
    for (const seed of seeds) {
      const card = played(cover, seed);
      expect(spadesTrickWinner([...trick, { seat: 'N', card }])).toBe('N');
      expect(card.rank).toBeLessThan(14);
      expect(spadesTrickWinner([...trick, { seat: 'N', card: played(nil, seed) }])).not.toBe('N');
    }
  });
});

/** Paired deals swap the hard partnership while keeping the same cards and bids. */
function hardAdvantage(seed: number, hardTeam: 'NS' | 'EW'): number {
  const deck = shuffleDeck(createDeck(), seededRandom(seed));
  const hands = spadesSeatMap((seat) => deck.slice(SPADES_SEATS.indexOf(seat) * 13, (SPADES_SEATS.indexOf(seat) + 1) * 13));
  let position = newSpadesHand('W');
  const randoms = spadesSeatMap((seat) => seededRandom(seed * 31 + SPADES_SEATS.indexOf(seat)));
  for (let step = 0; step < 56; step++) {
    const seat = position.currentTurnSeat!;
    const visible: SpadesVisibleState = { ...view(hands[seat]), phase: position.phase === 'bidding' ? 'bidding' : 'playing',
      mySeat: seat, currentTurnSeat: seat, position,
      handCounts: spadesSeatMap((other) => hands[other].length),
      validCards: spadesLegalCards(hands[seat], position.trick, position.broken) };
    const strategy = position.phase === 'bidding' || spadesTeam(seat) === hardTeam ? getSpadesBotAction : easySpadesAction;
    const action = strategy(visible, randoms[seat]);
    if (action?.type !== 'game-action' || action.request.gameType !== 'spades') throw new Error('Expected Spades action.');
    const move = action.request.action;
    const next = applySpadesMove(position, seat, hands[seat], move);
    if (!next) throw new Error('Illegal Spades action.');
    position = next;
    if (move.type === 'play') hands[seat] = hands[seat].filter((card) => card !== move.card);
  }
  expect(position.phase).toBe('complete');
  const score = scoreSpadesHand(position.bids as Record<Seat, number>, position.taken, { NS: 0, EW: 0 });
  const other = hardTeam === 'NS' ? 'EW' : 'NS';
  return score.teams[hardTeam].points - score.teams[other].points;
}

describe('Spades seeded strength', () => {
  it('outplays random legal opponents on paired deals with identical bidding', () => {
    const advantages = seeds.flatMap((seed) => [hardAdvantage(seed, 'NS'), hardAdvantage(seed, 'EW')]);
    expect(advantages.reduce((sum, value) => sum + value, 0) / advantages.length).toBeGreaterThan(0);
  });
});
