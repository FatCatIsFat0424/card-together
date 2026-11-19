import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BridgeVisibleState, Card, PlayerInfo, Seat } from '@shared/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { analyzeAuction, handPoints, isBalancedShape, suitLengths } from '../../src/bots/bridge-auction';
import { GAME_BOTS } from '../../src/bots/bot-registry';
import { bridgeSearch, sampleBridgeHands } from '../../src/bots/bridge-search';
import { getBridgeBotAction } from '../../src/bots/bridge-strategy';
import { shownVoids } from '../../src/bots/bridge-sampling';
import { applyBid, createBiddingState } from '../../src/engine/bidding';
import { createPlayingState } from '../../src/engine/playing';
import * as bridge from '../../src/managers/games/bridge-game';
import type { SearchContext } from '../../src/bots/search/search-types';
import { seededRandom } from '../../src/bots/search/seeded-random';
import { runSeededGame } from './seeded-game-runner';

const CODE = 'BRSRCH';
const player = (seat: Seat): PlayerInfo => ({ id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null });
const players = { N: player('N'), E: player('E'), S: player('S'), W: player('W') };
const key = (card: Card): string => `${card.suit}:${card.rank}`;

function context(seed: number, budgetMs: number): SearchContext {
  const began = performance.now();
  const timeLeftMs = (): number => Math.max(0, budgetMs - (performance.now() - began));
  return { random: seededRandom(seed), budget: { maxDepth: undefined, timeLeftMs, expired: () => timeLeftMs() === 0 } };
}

function turnSeat(): Seat {
  const game = bridge.getGameState(CODE)!;
  return game.phase === 'redeal_pending' ? game.redealPendingSeat! : game.phase === 'bidding'
    ? game.bidding!.currentBidderSeat : game.playing!.currentTurnSeat;
}

/** Applies a bot action and fails the test on a rejected one. */
function apply(seat: Seat, action: ReturnType<typeof bridgeSearch>): void {
  if (action?.type === 'bridge-redeal') expect(bridge.handleRedealResponse(CODE, seat, action.accept).success).toBe(true);
  else if (action?.type === 'bridge-bid') expect(bridge.handleBid(CODE, seat, action.action).success).toBe(true);
  else if (action?.type === 'bridge-play') expect(bridge.handlePlayCard(CODE, seat, action.card).success).toBe(true);
  else throw new Error('Expected a Bridge action');
}

