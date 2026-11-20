import { describe, expect, it } from 'vitest';
import type { Card, Seat } from '@shared/types';
import type { SpadesPlay, SpadesPosition, SpadesTrick, SpadesVisibleState } from '@shared/games/spades/types';
import { applySpadesMove, newSpadesHand, scoreSpadesHand, SPADES_SEATS, spadesLegalCards, spadesSeatMap, spadesTeam,
  spadesTrickWinner } from '@shared/rules/spades';
import type { BotAction } from '../../src/bots/bot-decisions';
import { getSpadesBotAction } from '../../src/bots/spades-strategy';
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

describe('Spades bot variety and cooperation', () => {
  it('varies equivalent low leads without spending a high card or reading spectator hands', () => {
    const visible = view([c('clubs', 2), c('diamonds', 2), c('hearts', 2), c('clubs', 12)]);
    const before = structuredClone(visible);
    const choices = seeds.map((seed) => played(visible, seed));
    // The club 2 guards the queen, so the equal deuces of the other suits lead.
    expect(new Set(choices.map((card) => card.suit))).toEqual(new Set(['diamonds', 'hearts']));
    expect(choices.every((card) => card.rank === 2)).toBe(true);
    expect(seeds.map((seed) => played(visible, seed))).toEqual(choices);
    expect(visible).toEqual(before);
    Object.defineProperty(visible, 'observedHands', { get: () => { throw new Error('Spectator data read.'); } });
    expect(seeds.map((seed) => played(visible, seed))).toEqual(choices);
  });

  it('varies touching winners but preserves a higher card separated by an unseen rank', () => {
    const visible = view([c('clubs', 10), c('clubs', 11), c('clubs', 12), c('clubs', 14)], [
      { seat: 'E', card: c('clubs', 8) }, { seat: 'S', card: c('clubs', 2) }, { seat: 'W', card: c('clubs', 9) },
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

/** A finished trick from its plays in order. */
function done(...plays: [Seat, Card][]): SpadesTrick {
  const list = plays.map(([seat, card]) => ({ seat, card }));
  return { plays: list, winner: spadesTrickWinner(list) };
}

function bid(hand: readonly Card[], bids: Partial<Record<Seat, number>> = {}, extra: Partial<SpadesVisibleState> = {}): number {
  const position: SpadesPosition = { ...newSpadesHand('W'), bids: { N: null, E: null, S: null, W: null, ...bids } };
  const visible: SpadesVisibleState = { ...view(hand), phase: 'bidding', position, validCards: [], ...extra };
  const action = getSpadesBotAction(visible, seededRandom(1));
  if (action?.type !== 'game-action' || action.request.gameType !== 'spades' || action.request.action.type !== 'bid') {
    throw new Error('Expected a Spades bid.');
  }
  return action.request.action.bid;
}

const parse = (text: string): Card[] => text.split(' ').map((code) => {
  const suit = ({ C: 'clubs', D: 'diamonds', H: 'hearts', S: 'spades' } as const)[code[0] as 'C' | 'D' | 'H' | 'S'];
  const rank = ({ A: 14, K: 13, Q: 12, J: 11, T: 10 } as Record<string, number>)[code.slice(1)] ?? Number(code.slice(1));
  return c(suit, rank as Card['rank']);
});

describe('Spades bot contract and table awareness', () => {
  it('plays second hand low when its winner is likely beaten and partner plays last', () => {
    const visible = view([c('clubs', 3), c('clubs', 10), c('hearts', 9)], [{ seat: 'W', card: c('clubs', 5) }]);
    for (const seed of seeds) expect(played(visible, seed)).toEqual(c('clubs', 3));
  });

  it('draws trumps with the top spades when holding most of those left', () => {
    const tricks = [
      done(['E', c('spades', 2)], ['S', c('spades', 3)], ['W', c('spades', 4)], ['N', c('spades', 5)]),
      done(['N', c('spades', 6)], ['E', c('spades', 7)], ['S', c('spades', 8)], ['W', c('spades', 9)]),
      done(['W', c('hearts', 14)], ['N', c('hearts', 3)], ['E', c('hearts', 4)], ['S', c('hearts', 5)]),
      done(['W', c('hearts', 9)], ['N', c('hearts', 12)], ['E', c('hearts', 10)], ['S', c('hearts', 11)]),
    ];
    const hand = parse('SA SK SJ ST C2 C3 D2 D3 H2');
    const visible = { ...view(hand, [], { tricks, taken: { N: 2, E: 0, S: 0, W: 2 }, bids: { N: 4, E: 3, S: 3, W: 3 } }),
      handCounts: { N: 9, E: 9, S: 9, W: 9 } };
    for (const seed of seeds.slice(0, 8)) {
      const card = played(visible, seed);
      expect(card.suit).toBe('spades');
      expect(card.rank).toBeGreaterThanOrEqual(13);
    }
  });

  it('does not cash a master that an opponent shown out of the suit can ruff', () => {
    const tricks = [
      done(['N', c('diamonds', 2)], ['E', c('clubs', 5)], ['S', c('diamonds', 3)], ['W', c('diamonds', 4)]),
      done(['W', c('hearts', 2)], ['N', c('hearts', 14)], ['E', c('hearts', 3)], ['S', c('hearts', 4)]),
    ];
    const visible = { ...view(parse('DA C2 C3 H5 H6'), [], { tricks, taken: { N: 1, E: 0, S: 0, W: 1 } }),
      handCounts: { N: 11, E: 11, S: 11, W: 11 } };
    for (const seed of seeds.slice(0, 8)) expect(played(visible, seed)).not.toEqual(c('diamonds', 14));
  });

  it('ducks to avoid bags once its contract is made and the opponents cannot be set', () => {
    const visible = view([c('clubs', 2), c('clubs', 14)], [{ seat: 'E', card: c('clubs', 5) }, { seat: 'S', card: c('clubs', 3) },
      { seat: 'W', card: c('clubs', 9) }], { bids: { N: 1, E: 3, S: 1, W: 3 }, taken: { N: 2, E: 3, S: 0, W: 3 } });
    for (const seed of seeds) expect(played(visible, seed)).toEqual(c('clubs', 2));
  });

  it('lets a live opponent Nil win and leads low into it', () => {
    const bids = { N: 3, E: 0, S: 3, W: 3 };
    const winning = view([c('clubs', 5), c('clubs', 13)], [{ seat: 'E', card: c('clubs', 9) }, { seat: 'S', card: c('clubs', 2) },
      { seat: 'W', card: c('clubs', 4) }], { bids });
    const leading = view([c('clubs', 2), c('clubs', 14), c('hearts', 13)], [], { bids });
    for (const seed of seeds) {
      expect(played(winning, seed)).toEqual(c('clubs', 5));
      expect(played(leading, seed)).toEqual(c('clubs', 2));
    }
  });

  it('bids shape, Nil, and partner context', () => {
    const balanced = parse('SA S7 S4 HA H8 H5 H3 D9 D6 D3 C8 C5 C2');
    const shapely = parse('SA S7 S4 S3 S2 HA H8 H5 H3 D9 D6 D3 D2');
    expect(bid(shapely)).toBeGreaterThan(bid(balanced));
    const weak = parse('S2 S5 H2 H4 H7 H9 D3 D5 D8 C2 C4 C6 C9');
    expect(bid(weak)).toBe(0);
    expect(bid(weak, { S: 0 })).toBeGreaterThan(0);
    const strong = parse('SA SK SQ S9 S5 HA HK H4 DA D5 C6 C4 C2');
    expect(bid(strong)).toBeGreaterThanOrEqual(6);
  });
});

/** A seeded uniformly random legal card: the weak baseline the bot is measured against. */
function randomLegalPlay(visible: SpadesVisibleState, random: () => number): BotAction | null {
  const cards = visible.validCards;
  if (cards.length === 0) return null;
  const card = cards[Math.min(cards.length - 1, Math.floor(random() * cards.length))];
  return { type: 'game-action', request: { gameType: 'spades', action: { type: 'play', card } } };
}

/** Paired deals swap the bot partnership while keeping the same cards and bids. */
function botAdvantage(seed: number, botTeam: 'NS' | 'EW'): number {
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
    const strategy = position.phase === 'bidding' || spadesTeam(seat) === botTeam ? getSpadesBotAction : randomLegalPlay;
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
  const other = botTeam === 'NS' ? 'EW' : 'NS';
  return score.teams[botTeam].points - score.teams[other].points;
}

describe('Spades seeded strength', () => {
  it('outplays random legal opponents on paired deals with identical bidding', () => {
    const advantages = seeds.flatMap((seed) => [botAdvantage(seed, 'NS'), botAdvantage(seed, 'EW')]);
    expect(advantages.reduce((sum, value) => sum + value, 0) / advantages.length).toBeGreaterThan(0);
  });
});
