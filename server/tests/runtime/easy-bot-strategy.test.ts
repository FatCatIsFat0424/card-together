import { GAME_SEAT_ORDER } from '@shared/constants';
import { cpIsFoul } from '@shared/rules/chinesepoker';
import { gameSeatValues } from '../helpers/game-seat-values';
import { runSeededGame } from './seeded-game-runner';
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
import { getEasyBotAction } from '../../src/bots/easy-strategy';
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
import * as holdem from '../../src/managers/games/holdem-game';

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
    case 'blackjack-dealer': return blackjack.dealerAct(CODE, seat, action.action);
    case 'holdem-action': return holdem.act(CODE, seat, action.action, Date.now(), Math.random);
  }
}

function turn(game: AnyGameState): Seat {
  if (game.gameType === 'chinesepoker') {
    const pending = chinesepoker.pendingSeats(game)[0];
    if (!pending) throw new Error('Every seat has arranged');
    return pending as Seat;
  }
  if (game.gameType === 'blackjack' && game.phase === 'betting') {
    const pending = blackjack.pendingBetSeats(game)[0];
    if (!pending) throw new Error('Every seat has bet');
    return pending as Seat;
  }
  if (game.gameType !== 'bridge') return game.currentTurnSeat as Seat;
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
  return gameSeatValues({
    gameType: 'ninetynine', phase: 'playing', mySeat: 'N', myHand: [],
    handCounts: { N: 0, E: 0, S: 0, W: 0 }, total: 0, direction: 'ccw',
    currentTurnSeat: 'N', lastPlayed: null, stockCount: 0, eliminated: [],
    log: [], result: null, ...overrides,
  });
}

