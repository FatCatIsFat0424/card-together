import { afterEach, describe, expect, it } from 'vitest';
import type { BotDifficulty, GameSeat, PlayerInfo } from '@shared/types';
import type { YachtGameAction } from '@shared/games/yacht/actions';
import type { YachtTurn, YachtVisibleState } from '@shared/games/yacht/types';
import { EMPTY_YACHT_SCORECARD, YACHT_BOXES, yachtLegalBoxes, yachtTotals } from '@shared/rules/yacht';
import type { YachtFace, YachtScorecard } from '@shared/rules/yacht';
import { getBotAction } from '../../src/bots/bot-decisions';
import type { BotAction } from '../../src/bots/bot-decisions';
import { GAME_BOTS } from '../../src/bots/bot-registry';
import { yachtFirstLegalAction, yachtTimeoutAction } from '../../src/bots/yacht-strategy';
import { yachtPlan } from '../../src/bots/yacht-lookahead';
import * as yacht from '../../src/managers/games/yacht-game';

const CODE = 'YBOT01';

function player(seat: GameSeat): PlayerInfo {
  return { id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null, isBot: true };
}

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function actionOf(action: BotAction | null): YachtGameAction {
  if (action?.type !== 'game-action' || action.request.gameType !== 'yacht') throw new Error('Expected a Yacht Dice action');
  return action.request.action;
}

const dice = (...faces: number[]): YachtFace[] => faces as YachtFace[];

/** A turn-mode view of seat N with the given dice and card. */
function view(faces: readonly number[], rolls: number, card: YachtScorecard = EMPTY_YACHT_SCORECARD, held = [false, false, false, false, false]): YachtVisibleState {
  const turn: YachtTurn = { dice: faces as YachtFace[], held, rolls, done: false };
  return {
    gameType: 'yacht', phase: 'playing', mySeat: 'N', seats: ['N', 'S'], options: { mode: 'turns' }, round: 1,
    currentTurnSeat: 'N', roundDeadline: null, turns: { N: turn, S: { ...turn, dice: [], rolls: 0 } },
    cards: { N: card, S: EMPTY_YACHT_SCORECARD }, log: [], result: null,
  };
}

/** Plays solo matches through the real game module and returns each final total. */
function totals(difficulty: BotDifficulty, games: number, mode: 'turns' | 'simultaneous' = 'turns'): { scores: number[]; slowest: number } {
  const scores: number[] = [];
  let slowest = 0;
  for (let seed = 1; seed <= games; seed++) {
    const random = seeded(seed);
    const players = { N: player('N'), S: player('S') };
    yacht.startGame(CODE, players, { mode }, 60_000, 1);
    for (let step = 0; step < 400 && !yacht.getGameState(CODE)!.result; step++) {
      const state = yacht.getGameState(CODE)!;
      const seat = mode === 'turns' ? state.currentTurnSeat! : yacht.pendingSeats(state)[0];
      const began = performance.now();
      const action = actionOf(getBotAction(yacht.getPlayerVisibleState(CODE, seat)!, random, difficulty));
      slowest = Math.max(slowest, performance.now() - began);
      const result = action.type === 'roll' ? yacht.roll(CODE, seat, action.held, random)
        : action.type === 'score' ? yacht.score(CODE, seat, action.box) : { success: false as const, reason: action.type };
      expect(result).toEqual({ success: true });
    }
    const final = yacht.getGameState(CODE)!;
    expect(final.phase).toBe('scoring');
    scores.push(...(['N', 'S'] as const).map((seat) => yachtTotals(final.cards[seat]!).total));
    yacht.abortGame(CODE);
  }
  return { scores, slowest };
}

const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

afterEach(() => yacht.abortGame(CODE));

