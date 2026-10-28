import { beforeEach, describe, expect, it } from 'vitest';
import type { AnyGameState, Card, GameSeat, PlayerInfo, StudAction, StudGameState } from '@shared/types';
import { GAME_SEAT_ORDER } from '@shared/constants';
import { STUD_HANDS } from '@shared/rules/stud';
import { heLegalActions } from '@shared/rules/holdem';
import { createDeck } from '../../src/engine/deck';
import * as stud from '../../src/managers/games/stud-game';
import { coherentStudGame, isStudResult } from '../../src/managers/games/stud-validation';
import { isRuntimeSnapshot } from '../../src/runtime/validate';
import type { RuntimeSnapshot } from '../../src/runtime/types';

const CODE = 'ST0001';
const SEATS4: readonly GameSeat[] = ['N', 'E', 'S', 'W'];

function players(seats: readonly GameSeat[]): Partial<Record<GameSeat, PlayerInfo>> {
  return Object.fromEntries(seats.map((seat) => [seat, {
    id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
  }]));
}

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
 * Random source for a match: the first draw picks the button among `seats`, then each hand's shuffle
 * deals `decks[n]`: hole cards from the button's left, first up cards the same way, then one up card per
 * street to the seats still in.
 */
function rigged(button: GameSeat, seats: readonly GameSeat[], decks: readonly (readonly Card[])[]): () => number {
  const draws = [(seats.indexOf(button) + 0.5) / seats.length, ...decks.flatMap(shuffleDraws)];
  let index = 0;
  return () => draws[index++] ?? 0.5;
}

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function game(): StudGameState {
  const state = stud.getGameState(CODE);
  if (!state) throw new Error('Expected a stud game');
  return state;
}

function persists(state: StudGameState, seats: readonly GameSeat[]): boolean {
  const roster = players(seats) as Record<string, PlayerInfo>;
  const playing = state.phase !== 'scoring';
  const snapshot: RuntimeSnapshot = {
    players: seats.map((seat) => ({ info: roster[seat], currentRoomCode: CODE, disconnectedAt: null })),
    rooms: [{
      info: {
        code: CODE, gameType: 'stud', status: playing ? 'playing' : 'waiting', createdAt: 1,
        hostId: 'N', abortVote: null, abortVoteCooldownUntil: null,
        seats: Object.fromEntries(SEATS4.map((seat) => [seat, { player: roster[seat] ?? null, isReady: playing }])) as
          RuntimeSnapshot['rooms'][number]['info']['seats'],
        additionalSeats: seats.slice(4).map((seat) => ({ player: roster[seat], isReady: playing })),
      },
      memberIds: [...seats],
    }],
    games: [JSON.parse(JSON.stringify(state)) as AnyGameState],
    chat: [{ roomCode: CODE, messages: [] }],
  };
  return isRuntimeSnapshot(snapshot);
}

/** One random legal action for the acting seat, folding rarely so hands reach showdowns and all-ins. */
function randomAction(state: StudGameState, random: () => number): StudAction {
  const legal = heLegalActions(state, state.currentTurnSeat)!;
  const roll = random();
  if (legal.raise && roll < 0.3) {
    const { min, max } = legal.raise;
    return { type: 'raise', to: roll < 0.08 ? max : min + Math.floor(random() * (max - min + 1) / 4) };
  }
  return legal.check ? { type: 'check' } : roll < 0.85 ? { type: 'call' } : { type: 'fold' };
}

function play(seed: number, seats: readonly GameSeat[], check?: (state: StudGameState) => void): StudGameState {
  const random = seeded(seed);
  stud.startGame(CODE, players(seats), random, 0);
  for (let step = 0; step < 4000 && game().phase !== 'scoring'; step++) {
    check?.(game());
    const state = game();
    expect(stud.act(CODE, state.currentTurnSeat, randomAction(state, random), 0, random).success).toBe(true);
  }
  return game();
}