describe('easy bot decisions', () => {
  beforeEach(() => {
    bridge.restoreGames([]);
    bigtwo.restoreGames([]);
    redpoints.restoreGames([]);
    ninetynine.restoreGames([]);
    sevens.restoreGames([]);
    chinesepoker.restoreGames([]);
    liarsdeck.restoreGames([]);
    blackjack.restoreGames([]);
    holdem.restoreGames([]);
    vi.spyOn(Math, 'random').mockImplementation(random(42));
  });
  afterEach(() => vi.restoreAllMocks());

  it.each((['bridge', 'bigtwo', 'redpoints', 'ninetynine', 'sevens', 'chinesepoker', 'liarsdeck', 'blackjack', 'holdem'] as const).flatMap((gameType) =>
    [7, 41, 2026].map((seed) => ({ gameType, seed }))))(
    'should finish $gameType with seed $seed using only seat-visible decisions', ({ gameType, seed }) => {
      vi.mocked(Math.random).mockImplementation(random(seed));
      const choices = random(seed + 100);
      const adapter = { bridge, bigtwo, redpoints, ninetynine, sevens, chinesepoker, liarsdeck, blackjack, holdem }[gameType];
      if (gameType === 'bridge') bridge.startGame(CODE, PLAYERS);
      else if (gameType === 'bigtwo') bigtwo.startGame(CODE, PLAYERS, shuffleDeck(createDeck(), random(seed)));
      else if (gameType === 'redpoints') redpoints.startGame(CODE, PLAYERS, shuffleDeck(createDeck(), random(seed)), 'N');
      else if (gameType === 'ninetynine') ninetynine.startGame(CODE, PLAYERS, shuffleDeck(createDeck(), random(seed)), 'N');
      else if (gameType === 'sevens') sevens.startGame(CODE, PLAYERS, shuffleDeck(createDeck(), random(seed)));
      else if (gameType === 'liarsdeck') liarsdeck.startGame(CODE, PLAYERS, random(seed));
      else if (gameType === 'blackjack') blackjack.startGame(CODE, PLAYERS, 15_000);
      else if (gameType === 'holdem') holdem.startGame(CODE, PLAYERS, random(seed));
      else chinesepoker.startGame(CODE, PLAYERS, 60_000, shuffleDeck(createDeck(), random(seed)));
      runSeededGame(`${gameType}/${seed}`, 2000, () => adapter.getGameState(CODE)?.phase === 'scoring', () => {
        const state = adapter.getGameState(CODE);
        expect(state).not.toBeNull();
        const seat = turn(state!);
        const visible: PlayerVisibleGameState = adapter.getPlayerVisibleState(CODE, seat)!;
        const original = structuredClone(visible);
        const action = getEasyBotAction(visible, choices);
        expect(visible).toEqual(original);
        expect(action).not.toBeNull();
        expect(execute(seat, action!).success).toBe(true);
      });
      expect(adapter.getGameState(CODE)?.phase).toBe('scoring');
      expect(adapter.getGameState(CODE)?.result).not.toBeNull();
      for (const seat of SEATS) expect(getEasyBotAction(adapter.getPlayerVisibleState(CODE, seat)!)).toBeNull();
    },
  );

  it('should open only a basic one-level bid and prevent repeated all-pass redeals', () => {
    const myHand = [card('clubs', 2), card('clubs', 3), card('hearts', 4)];
    expect(getEasyBotAction(bridgeState({ myHand }))).toEqual({ type: 'bridge-bid', action: { type: 'pass' } });
    expect(getEasyBotAction(bridgeState({ myHand, bidding: { ...createBiddingState('N'), consecutivePassCount: 3 } })))
      .toEqual({ type: 'bridge-bid', action: { type: 'bid', level: 1, suit: 'clubs' } });
    expect(getEasyBotAction(bridgeState({ phase: 'redeal_pending', redealPendingSeat: 'N' })))
      .toEqual({ type: 'bridge-redeal', accept: false });
    expect(getEasyBotAction(bridgeState({ phase: 'redeal_pending', redealPendingSeat: 'E' }))).toBeNull();
  });

  it('should follow suit without the hard bot choosing the cheapest winner', () => {
    const myHand = [card('clubs', 2), card('clubs', 9), card('clubs', 14), card('spades', 14)];
    const visible = bridgeState({
      phase: 'playing', myHand, validCards: myHand.slice(0, 3),
      contract: { level: 1, suit: 'nt', declarer: 'N' },
      playing: { ...createPlayingState('W'), currentTurnSeat: 'N', currentTrick: { W: card('clubs', 8) } },
    });
    expect(getEasyBotAction(visible, () => 0.99)).toEqual({ type: 'bridge-play', card: card('clubs', 14) });
    expect(getBotAction(visible, () => 0.99)).toEqual({ type: 'bridge-play', card: card('clubs', 9) });
  });

  it('should respect the first Big Two lead, mandatory passes, and locked seats', () => {
    const first = getEasyBotAction(bigTwoState({ myHand: [card('clubs', 3), card('hearts', 3)], firstPlay: true }), () => 0.99);
    expect(first?.type).toBe('bigtwo-play');
    if (first?.type === 'bigtwo-play') expect(first.cards).toContainEqual(card('clubs', 3));
    expect(getEasyBotAction(bigTwoState({
      myHand: [card('clubs', 3)], lastPlay: { seat: 'W', cards: [card('spades', 2)], comboType: 'single' },
    }))).toEqual({ type: 'bigtwo-pass' });
    expect(getEasyBotAction(bigTwoState({ myHand: [card('clubs', 3)], lockedSeats: ['N'] }))).toBeNull();
  });

  it('should choose an available Red Points capture for hand plays and flipped cards', () => {
    const capture = card('hearts', 8);
    expect(getEasyBotAction(redPointsState({ myHand: [card('clubs', 2)], table: [capture] })))
      .toEqual({ type: 'redpoints-play', card: card('clubs', 2), capture });
    expect(getEasyBotAction(redPointsState({ step: 'flip-choose', pendingFlip: card('clubs', 2), table: [capture] })))
      .toEqual({ type: 'redpoints-flip', capture });
    expect(getEasyBotAction(redPointsState({ step: 'flip-choose' }))).toBeNull();
  });

  it('should use legal Ninety-Nine choices and designate any living occupied seat', () => {
    expect(getEasyBotAction(ninetyNineState({ total: 99, myHand: [card('hearts', 10), card('clubs', 9)] })))
      .toEqual({ type: 'ninetynine-play', card: card('hearts', 10), choice: 'minus' });
    expect(getEasyBotAction(ninetyNineState({
      total: 99, seats: [...GAME_SEAT_ORDER], myHand: [card('clubs', 5)], eliminated: ['E', 'P7'],
    }), () => 0.99)).toEqual({ type: 'ninetynine-play', card: card('clubs', 5), target: 'P8' });
    expect(getEasyBotAction(ninetyNineState({ eliminated: ['N'], myHand: [card('clubs', 5)] }))).toBeNull();
  });

  it.each([7, 41, 2026])('should finish eight-seat Ninety-Nine with seed %s', (seed) => {
    const players = Object.fromEntries(GAME_SEAT_ORDER.map((seat) => [seat, player(seat)]));
    const choices = random(seed + 100);
    ninetynine.startGame(CODE, players, shuffleDeck([...createDeck(), ...createDeck()], random(seed)), 'N', { twoDecks: true });
    runSeededGame(`eight-seat Ninety-Nine/${seed}`, 2000, () => ninetynine.getGameState(CODE)?.phase === 'scoring', () => {
      const state = ninetynine.getGameState(CODE)!;
      const action = getEasyBotAction(ninetynine.getPlayerVisibleState(CODE, state.currentTurnSeat)!, choices);
      expect(action).not.toBeNull();
      if (action?.type !== 'ninetynine-play') throw new Error('Expected Ninety-Nine play');
      expect(ninetynine.play(CODE, state.currentTurnSeat, action.card, action.choice, action.target).success).toBe(true);
    });
    expect(ninetynine.getGameState(CODE)?.result).not.toBeNull();
  });

  it('should play a legal Sevens card and cover only when no play is available', () => {
    sevens.startGame(CODE, PLAYERS, shuffleDeck(createDeck(), random(7)));
    const visible = sevens.getPlayerVisibleState(CODE, sevens.getGameState(CODE)!.currentTurnSeat)!;
    const play = getEasyBotAction(visible, () => 0);
    expect(play?.type).toBe('sevens-play');
    if (play?.type === 'sevens-play') expect(visible.validCards).toContainEqual(play.card);
    expect(getEasyBotAction({ ...visible, validCards: [] }, () => 0))
      .toEqual({ type: 'sevens-cover', card: visible.myHand[0] });
  });

  it('should arrange Chinese Poker without fouling and wait after submission', () => {
    chinesepoker.startGame(CODE, PLAYERS, 60_000, shuffleDeck(createDeck(), random(7)));
    const visible = chinesepoker.getPlayerVisibleState(CODE, 'N')!;
    const action = getEasyBotAction(visible);
    expect(action?.type).toBe('chinesepoker-arrange');
    if (action?.type !== 'chinesepoker-arrange') throw new Error('Expected arrangement');
    expect(cpIsFoul(action.arrangement)).toBe(false);
    expect(execute('N', action).success).toBe(true);
    expect(getEasyBotAction(chinesepoker.getPlayerVisibleState(CODE, 'N')!)).toBeNull();
  });

  it('should use minimum Blackjack bets and a simple total instead of the hard splitting strategy', () => {
    blackjack.startGame(CODE, PLAYERS, 15_000);
    const betting = blackjack.getPlayerVisibleState(CODE, 'N')!;
    expect(getEasyBotAction(betting)).toEqual({ type: 'blackjack-bet', amount: 10 });
    expect(getEasyBotAction({ ...betting, myBet: 10 })).toBeNull();
    const visible = { ...betting, phase: 'playing' as const, currentTurnSeat: 'N' as const,
      dealer: [card('clubs', 6)], activeHand: 0,
      hands: { ...betting.hands, N: [{ cards: [card('hearts', 8), card('clubs', 8)], bet: 10,
        done: false, split: false, doubled: false }] } };
    expect(getEasyBotAction(visible)).toEqual({ type: 'blackjack-action', action: 'hit' });
    expect(getBotAction(visible)).toEqual({ type: 'blackjack-action', action: 'split' });
    expect(getEasyBotAction({ ...visible, hands: { ...visible.hands, N: [{ ...visible.hands.N[0],
      cards: [card('hearts', 10), card('clubs', 7)] }] } })).toEqual({ type: 'blackjack-action', action: 'stand' });
  });

  it('should challenge when forced and otherwise choose distinct owned cards in Liar\'s Deck', () => {
    liarsdeck.startGame(CODE, PLAYERS, random(7));
    const visible = { ...liarsdeck.getPlayerVisibleState(CODE, 'N')!, currentTurnSeat: 'N' as const,
      lastPlay: { seat: 'E' as const, count: 1 } };
    expect(getEasyBotAction({ ...visible, handCounts: { N: visible.myHand.length, E: 0, S: 0, W: 0 } }, () => 0.99))
      .toEqual({ type: 'liarsdeck-challenge' });
    expect(getEasyBotAction(visible, () => 0)).toEqual({ type: 'liarsdeck-challenge' });
    const play = getEasyBotAction(visible, () => 0.99);
    expect(play?.type).toBe('liarsdeck-play');
    if (play?.type !== 'liarsdeck-play') throw new Error('Expected face-down play');
    expect(play.cardIds).toHaveLength(3);
    expect(new Set(play.cardIds).size).toBe(3);
    for (const id of play.cardIds) expect(visible.myHand.some((card) => card.id === id)).toBe(true);
    expect(getEasyBotAction({ ...visible, eliminated: ['N'] })).toBeNull();
  });

  it('should respect player-dealer forced hits, voluntary stands, and hidden cards', () => {
    blackjack.startGame(CODE, PLAYERS, 15_000, Date.now(), { playerDealer: true }, () => 0);
    const betting = blackjack.getPlayerVisibleState(CODE, 'N')!;
    expect(getEasyBotAction(betting)).toBeNull();
    const visible = { ...betting, phase: 'playing' as const, currentTurnSeat: 'N' as const,
      holeHidden: false, dealer: [card('hearts', 10), card('clubs', 6)] };
    expect(getEasyBotAction(visible)).toEqual({ type: 'blackjack-dealer', action: 'hit' });
    expect(getEasyBotAction({ ...visible, dealer: [card('hearts', 10), card('clubs', 7)] }))
      .toEqual({ type: 'blackjack-dealer', action: 'stand' });
    expect(getEasyBotAction({ ...visible, holeHidden: true })).toBeNull();
    expect(getEasyBotAction({ ...visible, dealer: [card('hearts', 10), card('clubs', 14)] })).toBeNull();
  });

  it.each([7, 41, 2026])('should complete a player-dealer Blackjack match with seed %s', (seed) => {
    const choices = random(seed);
    blackjack.startGame(CODE, PLAYERS, 15_000, Date.now(), { playerDealer: true }, choices);
    runSeededGame(`player-dealer Blackjack/${seed}`, 2000, () => blackjack.getGameState(CODE)?.phase === 'scoring', () => {
      const seat = turn(blackjack.getGameState(CODE)!);
      const action = getEasyBotAction(blackjack.getPlayerVisibleState(CODE, seat)!, choices);
      expect(action).not.toBeNull();
      expect(execute(seat, action!).success).toBe(true);
    });
    expect(blackjack.getGameState(CODE)?.result).not.toBeNull();
  });

  it('should check for free, call, fold, or make a legal minimum Holdem raise without hand inference', () => {
    holdem.startGame(CODE, PLAYERS, random(7));
    const visible = holdem.getPlayerVisibleState(CODE, holdem.getGameState(CODE)!.currentTurnSeat)!;
    expect(getEasyBotAction(visible, () => 0.5)).toEqual({ type: 'holdem-action', action: { type: 'call' } });
    expect(getEasyBotAction({ ...visible, myHand: [card('hearts', 14), card('clubs', 14)] }, () => 0.5))
      .toEqual({ type: 'holdem-action', action: { type: 'call' } });
    expect(getEasyBotAction(visible, () => 0.99)).toEqual({ type: 'holdem-action', action: { type: 'fold' } });
    const raise = getEasyBotAction(visible, () => 0);
    expect(raise?.type).toBe('holdem-action');
    expect(execute(visible.mySeat as Seat, raise!).success).toBe(true);
    const checked = { ...visible, currentBet: visible.streetBets[visible.mySeat] };
    expect(getEasyBotAction(checked, () => 0)).toEqual({ type: 'holdem-action', action: { type: 'check' } });
  });

  it('should wait on another seat in turn-based games', () => {
    expect(getEasyBotAction(bridgeState({ bidding: createBiddingState('E') }))).toBeNull();
    expect(getEasyBotAction(bigTwoState({ currentTurnSeat: 'E', myHand: [card('clubs', 3)] }))).toBeNull();
    expect(getEasyBotAction(redPointsState({ currentTurnSeat: 'E', myHand: [card('clubs', 3)] }))).toBeNull();
    expect(getEasyBotAction(ninetyNineState({ currentTurnSeat: 'E', myHand: [card('clubs', 3)] }))).toBeNull();
    sevens.startGame(CODE, PLAYERS, shuffleDeck(createDeck(), random(7)));
    const sv = sevens.getPlayerVisibleState(CODE, 'N')!;
    expect(getEasyBotAction({ ...sv, currentTurnSeat: 'E' })).toBeNull();
    liarsdeck.startGame(CODE, PLAYERS, random(7));
    const ld = liarsdeck.getPlayerVisibleState(CODE, 'N')!;
    expect(getEasyBotAction({ ...ld, currentTurnSeat: 'E' })).toBeNull();
    holdem.startGame(CODE, PLAYERS, random(7));
    const he = holdem.getPlayerVisibleState(CODE, 'N')!;
    expect(getEasyBotAction({ ...he, currentTurnSeat: 'E' })).toBeNull();
    blackjack.startGame(CODE, PLAYERS, 15_000);
    const bj = blackjack.getPlayerVisibleState(CODE, 'N')!;
    expect(getEasyBotAction({ ...bj, phase: 'playing', currentTurnSeat: 'E' })).toBeNull();
  });
});
