import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BridgeVisibleState, Card, PlayerInfo, Seat } from '@shared/types';
import { getBridgeBotAction } from '../../src/bots/bridge-strategy';
import { applyBid, createBiddingState, validateBid } from '../../src/engine/bidding';
import { createPlayingState } from '../../src/engine/playing';
import * as bridge from '../../src/managers/games/bridge-game';

const card = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank });
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
function visible(overrides: Partial<BridgeVisibleState> = {}): BridgeVisibleState {
  return {
    gameType: 'bridge', phase: 'bidding', myHand: [], mySeat: 'N', dealerSeat: 'W',
    validCards: [], bidding: createBiddingState('N'), contract: null, playing: null,
    result: null, log: [], redealPendingSeat: null, ...overrides,
  };
}
function playing(hand: readonly Card[], overrides: Partial<BridgeVisibleState> = {}): BridgeVisibleState {
  return visible({
    phase: 'playing', myHand: hand, validCards: hand,
    contract: { level: 1, suit: 'nt', declarer: 'N' }, playing: createPlayingState('N'), ...overrides,
  });
}
const balancedHand = [
  card('spades', 14), card('spades', 13), card('spades', 2),
  card('hearts', 14), card('hearts', 3), card('hearts', 4),
  card('diamonds', 13), card('diamonds', 5), card('diamonds', 6),
  card('clubs', 12), card('clubs', 7), card('clubs', 8), card('clubs', 9),
];

