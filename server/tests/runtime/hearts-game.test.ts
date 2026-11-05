import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HeartsGameState } from '@shared/games/hearts/types';
import type { Card, Seat } from '@shared/types';
import { HEARTS_SEATS, heartsPassTarget, heartsPassDirection, heartsWinners } from '@shared/rules/hearts';
import { removeCards } from '@shared/rules/cards';
import { getPresentationFrames } from '@shared/game-presentation';
import { defaultGameOptions } from '@shared/games/room-options';
import { DEFAULT_TIME_CONTROL } from '@shared/time-control';
import { gameFacts } from '@shared/stats/registry';
import { DAILY_TASKS } from '@shared/constants/daily-rewards';
import * as facade from '../../src/managers/game-manager';
import * as hearts from '../../src/managers/games/hearts-game';
import { heartsGame, coherentHeartsGame, isHeartsResult } from '../../src/managers/games/hearts-validation';
import { heartsAdapter } from '../../src/managers/games/hearts-adapter';
import { gameBot } from '../../src/bots/bot-registry';
import { getBotAction } from '../../src/bots/bot-decisions';
import { HEARTS_PLAYERS, heartsRandom, heartsShuffle, heartsAction, heartsActor } from '../helpers/hearts';
const CODE = 'HEARTS';
const state = (): HeartsGameState => hearts.getGameState(CODE)!;
const shape = (game: HeartsGameState): boolean => heartsGame(game as unknown as Record<string, unknown>, () => true);
function start(seed = 1): () => Card[] {
  const random = heartsRandom(seed);
  const shuffle = (): Card[] => heartsShuffle(random);
  hearts.startGame(CODE, HEARTS_PLAYERS, 30000, shuffle(), 1000);
  return shuffle;
}
function step(shuffle: () => Card[], index: number, difficulty: 'easy' | 'hard' = 'hard'): void {
  const seat = heartsActor(state());
  const view = hearts.getPlayerVisibleState(CODE, seat)!;
  const action = heartsAction(getBotAction(view, heartsRandom(index + 1), difficulty));
  expect(hearts.act(CODE, seat, action, 1001 + index, shuffle)).toEqual({ success: true });
}
afterEach(() => { hearts.restoreGames([]); vi.restoreAllMocks(); });

