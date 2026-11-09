import { describe, expect, it } from 'vitest';
import type { CodeBreakerMatchResult, CodeBreakerVisibleState } from '@shared/types';
import {
  EMPTY_DRAFT, backspace, codeBreakerNeedsGuess, draftCode, padSymbols, placeSymbol, seatView, seatsStillGuessing,
  selectSlot, symbolTaken,
} from '../../../client/src/games/codebreaker/codebreaker-view';
import { clientGame } from '../../../client/src/games/registry';

function state(overrides: Partial<CodeBreakerVisibleState> = {}): CodeBreakerVisibleState {
  return {
    gameType: 'codebreaker', phase: 'playing', mySeat: 'N', seats: ['N', 'E', 'S'], options: { variant: 'digits' }, round: 3,
    roundDeadline: 1, pendingGuess: null, histories: { N: [] }, secret: null, log: [], result: null,
    progress: {
      N: { used: 2, solved: false, submitted: false },
      E: { used: 2, solved: true, submitted: false },
      S: { used: 10, solved: false, submitted: false },
    },
    ...overrides,
  };
}

describe('Code Breaker seat status', () => {
  it('asks only seats that are neither solved nor out of guesses and have not guessed this round', () => {
    const game = state();
    expect(seatView(game, 'N')).toMatchObject({ owes: true, solved: false, outOfGuesses: false });
    expect(seatView(game, 'E')).toMatchObject({ owes: false, solved: true });
    expect(seatView(game, 'S')).toMatchObject({ owes: false, outOfGuesses: true });
    expect(seatView(game, 'W')).toBeNull();
    expect(seatsStillGuessing(game)).toBe(1);
    expect(codeBreakerNeedsGuess(game)).toBe(true);
    expect(codeBreakerNeedsGuess({ ...game, observer: 'spectator' })).toBe(false);
    const submitted = state({ progress: { ...game.progress, N: { used: 2, solved: false, submitted: true } } });
    expect(seatView(submitted, 'N')?.owes).toBe(false);
    expect(codeBreakerNeedsGuess(submitted)).toBe(false);
    expect(codeBreakerNeedsGuess({ ...game, phase: 'scoring' })).toBe(false);
  });
});

describe('Code Breaker entry', () => {
  it('fills slots left to right and finishes with a complete code', () => {
    let draft = EMPTY_DRAFT;
    expect(draftCode(draft)).toBeNull();
    for (const symbol of [4, 2, 7, 0]) draft = placeSymbol(draft, symbol, 'digits');
    expect(draft.slots).toEqual([4, 2, 7, 0]);
    expect(draftCode(draft)).toEqual([4, 2, 7, 0]);
  });

  it('refuses a digit already in another slot but lets a selected slot be replaced', () => {
    let draft = placeSymbol(placeSymbol(EMPTY_DRAFT, 4, 'digits'), 2, 'digits');
    expect(symbolTaken(draft, 4, 'digits')).toBe(true);
    expect(placeSymbol(draft, 4, 'digits')).toBe(draft);
    draft = selectSlot(draft, 0);
    expect(symbolTaken(draft, 4, 'digits')).toBe(false);
    expect(placeSymbol(draft, 4, 'digits').slots[0]).toBe(4);
    expect(placeSymbol(draft, 9, 'digits').slots).toEqual([9, 2, null, null]);
  });

  it('allows repeated colours', () => {
    let draft = EMPTY_DRAFT;
    for (let index = 0; index < 4; index++) draft = placeSymbol(draft, 3, 'colors');
    expect(draftCode(draft)).toEqual([3, 3, 3, 3]);
    expect(padSymbols('colors')).toEqual([0, 1, 2, 3, 4, 5]);
    expect(padSymbols('digits')).toHaveLength(10);
  });

  it('deletes the selected slot, or the last filled one when the selected slot is empty', () => {
    let draft = EMPTY_DRAFT;
    for (const symbol of [1, 2, 3]) draft = placeSymbol(draft, symbol, 'digits');
    expect(draft.cursor).toBe(3);
    draft = backspace(draft);
    expect(draft.slots).toEqual([1, 2, null, null]);
    expect(backspace(selectSlot(draft, 0)).slots).toEqual([null, 2, null, null]);
    expect(backspace(EMPTY_DRAFT)).toBe(EMPTY_DRAFT);
    expect(selectSlot(draft, 9)).toBe(draft);
  });
});

describe('Code Breaker client module', () => {
  it('summarizes a finished match by its winners and guesses, or by nobody cracking it', () => {
    const t = ((key: string, params?: Record<string, string>) => `${key}${params ? JSON.stringify(params) : ''}`) as never;
    const base: Omit<CodeBreakerMatchResult, 'guesses' | 'solved' | 'winners'> = {
      gameType: 'codebreaker', seats: ['N', 'E'], variant: 'digits', secret: [1, 2, 3, 4], rounds: 4,
    };
    const { summary } = clientGame('codebreaker').result;
    expect(summary({ ...base, guesses: { N: 4, E: 10 }, solved: ['N'], winners: ['N'] }, 'N', t))
      .toEqual({ kind: 'winners', winners: ['N'], suffix: 'codebreaker.summaryGuesses{"n":"4"}' });
    expect(summary({ ...base, guesses: { N: 10, E: 10 }, solved: [], winners: [] }, 'N', t))
      .toEqual({ kind: 'text', text: 'codebreaker.noWinner' });
  });
});
