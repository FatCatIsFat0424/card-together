import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card, NinetyNineVisibleState, PlayerInfo, RedPointsVisibleState, Seat } from '@shared/types';
import { nnApply } from '@shared/rules/ninetynine';
import { createDeck, shuffleDeck } from '../../src/engine/deck';
import { getRedPointsBotAction } from '../../src/bots/redpoints-strategy';
import { getNinetyNineBotAction } from '../../src/bots/ninetynine-strategy';
import * as redpoints from '../../src/managers/games/redpoints-game';
import * as ninetynine from '../../src/managers/games/ninetynine-game';

const CODE = 'STR123';
const card = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank });
const player = (id: string): PlayerInfo => ({
  id, username: id, nickname: id, color: '#123456', avatar: 'cat', avatarImage: null,
});
const PLAYERS = { N: player('north'), E: player('east'), S: player('south'), W: player('west') };

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function redPointsState(overrides: Partial<RedPointsVisibleState> = {}): RedPointsVisibleState {
  return {
    gameType: 'redpoints', phase: 'playing', mySeat: 'N', myHand: [],
    handCounts: { N: 6, E: 6, S: 6, W: 6 }, table: [], stockCount: 24,
    captured: { N: [], E: [], S: [], W: [] }, currentTurnSeat: 'N', step: 'play',
    pendingFlip: null, log: [], result: null, ...overrides,
  };
}

function ninetyNineState(overrides: Partial<NinetyNineVisibleState> = {}): NinetyNineVisibleState {
  return {
    gameType: 'ninetynine', phase: 'playing', mySeat: 'N', myHand: [],
    handCounts: { N: 5, E: 5, S: 5, W: 5 }, total: 0, direction: 'ccw',
    currentTurnSeat: 'N', lastPlayed: null, stockCount: 32, eliminated: [],
    log: [], result: null, ...overrides,
  };
}

