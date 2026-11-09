import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodeBreakerGameState, CodeBreakerVisibleState, GameSeat, PlayerInfo, RoomCode } from '@shared/types';
import { gameDefinition } from '@shared/games/registry';
import { parseGameAction } from '@shared/games/actions';
import { matchStanding } from '@shared/rules/match-standing';
import { CB_MAX_GUESSES, cbFeedback, isCbCode } from '@shared/rules/codebreaker';
import type { CbCode, CodeBreakerOptions } from '@shared/rules/codebreaker';
import { codeBreakerFacts } from '@shared/stats/codebreaker';
import * as codebreaker from '../../src/managers/games/codebreaker-game';
import { codeBreakerAdapter } from '../../src/managers/games/codebreaker-adapter';
import {
  codeBreakerGame, coherentCodeBreakerGame, isCodeBreakerResult,
} from '../../src/managers/games/codebreaker-validation';
import { gameValidator } from '../../src/managers/games/validation-registry';
import { getBotAction } from '../../src/bots/bot-decisions';
import { seededRandom } from '../../src/bots/search/seeded-random';
import * as games from '../../src/managers/game-manager';
import * as rooms from '../../src/managers/room-manager';
import * as players from '../../src/managers/player-manager';
import { createRuntimeCoordinator } from '../../src/runtime/coordinator';
import { startSharedDeadlines } from '../../src/runtime/shared-deadline';
import { captureReplaySnapshot } from '../../src/runtime/replay-recording';
import type { RuntimeSnapshot } from '../../src/runtime/types';
import { isRuntimeSnapshot } from '../../src/runtime/validate';

const CODE = 'CBREAK';
const ROUND_MS = 60_000;

function player(seat: GameSeat, isBot = false): PlayerInfo {
  return { id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
    ...isBot ? { isBot: true } : {} };
}

function start(
  seats: readonly GameSeat[] = ['N', 'S'], options: CodeBreakerOptions = { variant: 'digits' }, bots = false, seed = 5,
): void {
  codebreaker.startGame(CODE, Object.fromEntries(seats.map((seat) => [seat, player(seat, bots)])), options, ROUND_MS,
    1_000, seededRandom(seed));
}

function game(): CodeBreakerGameState {
  const state = codebreaker.getGameState(CODE);
  if (!state) throw new Error('Expected a Code Breaker game');
  return state;
}

const view = (seat: GameSeat): CodeBreakerVisibleState => codebreaker.getPlayerVisibleState(CODE, seat)!;
const coherent = (): boolean => coherentCodeBreakerGame(structuredClone(game()));
const submit = (seat: GameSeat, code: CbCode, automatic = false, now = 2_000) => codebreaker.guess(CODE, seat, code, automatic, now);

/** A well-formed code that is not the secret. */
function wrong(): CbCode {
  const secret = game().secret;
  return secret.join() === '0,1,2,3' ? [4, 5, 6, 7] : [0, 1, 2, 3];
}

/** Every active seat guesses `code` for its seat, resolving the round. */
function roundOf(codes: Partial<Record<GameSeat, CbCode>>): void {
  for (const seat of codebreaker.pendingSeats(game())) expect(submit(seat, codes[seat] ?? wrong())).toEqual({ success: true });
}

afterEach(() => {
  codebreaker.abortGame(CODE);
});

