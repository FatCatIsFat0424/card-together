import { describe, expect, it } from 'vitest';
import type { CodeBreakerGameState, CodeBreakerVisibleState, GameSeat, PlayerInfo } from '@shared/types';
import {
  CB_MAX_GUESSES, cbConsistent, cbFeedback, cbRandomCode, isCbCode,
} from '@shared/rules/codebreaker';
import type { CbCode, CbVariant } from '@shared/rules/codebreaker';
import * as codebreaker from '../../src/managers/games/codebreaker-game';
import { getBotAction } from '../../src/bots/bot-decisions';
import type { BotAction } from '../../src/bots/bot-decisions';
import { gameBot } from '../../src/bots/bot-registry';
import {
  codeBreakerFirstLegalAction, consistentCodes, easyCodeBreakerAction, getCodeBreakerBotAction, knownGuesses,
} from '../../src/bots/codebreaker-strategy';
import { seededRandom } from '../../src/bots/search/seeded-random';

const CODE = 'CBBOT1';

function player(seat: GameSeat): PlayerInfo {
  return { id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null, isBot: true };
}

function codeOf(action: BotAction | null): CbCode {
  if (action?.type !== 'game-action' || action.request.gameType !== 'codebreaker') throw new Error('Expected a Code Breaker action');
  return action.request.action.code;
}

/** A solo seat's view, built from nothing but its own guesses and the feedback they earned. */
function soloView(variant: CbVariant, history: readonly { code: CbCode; exact: number; partial: number }[]): CodeBreakerVisibleState {
  return {
    gameType: 'codebreaker', phase: 'playing', mySeat: 'N', seats: ['N', 'S'], options: { variant }, round: history.length + 1,
    roundDeadline: 1, progress: { N: { used: history.length, solved: false, submitted: false }, S: { used: 0, solved: false, submitted: false } },
    pendingGuess: null,
    histories: { N: history.map((entry, index) => ({ ...entry, round: index + 1, auto: false })) },
    secret: null, log: [], result: null,
  };
}

/** Guesses to crack `secret` alone with a strategy, or null when it needs more than the cap. */
function solveAlone(
  variant: CbVariant, secret: CbCode, difficulty: 'easy' | 'hard', random: () => number,
): number | null {
  const history: { code: CbCode; exact: number; partial: number }[] = [];
  for (let used = 1; used <= CB_MAX_GUESSES; used++) {
    const code = codeOf(getBotAction(soloView(variant, history), random, difficulty));
    expect(isCbCode(code, variant)).toBe(true);
    const feedback = cbFeedback(secret, code);
    if (feedback.exact === 4) return used;
    history.push({ code, ...feedback });
  }
  return null;
}

