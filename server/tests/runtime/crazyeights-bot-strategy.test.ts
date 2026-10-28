import { beforeEach, describe, expect, it } from 'vitest';
import { GAME_SEAT_ORDER } from '@shared/constants';
import type { Card, GameSeat, PlayerInfo, Suit } from '@shared/types';
import type { CrazyEightsLogEntry, CrazyEightsVisibleState } from '@shared/games/crazyeights/types';
import { ceIsPlayable } from '@shared/rules/crazyeights';
import { getBotAction } from '../../src/bots/bot-decisions';
import type { BotAction } from '../../src/bots/bot-decisions';
import { firstLegalAction } from '../../src/runtime/automated-action';
import * as ce from '../../src/managers/games/crazyeights-game';
import { runSeededGame } from './seeded-game-runner';

const card = (suit: Suit, rank: Card['rank']): Card => ({ suit, rank });

function seeded(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function counts(entries: Partial<Record<GameSeat, number>>): Record<GameSeat, number> {
  return Object.fromEntries(GAME_SEAT_ORDER.map((seat) => [seat, entries[seat] ?? 0])) as Record<GameSeat, number>;
}

function view(myHand: Card[], overrides: Partial<CrazyEightsVisibleState> = {}): CrazyEightsVisibleState {
  return {
    gameType: 'crazyeights', phase: 'playing', options: { actionCards: false }, mySeat: 'N', seats: ['N', 'E', 'S', 'W'],
    myHand, handCounts: counts({ N: myHand.length, E: 5, S: 5, W: 5 }), hand: 1, scores: counts({}), direction: 'ccw',
    currentTurnSeat: 'N', drawn: false, lastPlayed: card('hearts', 6), activeSuit: 'hearts', stockCount: 20, reserveCount: 0,
    log: [], result: null, ...overrides,
  };
}

function play(action: BotAction | null): { card: Card; suit?: Suit } {
  if (action?.type !== 'game-action' || action.request.gameType !== 'crazyeights' || action.request.action.type !== 'play') {
    throw new Error('Expected a play');
  }
  return action.request.action;
}

function kind(action: BotAction | null): string | null {
  return action?.type === 'game-action' && action.request.gameType === 'crazyeights' ? action.request.action.type : null;
}

const samples = [0, 0.3, 0.6, 0.9999];

describe('Crazy Eights easy and fallback bots', () => {
  it('plays the first legal card in hand order and names the 8 own suit', () => {
    const visible = view([card('clubs', 3), card('hearts', 9), card('spades', 8), card('hearts', 2)]);
    for (const difficulty of ['easy'] as const) {
      expect(play(getBotAction(visible, () => 0.5, difficulty)).card).toEqual(card('hearts', 9));
    }
    const wildFirst = view([card('spades', 8), card('hearts', 9), card('clubs', 3)]);
    expect(play(getBotAction(wildFirst, () => 0.5, 'easy'))).toEqual({ type: 'play', card: card('spades', 8), suit: 'spades' });
    expect(play(firstLegalAction(wildFirst))).toEqual({ type: 'play', card: card('spades', 8), suit: 'spades' });
  });

  it('omits the suit for a last-card 8', () => {
    const last = view([card('spades', 8)], { handCounts: counts({ N: 1, E: 5, S: 5, W: 5 }) });
    expect(play(getBotAction(last, () => 0.5, 'easy'))).toEqual({ type: 'play', card: card('spades', 8) });
  });

  it('draws with nothing playable, and passes when the stock cannot supply a card', () => {
    const stuck = [card('clubs', 3), card('clubs', 4)];
    expect(kind(getBotAction(view(stuck), () => 0.5, 'easy'))).toBe('draw');
    expect(kind(getBotAction(view(stuck, { stockCount: 0, reserveCount: 0 }), () => 0.5, 'easy'))).toBe('pass');
    expect(kind(getBotAction(view(stuck), () => 0.5, 'hard'))).toBe('draw');
    expect(kind(getBotAction(view(stuck, { stockCount: 0, reserveCount: 3 }), () => 0.5, 'hard'))).toBe('draw');
  });

  it('only acts on its own turn while the hand is in play', () => {
    const hand = [card('hearts', 9)];
    for (const difficulty of ['easy', 'hard'] as const) {
      expect(getBotAction(view(hand, { currentTurnSeat: 'E' }), () => 0.5, difficulty)).toBeNull();
      expect(getBotAction(view(hand, { phase: 'scoring' }), () => 0.5, difficulty)).toBeNull();
    }
  });
});

describe('Crazy Eights hard bot', () => {
  it('keeps an 8 while another card is playable', () => {
    const visible = view([card('spades', 8), card('hearts', 3), card('clubs', 4), card('clubs', 5)]);
    for (const sample of samples) expect(play(getBotAction(visible, () => sample, 'hard')).card).toEqual(card('hearts', 3));
  });

  it('dumps the heavier of two otherwise equal plays and favours the suit it holds most of', () => {
    const heavy = view([card('hearts', 13), card('hearts', 3), card('clubs', 4)]);
    for (const sample of samples) expect(play(getBotAction(heavy, () => sample, 'hard')).card).toEqual(card('hearts', 13));
    const steer = view([card('hearts', 9), card('clubs', 6), card('clubs', 4), card('clubs', 5), card('clubs', 7)]);
    for (const sample of samples) expect(play(getBotAction(steer, () => sample, 'hard')).card).toEqual(card('clubs', 6));
  });

  it('declares its longest suit when an 8 is the only playable card', () => {
    const visible = view([card('spades', 8), card('diamonds', 3), card('diamonds', 4), card('diamonds', 9), card('clubs', 5)]);
    for (const sample of samples) {
      expect(play(getBotAction(visible, () => sample, 'hard'))).toEqual({ type: 'play', card: card('spades', 8), suit: 'diamonds' });
    }
  });

  it('goes out whenever the last card is playable', () => {
    const visible = view([card('spades', 8)]);
    for (const sample of samples) expect(play(getBotAction(visible, () => sample, 'hard')).card).toEqual(card('spades', 8));
  });

  it('declares a suit the next seat just failed to follow', () => {
    // Counterclockwise from N the next seat is W, which drew while diamonds were in force.
    const log: CrazyEightsLogEntry[] = [
      { type: 'hand', hand: 1, first: 'N', starter: card('diamonds', 3), timestamp: 0 },
      { type: 'draw', seat: 'W', timestamp: 1 },
      { type: 'pass', seat: 'W', timestamp: 1 },
    ];
    const hand = [card('spades', 8), card('hearts', 4), card('diamonds', 5)];
    const table = { lastPlayed: card('clubs', 9), activeSuit: 'clubs' as const };
    for (const sample of samples) {
      expect(play(getBotAction(view(hand, { ...table, log }), () => sample, 'hard')).suit).toBe('diamonds');
    }
    const declared = samples.map((sample) => play(getBotAction(view(hand, table), () => sample, 'hard')).suit);
    expect(new Set(declared)).toEqual(new Set(['hearts', 'diamonds']));
  });

  it('forgets a void once the seat took penalty cards', () => {
    const log: CrazyEightsLogEntry[] = [
      { type: 'hand', hand: 1, first: 'N', starter: card('diamonds', 3), timestamp: 0 },
      { type: 'draw', seat: 'W', timestamp: 1 },
      { type: 'play', seat: 'N', card: card('diamonds', 2), suit: null, effect: 'draw', target: 'W', drawn: 2, timestamp: 2 },
    ];
    const hand = [card('spades', 8), card('hearts', 4), card('diamonds', 5)];
    const declared = samples.map((sample) => play(getBotAction(view(hand, {
      lastPlayed: card('clubs', 9), activeSuit: 'clubs', log }), () => sample, 'hard')).suit);
    expect(new Set(declared)).toEqual(new Set(['hearts', 'diamonds']));
  });

  it('spends a skip or draw-two card on the next seat when it nearly went out', () => {
    const base = view([card('hearts', 12), card('hearts', 9), card('clubs', 4)], { options: { actionCards: true } });
    // Counterclockwise from N the next seat is W.
    const threat = { ...base, handCounts: counts({ N: 3, E: 5, S: 5, W: 2 }) };
    for (const sample of samples) expect(play(getBotAction(threat, () => sample, 'hard')).card).toEqual(card('hearts', 12));
    const draw = { ...threat, myHand: [card('hearts', 2), card('hearts', 10), card('clubs', 4)] };
    for (const sample of samples) expect(play(getBotAction(draw, () => sample, 'hard')).card).toEqual(card('hearts', 2));
  });

  it('reverses only when the leader sits behind it, not when the leader is next', () => {
    const base = view([card('hearts', 14), card('hearts', 9), card('clubs', 4)], { options: { actionCards: true } });
    // Counterclockwise from N the order is W, S, E: E is the seat behind N.
    const behind = { ...base, handCounts: counts({ N: 3, E: 2, S: 5, W: 5 }) };
    for (const sample of samples) expect(play(getBotAction(behind, () => sample, 'hard')).card).toEqual(card('hearts', 14));
    const next = { ...base, handCounts: counts({ N: 3, E: 5, S: 5, W: 2 }) };
    for (const sample of samples) expect(play(getBotAction(next, () => sample, 'hard')).card).toEqual(card('hearts', 9));
  });

  it('does not mutate the filtered view', () => {
    const visible = view([card('spades', 8), card('hearts', 3), card('clubs', 4)], { options: { actionCards: true } });
    const original = structuredClone(visible);
    for (const sample of samples) getBotAction(visible, () => sample, 'hard');
    expect(visible).toEqual(original);
  });
});

function playersOf(count: number): Partial<Record<GameSeat, PlayerInfo>> {
  return Object.fromEntries(GAME_SEAT_ORDER.slice(0, count).map((seat) => [seat, {
    id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
  }]));
}

function apply(code: string, seat: GameSeat, action: BotAction | null): void {
  if (action?.type !== 'game-action' || action.request.gameType !== 'crazyeights') throw new Error('Expected a Crazy Eights action');
  const move = action.request.action;
  const result = move.type === 'play' ? ce.play(code, seat, move.card, move.suit)
    : move.type === 'draw' ? ce.draw(code, seat) : ce.pass(code, seat);
  expect(result).toEqual({ success: true });
}

describe('Crazy Eights full matches between bots', () => {
  beforeEach(() => ce.restoreGames([]));

  const configurations = [2, 3, 4, 5, 6, 8].flatMap((count) => [false, true].map((actionCards) => ({ count, actionCards })));

  it.each(configurations)('finishes with $count players, action cards $actionCards, using only legal actions', ({ count, actionCards }) => {
    const code = `BOT${count}${actionCards ? 'A' : 'B'}`;
    const random = seeded(count * 31 + (actionCards ? 7 : 0));
    ce.startGame(code, playersOf(count), undefined, undefined, { actionCards });
    const difficulties = ['hard', 'easy'] as const;
    const actions = runSeededGame(code, 20000, () => ce.getGameState(code)?.phase === 'scoring', () => {
      const game = ce.getGameState(code)!;
      const seat = game.currentTurnSeat;
      const visible = ce.getPlayerVisibleState(code, seat)!;
      // Alternate difficulties by seat so hard and easy bots share every table.
      const difficulty = difficulties[GAME_SEAT_ORDER.indexOf(seat) % 2];
      const chosen = getBotAction(visible, random, difficulty);
      apply(code, seat, chosen);
    });
    const game = ce.getGameState(code)!;
    expect(actions).toBeGreaterThan(count);
    expect(game.result?.handWinners).toHaveLength(3);
    // The deck stays whole, with both copies of each card when two decks are in play.
    const all = [...GAME_SEAT_ORDER.flatMap((seat) => game.hands[seat]), ...game.stock, ...game.discard];
    expect(all).toHaveLength(count >= 5 ? 104 : 52);
  });

  it('plays the first legal action when the strategy is bypassed', () => {
    const code = 'BOTFL1';
    ce.startGame(code, playersOf(4), undefined, undefined, { actionCards: true });
    runSeededGame(code, 20000, () => ce.getGameState(code)?.phase === 'scoring', () => {
      const game = ce.getGameState(code)!;
      const seat = game.currentTurnSeat;
      apply(code, seat, firstLegalAction(ce.getPlayerVisibleState(code, seat)!));
    });
    expect(ce.getGameState(code)?.result).not.toBeNull();
  });

  it('only chooses playable cards', () => {
    const code = 'BOTPL1';
    const random = seeded(5);
    ce.startGame(code, playersOf(5), undefined, undefined, { actionCards: true });
    runSeededGame(code, 20000, () => ce.getGameState(code)?.phase === 'scoring', () => {
      const game = ce.getGameState(code)!;
      const seat = game.currentTurnSeat;
      const visible = ce.getPlayerVisibleState(code, seat)!;
      const action = getBotAction(visible, random, 'hard');
      if (kind(action) === 'play') {
        const chosen = play(action).card;
        expect(visible.myHand.some((own) => own.suit === chosen.suit && own.rank === chosen.rank)).toBe(true);
        expect(ceIsPlayable(chosen, visible.lastPlayed!, visible.activeSuit)).toBe(true);
      }
      apply(code, seat, action);
    });
  });
});
