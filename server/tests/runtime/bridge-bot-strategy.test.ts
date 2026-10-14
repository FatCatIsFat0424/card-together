import { runSeededGame } from './seeded-game-runner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BidAction, BidLevel, BidSuit, BiddingState, BridgeVisibleState, Card, PlayerInfo, Seat } from '@shared/types';
import { getBridgeBotAction } from '../../src/bots/bridge-strategy';
import { analyzeAuction } from '../../src/bots/bridge-auction';
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
const SUIT_CODES: Record<string, Card['suit']> = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
const HONOR_RANKS: Record<string, Card['rank']> = { A: 14, K: 13, Q: 12, J: 11, T: 10 };
/** Parses a spades.hearts.diamonds.clubs hand such as 'KQJ972.84.753.92'. */
function hand(text: string): Card[] {
  return text.split('.').flatMap((holding, index) => holding === '-' ? [] : [...holding].map((rank) => card(
    SUIT_CODES['SHDC'[index]], HONOR_RANKS[rank] ?? Number(rank) as Card['rank'],
  )));
}
/** Applies space-separated calls such as '1S P 2NT' clockwise from the starting seat. */
function auction(start: Seat, calls: string): BiddingState {
  const strains: Record<string, BidSuit> = { C: 'clubs', D: 'diamonds', H: 'hearts', S: 'spades', NT: 'nt' };
  return calls.split(' ').filter(Boolean).reduce((state, call) => applyBid(state, state.currentBidderSeat, call === 'P'
    ? { type: 'pass' }
    : { type: 'bid', level: Number(call[0]) as BidLevel, suit: strains[call.slice(1)] }), createBiddingState(start));
}
function callFor(text: string, bidding: BiddingState): BidAction {
  const action = getBridgeBotAction(visible({ mySeat: bidding.currentBidderSeat, myHand: hand(text), bidding }), () => 0);
  if (action?.type !== 'bridge-bid') throw new Error('Expected a bid');
  return action.action;
}
const pass: BidAction = { type: 'pass' };
const bid = (level: BidLevel, suit: BidSuit): BidAction => ({ type: 'bid', level, suit });
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

  it('raises a partner with support only to a safe level instead of chasing game', () => {
    const bidding = applyBid(applyBid(createBiddingState('S'), 'S', { type: 'bid', level: 1, suit: 'spades' }), 'W', { type: 'pass' });
    const hand = [card('spades', 14), card('spades', 13), card('spades', 2), card('spades', 3), card('clubs', 14)];
    expect(getBridgeBotAction(visible({ myHand: hand, bidding }), () => 0)).toEqual({
      type: 'bridge-bid', action: { type: 'bid', level: 3, suit: 'spades' },
    });
    expect(getBridgeBotAction(visible({ myHand: balancedHand, bidding }), () => 0)).toEqual({ type: 'bridge-bid', action: { type: 'bid', level: 3, suit: 'spades' } });
  });

  it('does not rebid an unsupported four-card suit in competition', () => {
    let bidding = applyBid(createBiddingState('N'), 'N', { type: 'bid', level: 1, suit: 'clubs' });
    bidding = applyBid(bidding, 'E', { type: 'bid', level: 1, suit: 'spades' });
    bidding = applyBid(bidding, 'S', { type: 'pass' });
    bidding = applyBid(bidding, 'W', { type: 'pass' });
    expect(callFor('542.AK4.AK6.Q987', bidding)).toEqual(pass);
  });

  it('responds with a new suit and lets the opener find the fit on its rebid', () => {
    const opener = [card('clubs', 14), card('clubs', 13), card('clubs', 12), card('clubs', 2), card('clubs', 3), card('spades', 14), card('spades', 7), card('spades', 6), card('spades', 5), card('hearts', 2), card('hearts', 3), card('diamonds', 2), card('diamonds', 3)];
    const responder = [card('spades', 13), card('spades', 12), card('spades', 11), card('spades', 2), card('hearts', 5), card('hearts', 6), card('hearts', 7), card('diamonds', 5), card('diamonds', 6), card('diamonds', 7), card('clubs', 5), card('clubs', 6), card('clubs', 7)];
    let bidding = applyBid(createBiddingState('N'), 'N', { type: 'bid', level: 1, suit: 'clubs' });
    bidding = applyBid(bidding, 'E', { type: 'pass' });
    const response = getBridgeBotAction(visible({ mySeat: 'S', myHand: responder, bidding }), () => 0)!;
    expect(response).toEqual({ type: 'bridge-bid', action: { type: 'bid', level: 1, suit: 'spades' } });
    if (response.type !== 'bridge-bid') throw new Error('Expected bid');
    bidding = applyBid(bidding, 'S', response.action);
    bidding = applyBid(bidding, 'W', { type: 'pass' });
    expect(getBridgeBotAction(visible({ myHand: opener, bidding }), () => 0)).toEqual({ type: 'bridge-bid', action: { type: 'bid', level: 2, suit: 'spades' } });
  });

  it('retains partner suit information after an opposing overcall', () => {
    let bidding = applyBid(createBiddingState('S'), 'S', { type: 'bid', level: 1, suit: 'spades' });
    bidding = applyBid(bidding, 'W', { type: 'bid', level: 2, suit: 'clubs' });
    expect(getBridgeBotAction(visible({ myHand: balancedHand, bidding }), () => 0)).toEqual({ type: 'bridge-bid', action: { type: 'bid', level: 3, suit: 'spades' } });
  });

  it('stops in partner NT opening because game earns no bonus', () => {
    let bidding = applyBid(createBiddingState('S'), 'S', { type: 'bid', level: 1, suit: 'nt' });
    bidding = applyBid(bidding, 'W', { type: 'pass' });
    expect(getBridgeBotAction(visible({ myHand: balancedHand, bidding }), () => 0)).toEqual({ type: 'bridge-bid', action: { type: 'pass' } });
  });

  it('passes a NT invitation whatever its strength', () => {
    let bidding = applyBid(createBiddingState('N'), 'N', { type: 'bid', level: 1, suit: 'nt' });
    bidding = applyBid(bidding, 'E', { type: 'pass' });
    bidding = applyBid(bidding, 'S', { type: 'bid', level: 2, suit: 'nt' });
    bidding = applyBid(bidding, 'W', { type: 'pass' });
    expect(getBridgeBotAction(visible({ myHand: balancedHand, bidding }), () => 0)).toEqual({ type: 'bridge-bid', action: { type: 'pass' } });
    const stronger = balancedHand.map((item) => item.suit === 'clubs' && item.rank === 9 ? card('clubs', 11) : item);
    expect(getBridgeBotAction(visible({ myHand: stronger, bidding }), () => 0)).toEqual({ type: 'bridge-bid', action: { type: 'pass' } });
  });

  it('rebids by opening range: 1NT when minimum balanced, a reverse only with extra strength', () => {
    expect(callFor('K32.Q54.A76.KJ52', auction('N', '1C P 1H P'))).toEqual(bid(1, 'nt'));
    expect(callFor('3.AQ64.AKQ75.K82', auction('N', '1D P 1S P'))).toEqual(bid(2, 'hearts'));
    expect(callFor('3.Q643.AK752.K82', auction('N', '1D P 1S P'))).toEqual(bid(2, 'diamonds'));
  });

  it('treats a new-suit response as forcing unless responder is a passed hand', () => {
    expect(callFor('Q42.5.A763.AK973', auction('N', '1C P 1H P'))).toEqual(bid(2, 'clubs'));
    const passedResponder = auction('S', 'P P 1C P 1H P');
    expect(callFor('Q42.5.A763.AK973', passedResponder)).toEqual(pass);
    const profile = analyzeAuction(passedResponder.bids).profiles.S;
    expect(profile).toMatchObject({ passedHand: true, minPoints: 6, maxPoints: 11 });
    expect(profile.minLength.hearts).toBe(4);
  });

  it('signs off in a five-card suit over partner 1NT and opener passes it', () => {
    expect(callFor('J2.Q8642.T75.932', auction('S', '1NT P'))).toEqual(bid(2, 'hearts'));
    expect(callFor('K72.Q86.T752.K93', auction('S', '1NT P'))).toEqual(pass);
    expect(callFor('A32.K4.QJ6.AT987', auction('N', '1NT P 2H P'))).toEqual(pass);
  });

  it('preempts with a weak long suit except in fourth seat', () => {
    expect(callFor('KQJ972.84.753.92', auction('N', ''))).toEqual(bid(2, 'spades'));
    expect(callFor('KQJ9732.84.75.92', auction('N', ''))).toEqual(bid(3, 'spades'));
    expect(callFor('KQJ972.84.753.92', auction('N', 'P P P'))).toEqual(bid(1, 'spades'));
  });

  it('competes with a known fit up to the total trump count', () => {
    expect(callFor('QT74.82.K973.J62', auction('E', '1H 1S 2H'))).toEqual(bid(2, 'spades'));
    expect(callFor('T7.82.K9763.J632', auction('E', '1H 1S 2H'))).toEqual(pass);
    expect(callFor('K2.KQJT63.A4.Q93', auction('N', '1H 1S 2H 2S'))).toEqual(bid(3, 'hearts'));
    expect(callFor('K2.KQJT6.A43.Q93', auction('N', '1H 1S 2H 2S'))).toEqual(pass);
  });

  it('does not overstate a 5422 hand as a balanced NT opening', () => {
    const hand = [...balancedHand.filter((item) => item.suit !== 'diamonds' && !(item.suit === 'hearts' && item.rank === 3)), card('spades', 5), card('clubs', 10), card('diamonds', 13), card('diamonds', 5)];
    expect(getBridgeBotAction(visible({ myHand: hand }), () => 0)).toEqual({ type: 'bridge-bid', action: { type: 'bid', level: 1, suit: 'clubs' } });
  });

  it('stops once the partnership has reached its supported contract', () => {
    let bidding = applyBid(createBiddingState('S'), 'S', { type: 'bid', level: 1, suit: 'spades' });
    bidding = applyBid(bidding, 'W', { type: 'pass' });
    bidding = applyBid(bidding, 'N', { type: 'bid', level: 4, suit: 'spades' });
    bidding = applyBid(bidding, 'E', { type: 'pass' });
    expect(getBridgeBotAction(visible({ mySeat: 'S', myHand: balancedHand, bidding }), () => 0)).toEqual({ type: 'bridge-bid', action: { type: 'pass' } });
  });

  it('leads partner bid suit, top of a doubleton', () => {
    const myHand = hand('83.753.Q96.K7542');
    const state = playing(myHand, {
      mySeat: 'W', bidding: auction('N', '1H 1S 2H P P P'),
      contract: { level: 2, suit: 'hearts', declarer: 'N' }, playing: createPlayingState('W'),
    });
    for (const sample of [0, 0.5, 0.999]) expect(getBridgeBotAction(state, () => sample)).toEqual({ type: 'bridge-play', card: card('spades', 8) });
    const silent = getBridgeBotAction({ ...state, bidding: createBiddingState('N') }, () => 0);
    expect(silent?.type === 'bridge-play' && silent.card.suit).toBe('clubs');
  });

  it('draws trumps with three small when partner has shown the long trump holding', () => {
    const myHand = hand('742.KQJ.9876.543');
    const state = playing(myHand, {
      mySeat: 'S', bidding: auction('N', '1S P 2S P P P'),
      contract: { level: 2, suit: 'spades', declarer: 'N' }, playing: createPlayingState('S'),
    });
    for (const sample of [0, 0.999]) {
      const action = getBridgeBotAction(state, () => sample);
      expect(action?.type === 'bridge-play' && action.card.suit).toBe('spades');
    }
    const unknown = getBridgeBotAction({ ...state, bidding: createBiddingState('N') }, () => 0);
    expect(unknown?.type === 'bridge-play' && unknown.card.suit).not.toBe('spades');
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
    runSeededGame(`bridge/${seed}`, 200, () => bridge.getGameState('BRBOT1')?.phase === 'scoring', () => {
      const game = bridge.getGameState('BRBOT1')!;
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
    });
    const game = bridge.getGameState('BRBOT1')!;
    expect(game.phase).toBe('scoring');
    expect(game.playing!.completedTricks).toHaveLength(13);
    expect(game.log.filter((entry) => entry.type === 'play')).toHaveLength(52);
  });
});