describe('Code Breaker setup', () => {
  it('registers a two to six player puzzle game with a digits or colours room rule', () => {
    const definition = gameDefinition('codebreaker');
    expect(definition).toMatchObject({
      category: 'puzzle', equipment: [],
      seats: { minPlayers: 2, maxPlayers: 6, flexible: true, expandable: true, numbered: false },
      options: { defaults: { variant: 'digits' } },
    });
    expect(definition.matchControls).toBeUndefined();
    expect(definition.options!.isValid({ variant: 'colors' })).toBe(true);
    expect(definition.options!.isValid({ variant: 'hex' })).toBe(false);
  });

  it('draws one secret per match from the injected generator, unrelated to the room or game id', () => {
    start(['N', 'S'], { variant: 'digits' }, false, 5);
    const first = [...game().secret];
    const id = game().id;
    codebreaker.abortGame(CODE);
    start(['N', 'S'], { variant: 'digits' }, false, 5);
    expect(game().secret).toEqual(first);
    expect(game().id).not.toBe(id);
    codebreaker.abortGame(CODE);
    start(['N', 'S'], { variant: 'digits' }, false, 6);
    expect(game().secret).not.toEqual(first);
    expect(isCbCode(game().secret, 'digits')).toBe(true);
  });

  it('draws a fresh secret from the operating system when no generator is injected', () => {
    const secrets = new Set<string>();
    for (let index = 0; index < 30; index++) {
      codebreaker.startGame(CODE, { N: player('N'), S: player('S') }, { variant: 'colors' }, ROUND_MS, 1_000);
      secrets.add(game().secret.join());
      expect(isCbCode(game().secret, 'colors')).toBe(true);
      codebreaker.abortGame(CODE);
    }
    expect(secrets.size).toBeGreaterThan(10);
  });

  it('starts in round one with every seat owing a guess against one deadline', () => {
    start(['N', 'E', 'P5']);
    expect(game()).toMatchObject({ phase: 'playing', round: 1, roundDeadline: 1_000 + ROUND_MS, log: [], result: null });
    expect(codebreaker.pendingSeats(game())).toEqual(['N', 'E', 'P5']);
    expect(view('E').progress).toEqual({
      N: { used: 0, solved: false, submitted: false }, E: { used: 0, solved: false, submitted: false },
      P5: { used: 0, solved: false, submitted: false },
    });
  });
});

