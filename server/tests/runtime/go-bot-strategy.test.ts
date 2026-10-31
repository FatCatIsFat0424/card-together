import { afterEach, describe, expect, it } from 'vitest';
import type { GameSeat, GoGameState, GoVisibleState, PlayerInfo } from '@shared/types';
import { goNode, goParsePoint, goPointOfNode } from '@shared/rules/go';
import type { GoSize } from '@shared/rules/go';
import { getBotAction, getEasyBotAction } from '../../src/bots/bot-decisions';
import type { BotAction } from '../../src/bots/bot-decisions';
import { gameBot } from '../../src/bots/bot-registry';
import { GO_MAX_CONTESTS, GO_SEARCH_ITERATIONS, goSearch } from '../../src/bots/go-search';
import { goFirstLegalAction } from '../../src/bots/go-strategy';
import { seededRandom } from '../../src/bots/search/seeded-random';
import * as go from '../../src/managers/games/go-game';
import { coherentGoGame } from '../../src/managers/games/go-validation';

const CODE = 'GOBT01';
const MARK_MS = 120_000;
const player = (seat: GameSeat): PlayerInfo => ({
  id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null, isBot: true,
});

function start(options = { size: 9 as GoSize, handicap: 0 }): void {
  go.startGame(CODE, { N: player('N'), S: player('S') }, options, 1_000);
}

const game = (): GoGameState => go.getGameState(CODE)!;
const view = (seat: GameSeat): GoVisibleState => go.getPlayerVisibleState(CODE, seat)!;
const name = (value: string): number => goParsePoint(9, value)!;
const node = (value: string): string => goNode(9, name(value));

const kind = (action: BotAction | null): string | null => (action?.type === 'game-action' && action.request.gameType === 'go'
  ? action.request.action.type : null);

const target = (action: BotAction | null): number | null => (action?.type === 'game-action' && action.request.gameType === 'go'
  && action.request.action.type === 'place' ? goPointOfNode(9, action.request.action.to) : null);

/** Applies a bot action the way the runtime would, as an automatic one. */
function apply(seat: GameSeat, action: BotAction | null): void {
  if (action?.type !== 'game-action' || action.request.gameType !== 'go') throw new Error('Expected a Go action');
  const move = action.request.action;
  const result = move.type === 'place' ? go.place(CODE, seat, move.to, MARK_MS, Date.now())
    : move.type === 'pass' ? go.pass(CODE, seat, MARK_MS, Date.now())
      : move.type === 'toggle-dead' ? go.toggleDead(CODE, seat, move.to, true)
        : move.type === 'confirm-score' ? go.confirmScore(CODE, seat, move.dead, true)
          : move.type === 'resume' ? go.resume(CODE, seat, true) : { success: false, reason: 'Unexpected action' };
  expect(result, JSON.stringify(move)).toEqual({ success: true });
}

/** Two safe groups with two eyes each: black on the second and top lines, white on the second and bottom lines. */
const BLACK_WALL = ['A8', 'B8', 'C8', 'D8', 'E8', 'F8', 'G8', 'H8', 'J8', 'B9', 'C9', 'D9', 'E9', 'F9', 'G9', 'H9'];
const WHITE_WALL = ['A2', 'B2', 'C2', 'D2', 'E2', 'F2', 'G2', 'H2', 'J2', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'H1'];

/** Builds both walls, passes twice and leaves the marking open. */
function twoAliveGroups(): void {
  start();
  BLACK_WALL.forEach((black, index) => {
    expect(go.place(CODE, 'N', node(black), MARK_MS, 2_000)).toEqual({ success: true });
    expect(go.place(CODE, 'S', node(WHITE_WALL[index]), MARK_MS, 2_000)).toEqual({ success: true });
  });
  expect(go.pass(CODE, 'N', MARK_MS, 3_000)).toEqual({ success: true });
  expect(go.pass(CODE, 'S', MARK_MS, 3_000)).toEqual({ success: true });
}

const stonesOf = (names: readonly string[]): number[] => names.map(name).sort((a, b) => a - b);

afterEach(() => go.abortGame(CODE));

describe('Go bot registry', () => {
  it('searches in the worker pool and decides turns, timeouts, and the marking deadline itself', () => {
    const bot = gameBot('go');
    expect(bot.search).toMatchObject({ budgetMs: 2500 });
    expect(bot.search?.strategy.exportName).toBe('goSearch');
    expect(bot.turnTimeout).toBeDefined();
    expect(bot.deadlineExpired).toBeDefined();
  });

  it('caps the search by board size so the 19 × 19 search still ends within the budget', () => {
    expect(GO_SEARCH_ITERATIONS[9]).toBeGreaterThanOrEqual(6_000);
    expect(GO_SEARCH_ITERATIONS[13]).toBeGreaterThanOrEqual(6_000);
    expect(GO_SEARCH_ITERATIONS[19]).toBeGreaterThanOrEqual(6_000);
  });
});

