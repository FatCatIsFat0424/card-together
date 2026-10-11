import { beforeEach, describe, expect, it } from 'vitest';
import {
  bjDealerActions, bjMatchHands, bjMatchOver, bjNextDealer, bjProportionalPayouts, bjSettle,
} from '@shared/rules/blackjack';
import type { BlackjackGameState, BlackjackHand, Card, PlayerInfo, Seat } from '@shared/types';
import { blackjackDealerDecision, getBlackjackBotAction } from '../../src/bots/blackjack-strategy';
import { getBotAction } from '../../src/bots/bot-decisions';
import { createDeck } from '../../src/engine/deck';
import * as blackjack from '../../src/managers/games/blackjack-game';
import * as gameManager from '../../src/managers/game-manager';
import * as roomManager from '../../src/managers/room-manager';
import { blackjackDealerDefault } from '../../src/runtime/automated-action';
import { isRuntimeSnapshot } from '../../src/runtime/validate';
import type { RuntimeSnapshot } from '../../src/runtime/types';

const CODE = 'BJPD01';
const PLAYER_DEALER = { playerDealer: true };

function player(id: string): PlayerInfo {
  return { id, username: id, nickname: id, color: '#123456', avatar: 'cat', avatarImage: null };
}

function seated(seats: readonly Seat[]): Partial<Record<Seat, PlayerInfo>> {
  return Object.fromEntries(seats.map((seat) => [seat, player(seat.toLowerCase())]));
}

const card = (rank: Card['rank'], suit: Card['suit'] = 'spades'): Card => ({ suit, rank });
const key = (value: Card): string => `${value.suit}${value.rank}`;
const hand = (cards: Card[], bet = 50, overrides: Partial<BlackjackHand> = {}): BlackjackHand => ({
  cards, bet, doubled: false, split: false, done: true, ...overrides,
});

/**
 * A random source that makes the shuffle put `top` first, in order. Deal order is each bettor's first
 * card (N, E, S, W), the up card, each bettor's second card, the hole card, then draws.
 */