describe('Hearts manager privacy and lifecycle', () => {
  it('collects simultaneous secret passes, rejects revisions and transfers atomically', () => {
    start();
    const original = structuredClone(state().hands);
    const sent = Object.fromEntries(HEARTS_SEATS.map((seat) => [seat, original[seat].slice(0, 3)])) as Record<Seat, Card[]>;
    for (const seat of HEARTS_SEATS) {
      expect(hearts.act(CODE, seat, { type: 'pass', cards: sent[seat] }, 1001)).toEqual({ success: true });
      expect(hearts.act(CODE, seat, { type: 'pass', cards: sent[seat] }, 1001).success).toBe(false);
      expect(coherentHeartsGame(state())).toBe(true);
      if (seat !== 'W') expect(state().hands).toEqual(original);
    }
    expect(state().phase).toBe('playing');
    expect(state().passDeadline).toBeNull();
    for (const seat of HEARTS_SEATS) {
      const receiver = heartsPassTarget(seat, 'left');
      expect(state().hands[receiver]).toEqual([...removeCards(original[receiver], sent[receiver]), ...sent[seat]]);
    }
    expect(state().hands[state().currentTurnSeat!]).toContainEqual({ suit: 'clubs', rank: 2 });
    expect(state().log.filter((entry) => entry.type === 'pass')).toEqual(HEARTS_SEATS.map((seat) => ({ type: 'pass', seat, timestamp: 1001 })));
  });
  it('filters hands and all other pass selections from participants, bots and observers', () => {
    start();
    const passed = state().hands.E.slice(0, 3);
    hearts.act(CODE, 'E', { type: 'pass', cards: passed }, 1001);
    const view = hearts.getPlayerVisibleState(CODE, 'N')!;
    expect(view).not.toHaveProperty('hands'); expect(view).not.toHaveProperty('deals');
    expect(view.myHand).toEqual(state().hands.N); expect(view.myPass).toEqual([]);
    expect(view.passedSeats).toEqual(['E']);
    expect(hearts.getPlayerVisibleState(CODE, 'E')?.myPass).toEqual(passed);
    expect(view.log).toEqual([{ type: 'deal', hand: 1, timestamp: 1000 }, { type: 'pass', seat: 'E', timestamp: 1001 }]);
    expect(hearts.getPlayerVisibleState(CODE, 'P5')).toBeNull();
    const observed = heartsAdapter.withObserverView(view, state(), 'spectator');
    expect(observed.observedHands).toEqual(state().hands); expect(observed.myPass).toEqual([]);
    expect(heartsAdapter.sharedDeadline?.owingSeats(state())).toEqual(['N', 'S', 'W']);
  });
  it('uses the shared deadline, delays it after presentation, and supplies legal timeout decisions', () => {
    expect(heartsAdapter.start({ roomCode: CODE, players: HEARTS_PLAYERS,
      settings: DEFAULT_TIME_CONTROL, options: defaultGameOptions() }).success).toBe(true);
    const game = state();
    heartsAdapter.afterPresentation?.(game, 100000);
    expect(game.passDeadline).toBe(100000 + game.passDurationMs);
    expect(heartsAdapter.turnSeat(game)).toBeNull();
    expect(heartsAdapter.sharedDeadline?.window(game)?.key).toContain(':pass:1');
    for (const seat of HEARTS_SEATS) {
      const view = hearts.getPlayerVisibleState(CODE, seat)!;
      const bot = gameBot('hearts');
      const context = { isBot: false, strategy: () => bot.hard(view, () => 0) };
      const action = heartsAction(bot.deadlineExpired?.(view, context) ?? context.strategy());
      expect(hearts.act(CODE, seat, action).success).toBe(true);
    }
    expect(game.phase).toBe('playing');
    const seat = game.currentTurnSeat!;
    const view = hearts.getPlayerVisibleState(CODE, seat)!;
    const bot = gameBot('hearts');
    const action = heartsAction(bot.turnTimeout?.(view, { isBot: false, strategy: () => bot.hard(view, () => 0) }) ?? bot.hard(view, () => 0));
    expect(action).toEqual({ type: 'play', card: { suit: 'clubs', rank: 2 } });
    expect(hearts.act(CODE, seat, action).success).toBe(true);
  });
  it('keeps the original passing deadline, rejects late manual submissions and starts the first turn clock', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    expect(facade.startGame(CODE, 'hearts', HEARTS_PLAYERS, { baseSeconds: 1, bankSeconds: 5 }).success).toBe(true);
    const deadline = state().passDeadline;
    expect(deadline).toBe(32500);
    now.mockReturnValue(2500);
    for (const seat of HEARTS_SEATS) {
      expect(facade.handleGameAction(CODE, seat, { gameType: 'hearts',
        action: { type: 'pass', cards: state().hands[seat].slice(0, 3) } }).success).toBe(true);
      if (seat !== 'W') {
        expect(state().passDeadline).toBe(deadline);
        expect(state().clock?.turn).toBeNull();
      }
    }
    expect(state().clock?.turn?.seat).toBe(state().currentTurnSeat);
    expect(state().clock?.turn?.startsAt).toBe(2500);
    expect(state().clock?.turn?.deadline).toBe(8500);
    now.mockReturnValue(10000);
    facade.startGame(CODE, 'hearts', HEARTS_PLAYERS, { baseSeconds: 1, bankSeconds: 5 });
    now.mockReturnValue(state().passDeadline!);
    const request = { gameType: 'hearts' as const, action: { type: 'pass' as const, cards: state().hands.N.slice(0, 3) } };
    const before = structuredClone(state());
    expect(facade.handleGameAction(CODE, 'N', request)).toEqual({ success: false, reason: 'Passing is closed.' });
    expect(state()).toEqual(before);
    expect(facade.handleGameAction(CODE, 'N', request, true).success).toBe(true);
  });
  it('rejects illegal plays without changing state and rejects actions for missing games', () => {
    start();
    const before = structuredClone(state());
    expect(hearts.act(CODE, 'N', { type: 'play', card: state().hands.N[0] }).success).toBe(false);
    expect(hearts.act(CODE, 'N', { type: 'pass', cards: [state().hands.N[0], state().hands.N[0], state().hands.N[1]] }).success).toBe(false);
    expect(state()).toEqual(before);
    hearts.abortGame(CODE);
    expect(hearts.act(CODE, 'N', { type: 'pass', cards: [] }).success).toBe(false);
  });
  it.each([1, 8, 19, 42])('finishes seed %i with legal bots, durable restore and coherent scores every action', (seed) => {
    const shuffle = start(seed);
    let moves = 0;
    const directions = new Set<string>();
    while (!state().result && moves < 1000) {
      const game = state();
      directions.add(heartsPassDirection(game.hand));
      const before = structuredClone(game);
      expect(shape(game)).toBe(true); expect(coherentHeartsGame(game)).toBe(true);
      if (moves % 13 === 0) {
        const records = JSON.parse(JSON.stringify(hearts.exportGames())) as HeartsGameState[];
        hearts.restoreGames(records);
        expect(state()).toEqual(before);
      }
      step(shuffle, moves++, seed % 2 ? 'hard' : 'easy');
      if (state().hand !== before.hand) {
        const clock = heartsAdapter.clockBeforeAction?.(before, 'N');
        expect(clock?.(state()).redealt).toBe(true);
        expect(state().log.at(-2)?.type).toBe('hand_end');
      }
    }
    const game = state();
    expect(moves).toBeLessThan(1000); expect(game.phase).toBe('scoring');
    expect(shape(game)).toBe(true); expect(coherentHeartsGame(game)).toBe(true);
    expect(isHeartsResult(game.result)).toBe(true);
    expect(directions).toEqual(new Set(['left', 'right', 'across', 'hold']));
    expect(game.result?.winners).toEqual(heartsWinners(game.scores));
    const endEntries = game.log.filter((entry) => entry.type === 'hand_end');
    expect(game.result?.hands).toEqual(endEntries.map((entry) => entry.score));
    expect(game.hand).toBeLessThanOrEqual(16);
    expect(Math.max(...Object.values(game.scores))).toBeGreaterThanOrEqual(100);
    const facts = gameFacts('hearts', game.result!, 'N', null);
    expect(facts.values.lowPenalty).toBe(game.scores.N);
    expect(DAILY_TASKS.find((task) => task.id === 'play-hearts')).toMatchObject({ gameType: 'hearts', target: 1 });
    const actor = 'N';
    const snapshot = structuredClone(game);
    expect(hearts.act(CODE, actor, { type: 'pass', cards: [] }).success).toBe(false);
    expect(game).toEqual(snapshot);
  }, 20_000);
  it('replays legal evidence and rejects tampered hands, passes, turns, tricks, scores and result', () => {
    const shuffle = start(3);
    for (let index = 0; index < 25; index++) step(shuffle, index);
    expect(coherentHeartsGame(state())).toBe(true);
    const changes: ((game: HeartsGameState) => void)[] = [
      (game) => { game.hands.N[0] = game.hands.E[0]; },
      (game) => { game.deals[0].passes.N = [...game.deals[0].passes.E ?? []]; },
      (game) => { game.scores.N++; },
      (game) => { game.currentTurnSeat = game.currentTurnSeat === 'N' ? 'E' : 'N'; },
      (game) => { game.heartsBroken = !game.heartsBroken; },
      (game) => { game.tricks[0] = { ...game.tricks[0], winner: game.tricks[0].winner === 'N' ? 'E' : 'N' }; },
      (game) => { game.log.splice(2, 1); },
      (game) => { game.passDeadline = 10000; },
      (game) => { game.players.E = game.players.N; },
    ];
    for (const change of changes) {
      const damaged = structuredClone(state()); change(damaged);
      expect(shape(damaged) && coherentHeartsGame(damaged)).toBe(false);
    }
    let index = 25;
    while (!state().result) step(shuffle, index++);
    const finished = state().result!;
    expect(isHeartsResult({ ...finished, winners: ['N', 'E', 'S', 'W'] })).toBe(false);
    expect(isHeartsResult({ ...finished, hands: [] })).toBe(false);
    expect(isHeartsResult({ ...finished, scores: { ...finished.scores, N: finished.scores.N + 1 } })).toBe(false);
  });
  it('derives public trick and settlement frames even after a new hand resets current tricks', () => {
    const shuffle = start();
    let index = 0;
    while (state().hand < 2) step(shuffle, index++);
    const game = state();
    const startIndex = game.log.findLastIndex((entry) => entry.type === 'trick_end') - 1;
    game.presentation = { id: 'test', startedAt: 1000, logStart: startIndex, timingVersion: 3 };
    const frames = getPresentationFrames(game);
    expect(frames.map((frame) => frame.kind)).toEqual(['play', 'trick', 'settle', 'deal']);
    expect(frames.find((frame) => frame.kind === 'trick')?.cards).toHaveLength(4);
    expect(frames.filter((frame) => frame.kind === 'settle' || frame.kind === 'deal').every((frame) => frame.cards.length === 0)).toBe(true);
    expect(JSON.stringify(frames)).not.toContain('passes');
  });
});
