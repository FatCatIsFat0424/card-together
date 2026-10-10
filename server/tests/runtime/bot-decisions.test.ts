import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AnyGameState,
  BigTwoVisibleState,
  BridgeVisibleState,
  Card,
  NinetyNineVisibleState,
  PlayerInfo,
  PlayerVisibleGameState,
  RedPointsVisibleState,
  Seat,
} from '@shared/types';
import { createDeck, shuffleDeck } from '../../src/engine/deck';
import { createBiddingState } from '../../src/engine/bidding';
import { createPlayingState } from '../../src/engine/playing';
import { getBotAction } from '../../src/bots/bot-decisions';
import type { BotAction } from '../../src/bots/bot-decisions';
import * as bridge from '../../src/managers/games/bridge-game';
import * as bigtwo from '../../src/managers/games/bigtwo-game';
import * as redpoints from '../../src/managers/games/redpoints-game';
import * as ninetynine from '../../src/managers/games/ninetynine-game';
import * as sevens from '../../src/managers/games/sevens-game';
import * as chinesepoker from '../../src/managers/games/chinesepoker-game';
import * as liarsdeck from '../../src/managers/games/liarsdeck-game';
import * as blackjack from '../../src/managers/games/blackjack-game';

const CODE = 'BOT123';
const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
const player = (id: string): PlayerInfo => ({
  id, username: id, nickname: id, color: '#123456', avatar: 'cat', avatarImage: null,
});
const PLAYERS = { N: player('north'), E: player('east'), S: player('south'), W: player('west') };
const card = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank });

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function execute(seat: Seat, action: BotAction): { success: boolean } {
  switch (action.type) {
    case 'bridge-redeal': return bridge.handleRedealResponse(CODE, seat, action.accept);
    case 'bridge-bid': return bridge.handleBid(CODE, seat, action.action);
    case 'bridge-play': return bridge.handlePlayCard(CODE, seat, action.card);
    case 'bigtwo-play': return bigtwo.play(CODE, seat, action.cards);
    case 'bigtwo-pass': return bigtwo.pass(CODE, seat);
    case 'redpoints-play': return redpoints.play(CODE, seat, action.card, action.capture);
    case 'redpoints-flip': return redpoints.chooseFlip(CODE, seat, action.capture);
    case 'ninetynine-play': return ninetynine.play(CODE, seat, action.card, action.choice, action.target);
    case 'sevens-play': return sevens.play(CODE, seat, action.card);
    case 'sevens-cover': return sevens.cover(CODE, seat, action.card);
    case 'chinesepoker-arrange': return chinesepoker.arrange(CODE, seat, action.arrangement, true);
    // Math.random is seeded in these tests, so trigger pulls and redeals are reproducible.
    case 'liarsdeck-play': return liarsdeck.play(CODE, seat, action.cardIds);
    case 'liarsdeck-challenge': return liarsdeck.challenge(CODE, seat, Math.random);
    case 'blackjack-bet': return blackjack.bet(CODE, seat, action.amount, true, Date.now(), Math.random);
    case 'blackjack-action': return blackjack.act(CODE, seat, action.action);
  }
}

function turn(game: AnyGameState): Seat {
  if (game.gameType === 'chinesepoker') {
    const pending = chinesepoker.pendingSeats(game)[0];
    if (!pending) throw new Error('Every seat has arranged');
    return pending;
  }
  if (game.gameType === 'blackjack' && game.phase === 'betting') {
    const pending = blackjack.pendingBetSeats(game)[0];
    if (!pending) throw new Error('Every seat has bet');
    return pending;
  }
  if (game.gameType !== 'bridge') return game.currentTurnSeat;
  if (game.phase === 'redeal_pending' && game.redealPendingSeat) return game.redealPendingSeat;
  if (game.phase === 'bidding' && game.bidding) return game.bidding.currentBidderSeat;
  if (game.playing) return game.playing.currentTurnSeat;
  throw new Error('Game has no acting seat');
}

function bridgeState(overrides: Partial<BridgeVisibleState> = {}): BridgeVisibleState {
  return {
    gameType: 'bridge', phase: 'bidding', myHand: [], mySeat: 'N', dealerSeat: 'W',
    validCards: [], bidding: createBiddingState('N'), contract: null, playing: null,
    result: null, log: [], redealPendingSeat: null, ...overrides,
  };
}