function rigged(top: readonly Card[]): () => number {
  const rest = createDeck().filter((value) => !top.some((wanted) => key(wanted) === key(value)));
  const target = [...top, ...rest];
  const deck = createDeck();
  const draws: number[] = [];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = deck.findIndex((value) => key(value) === key(target[i]));
    draws.push((j + 0.5) / (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  let index = 0;
  return () => draws[index++];
}

/** Picks `dealer` as the first dealer among `seats`. */
const firstDealer = (seats: readonly Seat[], dealer: Seat): () => number => () => (seats.indexOf(dealer) + 0.5) / seats.length;

function game(): BlackjackGameState {
  const state = blackjack.getGameState(CODE);
  if (!state) throw new Error('Expected a Blackjack game');
  return state;
}

function snapshot(): RuntimeSnapshot {
  const state = game();
  const seats = (['N', 'E', 'S', 'W'] as const).filter((seat) => state.players[seat]);
  const ids = seats.map((seat) => state.players[seat]!.id);
  return {
    players: seats.map((seat) => ({ info: state.players[seat]!, currentRoomCode: CODE, disconnectedAt: null })),
    rooms: [{
      info: {
        code: CODE, gameType: 'blackjack', status: state.phase === 'scoring' ? 'waiting' : 'playing', createdAt: 1,
        hostId: ids[0], abortVote: null, abortVoteCooldownUntil: null, blackjackOptions: PLAYER_DEALER,
        seats: {
          N: { player: state.players.N ?? null, isReady: Boolean(state.players.N) },
          E: { player: state.players.E ?? null, isReady: Boolean(state.players.E) },
          S: { player: state.players.S ?? null, isReady: Boolean(state.players.S) },
          W: { player: state.players.W ?? null, isReady: Boolean(state.players.W) },
        },
      },
      memberIds: ids,
    }],
    games: [structuredClone(state)],
    chat: [{ roomCode: CODE, messages: [] }],
  };
}

describe('Blackjack player dealer rules', () => {
  it('should rotate the deal clockwise over the seats taking part for two rounds', () => {
    expect(bjMatchHands(4, true)).toBe(8);
    expect(bjMatchHands(2, true)).toBe(4);
    expect(bjMatchHands(3, false)).toBe(8);
    expect(bjNextDealer('E', ['N', 'E', 'W'])).toBe('W');
    expect(bjNextDealer('W', ['N', 'E', 'W'])).toBe('N');
    expect(bjMatchOver(3, { N: 500, E: 500, S: 0, W: 0 }, ['N', 'E'], true)).toBe(false);
    expect(bjMatchOver(4, { N: 500, E: 500, S: 0, W: 0 }, ['N', 'E'], true)).toBe(true);
    expect(bjMatchOver(1, { N: 995, E: 5, S: 0, W: 0 }, ['N', 'E'], true)).toBe(true);
    expect(bjMatchOver(1, { N: 995, E: 5, S: 0, W: 0 }, ['N', 'E'], false)).toBe(false);
  });

  it('should let a player dealer hit below 17, choose from 17, and stop at 21', () => {
    expect(bjDealerActions([card(10), card(6)])).toEqual(['hit']);
    expect(bjDealerActions([card(14), card(6)])).toEqual(['hit', 'stand']);
    expect(bjDealerActions([card(10), card(9)])).toEqual(['hit', 'stand']);
    expect(bjDealerActions([card(10), card(5), card(6)])).toEqual([]);
    expect(bjDealerActions([card(10), card(9), card(5)])).toEqual([]);
  });

  it('should move chips between each player and the dealer', () => {
    const settlement = bjSettle({
      hand: 1, dealerSeat: 'N', dealerStood: true,
      chips: { N: 1000, E: 950, S: 900, W: 950 },
      hands: {
        N: [],
        E: [hand([card(14), card(13)])],
        S: [hand([card(10), card(9)], 100, { doubled: true })],
        W: [hand([card(10), card(8)])],
      },
      dealer: [card(10), card(8)],
    });
    expect(settlement.outcomes).toEqual({ N: [], E: ['blackjack'], S: ['win'], W: ['push'] });
    expect(settlement.net).toEqual({ N: -175, E: 75, S: 100, W: 0 });
    expect(settlement.chips).toEqual({ N: 825, E: 1075, S: 1100, W: 1000 });
  });

  it('should pay winners in proportion when the dealer runs short, rounding down and passing leftovers clockwise', () => {
    expect(bjProportionalPayouts({ N: 0, E: 100, S: 50, W: 50 }, 101, 'N')).toEqual({ N: 0, E: 51, S: 25, W: 25 });
    expect(bjProportionalPayouts({ N: 0, E: 100, S: 50, W: 50 }, 103, 'N')).toEqual({ N: 0, E: 52, S: 26, W: 25 });
    expect(bjProportionalPayouts({ N: 30, E: 0, S: 30, W: 30 }, 50, 'E')).toEqual({ N: 16, E: 0, S: 17, W: 17 });
    // The dealer collects W's lost stake first, then splits its 30 + 40 between E and S (46.7 and 23.3,
    // the leftover chip going to E as the first winner after the dealer) and ends at zero.
    const settlement = bjSettle({
      hand: 1, dealerSeat: 'N', dealerStood: true,
      chips: { N: 30, E: 900, S: 950, W: 960 },
      hands: { N: [], E: [hand([card(10), card(9)], 100)], S: [hand([card(10), card(9, 'hearts')], 50)],
        W: [hand([card(10), card(6)], 40)] },
      dealer: [card(10), card(8)],
    });
    expect(settlement.chips).toEqual({ N: 0, E: 1047, S: 1023, W: 960 });
    expect(settlement.net).toEqual({ N: -30, E: 47, S: 23, W: -40 });
  });
});

describe('Blackjack player dealer gameplay', () => {
  beforeEach(() => blackjack.restoreGames([]));

  it('should keep the house dealer when the option is off', () => {
    blackjack.startGame(CODE, seated(['N', 'E']), 15_000, 1000);
    expect(game().dealerSeat).toBeUndefined();
    expect(blackjack.getPlayerVisibleState(CODE, 'N')).toMatchObject({ dealerSeat: null, totalHands: 8 });
    blackjack.bet(CODE, 'N', 50, true, 1000, rigged([card(10), card(9), card(6), card(10, 'hearts'), card(8), card(10, 'clubs')]));
    blackjack.bet(CODE, 'E', 50, true, 1000, rigged([card(10), card(9), card(6), card(10, 'hearts'), card(8), card(10, 'clubs')]));
    expect(game().log.find((entry) => entry.type === 'deal')).not.toHaveProperty('dealer');
  });

  it('should play a dealer hand by hand, settle against its chips, and rotate the deal', () => {
    blackjack.startGame(CODE, seated(['N', 'E', 'S']), 15_000, 1000, PLAYER_DEALER, firstDealer(['N', 'E', 'S'], 'E'));
    expect(game().dealerSeat).toBe('E');
    expect(blackjack.pendingBetSeats(game())).toEqual(['N', 'S']);
    expect(blackjack.bet(CODE, 'E', 50, true, 1000)).toEqual({ success: false, reason: 'The dealer does not bet' });
    expect(blackjack.getPlayerVisibleState(CODE, 'E')).toMatchObject({ dealerSeat: 'E', totalHands: 6 });
    expect(isRuntimeSnapshot(snapshot())).toBe(true);

    // N: 10 + 9, S: 10 + 7; dealer up 6, hole 10; then draws 5 and 3.
    const deck = rigged([card(10), card(10, 'hearts'), card(6), card(9), card(7), card(10, 'clubs'), card(5), card(3)]);
    expect(blackjack.bet(CODE, 'N', 50, true, 1000, deck).success).toBe(true);
    expect(blackjack.bet(CODE, 'S', 100, true, 1000, deck).success).toBe(true);
    expect(game().log.find((entry) => entry.type === 'deal')).toMatchObject({ dealer: 'E', bets: { E: 0 } });
    expect(blackjack.getPlayerVisibleState(CODE, 'E')?.myHole).toEqual(card(10, 'clubs'));
    expect(blackjack.getPlayerVisibleState(CODE, 'N')).not.toHaveProperty('myHole');
    expect(blackjack.getPlayerVisibleState(CODE, 'N')?.holeHidden).toBe(true);
    expect(blackjack.dealerAct(CODE, 'E', 'hit').success).toBe(false);
    expect(blackjack.act(CODE, 'N', 'stand').success).toBe(true);
    expect(blackjack.act(CODE, 'S', 'stand').success).toBe(true);

    // Every player hand is done: the hole card is revealed and the dealer seat takes its turn.
    expect(game()).toMatchObject({ phase: 'playing', currentTurnSeat: 'E', hole: null });
    expect(isRuntimeSnapshot(snapshot())).toBe(true);
    expect(blackjack.act(CODE, 'E', 'hit').success).toBe(false);
    expect(blackjack.dealerAct(CODE, 'N', 'hit')).toEqual({ success: false, reason: 'You are not the dealer' });
    expect(blackjack.dealerAct(CODE, 'E', 'stand')).toEqual({ success: false, reason: 'The dealer must hit below 17' });
    expect(blackjack.dealerAct(CODE, 'E', 'hit').success).toBe(true);
    // 21: the dealer's turn ends, beating both players.
    const settled = game();
    expect(settled.dealer).toEqual([card(6), card(10, 'clubs'), card(5)]);
    expect(settled.log.at(-1)).toMatchObject({ type: 'settle', net: { N: -50, E: 150, S: -100, W: 0 } });
    expect(settled).toMatchObject({ phase: 'betting', dealerSeat: 'S', chips: { N: 950, E: 1150, S: 900, W: 0 } });
    expect(blackjack.pendingBetSeats(settled)).toEqual(['N', 'E']);
    expect(isRuntimeSnapshot(snapshot())).toBe(true);
  });

  it('should let the dealer stand from 17 and skip its turn when no hand needs beating', () => {
    blackjack.startGame(CODE, seated(['N', 'S']), 15_000, 1000, PLAYER_DEALER, firstDealer(['N', 'S'], 'N'));
    // S: 10 + 8 against up 10, hole 7.
    blackjack.bet(CODE, 'S', 20, true, 1000, rigged([card(10), card(10, 'hearts'), card(8), card(7)]));
    expect(blackjack.act(CODE, 'S', 'stand').success).toBe(true);
    expect(game().currentTurnSeat).toBe('N');
    expect(blackjackDealerDefault(blackjack.getPlayerVisibleState(CODE, 'N')!))
      .toEqual({ type: 'blackjack-dealer', action: 'stand' });
    expect(blackjack.dealerAct(CODE, 'N', 'stand').success).toBe(true);
    expect(game().log.slice(-2).map((entry) => entry.type)).toEqual(['dealerStand', 'settle']);
    expect(game().chips).toEqual({ N: 980, E: 0, S: 1020, W: 0 });
    expect(game().dealerSeat).toBe('S');
    expect(isRuntimeSnapshot(snapshot())).toBe(true);

    // N busts: the dealer reveals and settles at once without a turn.
    blackjack.bet(CODE, 'N', 20, true, 1000, rigged([card(10), card(10, 'hearts'), card(6), card(7), card(9)]));
    expect(blackjack.act(CODE, 'N', 'hit').success).toBe(true);
    expect(game().log.slice(-2).map((entry) => entry.type)).toEqual(['reveal', 'settle']);
    expect(game().phase).toBe('betting');
  });

  it('should end after two rotations with the result over the seats taking part', () => {
    blackjack.startGame(CODE, seated(['E', 'W']), 15_000, 1000, PLAYER_DEALER, firstDealer(['E', 'W'], 'W'));
    const dealers: Seat[] = [];
    for (let steps = 0; game().phase !== 'scoring' && steps < 100; steps++) {
      const state = game();
      if (state.phase === 'betting') {
        dealers.push(state.dealerSeat!);
        for (const seat of blackjack.pendingBetSeats(state)) blackjack.bet(CODE, seat, 10, true, 1000);
      } else if (state.hole === null) {
        blackjack.dealerAct(CODE, state.currentTurnSeat, bjDealerActions(state.dealer)[0]);
      } else blackjack.act(CODE, state.currentTurnSeat, 'stand');
      expect(isRuntimeSnapshot(snapshot())).toBe(true);
    }
    expect(dealers).toEqual(['W', 'E', 'W', 'E']);
    expect(game().result).toMatchObject({ seats: ['E', 'W'], hands: 4 });
    expect(game().chips.E + game().chips.W).toBe(2000);
  });

  it('should finish bot-only player-dealer matches with every snapshot valid', () => {
    for (const seed of [3, 17, 2026]) {
      let state = seed;
      const random = (): number => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
      };
      blackjack.restoreGames([]);
      blackjack.startGame(CODE, seated(['N', 'E', 'S', 'W']), 15_000, 1000, PLAYER_DEALER, random);
      for (let steps = 0; game().phase !== 'scoring' && steps < 400; steps++) {
        const current = game();
        const seat = current.phase === 'betting' ? blackjack.pendingBetSeats(current)[0] : current.currentTurnSeat;
        const action = getBotAction(blackjack.getPlayerVisibleState(CODE, seat)!, random);
        if (action?.type === 'blackjack-bet') blackjack.bet(CODE, seat, action.amount, true, 1000, random);
        else if (action?.type === 'blackjack-action') expect(blackjack.act(CODE, seat, action.action).success).toBe(true);
        else if (action?.type === 'blackjack-dealer') {
          expect(blackjack.dealerAct(CODE, seat, action.action).success).toBe(true);
        } else throw new Error('Expected a Blackjack decision');
      }
      expect(game().phase).toBe('scoring');
      expect(isRuntimeSnapshot(snapshot())).toBe(true);
      expect(Object.values(game().chips).reduce((sum, chips) => sum + chips, 0)).toBe(4000);
    }
  });

  it('should reject a persisted player dealer that bets or breaks the rotation', () => {
    blackjack.startGame(CODE, seated(['N', 'E', 'S']), 15_000, 1000, PLAYER_DEALER, firstDealer(['N', 'E', 'S'], 'N'));
    const valid = snapshot();
    const betting = structuredClone(valid);
    (betting.games[0] as BlackjackGameState).log.push({ type: 'bet', seat: 'N', auto: false, timestamp: 1 });
    (betting.games[0] as BlackjackGameState).bets.N = 10;
    expect(isRuntimeSnapshot(betting)).toBe(false);
    const missing = structuredClone(valid);
    delete (missing.games[0] as { dealerSeat?: Seat }).dealerSeat;
    expect(isRuntimeSnapshot(missing)).toBe(false);
    blackjack.bet(CODE, 'E', 10, true, 1000, rigged([card(10), card(10, 'hearts'), card(6), card(7), card(9)]));
    blackjack.bet(CODE, 'S', 10, true, 1000, rigged([card(10), card(10, 'hearts'), card(6), card(7), card(9)]));
    const dealt = snapshot();
    expect(isRuntimeSnapshot(dealt)).toBe(true);
    const deal = (dealt.games[0] as BlackjackGameState).log.find((entry) => entry.type === 'deal');
    if (deal?.type !== 'deal') throw new Error('Expected a deal');
    (dealt.games[0] as BlackjackGameState).log[(dealt.games[0] as BlackjackGameState).log.indexOf(deal)] = {
      ...deal, dealer: 'E' };
    expect(isRuntimeSnapshot(dealt)).toBe(false);
  });
});

describe('Blackjack player dealer bot and timer', () => {
  const hands = (cards: Partial<Record<Seat, BlackjackHand[]>>): Record<Seat, BlackjackHand[]> =>
    ({ N: [], E: [], S: [], W: [], ...cards });

  it('should hit below 17 and weigh the live hands it must beat from 17', () => {
    expect(blackjackDealerDecision([card(10), card(5)], hands({ E: [hand([card(10), card(2)])] }))).toBe('hit');
    // Standing on 17 loses to 19 and 20; drawing can still win.
    expect(blackjackDealerDecision([card(10), card(7)],
      hands({ E: [hand([card(10), card(9)])], S: [hand([card(10), card(10, 'hearts')])] }))).toBe('hit');
    // Standing on 19 beats both remaining hands; busted hands and naturals do not count.
    expect(blackjackDealerDecision([card(10), card(9)], hands({
      E: [hand([card(10), card(7)])], S: [hand([card(10), card(6), card(9)])], W: [hand([card(14), card(13)])],
    }))).toBe('stand');
  });

  it('should keep a bot dealer from betting and use the house rule when a human dealer times out', () => {
    const view = {
      gameType: 'blackjack', phase: 'betting', mySeat: 'N', seats: ['N', 'E'], options: PLAYER_DEALER,
      dealerSeat: 'N', totalHands: 4, hand: 0, chips: { N: 1000, E: 1000, S: 0, W: 0 }, myBet: null,
      betPlaced: { N: false, E: false, S: false, W: false }, betDeadline: 1, hands: hands({}), dealer: [],
      holeHidden: false, currentTurnSeat: 'N', activeHand: 0, log: [], result: null,
    } as const;
    expect(getBlackjackBotAction(view, () => 0.5)).toBeNull();
    const turn = { ...view, phase: 'playing', dealer: [card(10), card(6)] } as const;
    expect(blackjackDealerDefault(turn)).toEqual({ type: 'blackjack-dealer', action: 'hit' });
    expect(blackjackDealerDefault({ ...turn, dealer: [card(10), card(6), card(2)] }))
      .toEqual({ type: 'blackjack-dealer', action: 'stand' });
    expect(blackjackDealerDefault({ ...turn, holeHidden: true })).toBeNull();
    expect(blackjackDealerDefault({ ...turn, currentTurnSeat: 'E' })).toBeNull();
  });
});

describe('Blackjack player dealer room option', () => {
  beforeEach(() => {
    roomManager.restoreRooms([]);
    gameManager.restoreGames([]);
  });

  it('should let only the waiting Blackjack host change it and pass it to the match', () => {
    const code = roomManager.createRoom('blackjack', 'host');
    roomManager.joinRoom(code, 'guest');
    roomManager.changeSeat(code, player('host'), 'N');
    roomManager.changeSeat(code, player('guest'), 'S');
    roomManager.setReady(code, 'guest', true);
    expect(roomManager.getRoomInfo(code)?.blackjackOptions).toEqual({ playerDealer: false });
    expect(roomManager.setBlackjackOptions(code, 'guest', PLAYER_DEALER).success).toBe(false);
    expect(roomManager.setBlackjackOptions(code, 'host', { playerDealer: 'yes' } as never).success).toBe(false);
    expect(roomManager.setBlackjackOptions(code, 'host', PLAYER_DEALER).success).toBe(true);
    expect(roomManager.getRoomInfo(code)?.seats.S.isReady).toBe(false);
    const { blackjackOptions: _omitted, ...legacy } = roomManager.exportRooms()[0].info;
    roomManager.restoreRooms([{ ...roomManager.exportRooms()[0], info: legacy }]);
    expect(roomManager.getRoomInfo(code)?.blackjackOptions).toEqual({ playerDealer: false });
    roomManager.setBlackjackOptions(code, 'host', PLAYER_DEALER);
    const room = roomManager.getRoomInfo(code)!;
    expect(gameManager.startGame(code, 'blackjack', roomManager.getSeatPlayers(code)!, room.timeControl,
      room.sevensOptions, room.ninetyNineOptions, room.blackjackOptions).success).toBe(true);
    const state = gameManager.getGameState(code);
    expect(state?.gameType === 'blackjack' && state.dealerSeat).toMatch(/^[NS]$/);
    expect(roomManager.setGameType(code, 'host', 'holdem').success).toBe(true);
    expect(roomManager.setBlackjackOptions(code, 'host', { playerDealer: false }))
      .toEqual({ success: false, reason: 'Not a Blackjack room.' });
  });
});