describe('Code Breaker rounds', () => {
  it('holds guesses until every active seat has guessed, then answers all of them at once', () => {
    start(['N', 'E', 'S']);
    const secret = game().secret;
    expect(submit('N', [0, 1, 2, 3])).toEqual({ success: true });
    expect(view('N').pendingGuess).toEqual([0, 1, 2, 3]);
    expect(view('N').histories.N).toEqual([]);
    expect(view('E').progress.N).toEqual({ used: 0, solved: false, submitted: true });
    expect(submit('E', [4, 5, 6, 7])).toEqual({ success: true });
    expect(game().round).toBe(1);
    expect(submit('S', [8, 9, 0, 1])).toEqual({ success: true });
    expect(game().round).toBe(2);
    expect(game().roundDeadline).toBe(2_000 + ROUND_MS);
    expect(view('N').histories.N).toEqual([{ round: 1, code: [0, 1, 2, 3], ...cbFeedback(secret, [0, 1, 2, 3]), auto: false }]);
    expect(view('N').pendingGuess).toBeNull();
    expect(game().log.map((entry) => entry.seat)).toEqual(['N', 'E', 'S']);
    expect(coherent()).toBe(true);
  });

  it('allows one guess per seat and round and rejects malformed, outsider, and late manual guesses', () => {
    start(['N', 'E']);
    expect(submit('N', [0, 1, 2, 3])).toEqual({ success: true });
    expect(submit('N', [4, 5, 6, 7])).toEqual({ success: false, reason: 'You already guessed this round' });
    expect(submit('E', [1, 1, 2, 3])).toEqual({ success: false, reason: 'Invalid guess' });
    expect(submit('E', [0, 1, 2])).toEqual({ success: false, reason: 'Invalid guess' });
    expect(submit('E', [0, 1, 2, 10])).toEqual({ success: false, reason: 'Invalid guess' });
    expect(submit('S', [0, 1, 2, 3])).toEqual({ success: false, reason: 'Only players in this match can guess.' });
    expect(submit('E', [4, 5, 6, 7], false, game().roundDeadline)).toEqual({ success: false, reason: 'The round time is over' });
    expect(submit('E', [4, 5, 6, 7], true, game().roundDeadline)).toEqual({ success: true });
    expect(game().log.find((entry) => entry.seat === 'E')).toMatchObject({ auto: true });
    expect(game().log.find((entry) => entry.seat === 'N')).toMatchObject({ auto: false });
  });

  it('accepts repeated colours but not repeated digits, and does not require guesses to fit earlier feedback', () => {
    start(['N', 'E'], { variant: 'colors' });
    expect(submit('N', [2, 2, 2, 2])).toEqual({ success: true });
    expect(submit('E', [1, 1, 5, 5])).toEqual({ success: true });
    expect(game().log.map((entry) => entry.code)).toEqual([[2, 2, 2, 2], [1, 1, 5, 5]]);
    // Nothing forces the next guess to fit the feedback of the last.
    expect(submit('N', [2, 2, 2, 2])).toEqual({ success: true });
    expect(view('N').pendingGuess).toEqual([2, 2, 2, 2]);
  });

  it('stops asking a solver while the others keep guessing, and ends when nobody can guess again', () => {
    start(['N', 'E', 'S']);
    const secret = game().secret;
    roundOf({ N: secret, E: wrong(), S: wrong() });
    expect(view('S').progress.N).toEqual({ used: 1, solved: true, submitted: false });
    expect(codebreaker.pendingSeats(game())).toEqual(['E', 'S']);
    expect(submit('N', wrong())).toEqual({ success: false, reason: 'You have no guesses left to make.' });
    roundOf({ E: secret, S: wrong() });
    expect(game().round).toBe(3);
    expect(game().phase).toBe('playing');
    roundOf({ S: secret });
    expect(game()).toMatchObject({ phase: 'scoring', round: 3 });
    expect(game().result).toMatchObject({
      seats: ['N', 'E', 'S'], solved: ['N', 'E', 'S'], winners: ['N'], guesses: { N: 1, E: 2, S: 3 }, rounds: 3, secret,
    });
    expect(coherent()).toBe(true);
    expect(submit('N', wrong())).toEqual({ success: false, reason: 'The game is over' });
  });

  it('shares the win between solvers with the fewest guesses and ranks the rest behind them', () => {
    start(['N', 'E', 'S', 'W']);
    const secret = game().secret;
    roundOf({ N: wrong(), E: wrong(), S: wrong(), W: wrong() });
    roundOf({ N: secret, E: secret, S: wrong(), W: wrong() });
    for (let round = 3; round <= CB_MAX_GUESSES; round++) roundOf({ S: round === 4 ? secret : wrong(), W: wrong() });
    const result = game().result!;
    expect(result).toMatchObject({ winners: ['N', 'E'], solved: ['N', 'E', 'S'], guesses: { N: 2, E: 2, S: 4, W: 10 } });
    const ranks = (['N', 'E', 'S', 'W'] as const).map((seat) => matchStanding(result, seat)!);
    expect(ranks.map((standing) => standing.rank)).toEqual([1, 1, 3, 4]);
    expect(ranks.map((standing) => standing.won)).toEqual([true, true, false, false]);
    expect(ranks[0].tied).toBe(true);
    expect(coherent()).toBe(true);
  });

  it('ends after ten guesses each with nobody winning when nobody cracks the code', () => {
    start(['N', 'E']);
    for (let round = 1; round <= CB_MAX_GUESSES; round++) {
      expect(game().phase).toBe('playing');
      roundOf({});
    }
    expect(game().phase).toBe('scoring');
    const result = game().result!;
    expect(result).toMatchObject({ solved: [], winners: [], guesses: { N: 10, E: 10 }, rounds: 10 });
    for (const seat of ['N', 'E'] as const) {
      expect(matchStanding(result, seat)).toMatchObject({ rank: 1, tied: true, won: false });
      expect(codeBreakerFacts(result, seat).counts).toEqual({});
    }
    expect(isCodeBreakerResult(result)).toBe(true);
    expect(coherent()).toBe(true);
  });
});