function bigTwoState(overrides: Partial<BigTwoVisibleState> = {}): BigTwoVisibleState {
  return {
    gameType: 'bigtwo', phase: 'playing', mySeat: 'N', myHand: [],
    handCounts: { N: 0, E: 0, S: 0, W: 0 }, currentTurnSeat: 'N', lastPlay: null,
    lockedSeats: [], firstPlay: false, log: [], result: null, revealedHands: null, ...overrides,
  };
}

function redPointsState(overrides: Partial<RedPointsVisibleState> = {}): RedPointsVisibleState {
  return {
    gameType: 'redpoints', phase: 'playing', mySeat: 'N', myHand: [],
    handCounts: { N: 0, E: 0, S: 0, W: 0 }, table: [], stockCount: 0,
    captured: { N: [], E: [], S: [], W: [] }, currentTurnSeat: 'N', step: 'play',
    pendingFlip: null, log: [], result: null, ...overrides,
  };
}

function ninetyNineState(overrides: Partial<NinetyNineVisibleState> = {}): NinetyNineVisibleState {
  return {
    gameType: 'ninetynine', phase: 'playing', mySeat: 'N', myHand: [],
    handCounts: { N: 0, E: 0, S: 0, W: 0 }, total: 0, direction: 'ccw',
    currentTurnSeat: 'N', lastPlayed: null, stockCount: 0, eliminated: [],
    log: [], result: null, ...overrides,
  };
}