describe('Go bots on their turn', () => {
  it('plays a legal stone for both difficulties and none for a seat that is not on move', () => {
    start();
    for (const difficulty of ['easy', 'hard'] as const) {
      const action = getBotAction(view('N'), seededRandom(3), difficulty);
      expect(kind(action), difficulty).toBe('place');
      expect(target(action)).toBeGreaterThanOrEqual(0);
    }
    expect(getBotAction(view('S'), seededRandom(3), 'easy')).toBeNull();
    expect(getBotAction(view('S'), seededRandom(3), 'hard')).toBeNull();
    expect(goFirstLegalAction(view('S'))).toBeNull();
  });

  it('gives a player who ran out of time a stone by the easy policy', () => {
    start();
    const timeout = gameBot('go').turnTimeout!(view('N'), { isBot: false, strategy: () => null });
    expect(kind(timeout)).toBe('place');
    expect(kind(gameBot('go').turnTimeout!(view('S'), { isBot: false, strategy: () => null }))).toBeNull();
  });

  it('captures a group in atari and saves its own with the easy policy', () => {
    start();
    // White's D5 has one liberty, E5: black takes it, and white on its move extends there.
    for (const [seat, point] of [['N', 'D4'], ['S', 'D5'], ['N', 'C5'], ['S', 'A1'], ['N', 'D6']] as const) {
      expect(go.place(CODE, seat, node(point), MARK_MS, 2_000)).toEqual({ success: true });
    }
    expect(target(getEasyBotAction(view('S'), seededRandom(4)))).toBe(name('E5'));
    go.pass(CODE, 'S', MARK_MS, 2_500);
    expect(target(getEasyBotAction(view('N'), seededRandom(4)))).toBe(name('E5'));
  });

  it('plays the first legal point nearest the centre as the last resort', () => {
    start();
    expect(target(goFirstLegalAction(view('N')))).toBe(name('E5'));
  });

  it('plays or passes legally after a resume, on a board where both groups are settled', () => {
    twoAliveGroups();
    go.resume(CODE, 'N', false, 4_000);
    const action = getBotAction(view('N'), seededRandom(5), 'hard');
    expect(['place', 'pass']).toContain(kind(action));
    apply('N', action);
  });

  it('respects the time limit of its search and stays legal when it is already spent', () => {
    start();
    const context = {
      random: seededRandom(2),
      budget: { maxDepth: undefined, timeLeftMs: () => 0, expired: () => true },
    };
    const started = performance.now();
    const action = goSearch(view('N'), context);
    expect(performance.now() - started).toBeLessThan(500);
    expect(kind(action)).toBe('place');
    expect(goSearch(view('S'), context)).toBeNull();
  });

  it('saves a group in atari within its iteration cap on a 9 × 9 board', () => {
    start();
    for (const [seat, point] of [['N', 'D4'], ['S', 'D5'], ['N', 'C5'], ['S', 'A1'], ['N', 'D6']] as const) {
      expect(go.place(CODE, seat, node(point), MARK_MS, 2_000)).toEqual({ success: true });
    }
    const context = { random: seededRandom(8), budget: { maxDepth: undefined, timeLeftMs: () => 5_000, expired: () => false } };
    expect(target(goSearch(view('S'), context))).toBe(name('E5'));
  });
});