describe('Code Breaker hidden information', () => {
  it('never puts the secret or another seat guess in a seated view before the end', () => {
    start(['N', 'E', 'S']);
    const secret = game().secret;
    roundOf({ N: [0, 1, 2, 3], E: [4, 5, 6, 7], S: [8, 9, 0, 1] });
    expect(submit('N', [3, 2, 1, 0])).toEqual({ success: true });
    for (const seat of ['N', 'E', 'S'] as const) {
      const seen = view(seat);
      expect(seen.secret).toBeNull();
      expect(seen.observer).toBeUndefined();
      expect(Object.keys(seen.histories)).toEqual([seat]);
      expect(seen.log.every((entry) => Object.keys(entry).sort().join() === 'round,seat,solved,timestamp')).toBe(true);
      const text = JSON.stringify(seen);
      expect(text).not.toContain(`"secret":[${secret.join(',')}]`);
      expect(text).not.toContain('"pending"');
    }
    expect(JSON.stringify(view('E'))).not.toContain('[0,1,2,3]');
    expect(JSON.stringify(view('E'))).not.toContain('[3,2,1,0]');
    expect(view('E').progress.N).toEqual({ used: 1, solved: false, submitted: true });
    expect(view('E').pendingGuess).toBeNull();
  });

  it('gives unseated spectators and replays the secret and every history, but never a seated view', () => {
    start(['N', 'E']);
    const secret = game().secret;
    roundOf({ N: [0, 1, 2, 3], E: [4, 5, 6, 7] });
    const spectator = codeBreakerAdapter.withObserverView(view('N'), game(), 'spectator');
    expect(spectator).toMatchObject({ observer: 'spectator', secret });
    expect(Object.keys(spectator.histories)).toEqual(['N', 'E']);
    expect(view('N').secret).toBeNull();
    expect(Object.keys(view('N').histories)).toEqual(['N']);
  });

  it('reveals the secret and every history to everyone when the match is over', () => {
    start(['N', 'E']);
    const secret = game().secret;
    roundOf({ N: secret, E: wrong() });
    roundOf({ E: secret });
    expect(view('N').secret).toEqual(secret);
    expect(Object.keys(view('N').histories)).toEqual(['N', 'E']);
    expect(view('E').histories.N?.[0]).toMatchObject({ code: secret, exact: 4 });
    expect(view('N').result?.winners).toEqual(['N']);
  });

  it('feeds bots only their own filtered view and parses actions', () => {
    start(['N', 'E'], { variant: 'digits' }, true);
    const action = getBotAction(view('N'), seededRandom(2), 'hard');
    expect(action).toMatchObject({ type: 'game-action', request: { gameType: 'codebreaker', action: { type: 'guess' } } });
    expect(parseGameAction({ gameType: 'codebreaker', action: { type: 'guess', code: [1, 2, 3, 4] } }))
      .toEqual({ gameType: 'codebreaker', action: { type: 'guess', code: [1, 2, 3, 4] } });
    for (const code of [[1, 2, 3], [1, 2, 3, 10], [1, 2, 3, 'x'], 'abcd', [1.5, 2, 3, 4]]) {
      expect(parseGameAction({ gameType: 'codebreaker', action: { type: 'guess', code } })).toBe('Invalid guess.');
    }
    expect(parseGameAction({ gameType: 'codebreaker', action: { type: 'resign' } })).toBe('Invalid action.');
  });
});