describe('capture and survival bot strategies', () => {
  beforeEach(() => {
    redpoints.restoreGames([]);
    ninetynine.restoreGames([]);
    vi.spyOn(Math, 'random').mockImplementation(seededRandom(83));
  });
  afterEach(() => vi.restoreAllMocks());

  it('secures a valuable red capture across different random choices', () => {
    const state = redPointsState({
      myHand: [card('clubs', 9)], table: [card('clubs', 14), card('hearts', 14)],
    });
    for (const roll of [0, 0.25, 0.75, 0.999]) {
      expect(getRedPointsBotAction(state, () => roll)).toEqual({
        type: 'redpoints-play', card: card('clubs', 9), capture: card('hearts', 14),
      });
    }
    expect(getRedPointsBotAction({ ...state, step: 'flip-choose', pendingFlip: card('clubs', 9) }, () => 0.999))
      .toEqual({ type: 'redpoints-flip', capture: card('hearts', 14) });
  });

  it('avoids exposing a red ace when discarding a black card is safer', () => {
    const state = redPointsState({ myHand: [card('hearts', 14), card('clubs', 13)] });
    for (const roll of [0, 0.5, 0.999]) {
      expect(getRedPointsBotAction(state, () => roll)).toEqual({ type: 'redpoints-play', card: card('clubs', 13) });
    }
  });

  it('varies equivalent captures without mutating the visible state', () => {
    const state = redPointsState({
      myHand: [card('clubs', 10)], table: [card('hearts', 10), card('diamonds', 10)],
    });
    const original = structuredClone(state);
    const random = seededRandom(333);
    const captures = new Set<string>();
    for (let index = 0; index < 40; index++) {
      const action = getRedPointsBotAction(state, random);
      expect(action?.type).toBe('redpoints-play');
      if (action?.type === 'redpoints-play') captures.add(action.capture!.suit);
    }
    expect(captures).toEqual(new Set(['hearts', 'diamonds']));
    expect(state).toEqual(original);
  });

  it('can lower a legal high total instead of exhausting the only rescue card', () => {
    const state = ninetyNineState({ total: 70, myHand: [card('hearts', 12)] });
    expect(nnApply(state.total, state.myHand[0], 'plus').total).toBe(90);
    expect(getNinetyNineBotAction(state, () => 0.999)).toEqual({
      type: 'ninetynine-play', card: card('hearts', 12), choice: 'minus',
    });
  });

  it('retains a point-lowering card while passing pressure to the next opponent', () => {
    const state = ninetyNineState({ total: 99, myHand: [card('clubs', 11), card('hearts', 12)] });
    for (const roll of [0, 0.5, 0.999]) {
      expect(getNinetyNineBotAction(state, () => roll)).toEqual({ type: 'ninetynine-play', card: card('clubs', 11) });
    }
  });

  it('chooses both legal signs near the best score and always subtracts when plus exceeds 99', () => {
    const state = ninetyNineState({ total: 1, myHand: [card('hearts', 10)] });
    const random = seededRandom(555);
    const signs = new Set<string>();
    for (let index = 0; index < 40; index++) {
      const action = getNinetyNineBotAction(state, random);
      if (action?.type === 'ninetynine-play') signs.add(action.choice!);
    }
    expect(signs).toEqual(new Set(['plus', 'minus']));
    expect(getNinetyNineBotAction({ ...state, total: 99 }, () => 0.999)).toEqual({
      type: 'ninetynine-play', card: card('hearts', 10), choice: 'minus',
    });
  });

  it('varies designation among similarly rated surviving opponents and preserves the input', () => {
    const state = ninetyNineState({ total: 20, myHand: [card('clubs', 5)], eliminated: ['E'] });
    const original = structuredClone(state);
    const random = seededRandom(77);
    const targets = new Set<Seat>();
    for (let index = 0; index < 40; index++) {
      const action = getNinetyNineBotAction(state, random);
      expect(action?.type).toBe('ninetynine-play');
      if (action?.type === 'ninetynine-play') targets.add(action.target!);
    }
    expect(targets).toEqual(new Set(['S', 'W']));
    expect(state).toEqual(original);
    // Near 99, designating W leaves S to act before N; designating S returns the turn to N at once.
    for (const roll of [0, 0.5, 0.999]) {
      expect(getNinetyNineBotAction({ ...state, total: 99 }, () => roll)).toEqual({
        type: 'ninetynine-play', card: card('clubs', 5), target: 'W',
      });
    }
  });

  it.each([7, 19, 41, 97])('finishes legal randomized capture and survival games with seed %i', (seed) => {
    for (const gameType of ['redpoints', 'ninetynine'] as const) {
      const random = seededRandom(seed);
      const adapter = gameType === 'redpoints' ? redpoints : ninetynine;
      adapter.startGame(CODE, PLAYERS, shuffleDeck(createDeck(), random), 'N');
      let turns = 0;
      while (adapter.getGameState(CODE)?.phase !== 'scoring' && turns < 2000) {
        const seat = adapter.getGameState(CODE)!.currentTurnSeat;
        const state = adapter.getPlayerVisibleState(CODE, seat)!;
        const original = structuredClone(state);
        const action = state.gameType === 'redpoints'
          ? getRedPointsBotAction(state, random) : getNinetyNineBotAction(state, random);
        expect(action).not.toBeNull();
        expect(state).toEqual(original);
        if (action?.type === 'redpoints-play') expect(redpoints.play(CODE, seat, action.card, action.capture).success).toBe(true);
        else if (action?.type === 'redpoints-flip') expect(redpoints.chooseFlip(CODE, seat, action.capture).success).toBe(true);
        else if (action?.type === 'ninetynine-play') {
          expect(ninetynine.play(CODE, seat, action.card, action.choice, action.target).success).toBe(true);
        } else throw new Error('Unexpected bot action');
        turns++;
      }
      expect(adapter.getGameState(CODE)?.phase).toBe('scoring');
      expect(adapter.getGameState(CODE)?.result).not.toBeNull();
    }
  });
});