describe('bridge search bot', () => {
  afterEach(() => {
    bridge.restoreGames([]);
    vi.restoreAllMocks();
  });

  it('samples hidden hands that respect hand sizes, shown voids, and every known card', () => {
    vi.spyOn(Math, 'random').mockImplementation(seededRandom(21));
    bridge.startGame(CODE, players);
    const heuristic = seededRandom(5);
    runSeededGame('bridge-search/sample', 300, () => (bridge.getGameState(CODE)?.playing?.completedTricks.length ?? 0) >= 6, () => {
      const seat = turnSeat();
      apply(seat, getBridgeBotAction(bridge.getPlayerVisibleState(CODE, seat)!, heuristic));
    });
    const random = seededRandom(9);
    for (const seat of SEAT_ORDER_CLOCKWISE) {
      const visible = bridge.getPlayerVisibleState(CODE, seat)!;
      const before = structuredClone(visible);
      const playing = visible.playing!;
      const played = [...playing.completedTricks.flatMap((trick) => Object.values(trick.cards)), ...Object.values(playing.currentTrick)];
      const voids = shownVoids(visible);
      for (let sample = 0; sample < 25; sample++) {
        const hands = sampleBridgeHands(visible, random)!;
        expect(hands[seat].map(key).sort()).toEqual(visible.myHand.map(key).sort());
        const all = SEAT_ORDER_CLOCKWISE.flatMap((other) => hands[other]).map(key);
        expect(new Set([...all, ...played.map(key)]).size).toBe(52);
        for (const other of SEAT_ORDER_CLOCKWISE) {
          const playedByOther = [...playing.completedTricks.map((trick) => trick.cards[other]), playing.currentTrick[other]].filter(Boolean);
          expect(hands[other]).toHaveLength(13 - playedByOther.length);
          for (const suit of voids[other]) expect(hands[other].some((card) => card.suit === suit)).toBe(false);
        }
      }
      expect(visible).toEqual(before);
    }
  });

  it('fits sampled hands to what the auction showed', () => {
    const bidding = applyBid(applyBid(createBiddingState('E'), 'E', { type: 'bid', level: 1, suit: 'nt' }), 'S', { type: 'pass' });
    const profile = analyzeAuction(bidding.bids).profiles.E;
    const myHand: Card[] = [
      { suit: 'spades', rank: 9 }, { suit: 'spades', rank: 5 }, { suit: 'spades', rank: 2 }, { suit: 'hearts', rank: 12 },
      { suit: 'hearts', rank: 7 }, { suit: 'hearts', rank: 3 }, { suit: 'diamonds', rank: 11 }, { suit: 'diamonds', rank: 8 },
      { suit: 'diamonds', rank: 4 }, { suit: 'clubs', rank: 10 }, { suit: 'clubs', rank: 6 }, { suit: 'clubs', rank: 3 },
      { suit: 'clubs', rank: 2 },
    ];
    const visible: BridgeVisibleState = {
      gameType: 'bridge', phase: 'playing', myHand, mySeat: 'S', dealerSeat: 'E', validCards: myHand, bidding,
      contract: { level: 1, suit: 'nt', declarer: 'E' }, playing: createPlayingState('S'), result: null, log: [],
      redealPendingSeat: null,
    };
    const random = seededRandom(4);
    let fits = 0;
    for (let sample = 0; sample < 40; sample++) {
      const east = sampleBridgeHands(visible, random)!.E;
      const points = handPoints(east);
      if (points >= profile.minPoints && points <= profile.maxPoints && isBalancedShape(suitLengths(east))) fits++;
    }
    expect(fits).toBeGreaterThanOrEqual(36);
  });

  it('accepts a redeal offered to a bot but keeps the deal when a human times out', () => {
    const visible: BridgeVisibleState = {
      gameType: 'bridge', phase: 'redeal_pending', myHand: [], mySeat: 'N', dealerSeat: 'W', validCards: [],
      bidding: null, contract: null, playing: null, result: null, log: [], redealPendingSeat: 'N',
    };
    expect(bridgeSearch(visible, context(1, 100))).toEqual({ type: 'bridge-redeal', accept: true });
    const strategy = (): ReturnType<typeof bridgeSearch> => getBridgeBotAction(visible, Math.random);
    expect(GAME_BOTS.bridge.turnTimeout!(visible, { isBot: false, strategy })).toEqual({ type: 'bridge-redeal', accept: false });
    expect(GAME_BOTS.bridge.turnTimeout!(visible, { isBot: true, strategy })).toEqual({ type: 'bridge-redeal', accept: true });
  });

  it.each([3, 17])('finishes seeded game %i with legal searched plays and unchanged inputs', (seed) => {
    vi.spyOn(Math, 'random').mockImplementation(seededRandom(seed));
    bridge.startGame(CODE, players);
    runSeededGame(`bridge-search/${seed}`, 300, () => bridge.getGameState(CODE)?.phase === 'scoring', (index) => {
      const seat = turnSeat();
      const visible = bridge.getPlayerVisibleState(CODE, seat)!;
      const before = structuredClone(visible);
      const action = bridgeSearch(visible, context(seed * 1000 + index, 40));
      expect(visible).toEqual(before);
      apply(seat, action);
    });
    expect(bridge.getGameState(CODE)!.playing!.completedTricks).toHaveLength(13);
  });
});