describe('Go bots in the marking', () => {
  it('accepts a proposal that leaves its stones alone', () => {
    twoAliveGroups();
    game().dead = [];
    for (const seat of ['N', 'S'] as const) expect(kind(getBotAction(view(seat), seededRandom(1), 'hard')), seat).toBe('confirm-score');
    for (const seat of ['N', 'S'] as const) expect(kind(getEasyBotAction(view(seat), seededRandom(1))), seat).toBe('confirm-score');
  });

  it('sends the count back to play when its own living group is marked dead, and only then', () => {
    twoAliveGroups();
    game().dead = stonesOf(BLACK_WALL);
    expect(kind(getBotAction(view('N'), seededRandom(1), 'hard'))).toBe('resume');
    expect(kind(getBotAction(view('N'), seededRandom(1), 'easy'))).toBe('resume');
    // White agrees that black's wall is dead.
    expect(kind(getBotAction(view('S'), seededRandom(1), 'hard'))).toBe('confirm-score');
    game().dead = stonesOf(WHITE_WALL);
    expect(kind(getBotAction(view('S'), seededRandom(1), 'hard'))).toBe('resume');
    expect(kind(getBotAction(view('N'), seededRandom(1), 'hard'))).toBe('confirm-score');
  });

  it('gives the same answer in the worker strategy, and answers only while it still owes one', () => {
    twoAliveGroups();
    game().dead = stonesOf(BLACK_WALL);
    const context = { random: seededRandom(1), budget: { maxDepth: undefined, timeLeftMs: () => 1_000, expired: () => false } };
    expect(kind(goSearch(view('N'), context))).toBe('resume');
    game().dead = [];
    go.confirmScore(CODE, 'N', [], true, 4_000);
    expect(goSearch(view('N'), context)).toBeNull();
    expect(kind(goSearch(view('S'), context))).toBe('confirm-score');
  });

  it('stops contesting after a few disagreements, so two bots cannot loop until the move limit', () => {
    twoAliveGroups();
    for (let round = 0; round < GO_MAX_CONTESTS; round++) {
      game().dead = stonesOf(BLACK_WALL);
      expect(kind(getBotAction(view('N'), seededRandom(1), 'hard')), `round ${round}`).toBe('resume');
      go.resume(CODE, 'N', true);
      const toMove = game().currentTurnSeat;
      apply(toMove, { type: 'game-action', request: { gameType: 'go', action: { type: 'pass' } } });
      apply(toMove === 'N' ? 'S' : 'N', { type: 'game-action', request: { gameType: 'go', action: { type: 'pass' } } });
    }
    game().dead = stonesOf(BLACK_WALL);
    expect(game().resumes).toHaveLength(GO_MAX_CONTESTS);
    expect(kind(getBotAction(view('N'), seededRandom(1), 'hard'))).toBe('confirm-score');
  });

  it('confirms the proposal as a human would at a missed deadline, and keeps a bot on its own answer', () => {
    twoAliveGroups();
    game().dead = stonesOf(BLACK_WALL);
    const expired = gameBot('go').deadlineExpired!;
    const human = expired(view('N'), { isBot: false, strategy: () => null });
    expect(human).toMatchObject({ request: { action: { type: 'confirm-score', dead: stonesOf(BLACK_WALL) } } });
    expect(kind(expired(view('N'), { isBot: true, strategy: () => getBotAction(view('N'), seededRandom(1)) }))).toBe('resume');
  });

  it('serves a spectator nothing', () => {
    twoAliveGroups();
    expect(getBotAction(view('E'), seededRandom(1), 'hard')).toBeNull();
    expect(getBotAction(view('E'), seededRandom(1), 'easy')).toBeNull();
  });
});

describe('Go bots playing whole games', () => {
  /** Plays until the match ends; every action is the bot's own and must succeed. */
  function playOut(difficulty: { N: 'easy' | 'hard'; S: 'easy' | 'hard' }, seed: number): void {
    const random = seededRandom(seed);
    for (let step = 0; step < 900 && game().result === null; step++) {
      const state = game();
      const seat: 'N' | 'S' = state.phase === 'marking'
        ? (['N', 'S'] as const).find((candidate) => !state.confirmed.includes(candidate))!
        : state.currentTurnSeat === 'N' ? 'N' : 'S';
      apply(seat, getBotAction(view(seat), random, difficulty[seat]));
      expect(coherentGoGame(structuredClone(game())), `step ${step}`).toBe(true);
    }
    expect(game().result).not.toBeNull();
  }

  it('ends a 9 × 9 easy game by counting, with a result that agrees with the board', () => {
    start();
    playOut({ N: 'easy', S: 'easy' }, 11);
    const result = game().result!;
    expect(['score', 'move-limit']).toContain(result.reason);
    expect(result.moves).toBe(game().log.length);
  });

  it('ends an easy game on the larger boards too', () => {
    for (const size of [13, 19] as const) {
      go.abortGame(CODE);
      start({ size, handicap: size === 13 ? 2 : 0 });
      playOut({ N: 'easy', S: 'easy' }, 5 + size);
      expect(game().result?.options.size).toBe(size);
    }
  }, 60_000);

  it('lets the quick hard policy finish a game against the easy policy', () => {
    start();
    playOut({ N: 'hard', S: 'easy' }, 21);
  }, 60_000);
});
