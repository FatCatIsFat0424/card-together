import { beforeEach, describe, expect, it } from 'vitest';
import type { Card, HoldemAction, HoldemGameState, PlayerInfo, Seat } from '@shared/types';
import { HE_HANDS } from '@shared/rules/holdem';
import { createDeck } from '../../src/engine/deck';
import * as holdem from '../../src/managers/games/holdem-game';

const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
const CODE = 'HE0001';
const PLAYERS = Object.fromEntries(SEATS.map((seat) => [seat, {
  id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
}])) as Record<Seat, PlayerInfo>;

const card = (rank: Card['rank'], suit: Card['suit'] = 'spades'): Card => ({ suit, rank });
const key = (value: Card): string => `${value.suit}${value.rank}`;

/** Fisher-Yates draws that put `top` first, in order; remaining cards keep deck order. */
function shuffleDraws(top: readonly Card[]): number[] {
  const rest = createDeck().filter((value) => !top.some((wanted) => key(wanted) === key(value)));
  const target = [...top, ...rest];
  const deck = createDeck();
  const draws: number[] = [];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = deck.findIndex((value) => key(value) === key(target[i]));
    draws.push((j + 0.5) / (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return draws;
}

/**
 * Random source for a match: the first draw picks the button, then each hand's shuffle deals `decks[n]`.
 * Hole cards go one at a time from the button's left, twice around, then flop, turn, and river.
 */
function rigged(button: Seat, decks: readonly (readonly Card[])[]): () => number {
  const draws = [(SEATS.indexOf(button) + 0.5) / 4, ...decks.flatMap(shuffleDraws)];
  let index = 0;
  return () => draws[index++] ?? 0.5;
}

function game(): HoldemGameState {
  const state = holdem.getGameState(CODE);
  if (!state) throw new Error("Expected a Hold'em game");
  return state;
}

describe("Hold'em gameplay", () => {
  beforeEach(() => holdem.restoreGames([]));

  it('deals two private cards per seat, posts blinds, and opens after the big blind', () => {
    holdem.startGame(CODE, PLAYERS, rigged('W', [[card(2), card(3), card(4), card(5), card(6), card(7), card(8), card(9)]]), 0);
    const state = game();
    expect(state).toMatchObject({ hand: 1, button: 'W', smallBlind: 10, bigBlind: 20, currentTurnSeat: 'S',
      chips: { N: 990, E: 980, S: 1000, W: 1000 }, streetBets: { N: 10, E: 20, S: 0, W: 0 }, currentBet: 20 });
    expect(state.hands).toEqual({ N: [card(2), card(6)], E: [card(3), card(7)], S: [card(4), card(8)], W: [card(5), card(9)] });
    const view = holdem.getPlayerVisibleState(CODE, 'E')!;
    expect(view.myHand).toEqual([card(3), card(7)]);
    expect(view).not.toHaveProperty('hands');
    expect(view).not.toHaveProperty('deck');
    expect(view.revealed).toEqual({ N: [], E: [], S: [], W: [] });
  });

  it('rejects out-of-turn and illegal actions without changes', () => {
    holdem.startGame(CODE, PLAYERS, rigged('W', []), 0);
    const before = structuredClone(game());
    expect(holdem.act(CODE, 'N', { type: 'fold' }).success).toBe(false);
    expect(holdem.act(CODE, 'S', { type: 'check' }).success).toBe(false);
    expect(holdem.act(CODE, 'S', { type: 'raise', to: 39 }).success).toBe(false);
    expect(holdem.act(CODE, 'S', { type: 'raise', to: 1001 }).success).toBe(false);
    expect(holdem.act(CODE, 'S', { type: 'raise', to: 40.5 }).success).toBe(false);
    expect(game()).toEqual(before);
    expect(holdem.act(CODE, 'S', { type: 'raise', to: 40 }).success).toBe(true);
    expect(game().log.at(-1)).toMatchObject({ type: 'action', seat: 'S', action: 'raise', to: 40, allIn: false });
  });

  it('awards the blinds when everyone folds and starts the next hand with the button moved', () => {
    holdem.startGame(CODE, PLAYERS, rigged('W', []), 0);
    expect(holdem.act(CODE, 'S', { type: 'fold' }).success).toBe(true);
    expect(holdem.act(CODE, 'W', { type: 'fold' }).success).toBe(true);
    expect(holdem.act(CODE, 'N', { type: 'fold' }).success).toBe(true);
    const state = game();
    const award = state.log.find((entry) => entry.type === 'award');
    expect(award).toMatchObject({ pots: [{ amount: 30, eligible: ['E'], winners: ['E'] }], eliminated: [] });
    expect(state.log.some((entry) => entry.type === 'showdown')).toBe(false);
    expect(state).toMatchObject({ hand: 2, button: 'N', currentTurnSeat: 'W',
      chips: { N: 990, E: 1010 - 10, S: 980, W: 1000 }, streetBets: { N: 0, E: 10, S: 20, W: 0 } });
  });

  it('checks a hand down through every street to a showdown', () => {
    const board = [card(2, 'hearts'), card(7, 'clubs'), card(9, 'diamonds'), card(12, 'clubs'), card(13, 'hearts')];
    holdem.startGame(CODE, PLAYERS, rigged('W', [[card(14), card(3), card(4), card(5), card(14, 'clubs'), card(3, 'clubs'),
      card(4, 'clubs'), card(5, 'clubs'), ...board]]), 0);
    for (const seat of ['S', 'W', 'N'] as const) expect(holdem.act(CODE, seat, { type: 'call' }).success).toBe(true);
    expect(holdem.act(CODE, 'E', { type: 'check' }).success).toBe(true);
    for (let street = 0; street < 3; street++) {
      expect(game().currentTurnSeat).toBe('N');
      for (const seat of ['N', 'E', 'S', 'W'] as const) expect(holdem.act(CODE, seat, { type: 'check' }).success).toBe(true);
    }
    const state = game();
    const types = state.log.map((entry) => entry.type);
    expect(types.filter((type) => type === 'street')).toHaveLength(3);
    const showdown = state.log.find((entry) => entry.type === 'showdown');
    expect(showdown).toMatchObject({ cards: { N: [card(14), card(14, 'clubs')] } });
    expect(state.log.find((entry) => entry.type === 'award')).toMatchObject({
      pots: [{ amount: 80, eligible: ['N', 'E', 'S', 'W'], winners: ['N'] }] });
    expect(state.hand).toBe(2);
    expect(state.revealed).toEqual({ N: [], E: [], S: [], W: [] });
  });

  it('runs out the board after all-ins, eliminates busted seats, and ends when one seat holds every chip', () => {
    const random = rigged('W', [
      [card(14), card(2), card(3, 'hearts'), card(4, 'hearts'), card(14, 'clubs'), card(7, 'diamonds'), card(8, 'clubs'),
        card(9, 'clubs'), card(13), card(13, 'hearts'), card(5, 'diamonds'), card(6, 'hearts'), card(11, 'clubs')],
      [card(2, 'clubs'), card(4), card(14, 'hearts'), card(3, 'diamonds'), card(6, 'clubs'), card(14, 'diamonds'),
        card(13, 'clubs'), card(13, 'diamonds'), card(9, 'diamonds'), card(10, 'clubs'), card(12, 'hearts')],
    ]);
    holdem.startGame(CODE, PLAYERS, random, 0);
    const play = (seat: Seat, action: HoldemAction): boolean => holdem.act(CODE, seat, action, 0, random).success;
    expect(play('S', { type: 'fold' })).toBe(true);
    expect(play('W', { type: 'fold' })).toBe(true);
    expect(play('N', { type: 'raise', to: 1000 })).toBe(true);
    expect(game().log.at(-1)).toMatchObject({ action: 'raise', to: 1000, allIn: true });
    expect(play('E', { type: 'call' })).toBe(true);
    let state = game();
    const first = state.log.findIndex((entry) => entry.type === 'award');
    expect(state.log.slice(first - 4, first).map((entry) => entry.type)).toEqual(['street', 'street', 'street', 'showdown']);
    expect(state.log[first]).toMatchObject({ pots: [{ amount: 2000, eligible: ['N', 'E'], winners: ['N'] }], eliminated: ['E'] });
    expect(state).toMatchObject({ hand: 2, button: 'N', dealt: ['N', 'S', 'W'], eliminated: ['E'], currentTurnSeat: 'N',
      streetBets: { N: 0, E: 0, S: 10, W: 20 } });
    expect(state.hands.E).toEqual([]);

    expect(play('N', { type: 'raise', to: 2000 })).toBe(true);
    expect(play('S', { type: 'call' })).toBe(true);
    expect(play('W', { type: 'call' })).toBe(true);
    state = game();
    expect(state.phase).toBe('scoring');
    expect(state.log.at(-1)).toMatchObject({ type: 'award', eliminated: ['S', 'W'] });
    expect(state.result).toEqual({ gameType: 'holdem', chips: { N: 4000, E: 0, S: 0, W: 0 }, hands: 2, winners: ['N'],
      eliminationOrder: ['E', 'S', 'W'] });
  });

  it('ends after the last hand with the most chips winning', () => {
    holdem.startGame(CODE, PLAYERS, rigged('W', []), 0);
    for (let hand = 1; hand <= HE_HANDS; hand++) {
      expect(game().hand).toBe(hand);
      for (let folds = 0; folds < 3; folds++) {
        expect(holdem.act(CODE, game().currentTurnSeat, { type: 'fold' }).success).toBe(true);
      }
    }
    const state = game();
    expect(state.phase).toBe('scoring');
    expect(state.result).toMatchObject({ gameType: 'holdem', hands: HE_HANDS, chips: state.chips, eliminationOrder: [] });
    expect(Object.values(state.chips).reduce((sum, value) => sum + value, 0)).toBe(4000);
  });
});