describe('filtered bot decisions', () => {
  beforeEach(() => {
    bridge.restoreGames([]);
    bigtwo.restoreGames([]);
    redpoints.restoreGames([]);
    ninetynine.restoreGames([]);
    sevens.restoreGames([]);
    chinesepoker.restoreGames([]);
    liarsdeck.restoreGames([]);
    blackjack.restoreGames([]);
    vi.spyOn(Math, 'random').mockImplementation(random(42));
  });
  afterEach(() => vi.restoreAllMocks());

  it.each((['bridge', 'bigtwo', 'redpoints', 'ninetynine', 'sevens', 'chinesepoker', 'liarsdeck', 'blackjack'] as const).flatMap((gameType) =>
    [7, 41, 2026].map((seed) => ({ gameType, seed }))))(
    'should finish $gameType with seed $seed using only seat-visible decisions', ({ gameType, seed }) => {
      vi.mocked(Math.random).mockImplementation(random(seed));
      const choices = random(seed + 100);
      const adapter = { bridge, bigtwo, redpoints, ninetynine, sevens, chinesepoker, liarsdeck, blackjack }[gameType];
      if (gameType === 'bridge') bridge.startGame(CODE, PLAYERS);
      else if (gameType === 'bigtwo') bigtwo.startGame(CODE, PLAYERS, shuffleDeck(createDeck(), random(seed)));
      else if (gameType === 'redpoints') redpoints.startGame(CODE, PLAYERS, shuffleDeck(createDeck(), random(seed)), 'N');
      else if (gameType === 'ninetynine') ninetynine.startGame(CODE, PLAYERS, shuffleDeck(createDeck(), random(seed)), 'N');
      else if (gameType === 'sevens') sevens.startGame(CODE, PLAYERS, shuffleDeck(createDeck(), random(seed)));
      else if (gameType === 'liarsdeck') liarsdeck.startGame(CODE, PLAYERS, random(seed));
      else if (gameType === 'blackjack') blackjack.startGame(CODE, PLAYERS, 15_000);
      else chinesepoker.startGame(CODE, PLAYERS, 60_000, shuffleDeck(createDeck(), random(seed)));
      let actions = 0;
      while (adapter.getGameState(CODE)?.phase !== 'scoring' && actions < 2000) {
        const state = adapter.getGameState(CODE);
        expect(state).not.toBeNull();
        const seat = turn(state!);
        const visible: PlayerVisibleGameState = adapter.getPlayerVisibleState(CODE, seat)!;
        const original = structuredClone(visible);
        const action = getBotAction(visible, choices);
        expect(visible).toEqual(original);
        expect(action).not.toBeNull();
        expect(execute(seat, action!).success).toBe(true);
        actions++;
      }
      expect(adapter.getGameState(CODE)?.phase).toBe('scoring');
      expect(adapter.getGameState(CODE)?.result).not.toBeNull();
      for (const seat of SEATS) expect(getBotAction(adapter.getPlayerVisibleState(CODE, seat)!)).toBeNull();
    },
  );

  it('should pass with a weak hand but open after three passes and decline a pending redeal', () => {
    const hand = [card('clubs', 2), card('clubs', 3), card('hearts', 4)];
    expect(getBotAction(bridgeState({ myHand: hand }))).toEqual({ type: 'bridge-bid', action: { type: 'pass' } });
    expect(getBotAction(bridgeState({ myHand: hand,
      bidding: { ...createBiddingState('N'), consecutivePassCount: 3 },
    }))).toEqual({
      type: 'bridge-bid', action: { type: 'bid', level: 1, suit: 'clubs' },
    });
    expect(getBotAction(bridgeState({ phase: 'redeal_pending', redealPendingSeat: 'N' }))).toEqual({
      type: 'bridge-redeal', accept: false,
    });
    expect(getBotAction(bridgeState({ phase: 'redeal_pending', redealPendingSeat: 'E' }))).toBeNull();
  });

  it('should follow suit and win as cheaply as possible when an opponent leads', () => {
    const hand = [card('clubs', 2), card('clubs', 9), card('clubs', 14), card('spades', 14)];
    expect(getBotAction(bridgeState({
      phase: 'playing', myHand: hand, validCards: hand.slice(0, 3),
      contract: { level: 1, suit: 'nt', declarer: 'N' },
      playing: { ...createPlayingState('W'), currentTurnSeat: 'N', currentTrick: { W: card('clubs', 8) } },
    }))).toEqual({ type: 'bridge-play', card: card('clubs', 9) });
  });

  it('should retain a high card when a partner already wins the trick', () => {
    const hand = [card('hearts', 2), card('hearts', 14)];
    expect(getBotAction(bridgeState({
      phase: 'playing', myHand: hand, validCards: hand,
      contract: { level: 1, suit: 'hearts', declarer: 'N' },
      playing: {
        ...createPlayingState('S'), currentTurnSeat: 'N',
        currentTrick: { S: card('hearts', 13), W: card('hearts', 8) },
      },
    }))).toEqual({ type: 'bridge-play', card: card('hearts', 2) });
  });

  it('should include club three on the first Big Two lead and pass if no legal response exists', () => {
    const first = getBotAction(bigTwoState({ myHand: [card('clubs', 3), card('hearts', 3)], firstPlay: true }));
    expect(first?.type).toBe('bigtwo-play');
    if (first?.type === 'bigtwo-play') expect(first.cards).toContainEqual(card('clubs', 3));
    expect(getBotAction(bigTwoState({
      myHand: [card('clubs', 3)], lastPlay: { seat: 'W', cards: [card('spades', 2)], comboType: 'single' },
    }))).toEqual({ type: 'bigtwo-pass' });
    expect(getBotAction(bigTwoState({ myHand: [card('clubs', 3)], lockedSeats: ['N'] }))).toBeNull();
  });

  it('should choose the highest scoring red capture, including a pending flip', () => {
    const table = [card('clubs', 14), card('hearts', 14)];
    expect(getBotAction(redPointsState({ myHand: [card('clubs', 9)], table }))).toEqual({
      type: 'redpoints-play', card: card('clubs', 9), capture: card('hearts', 14),
    });
    expect(getBotAction(redPointsState({ step: 'flip-choose', pendingFlip: card('clubs', 9), table }))).toEqual({
      type: 'redpoints-flip', capture: card('hearts', 14),
    });
  });

  it('should choose a legal minus at 99 and designate a living opponent for a five', () => {
    expect(getBotAction(ninetyNineState({ total: 99, myHand: [card('hearts', 10), card('clubs', 9)] }))).toEqual({
      type: 'ninetynine-play', card: card('hearts', 10), choice: 'minus',
    });
    const designation = getBotAction(ninetyNineState({ total: 99, myHand: [card('clubs', 5)], eliminated: ['E'] }));
    expect(designation).toMatchObject({ type: 'ninetynine-play', card: card('clubs', 5) });
    if (designation?.type !== 'ninetynine-play') throw new Error('Expected Ninety-Nine action');
    expect(['S', 'W']).toContain(designation.target);
  });

  it('should wait on another seat and avoid decisions for eliminated players', () => {
    expect(getBotAction(bridgeState({ bidding: createBiddingState('E') }))).toBeNull();
    expect(getBotAction(bigTwoState({ currentTurnSeat: 'E', myHand: [card('clubs', 3)] }))).toBeNull();
    expect(getBotAction(redPointsState({ currentTurnSeat: 'E', myHand: [card('clubs', 3)] }))).toBeNull();
    expect(getBotAction(ninetyNineState({ currentTurnSeat: 'E', myHand: [card('clubs', 3)] }))).toBeNull();
    expect(getBotAction(ninetyNineState({ eliminated: ['N'], myHand: [card('clubs', 3)] }))).toBeNull();
  });
});
