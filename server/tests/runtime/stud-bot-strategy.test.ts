import { beforeEach, describe, expect, it } from 'vitest';
import type { BotDifficulty, Card, GameSeat, PlayerInfo, StudAction, StudVisibleState } from '@shared/types';
import { GAME_SEAT_ORDER } from '@shared/constants';
import { getBotAction } from '../../src/bots/bot-decisions';
import type { BotAction } from '../../src/bots/bot-decisions';
import { gameBot } from '../../src/bots/bot-registry';
import { studEquity } from '../../src/bots/stud-equity';
import * as stud from '../../src/managers/games/stud-game';

const CODE = 'SB0001';

function players(seats: readonly GameSeat[]): Partial<Record<GameSeat, PlayerInfo>> {
  return Object.fromEntries(seats.map((seat) => [seat, {
    id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
  }]));
}

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const card = (rank: Card['rank'], suit: Card['suit'] = 'spades'): Card => ({ suit, rank });

function studAction(action: BotAction | null): StudAction {
  if (action?.type !== 'game-action' || action.request.gameType !== 'stud') throw new Error('Expected a stud action');
  return action.request.action;
}

/** Plays a whole match where every seat is a bot of the given difficulty, using only each seat's own view. */
function botMatch(seed: number, seats: readonly GameSeat[], difficulty: (seat: GameSeat) => BotDifficulty): number {
  const random = seeded(seed);
  stud.startGame(CODE, players(seats), random, 0);
  let decisions = 0;
  for (let step = 0; step < 4000 && stud.getGameState(CODE)!.phase !== 'scoring'; step++) {
    const seat = stud.getGameState(CODE)!.currentTurnSeat;
    const view = stud.getPlayerVisibleState(CODE, seat)!;
    const action = getBotAction(view, random, difficulty(seat));
    expect(action).not.toBeNull();
    expect(stud.act(CODE, seat, studAction(action), 0, random)).toEqual({ success: true });
    decisions += 1;
  }
  expect(stud.getGameState(CODE)!.phase).toBe('scoring');
  return decisions;
}

describe('stud bot strategies', () => {
  beforeEach(() => stud.restoreGames([]));

  it('plays only legal actions as Easy bots at 2, 4, and 8 seats', () => {
    const rosters: readonly (readonly GameSeat[])[] = [['N', 'S'], ['N', 'E', 'S', 'W'], GAME_SEAT_ORDER];
    for (const [index, seats] of rosters.entries()) {
      expect(botMatch(10 + index, seats, () => 'easy')).toBeGreaterThan(0);
    }
  });

  it('plays only legal actions as Hard bots, and mixed with Easy bots, at several table sizes', () => {
    const rosters: readonly (readonly GameSeat[])[] = [['N', 'E'], ['N', 'E', 'S'], GAME_SEAT_ORDER];
    for (const [index, seats] of rosters.entries()) {
      expect(botMatch(20 + index, seats, () => 'hard')).toBeGreaterThan(0);
      stud.restoreGames([]);
      expect(botMatch(30 + index, seats, (seat) => (GAME_SEAT_ORDER.indexOf(seat) % 2 === 0 ? 'hard' : 'easy'))).toBeGreaterThan(0);
      stud.restoreGames([]);
    }
  });

  it('does not act out of turn or after the match', () => {
    stud.startGame(CODE, players(['N', 'E']), seeded(5), 0);
    const waiting = GAME_SEAT_ORDER.find((seat) => seat !== stud.getGameState(CODE)!.currentTurnSeat && seat in stud.getGameState(CODE)!.players)!;
    const view = stud.getPlayerVisibleState(CODE, waiting)!;
    expect(getBotAction(view, seeded(1), 'hard')).toBeNull();
    expect(getBotAction(view, seeded(1), 'easy')).toBeNull();
    const { phase: _phase, ...rest } = view;
    expect(getBotAction({ ...rest, phase: 'scoring' } as StudVisibleState, seeded(1), 'hard')).toBeNull();
  });

  it('answers a human timeout and a repeated bot failure with check or fold', () => {
    stud.startGame(CODE, players(['N', 'E', 'S']), seeded(7), 0);
    const seat = stud.getGameState(CODE)!.currentTurnSeat;
    const view = stud.getPlayerVisibleState(CODE, seat)!;
    const bot = gameBot('stud');
    expect(studAction(bot.turnTimeout!(view, { isBot: false, strategy: () => null }))).toEqual({ type: 'check' });
    expect(studAction(bot.firstLegal(view))).toEqual({ type: 'check' });
    // Facing a bet, the passive default folds
    expect(stud.act(CODE, seat, { type: 'raise', to: 20 }, 0).success).toBe(true);
    const next = stud.getGameState(CODE)!.currentTurnSeat;
    expect(studAction(bot.firstLegal(stud.getPlayerVisibleState(CODE, next)!))).toEqual({ type: 'fold' });
  });

  it('decides each Hard turn within a small time budget, even at a full table', () => {
    const seats = GAME_SEAT_ORDER;
    const random = seeded(99);
    stud.startGame(CODE, players(seats), random, 0);
    const view = stud.getPlayerVisibleState(CODE, stud.getGameState(CODE)!.currentTurnSeat)!;
    const start = performance.now();
    for (let run = 0; run < 20; run++) getBotAction(view, random, 'hard');
    expect((performance.now() - start) / 20).toBeLessThan(50);
  });
});

describe('stud equity', () => {
  it('rates a pair of aces well above a scattered hand heads-up', () => {
    const random = seeded(4);
    const strong = studEquity({
      own: [card(14), card(14, 'hearts'), card(13, 'clubs')],
      opponents: [{ up: [card(7, 'diamonds'), card(2, 'clubs')] }],
      visible: [card(14, 'hearts'), card(13, 'clubs'), card(7, 'diamonds'), card(2, 'clubs')], random,
    });
    const weak = studEquity({
      own: [card(3), card(8, 'hearts'), card(2, 'clubs')],
      opponents: [{ up: [card(14, 'diamonds'), card(14, 'clubs')] }],
      visible: [card(8, 'hearts'), card(2, 'clubs'), card(14, 'diamonds'), card(14, 'clubs')], random,
    });
    expect(strong).toBeGreaterThan(0.75);
    expect(weak).toBeLessThan(0.2);
  });

  it('is certain with no opponents and uncertain against a live opponent', () => {
    expect(studEquity({ own: [card(5)], opponents: [], visible: [], random: seeded(1) })).toBe(1);
    const even = studEquity({
      own: [card(9), card(9, 'hearts')], opponents: [{ up: [card(9, 'clubs')] }],
      visible: [card(9, 'hearts'), card(9, 'clubs')], random: seeded(2), runs: 600,
    });
    expect(even).toBeGreaterThan(0);
    expect(even).toBeLessThan(1);
  });
});