describe('stud gameplay', () => {
  beforeEach(() => stud.restoreGames([]));

  it('antes, deals a hole and an up card, and opens with the best up card', () => {
    // Button W: hole cards N E S W, then up cards N E S W
    const holes = [card(2, 'hearts'), card(3, 'hearts'), card(4, 'hearts'), card(5, 'hearts')];
    const ups = [card(9), card(14, 'clubs'), card(14, 'hearts'), card(13)];
    stud.startGame(CODE, players(SEATS4), rigged('W', SEATS4, [[...holes, ...ups]]), 0);
    const state = game();
    expect(state).toMatchObject({ hand: 1, button: 'W', ante: 10, minBet: 20, street: 2,
      chips: { N: 990, E: 990, S: 990, W: 990 }, totalBets: { N: 10, E: 10, S: 10, W: 10 },
      streetBets: { N: 0, E: 0, S: 0, W: 0 }, currentBet: 0, currentTurnSeat: 'S' });
    expect(state.hands).toMatchObject({ N: [holes[0]], E: [holes[1]], S: [holes[2]], W: [holes[3]] });
    expect(state.up).toMatchObject({ N: [ups[0]], E: [ups[1]], S: [ups[2]], W: [ups[3]] });
    expect(state.log.map((entry) => entry.type)).toEqual(['hand', 'street']);
  });

  it('never leaks another seat\'s hole card or the deck before a showdown', () => {
    const holes = [card(2, 'hearts'), card(3, 'hearts'), card(4, 'hearts'), card(5, 'hearts')];
    stud.startGame(CODE, players(SEATS4), rigged('W', SEATS4, [[...holes, card(9), card(10), card(11), card(12)]]), 0);
    for (const seat of SEATS4) {
      const view = stud.getPlayerVisibleState(CODE, seat)!;
      const text = JSON.stringify(view);
      expect(view.myHand).toEqual([holes[SEATS4.indexOf(seat)]]);
      expect(view).not.toHaveProperty('hands');
      expect(view).not.toHaveProperty('deck');
      SEATS4.forEach((other, index) => {
        if (other !== seat) expect(text).not.toContain(JSON.stringify(holes[index]));
      });
      expect(view.revealed).toMatchObject({ N: [], E: [], S: [], W: [] });
    }
  });

  it('rejects out-of-turn and illegal actions without changes', () => {
    stud.startGame(CODE, players(SEATS4),
      rigged('W', SEATS4, [[card(2), card(3), card(4), card(5), card(9), card(8), card(7), card(6)]]), 0);
    // N shows the 9 and opens
    const before = structuredClone(game());
    expect(stud.act(CODE, 'E', { type: 'check' }).success).toBe(false);
    expect(stud.act(CODE, 'N', { type: 'call' }).success).toBe(false);
    expect(stud.act(CODE, 'N', { type: 'raise', to: 19 }).success).toBe(false);
    expect(stud.act(CODE, 'N', { type: 'raise', to: 991 }).success).toBe(false);
    expect(stud.act(CODE, 'N', { type: 'raise', to: 20.5 }).success).toBe(false);
    expect(game()).toEqual(before);
    expect(stud.act(CODE, 'N', { type: 'raise', to: 20 }).success).toBe(true);
    expect(game().log.at(-1)).toMatchObject({ type: 'action', seat: 'N', action: 'bet', to: 20, allIn: false });
    expect(game().currentTurnSeat).toBe('E');
    expect(stud.act(CODE, 'E', { type: 'check' }).success).toBe(false);
  });

  it('deals a street to the seats still in and lets the best showing hand open it', () => {
    const holes = [card(2, 'hearts'), card(3, 'hearts'), card(4, 'hearts'), card(5, 'hearts')];
    // N 9, E 8, S 7, W 6 showing; then the third-card round: N 5, E 8 (pair), S 2, W 3 (S folds first)
    stud.startGame(CODE, players(SEATS4), rigged('W', SEATS4, [[...holes, card(9), card(8), card(7), card(6),
      card(5), card(8, 'hearts'), card(3), card(12)]]), 0);
    expect(stud.act(CODE, 'N', { type: 'check' }).success).toBe(true);
    expect(stud.act(CODE, 'E', { type: 'check' }).success).toBe(true);
    expect(stud.act(CODE, 'S', { type: 'fold' }).success).toBe(true);
    expect(stud.act(CODE, 'W', { type: 'check' }).success).toBe(true);
    const state = game();
    expect(state.street).toBe(3);
    // The folded seat gets no card; the deal runs from the button's left over N, E, W
    expect(state.up).toMatchObject({ N: [card(9), card(5)], E: [card(8), card(8, 'hearts')], S: [card(7)], W: [card(6), card(3)] });
    expect(state.currentTurnSeat).toBe('E');
    expect(state.streetBets).toMatchObject({ N: 0, E: 0, S: 0, W: 0 });
  });

  it('awards the antes when everyone folds and starts the next hand with the button moved', () => {
    stud.startGame(CODE, players(SEATS4), rigged('W', SEATS4, [[]]), 0);
    const opener = game().currentTurnSeat;
    expect(stud.act(CODE, opener, { type: 'raise', to: 20 }).success).toBe(true);
    for (let folds = 0; folds < 3; folds++) expect(stud.act(CODE, game().currentTurnSeat, { type: 'fold' }).success).toBe(true);
    const state = game();
    const award = state.log.find((entry) => entry.type === 'award');
    expect(award).toMatchObject({ pots: [{ amount: 60, eligible: [opener], winners: [opener] }] });
    expect(state).toMatchObject({ hand: 2, button: 'N' });
    // The winner collected the three antes of the others and the hand-two antes came out of everyone
    expect(state.chips[opener]).toBe(1000 + 30 - 10);
  });

  it('checks a hand down through every street to a showdown with the best five cards', () => {
    const holes = [card(14), card(3, 'hearts'), card(4, 'hearts'), card(5, 'hearts')];
    stud.startGame(CODE, players(SEATS4), rigged('W', SEATS4, [[...holes,
      card(14, 'clubs'), card(7), card(8), card(9, 'clubs'),
      card(2, 'clubs'), card(10, 'hearts'), card(11, 'hearts'), card(12, 'clubs'),
      card(2, 'diamonds'), card(13), card(9, 'hearts'), card(11, 'clubs'),
      card(6, 'diamonds'), card(6, 'hearts'), card(7, 'hearts'), card(13, 'clubs')]]), 0);
    for (let street = 2; street <= 5; street++) {
      for (let acted = 0; acted < 4; acted++) {
        expect(stud.act(CODE, game().currentTurnSeat, { type: 'check' }).success).toBe(true);
      }
    }
    const state = game();
    const firstHand = state.log.slice(0, state.log.findIndex((entry) => entry.type === 'award'));
    expect(firstHand.filter((entry) => entry.type === 'street').map((entry) => entry.type === 'street' && entry.street)).toEqual([2, 3, 4, 5]);
    expect(state.log.find((entry) => entry.type === 'showdown')).toMatchObject({ cards: { N: [card(14)], E: [card(3, 'hearts')] } });
    // N holds aces and deuces
    expect(state.log.find((entry) => entry.type === 'award')).toMatchObject({
      pots: [{ amount: 40, eligible: ['N', 'E', 'S', 'W'], winners: ['N'] }] });
    expect(state.hand).toBe(2);
    expect(state.revealed).toMatchObject({ N: [], E: [], S: [], W: [] });
  });

  it('runs out the cards after all-ins, eliminates busted seats, and ends when one seat holds every chip', () => {
    const seats: readonly GameSeat[] = ['N', 'E'];
    // Heads-up, button E: hole cards N E, up cards N E, then four more up pairs
    const random = rigged('E', seats, [[card(14), card(2), card(14, 'hearts'), card(7, 'clubs'),
      card(13), card(5, 'diamonds'), card(12), card(9), card(11), card(4)]]);
    stud.startGame(CODE, players(seats), random, 0);
    expect(game().currentTurnSeat).toBe('N');
    expect(stud.act(CODE, 'N', { type: 'raise', to: 990 }, 0, random).success).toBe(true);
    expect(game().log.at(-1)).toMatchObject({ action: 'bet', to: 990, allIn: true });
    expect(stud.act(CODE, 'E', { type: 'call' }, 0, random).success).toBe(true);
    const state = game();
    expect(state.log.slice(-5).map((entry) => entry.type)).toEqual(['street', 'street', 'street', 'showdown', 'award']);
    expect(state.phase).toBe('scoring');
    expect(state.result).toEqual({ gameType: 'stud', seats, chips: { ...state.chips }, hands: 1, winners: ['N'],
      eliminationOrder: ['E'] });
    expect(state.chips).toMatchObject({ N: 2000, E: 0 });
  });

  it('puts a short ante all-in, deals the seat in, and runs the hand out', () => {
    const seats: readonly GameSeat[] = ['N', 'E'];
    const random = rigged('E', seats, [[card(14), card(2), card(14, 'hearts'), card(7, 'clubs'),
      card(13), card(5, 'diamonds'), card(12), card(9), card(11), card(4)]]);
    stud.startGame(CODE, players(seats), random, 0);
    // N raises to leave itself 5 chips... E calls and loses the hand, keeping 5 chips behind.
    expect(stud.act(CODE, 'N', { type: 'raise', to: 985 }, 0, random).success).toBe(true);
    expect(stud.act(CODE, 'E', { type: 'call' }, 0, random).success).toBe(true);
    for (let street = 3; street <= 5; street++) {
      for (let acted = 0; acted < 2; acted++) {
        expect(stud.act(CODE, game().currentTurnSeat, { type: 'check' }, 0, random).success).toBe(true);
      }
    }
    const second = game().log.filter((entry) => entry.type === 'hand')[1];
    expect(second).toMatchObject({ hand: 2, ante: 10, antes: { N: 10, E: 5 } });
    expect(game().log.some((entry, index) => entry.type === 'showdown' && index > game().log.indexOf(second!))).toBe(true);
    expect(game().totalBets.N + game().totalBets.E).toBe(0);
  });

  it('ends after the last hand with the most chips winning', () => {
    stud.startGame(CODE, players(SEATS4), rigged('W', SEATS4, []), 0);
    for (let hand = 1; hand <= STUD_HANDS; hand++) {
      expect(game().hand).toBe(hand);
      // The opener bets so that the other three can fold the hand away
      expect(stud.act(CODE, game().currentTurnSeat, { type: 'raise', to: game().minBet }).success).toBe(true);
      for (let folds = 0; folds < 3; folds++) {
        expect(stud.act(CODE, game().currentTurnSeat, { type: 'fold' }).success).toBe(true);
      }
    }
    const state = game();
    expect(state.phase).toBe('scoring');
    expect(state.result).toMatchObject({ gameType: 'stud', hands: STUD_HANDS, chips: state.chips, eliminationOrder: [] });
    expect(Object.values(state.chips).reduce((sum, value) => sum + value, 0)).toBe(4000);
    expect(isStudResult(JSON.parse(JSON.stringify(state.result)))).toBe(true);
  });

  it('keeps chips whole and every committed state coherent across full 2-, 3-, and 8-player matches', () => {
    const rosters: readonly (readonly GameSeat[])[] = [['N', 'S'], ['N', 'E', 'W'], GAME_SEAT_ORDER];
    for (const [index, seats] of rosters.entries()) {
      const final = play(index + 3, seats, (state) => {
        expect(Object.values(state.chips).reduce((sum, value) => sum + value, 0)
          + Object.values(state.totalBets).reduce((sum, value) => sum + value, 0)).toBe(1000 * seats.length);
        if (state.log.length % 7 === 0) expect(coherentStudGame(JSON.parse(JSON.stringify(state)))).toBe(true);
      });
      expect(final.phase).toBe('scoring');
      expect(final.log.some((entry) => entry.type === 'showdown')).toBe(true);
      expect(persists(final, seats)).toBe(true);
      expect(isStudResult(JSON.parse(JSON.stringify(final.result)))).toBe(true);
    }
  });

  it('rejects altered awards, illegal bets, and duplicated cards in stored state', () => {
    const final = play(12, SEATS4);
    expect(persists(final, SEATS4)).toBe(true);
    const award = final.log.findIndex((entry) => entry.type === 'award');
    const chips = structuredClone(final);
    const entry = chips.log[award];
    if (entry.type !== 'award') throw new Error('Expected an award');
    entry.chips.N += 10;
    expect(persists(chips, SEATS4)).toBe(false);
    const bet = structuredClone(final);
    const index = bet.log.findIndex((value) => value.type === 'action' && (value.action === 'raise' || value.action === 'bet'));
    expect(index).toBeGreaterThanOrEqual(0);
    bet.log[index] = { ...bet.log[index], to: 1 } as typeof bet.log[number];
    expect(persists(bet, SEATS4)).toBe(false);
    const result = structuredClone(final);
    result.result = { ...result.result!, hands: result.result!.hands - 1 };
    expect(persists(result, SEATS4)).toBe(false);

    stud.startGame(CODE, players(SEATS4), seeded(3), 0);
    const live = game();
    expect(persists(live, SEATS4)).toBe(true);
    const duplicate = structuredClone(live);
    duplicate.deck[0] = { ...duplicate.hands[live.dealt[0]][0] };
    expect(persists(duplicate, SEATS4)).toBe(false);
    const turn = structuredClone(live);
    turn.currentTurnSeat = SEATS4[(SEATS4.indexOf(live.currentTurnSeat) + 1) % 4];
    expect(persists(turn, SEATS4)).toBe(false);
    const up = structuredClone(live);
    up.up[live.dealt[0]] = [];
    expect(persists(up, SEATS4)).toBe(false);
  });
});