describe('Code Breaker statistics and stored state', () => {
  it('counts cracked codes and guesses to solve from the stored result only', () => {
    start(['N', 'E']);
    const secret = game().secret;
    roundOf({ N: wrong(), E: wrong() });
    roundOf({ N: secret, E: wrong() });
    for (let round = 3; round <= CB_MAX_GUESSES; round++) roundOf({});
    const result = game().result!;
    expect(codeBreakerFacts(result, 'N')).toMatchObject({
      counts: { codesCracked: 1 }, sums: { guessesToSolve: 2 }, values: { fewestGuesses: 2 },
    });
    expect(codeBreakerFacts(result, 'E')).toMatchObject({ counts: {}, sums: {}, values: {} });
    expect(matchStanding(result, 'N')).toMatchObject({ rank: 1, won: true, tied: false });
    expect(matchStanding(result, 'E')).toMatchObject({ rank: 2, won: false, tied: false });
  });

  it('accepts a played game as stored state and rejects tampering', () => {
    start(['N', 'E', 'S'], { variant: 'colors' });
    const secret = game().secret;
    roundOf({ N: [0, 0, 1, 1], E: [2, 2, 3, 3], S: secret });
    const validator = gameValidator('codebreaker');
    const stored = (): CodeBreakerGameState => structuredClone(game());
    expect(validator.shape(stored() as never, () => true)).toBe(true);
    expect(coherent()).toBe(true);

    const mutations: ((state: CodeBreakerGameState) => void)[] = [
      (state) => { state.log[0] = { ...state.log[0], exact: (state.log[0].exact + 1) % 4 }; },
      (state) => { state.log[1] = { ...state.log[1], solved: true }; },
      (state) => { state.round = 5; },
      (state) => { state.log[2] = { ...state.log[2], round: 2 }; },
      (state) => { state.log.push({ ...state.log[2], round: 2 }); },
      (state) => { state.pending.S = [0, 1, 2, 3]; },
      (state) => { state.phase = 'scoring'; },
    ];
    for (const mutate of mutations) {
      const tampered = stored();
      mutate(tampered);
      expect(coherentCodeBreakerGame(tampered)).toBe(false);
    }
    const badShape = stored() as unknown as Record<string, unknown>;
    badShape.secret = [1, 1, 1, 1];
    expect(codeBreakerGame({ ...badShape, options: { variant: 'digits' } } as never, () => true)).toBe(false);
    expect(codeBreakerGame({ ...(stored() as object), options: { variant: 'hex' } } as never, () => true)).toBe(false);
  });

  it('validates stored results', () => {
    start(['N', 'E']);
    for (let round = 1; round <= CB_MAX_GUESSES; round++) roundOf({});
    const result = structuredClone(game().result!);
    expect(isCodeBreakerResult(result)).toBe(true);
    expect(isCodeBreakerResult({ ...result, winners: ['N'] })).toBe(false);
    expect(isCodeBreakerResult({ ...result, guesses: { N: 3, E: 10 } })).toBe(false);
    expect(isCodeBreakerResult({ ...result, secret: [1, 1, 1, 1] })).toBe(false);
    expect(isCodeBreakerResult({ ...result, seats: ['N'] })).toBe(false);
  });
});