describe('Code Breaker bot legality', () => {
  it('only ever guesses well-formed codes that fit its own feedback', () => {
    const random = seededRandom(3);
    for (const variant of ['digits', 'colors'] as const) {
      const secret = cbRandomCode(variant, random);
      const history: { code: CbCode; exact: number; partial: number }[] = [];
      for (let used = 1; used <= 6; used++) {
        for (const difficulty of ['easy', 'hard'] as const) {
          const code = codeOf(getBotAction(soloView(variant, history), random, difficulty));
          expect(isCbCode(code, variant)).toBe(true);
          if (difficulty === 'easy') expect(cbConsistent(code, history)).toBe(true);
        }
        const code = codeOf(easyCodeBreakerAction(soloView(variant, history), random));
        history.push({ code, ...cbFeedback(secret, code) });
      }
    }
  });

  it('returns nothing when the seat owes no guess and a legal fallback otherwise', () => {
    const base = soloView('digits', []);
    expect(getCodeBreakerBotAction({ ...base, pendingGuess: [0, 1, 2, 3] }, Math.random)).toBeNull();
    expect(easyCodeBreakerAction({ ...base, phase: 'scoring' }, Math.random)).toBeNull();
    expect(codeBreakerFirstLegalAction({ ...base, progress: { N: { used: 10, solved: false, submitted: false } } })).toBeNull();
    expect(codeBreakerFirstLegalAction({ ...base, progress: { N: { used: 2, solved: true, submitted: false } } })).toBeNull();
    expect(codeOf(codeBreakerFirstLegalAction(base))).toEqual([0, 1, 2, 3]);
    const guess = { code: [0, 1, 2, 3], exact: 0, partial: 0 };
    expect(isCbCode(codeOf(codeBreakerFirstLegalAction(soloView('colors', [{ ...guess, code: [0, 1, 2, 3] }]))), 'colors')).toBe(true);
    expect(gameBot('codebreaker').firstLegal(base)).not.toBeNull();
  });

  it('keeps each hard decision well under the 50 ms budget, also right after a weak first guess', () => {
    const random = seededRandom(5);
    for (const variant of ['digits', 'colors'] as const) {
      const secret = cbRandomCode(variant, random);
      const first = codeOf(easyCodeBreakerAction(soloView(variant, []), random));
      const view = soloView(variant, [{ code: first, ...cbFeedback(secret, first) }]);
      const started = performance.now();
      for (let index = 0; index < 5; index++) getCodeBreakerBotAction(view, random);
      expect((performance.now() - started) / 5).toBeLessThan(50);
    }
  });
});

describe('Code Breaker bots see only their own feedback', () => {
  it('decides from a filtered view that holds no secret and no other seat guesses', () => {
    const players = { N: player('N'), E: player('E'), S: player('S') };
    codebreaker.startGame(CODE, players, { variant: 'digits' }, 60_000, 1_000, seededRandom(21));
    const game = codebreaker.getGameState(CODE) as CodeBreakerGameState;
    for (const seat of ['N', 'E', 'S'] as const) {
      expect(codebreaker.guess(CODE, seat, [0, 1, 2, 3], false, 2_000)).toEqual({ success: true });
    }
    const view = codebreaker.getPlayerVisibleState(CODE, 'N')!;
    expect(view.secret).toBeNull();
    expect(Object.keys(view.histories)).toEqual(['N']);
    expect(JSON.stringify(view)).not.toContain(`"secret":[${game.secret.join(',')}]`);

    // The decision depends on the view only: the same view under a different hidden secret gives the same guess.
    const other = { ...view, secret: null };
    expect(codeOf(getCodeBreakerBotAction(view, seededRandom(1)))).toEqual(codeOf(getCodeBreakerBotAction(other, seededRandom(1))));
    expect(consistentCodes(view).every((code) => cbConsistent(code, knownGuesses(view)))).toBe(true);
    codebreaker.abortGame(CODE);
  });
});

describe('Code Breaker bot strength', () => {
  const GAMES = 150;

  function average(variant: CbVariant, difficulty: 'easy' | 'hard'): { mean: number; solved: number } {
    let total = 0;
    let solved = 0;
    for (let seed = 1; seed <= GAMES; seed++) {
      const random = seededRandom(seed * 7919 + (variant === 'digits' ? 1 : 2));
      const secret = cbRandomCode(variant, seededRandom(seed * 31 + 9));
      const used = solveAlone(variant, secret, difficulty, random);
      if (used !== null) {
        solved++;
        total += used;
      }
    }
    return { mean: total / Math.max(1, solved), solved };
  }

  for (const variant of ['digits', 'colors'] as const) {
    it(`solves ${variant} within ten guesses in a large majority of seeded games, and hard needs fewer than easy`, () => {
      const easy = average(variant, 'easy');
      const hard = average(variant, 'hard');
      expect(easy.solved / GAMES).toBeGreaterThan(0.9);
      expect(hard.solved / GAMES).toBeGreaterThan(0.97);
      expect(hard.mean).toBeLessThan(easy.mean);
    }, 60_000);
  }
});