describe('Yacht Dice bots', () => {
  it('registers a bot with both difficulties, a timeout, and a deadline action', () => {
    expect(GAME_BOTS.yacht.hard).toBeTypeOf('function');
    expect(GAME_BOTS.yacht.easy).toBeTypeOf('function');
    expect(GAME_BOTS.yacht.turnTimeout).toBe(yachtTimeoutAction);
    expect(GAME_BOTS.yacht.deadlineExpired).toBe(yachtTimeoutAction);
  });

  it('finishes complete matches in both modes with legal actions only, for both difficulties', () => {
    for (const difficulty of ['easy', 'hard'] as const) {
      for (const mode of ['turns', 'simultaneous'] as const) {
        const { scores } = totals(difficulty, 4, mode);
        expect(scores).toHaveLength(8);
        for (const score of scores) expect(score).toBeGreaterThan(0);
      }
    }
  });

  it('scores clearly higher on average with the hard bot than with the easy bot', () => {
    const easy = mean(totals('easy', 30).scores);
    const hard = mean(totals('hard', 30).scores);
    expect(hard).toBeGreaterThan(easy + 40);
    expect(hard).toBeGreaterThan(200);
    expect(easy).toBeGreaterThan(100);
  });

  it('decides quickly enough to run on the main thread', () => {
    const { scores, slowest } = totals('hard', 5);
    expect(scores).toHaveLength(10);
    expect(slowest).toBeLessThan(150);
  });

  it('rolls first, then writes the dice once no rolls are left', () => {
    expect(actionOf(getBotAction(view([], 0), seeded(1), 'hard'))).toEqual({ type: 'roll' });
    expect(actionOf(getBotAction(view([], 0), seeded(1), 'easy'))).toEqual({ type: 'roll' });
    for (const difficulty of ['easy', 'hard'] as const) {
      const action = actionOf(getBotAction(view([1, 2, 3, 4, 5], 3), seeded(1), difficulty));
      expect(action).toEqual({ type: 'score', box: 'largeStraight' });
    }
  });

  it('keeps a made Yacht and a made straight instead of rolling again', () => {
    expect(actionOf(getBotAction(view([6, 6, 6, 6, 6], 1), seeded(1), 'hard'))).toEqual({ type: 'score', box: 'yacht' });
    expect(actionOf(getBotAction(view([1, 2, 3, 4, 5], 1), seeded(1), 'hard'))).toEqual({ type: 'score', box: 'largeStraight' });
  });

  it('keeps the matching dice when chasing a kind and rerolls the rest', () => {
    const action = actionOf(getBotAction(view([6, 6, 6, 2, 3], 1), seeded(1), 'hard'));
    expect(action).toEqual({ type: 'roll', held: [true, true, true, false, false] });
    const easy = actionOf(getBotAction(view([4, 4, 1, 4, 3], 1), seeded(1), 'easy'));
    expect(easy).toEqual({ type: 'roll', held: [true, true, false, true, false] });
  });

  it('plans to keep a pair of sixes and reroll the rest while two rolls remain', () => {
    const plan = yachtPlan(EMPTY_YACHT_SCORECARD, dice(6, 6, 1, 2, 3), 2);
    expect(plan.stop).toBe(false);
    expect(plan.held).toEqual([true, true, false, false, false]);
  });

  it('rerolls the odd die of four of a kind, since keeping the four can only improve', () => {
    const plan = yachtPlan(EMPTY_YACHT_SCORECARD, dice(5, 5, 5, 5, 2), 1);
    expect(plan.stop).toBe(false);
    expect(plan.held).toEqual([true, true, true, true, false]);
    expect(plan.box).toBe('fourKind');
  });

  it('follows the joker rule when it writes an extra Yacht', () => {
    const card: YachtScorecard = { boxes: { yacht: 50 }, extraYachts: 0 };
    for (const difficulty of ['easy', 'hard'] as const) {
      expect(actionOf(getBotAction(view([3, 3, 3, 3, 3], 1, card), seeded(1), difficulty))).toEqual({ type: 'score', box: 'threes' });
    }
  });

  it('always names a legal box, whatever the dice and the card', () => {
    const random = seeded(77);
    for (let trial = 0; trial < 200; trial++) {
      const filled = YACHT_BOXES.filter(() => random() < 0.5);
      const card: YachtScorecard = { boxes: Object.fromEntries(filled.map((box) => [box, 0])), extraYachts: 0 };
      if (filled.length === YACHT_BOXES.length) continue;
      const faces = Array.from({ length: 5 }, () => Math.floor(random() * 6) + 1);
      const rolls = 1 + Math.floor(random() * 3);
      for (const difficulty of ['easy', 'hard'] as const) {
        const action = actionOf(getBotAction(view(faces, rolls, card), random, difficulty));
        if (action.type === 'score') expect(yachtLegalBoxes(card, faces as YachtFace[])).toContain(action.box);
        else {
          expect(action.type).toBe('roll');
          expect(rolls).toBeLessThan(3);
          expect((action as { held?: boolean[] }).held?.every(Boolean)).toBe(false);
        }
      }
    }
  });

  it('acts only for the seat that owes a decision', () => {
    const waiting = { ...view([1, 2, 3, 4, 5], 1), currentTurnSeat: 'S' as const };
    expect(getBotAction(waiting, seeded(1), 'hard')).toBeNull();
    expect(getBotAction(waiting, seeded(1), 'easy')).toBeNull();
    expect(yachtFirstLegalAction(waiting)).toBeNull();
    expect(yachtTimeoutAction(waiting)).toBeNull();
    const done = view([1, 2, 3, 4, 5], 1);
    expect(getBotAction({ ...done, turns: { N: { ...done.turns.N!, done: true } } }, seeded(1), 'hard')).toBeNull();
    expect(getBotAction({ ...done, phase: 'scoring' }, seeded(1), 'hard')).toBeNull();
    // Simultaneous rounds ask every seat that has not scored.
    expect(getBotAction({ ...waiting, options: { mode: 'simultaneous' }, currentTurnSeat: null }, seeded(1), 'hard')).not.toBeNull();
  });

  it('offers a legal first move and a whole-turn timeout action', () => {
    expect(actionOf(yachtFirstLegalAction(view([], 0)))).toEqual({ type: 'roll' });
    const card: YachtScorecard = { boxes: { ones: 1 }, extraYachts: 0 };
    expect(actionOf(yachtFirstLegalAction(view([1, 2, 3, 4, 5], 1, card)))).toEqual({ type: 'score', box: 'twos' });
    expect(actionOf(yachtTimeoutAction(view([], 0)))).toEqual({ type: 'auto' });
  });
});