describe('bridge bot strategy', () => {
  beforeEach(() => bridge.restoreGames([]));
  afterEach(() => vi.restoreAllMocks());

  it('passes a weak opening but opens at the fourth seat after three passes', () => {
    const hand = [card('clubs', 2), card('clubs', 3), card('hearts', 4)];
    expect(getBridgeBotAction(visible({ myHand: hand }), () => 0)).toEqual({ type: 'bridge-bid', action: { type: 'pass' } });
    let bidding = createBiddingState('E');
    for (const seat of ['E', 'S', 'W'] as const) bidding = applyBid(bidding, seat, { type: 'pass' });
    expect(getBridgeBotAction(visible({ myHand: hand, bidding }), () => 0)).toEqual({
      type: 'bridge-bid', action: { type: 'bid', suit: 'clubs', level: 1 },
    });
  });

  it('opens a balanced 16 point hand in 1NT', () => {
    expect(getBridgeBotAction(visible({ myHand: balancedHand }), () => 0)).toEqual({
      type: 'bridge-bid', action: { type: 'bid', level: 1, suit: 'nt' },
    });
  });

  it('passes against a high opposing contract', () => {
    const bidding = applyBid(createBiddingState('W'), 'W', { type: 'bid', level: 4, suit: 'clubs' });
    for (const sample of [0, 0.5, 0.99]) {
      expect(getBridgeBotAction(visible({ myHand: balancedHand, bidding }), () => sample)).toEqual({ type: 'bridge-bid', action: { type: 'pass' } });
    }
  });

  it('raises a partner only with sufficient points and suit support', () => {
    const bidding = applyBid(applyBid(createBiddingState('S'), 'S', { type: 'bid', level: 1, suit: 'spades' }), 'W', { type: 'pass' });
    const hand = [card('spades', 14), card('spades', 13), card('spades', 2), card('spades', 3), card('clubs', 14)];
    expect(getBridgeBotAction(visible({ myHand: hand, bidding }), () => 0)).toEqual({
      type: 'bridge-bid', action: { type: 'bid', level: 2, suit: 'spades' },
    });
    expect(getBridgeBotAction(visible({ myHand: balancedHand, bidding }), () => 0)).toEqual({ type: 'bridge-bid', action: { type: 'pass' } });
  });

  it('does not repeatedly raise its own earlier bid', () => {
    let bidding = applyBid(createBiddingState('N'), 'N', { type: 'bid', level: 1, suit: 'clubs' });
    bidding = applyBid(bidding, 'E', { type: 'bid', level: 1, suit: 'spades' });
    bidding = applyBid(bidding, 'S', { type: 'pass' });
    bidding = applyBid(bidding, 'W', { type: 'pass' });
    expect(getBridgeBotAction(visible({ myHand: balancedHand, bidding }), () => 0)).toEqual({ type: 'bridge-bid', action: { type: 'pass' } });
  });

  it('varies similarly rated low leads while preserving the state', () => {
    const state = playing([card('clubs', 2), card('clubs', 3), card('clubs', 4), card('hearts', 13)]);
    const original = structuredClone(state);
    const choices = new Set([0, 0.25, 0.75, 0.999].map((sample) => JSON.stringify(getBridgeBotAction(state, () => sample))));
    expect(choices.size).toBeGreaterThan(1);
    for (const sample of [0, 0.25, 0.75, 0.999]) {
      const action = getBridgeBotAction(state, () => sample)!;
      expect(action.type).toBe('bridge-play');
      if (action.type === 'bridge-play') expect(action.card.suit).toBe('clubs');
    }
    expect(state).toEqual(original);
  });

  it('cashes a king once the ace has been publicly played', () => {
    const hand = [card('hearts', 13), card('clubs', 2), card('clubs', 3), card('clubs', 4)];
    const state = playing(hand, { playing: {
      ...createPlayingState('N'), completedTricks: [{
        leadSeat: 'E', winnerSeat: 'E', cards: {
          N: card('hearts', 2), E: card('hearts', 14), S: card('hearts', 3), W: card('hearts', 4),
        },
      }],
    } });
    expect(getBridgeBotAction(state, () => 0.999)).toEqual({ type: 'bridge-play', card: card('hearts', 13) });
  });

  it('uses the lowest winning trump against an opponent', () => {
    const hand = [card('spades', 2), card('spades', 14), card('hearts', 3)];
    const state = playing(hand, {
      contract: { level: 1, suit: 'spades', declarer: 'N' }, playing: {
        ...createPlayingState('W'), currentTurnSeat: 'N', currentTrick: { W: card('clubs', 14) },
      },
    });
    for (const sample of [0, 0.999]) expect(getBridgeBotAction(state, () => sample)).toEqual({ type: 'bridge-play', card: card('spades', 2) });
  });

  it('draws outstanding trumps with a long trump holding on the declaring team', () => {
    const hand = [
      card('spades', 2), card('spades', 3), card('spades', 4), card('spades', 5),
      card('clubs', 2), card('clubs', 3), card('clubs', 4), card('clubs', 5), card('clubs', 6),
    ];
    const state = playing(hand, { contract: { level: 1, suit: 'spades', declarer: 'S' } });
    for (const sample of [0, 0.999]) {
      const action = getBridgeBotAction(state, () => sample)!;
      expect(action.type).toBe('bridge-play');
      if (action.type === 'bridge-play') expect(action.card.suit).toBe('spades');
    }
  });

  it('avoids leading an established winner into an opponent known to be void', () => {
    const hand = [card('clubs', 14), card('clubs', 2), card('clubs', 3), card('clubs', 4), card('hearts', 14)];
    const state = playing(hand, {
      contract: { level: 1, suit: 'spades', declarer: 'N' }, playing: {
        ...createPlayingState('N'), completedTricks: [{
          leadSeat: 'S', winnerSeat: 'E', cards: {
            N: card('clubs', 9), E: card('spades', 2), S: card('clubs', 8), W: card('clubs', 10),
          },
        }],
      },
    });
    expect(getBridgeBotAction(state, () => 0)).toEqual({ type: 'bridge-play', card: card('hearts', 14) });
  });

  it('discards a low side card when its partner already wins', () => {
    const hand = [card('spades', 2), card('spades', 14), card('hearts', 3)];
    expect(getBridgeBotAction(playing(hand, {
      contract: { level: 1, suit: 'spades', declarer: 'N' }, playing: {
        ...createPlayingState('S'), currentTurnSeat: 'N', currentTrick: { S: card('clubs', 14), W: card('clubs', 2) },
      },
    }), () => 0)).toEqual({ type: 'bridge-play', card: card('hearts', 3) });
  });

  it.each([1, 7, 42, 99, 256, 1024, 2026, 8675309])('finishes seeded game %i with legal actions and immutable visible inputs', (seed) => {
    const player = (seat: Seat): PlayerInfo => ({ id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null });
    const players = { N: player('N'), E: player('E'), S: player('S'), W: player('W') };
    const rng = random(seed);
    vi.spyOn(Math, 'random').mockImplementation(rng);
    bridge.startGame('BRBOT1', players);
    for (let count = 0; count < 200; count++) {
      const game = bridge.getGameState('BRBOT1')!;
      if (game.phase === 'scoring') break;
      const seat = game.phase === 'redeal_pending' ? game.redealPendingSeat! : game.phase === 'bidding' ? game.bidding!.currentBidderSeat : game.playing!.currentTurnSeat;
      const state = bridge.getPlayerVisibleState('BRBOT1', seat)!;
      const before = structuredClone(state);
      const action = getBridgeBotAction(state, rng)!;
      expect(action).not.toBeNull();
      expect(state).toEqual(before);
      if (action.type === 'bridge-redeal') expect(bridge.handleRedealResponse('BRBOT1', seat, action.accept).success).toBe(true);
      else if (action.type === 'bridge-bid') {
        expect(validateBid(game.bidding!, seat, action.action).valid).toBe(true);
        expect(bridge.handleBid('BRBOT1', seat, action.action).success).toBe(true);
      } else if (action.type === 'bridge-play') expect(bridge.handlePlayCard('BRBOT1', seat, action.card).success).toBe(true);
      else throw new Error('Unexpected non-Bridge action');
    }
    const game = bridge.getGameState('BRBOT1')!;
    expect(game.phase).toBe('scoring');
    expect(game.playing!.completedTricks).toHaveLength(13);
    expect(game.log.filter((entry) => entry.type === 'play')).toHaveLength(52);
  });
});