describe('Code Breaker through the runtime', () => {
  const SEATS = ['N', 'S'] as const;
  const stops: (() => void)[] = [];
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10_000); });
  afterEach(() => {
    stops.splice(0).forEach((stop) => stop());
    games.restoreGames([]);
    rooms.restoreRooms([]);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function fixture(options: { variant: 'digits' | 'colors' } = { variant: 'digits' }): Promise<{
    code: RoomCode; runtime: Awaited<ReturnType<typeof createRuntimeCoordinator>>; saved: () => RuntimeSnapshot;
    state: () => CodeBreakerGameState;
  }> {
    let saved: RuntimeSnapshot | null = null;
    const repository = {
      loadRuntime: async (): Promise<RuntimeSnapshot | null> => structuredClone(saved),
      saveRuntime: vi.fn(async (snapshot: RuntimeSnapshot): Promise<void> => {
        expect(isRuntimeSnapshot(snapshot)).toBe(true);
        saved = structuredClone(snapshot);
      }),
    };
    const runtime = await createRuntimeCoordinator(repository);
    let code = '';
    await runtime.mutate(() => {
      code = rooms.createRoom('codebreaker', 'N');
      for (const seat of SEATS) {
        players.attachPlayer(seat, player(seat));
        players.setPlayerRoom(seat, code);
        rooms.joinRoom(code, seat);
        rooms.changeSeat(code, player(seat), seat);
      }
      rooms.setRoomStatus(code, 'playing');
      expect(games.startGame(code, 'codebreaker', rooms.getSeatPlayers(code)!, { baseSeconds: 60, bankSeconds: 0 },
        { codebreaker: options }).success).toBe(true);
    });
    const state = (): CodeBreakerGameState => games.getGameState(code) as CodeBreakerGameState;
    return { code, runtime, saved: () => saved!, state };
  }

  it('runs no turn clock and takes guesses through the shared action path', async () => {
    const { code, runtime, state } = await fixture();
    expect(state()).toMatchObject({ phase: 'playing', round: 1, options: { variant: 'digits' } });
    expect(state().roundDeadline).toBe(10_000 + 60_000);
    expect(state().clock?.turn).toBeNull();
    await runtime.mutate(() => {
      expect(games.handleGameAction(code, 'N', { gameType: 'codebreaker', action: { type: 'guess', code: [0, 1, 2, 3] } }).success).toBe(true);
      expect(games.handleGameAction(code, 'N', { gameType: 'codebreaker', action: { type: 'guess', code: [0, 1, 2, 3] } }).success).toBe(false);
    });
    expect(state().pending.N).toEqual([0, 1, 2, 3]);
    expect(state().clock?.turn).toBeNull();
  });

  it('guesses for a human who misses the round window, also after a restart, using only their own feedback', async () => {
    const { code, runtime, saved, state } = await fixture({ variant: 'colors' });
    await runtime.mutate(() => {
      expect(games.handleGameAction(code, 'N', { gameType: 'codebreaker', action: { type: 'guess', code: [0, 0, 1, 1] } }).success).toBe(true);
    });
    const restored = saved();
    games.restoreGames([]);
    games.restoreGames(restored.games);
    expect(state()).toMatchObject({ round: 1, pending: { N: [0, 0, 1, 1], S: null } });
    vi.setSystemTime(state().roundDeadline);
    const publish = vi.fn();
    stops.push(startSharedDeadlines(runtime, publish));
    await vi.advanceTimersByTimeAsync(0);
    await runtime.idle();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(state()).toMatchObject({ phase: 'playing', round: 2, pendingAuto: [] });
    expect(state().log.map((entry) => [entry.seat, entry.auto])).toEqual([['N', false], ['S', true]]);
    expect(isCbCode(state().log[1].code, 'colors')).toBe(true);
    expect(state().roundDeadline).toBe(state().log[1].timestamp + 60_000);
  });

  it('records the spectator view for replays but sends seated players neither the secret nor other guesses', async () => {
    const { code, runtime, state } = await fixture();
    await runtime.mutate(() => {
      for (const [seat, guess] of [['N', [0, 1, 2, 3]], ['S', [4, 5, 6, 7]]] as const) {
        expect(games.handleGameAction(code, seat, { gameType: 'codebreaker', action: { type: 'guess', code: [...guess] } }).success).toBe(true);
      }
    });
    const snapshot = captureReplaySnapshot(state()) as unknown as CodeBreakerVisibleState;
    expect(snapshot).toMatchObject({ observer: 'spectator', secret: state().secret });
    expect(Object.keys(snapshot.histories)).toEqual(['N', 'S']);
    for (const seat of SEATS) {
      const seated = games.getRecipientVisibleState(code, seat) as CodeBreakerVisibleState;
      expect(seated.secret).toBeNull();
      expect(seated.observer).toBeUndefined();
      expect(Object.keys(seated.histories)).toEqual([seat]);
    }
  });

  it('lists the seats that still owe a guess, which bots answer one at a time', async () => {
    const { code, runtime, state } = await fixture();
    expect(games.getOwingSeats(state())).toEqual(['N', 'S']);
    await runtime.mutate(() => {
      expect(games.handleGameAction(code, 'N', { gameType: 'codebreaker', action: { type: 'guess', code: [0, 1, 2, 3] } }).success).toBe(true);
    });
    expect(games.getOwingSeats(state())).toEqual(['S']);
  });
});
