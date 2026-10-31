import { afterEach, describe, expect, it } from 'vitest';
import type { GameSeat, GoGameState, GoVisibleState, PlayerInfo } from '@shared/types';
import { gameDefinition } from '@shared/games/registry';
import { parseGameAction } from '@shared/games/actions';
import { goMoveLimit, goNode, goParsePoint } from '@shared/rules/go';
import type { GoOptions } from '@shared/rules/go';
import { goMarkSeconds } from '@shared/rules/go-match';
import { matchStanding } from '@shared/rules/match-standing';
import * as go from '../../src/managers/games/go-game';
import { goAdapter } from '../../src/managers/games/go-adapter';
import { coherentGoGame, goGame, isGoResult } from '../../src/managers/games/go-validation';
import { gameValidator } from '../../src/managers/games/validation-registry';
import * as manager from '../../src/managers/game-manager';

const CODE = 'GOGAM1';
const MARK_MS = goMarkSeconds(60, 300) * 1000;

function player(seat: GameSeat): PlayerInfo {
  return { id: seat.toLowerCase(), username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null };
}

function start(options?: GoOptions, seats: readonly GameSeat[] = ['N', 'S']): void {
  go.startGame(CODE, Object.fromEntries(seats.map((seat) => [seat, player(seat)])), options, 1_000);
}

function game(): GoGameState {
  const state = go.getGameState(CODE);
  if (!state) throw new Error('Expected a Go game');
  return state;
}

const coherent = (): boolean => coherentGoGame(structuredClone(game()));
const accepts = (value: unknown): boolean => gameValidator('go').shape(value as never, () => true)
  && gameValidator('go').coherent(value as GoGameState);

/** Board node of a `D4`-style name on a 9 × 9 board. */
const node = (name: string, size: 9 | 13 | 19 = 9): string => goNode(size, goParsePoint(size, name)!);

/** Plays `seat:point` steps (or `seat:pass`) in order and expects each to succeed. */
function play(...steps: string[]): void {
  for (const step of steps) {
    const [seat, point] = step.split(':');
    const result = point === 'pass' ? go.pass(CODE, seat as GameSeat, MARK_MS, 2_000)
      : go.place(CODE, seat as GameSeat, node(point), MARK_MS, 2_000);
    expect(result, step).toEqual({ success: true });
  }
}

/** Black takes E5 with F5 in a ko; white may not take back at once. */
const KO = ['N:E6', 'S:F6', 'N:D5', 'S:E5', 'N:E4', 'S:F4', 'N:A1', 'S:G5', 'N:F5'];

afterEach(() => go.abortGame(CODE));

describe('Go setup', () => {
  it('registers a two-player flexible board game with room rules, the board timer, resign and no draw offers', () => {
    expect(gameDefinition('go')).toMatchObject({
      category: 'board', equipment: [], seats: { minPlayers: 2, maxPlayers: 2, flexible: true },
      matchControls: { resign: true, draw: false }, timeControl: { baseSeconds: 60, bankSeconds: 300 },
      options: { defaults: { size: 9, handicap: 0 } },
    });
  });

  it('starts on an empty board with the first occupied seat playing black', () => {
    start(undefined, ['E', 'W']);
    expect(game()).toMatchObject({ phase: 'playing', currentTurnSeat: 'E', result: null, log: [], captures: [0, 0], passes: 0,
      resumes: [], markDeadline: 0, dead: [], confirmed: [], options: { size: 9, handicap: 0 } });
    expect(game().stones.every((cell) => cell === null)).toBe(true);
    expect(go.getPlayerVisibleState(CODE, 'W')).toMatchObject({ seats: ['E', 'W'], mySeat: 'W', currentTurnSeat: 'E' });
    expect(coherent()).toBe(true);
  });

  it('puts the handicap stones down and lets white move first', () => {
    start({ size: 13, handicap: 4 });
    expect(game().stones.filter((cell) => cell === 0)).toHaveLength(4);
    expect(game().currentTurnSeat).toBe('S');
    expect(go.place(CODE, 'N', node('D4', 13), MARK_MS, 2_000)).toEqual({ success: false, reason: 'Not your turn' });
    play('S:pass');
    expect(game().currentTurnSeat).toBe('N');
    expect(coherent()).toBe(true);
  });
});

describe('Go moves', () => {
  it('alternates colours, logs the public move, and passes the turn', () => {
    start();
    play('N:E5');
    expect(game().log).toEqual([{ seat: 'N', to: '4,4', timestamp: 2_000 }]);
    expect(game().stones[goParsePoint(9, 'E5')!]).toBe(0);
    expect(game().currentTurnSeat).toBe('S');
    expect(go.place(CODE, 'N', node('A1'), MARK_MS)).toEqual({ success: false, reason: 'Not your turn' });
    play('S:D5');
    expect(game().stones[goParsePoint(9, 'D5')!]).toBe(1);
    expect(coherent()).toBe(true);
  });

  it('rejects an occupied point, an off-board node, and moves from outside the match', () => {
    start();
    play('N:E5');
    expect(go.place(CODE, 'S', node('E5'), MARK_MS)).toEqual({ success: false, reason: 'That point is taken' });
    expect(go.place(CODE, 'S', '9,0', MARK_MS)).toEqual({ success: false, reason: 'Illegal move' });
    expect(go.place(CODE, 'E', node('A1'), MARK_MS)).toEqual({ success: false, reason: 'Not your turn' });
    expect(game().log).toHaveLength(1);
  });

  it('removes captured stones, counts them for the capturer, and marks the public record', () => {
    start();
    play('N:D5', 'S:E5', 'N:E6', 'S:A9', 'N:E4', 'S:A8', 'N:F5');
    expect(game().stones[goParsePoint(9, 'E5')!]).toBeNull();
    expect(game().captures).toEqual([1, 0]);
    expect(game().log.at(-1)).toMatchObject({ seat: 'N', to: node('F5'), capture: true, captured: 1 });
    expect(coherent()).toBe(true);
  });

  it('forbids suicide but allows a move that captures', () => {
    start();
    play('N:B1', 'S:A2', 'N:A9', 'S:B2', 'N:A8');
    // White's A1 would have no liberty left: both neighbours are black.
    expect(go.place(CODE, 'S', node('A1'), MARK_MS)).toEqual({ success: true });
  });

  it('refuses suicide when no capture comes with it', () => {
    start();
    play('N:A2', 'S:E5', 'N:B1');
    expect(go.place(CODE, 'S', node('A1'), MARK_MS)).toEqual({ success: false, reason: 'Suicide is not allowed' });
  });

  it('forbids retaking a ko at once and allows it after a move elsewhere', () => {
    start();
    play(...KO);
    expect(game().stones[goParsePoint(9, 'E5')!]).toBeNull();
    expect(go.place(CODE, 'S', node('E5'), MARK_MS)).toEqual({ success: false, reason: 'Ko: that repeats an earlier position' });
    play('S:J9', 'N:J1');
    expect(go.place(CODE, 'S', node('E5'), MARK_MS)).toEqual({ success: true });
    expect(coherent()).toBe(true);
  });

  it('keeps the turn with the seat on move when a move is rejected', () => {
    start();
    expect(go.place(CODE, 'S', node('E5'), MARK_MS)).toEqual({ success: false, reason: 'Not your turn' });
    expect(game().currentTurnSeat).toBe('N');
    expect(go.pass(CODE, 'S', MARK_MS)).toEqual({ success: false, reason: 'Not your turn' });
  });
});

describe('Go marking and counting', () => {
  it('starts the marking after two passes with the server proposal of dead stones', () => {
    start();
    play('N:E5', 'S:pass');
    expect(game()).toMatchObject({ phase: 'playing', passes: 1 });
    play('N:pass');
    expect(game()).toMatchObject({ phase: 'marking', passes: 2, markDeadline: 2_000 + MARK_MS, confirmed: [], currentTurnSeat: 'S' });
    expect(Array.isArray(game().dead)).toBe(true);
    expect(go.place(CODE, 'S', node('A1'), MARK_MS)).toEqual({ success: false, reason: 'The dead stones are being marked' });
    expect(go.pass(CODE, 'S', MARK_MS)).toEqual({ success: false, reason: 'The dead stones are being marked' });
    expect(coherent()).toBe(true);
  });

  it('resets the pass count when a stone is played in between', () => {
    start();
    play('N:pass', 'S:E5', 'N:pass');
    expect(game()).toMatchObject({ phase: 'playing', passes: 1 });
  });

  /** A lone black stone and a lone white stone: the empty board splits nothing, so only the stones count. */
  function mark(): void {
    start();
    play('N:E5', 'S:A1', 'N:pass', 'S:pass');
    game().dead = [];
  }

  it('toggles whole groups, clears every confirmation, and lets either seat do it', () => {
    start();
    play('N:E5', 'S:A1', 'N:E6', 'S:pass', 'N:pass');
    game().dead = [];
    expect(go.toggleDead(CODE, 'N', node('E5'), false, 3_000)).toEqual({ success: true });
    expect(game().dead).toEqual([goParsePoint(9, 'E5')!, goParsePoint(9, 'E6')!].sort((a, b) => a - b));
    expect(go.confirmScore(CODE, 'N', game().dead, false, 3_000)).toEqual({ success: true });
    expect(game().confirmed).toEqual(['N']);
    expect(go.toggleDead(CODE, 'S', node('E6'), false, 3_000)).toEqual({ success: true });
    expect(game()).toMatchObject({ dead: [], confirmed: [] });
    expect(go.toggleDead(CODE, 'S', node('A5'), false, 3_000)).toEqual({ success: false, reason: 'There is no stone there' });
    expect(go.toggleDead(CODE, 'E', node('E5'), false, 3_000)).toEqual({ success: false, reason: 'Only players in this match can do that.' });
  });

  it('refuses to accept a marking that changed after the seat saw it', () => {
    mark();
    expect(go.toggleDead(CODE, 'S', node('A1'), false, 3_000)).toEqual({ success: true });
    expect(go.confirmScore(CODE, 'N', [], false, 3_000)).toEqual({ success: false, reason: 'The marking changed' });
    expect(go.confirmScore(CODE, 'N', [goParsePoint(9, 'A1')!], false, 3_000)).toEqual({ success: true });
    expect(go.confirmScore(CODE, 'N', [goParsePoint(9, 'A1')!], false, 3_000)).toEqual({ success: false, reason: 'Already confirmed' });
  });

  it('counts the area with komi once both seats accept, and finishes the match', () => {
    mark();
    expect(go.confirmScore(CODE, 'N', [], false, 3_000)).toEqual({ success: true });
    expect(game().phase).toBe('marking');
    expect(go.confirmScore(CODE, 'S', [], false, 3_000)).toEqual({ success: true });
    expect(game()).toMatchObject({ phase: 'scoring', dead: [], confirmed: [], markDeadline: 0 });
    expect(game().result).toEqual({
      gameType: 'go', seats: ['N', 'S'], options: { size: 9, handicap: 0 }, moves: 4, captured: { N: 0, S: 0 }, dead: [],
      area: { N: 1, S: 1 }, komi: 7.5, margin: 7.5, winners: ['S'], reason: 'score',
    });
    expect(coherent()).toBe(true);
    expect(matchStanding(game().result!, 'S')).toMatchObject({ rank: 1, won: true });
  });

  it('takes dead stones off the count, so territory goes to the side that owns the board', () => {
    start();
    // Black walls off the whole board but one white stone inside; marking it dead gives black everything.
    play('N:E5', 'S:A1', 'N:pass', 'S:pass');
    game().dead = [goParsePoint(9, 'A1')!];
    expect(go.confirmScore(CODE, 'N', game().dead, false, 3_000)).toEqual({ success: true });
    expect(go.confirmScore(CODE, 'S', game().dead, false, 3_000)).toEqual({ success: true });
    expect(game().result).toMatchObject({ dead: [goParsePoint(9, 'A1')], area: { N: 81, S: 0 }, margin: 73.5, winners: ['N'] });
    expect(coherent()).toBe(true);
  });

  it('gives white only the half point of komi when black had a handicap', () => {
    start({ size: 9, handicap: 2 });
    play('S:pass', 'N:pass');
    game().dead = [];
    go.confirmScore(CODE, 'N', [], false, 3_000);
    go.confirmScore(CODE, 'S', [], false, 3_000);
    expect(game().result).toMatchObject({ komi: 0.5, area: { N: 81, S: 0 }, margin: 80.5, winners: ['N'] });
    expect(coherent()).toBe(true);
  });

  it('refuses marking after the deadline unless the action is automatic', () => {
    mark();
    const past = game().markDeadline + 1;
    expect(go.toggleDead(CODE, 'N', node('E5'), false, past)).toEqual({ success: false, reason: 'The marking time is over' });
    expect(go.confirmScore(CODE, 'N', [], false, past)).toEqual({ success: false, reason: 'The marking time is over' });
    expect(go.confirmScore(CODE, 'N', [], true, past)).toEqual({ success: true });
  });

  it('plays on after a resume: the seat that did not pass last moves, and the count restarts', () => {
    start();
    play('N:E5', 'S:A1', 'N:pass', 'S:pass');
    expect(go.resume(CODE, 'S', false, 3_000)).toEqual({ success: true });
    expect(game()).toMatchObject({ phase: 'playing', passes: 0, resumes: [4], dead: [], confirmed: [], markDeadline: 0, currentTurnSeat: 'N' });
    expect(coherent()).toBe(true);
    play('N:pass');
    expect(game().phase).toBe('playing');
    play('S:pass');
    expect(game()).toMatchObject({ phase: 'marking', resumes: [4] });
    expect(coherent()).toBe(true);
  });

  it('cannot resume after the move limit, and cannot be marked while still playing', () => {
    start();
    expect(go.toggleDead(CODE, 'N', node('E5'), false)).toEqual({ success: false, reason: 'Play is still going on' });
    play('N:pass', 'S:pass');
    game().log.push(...Array.from({ length: goMoveLimit(9) }, () => ({ seat: 'N' as const, timestamp: 1 })));
    expect(go.resume(CODE, 'N', false, 3_000)).toEqual({ success: false, reason: 'The move limit is reached' });
  });

  it('counts at the move limit like any other count, reported as move-limit', () => {
    start();
    play('N:E5');
    // Jump to the end of the move budget: the count does not replay the log.
    Object.assign(game(), {
      phase: 'marking', passes: 0, markDeadline: 99_000, dead: [],
      log: Array.from({ length: goMoveLimit(9) }, (_, index) => ({ seat: index % 2 === 0 ? 'N' as const : 'S' as const, timestamp: 1 })),
    });
    expect(go.confirmScore(CODE, 'N', [], false, 6_000)).toEqual({ success: true });
    expect(go.confirmScore(CODE, 'S', [], false, 6_000)).toEqual({ success: true });
    expect(game().result).toMatchObject({ reason: 'move-limit', winners: ['N'], area: { N: 81, S: 0 }, moves: goMoveLimit(9) });
  });
});

describe('Go resignation', () => {
  it('lets either seat resign at any time, even off turn, and gives the other seat the win', () => {
    start();
    expect(go.control(CODE, 'S', { type: 'resign' })).toEqual({ success: true });
    expect(game()).toMatchObject({ phase: 'scoring', result: { winners: ['N'], reason: 'resign', area: {}, dead: [], margin: 0 } });
    expect(go.control(CODE, 'N', { type: 'resign' })).toEqual({ success: false, reason: 'The game is over' });
    expect(coherent()).toBe(true);
  });

  it('allows resigning while the dead stones are being marked', () => {
    start();
    play('N:E5', 'S:pass', 'N:pass');
    expect(go.control(CODE, 'N', { type: 'resign' })).toEqual({ success: true });
    expect(game()).toMatchObject({ phase: 'scoring', dead: [], confirmed: [], markDeadline: 0, result: { winners: ['S'], reason: 'resign' } });
    expect(coherent()).toBe(true);
  });

  it('offers no draws', () => {
    start();
    expect(go.control(CODE, 'N', { type: 'offer-draw' })).toEqual({ success: false, reason: 'Draw offers are only available in two-player matches.' });
    expect(parseGameAction({ gameType: 'go', action: { type: 'offer-draw' } })).toBe('This game has no draw offers.');
  });
});

describe('Go adapter and stored state', () => {
  it('gives spectators the same public position with only the observer flag added', () => {
    start();
    play('N:E5');
    const seen = go.getPlayerVisibleState(CODE, 'N')!;
    expect(goAdapter.withObserverView(go.getPlayerVisibleState(CODE, 'E') ?? seen, game(), 'spectator'))
      .toMatchObject({ observer: 'spectator', stones: seen.stones, log: seen.log });
    expect(go.getPlayerVisibleState('NOPE00', 'N')).toBeNull();
  });

  it('only runs the turn clock outside marking', () => {
    start();
    expect(goAdapter.turnSeat(game())).toBe('N');
    play('N:pass', 'S:pass');
    expect(goAdapter.turnSeat(game())).toBeNull();
    expect(goAdapter.sharedDeadline?.window(game())).toEqual({ key: `${game().id}:mark:0`, deadline: 2_000 + MARK_MS });
    expect(goAdapter.sharedDeadline?.owingSeats(game())).toEqual(['N', 'S']);
    go.confirmScore(CODE, 'N', game().dead, false, 3_000);
    expect(goAdapter.sharedDeadline?.pendingSeats(game())).toEqual(['S']);
    go.resume(CODE, 'S', false, 3_000);
    expect(goAdapter.sharedDeadline?.window(game())).toBeNull();
    expect(goAdapter.sharedDeadline?.owingSeats(game())).toBeNull();
  });

  it('accepts played games as stored state, whatever their phase, and rejects tampering', () => {
    start();
    play(...KO, 'S:J9', 'N:pass', 'S:pass');
    const marking = JSON.parse(JSON.stringify(game())) as Record<string, unknown>;
    expect(accepts(marking)).toBe(true);
    expect(goGame(marking, () => true)).toBe(true);
    for (const phase of ['playing', 'scoring']) expect(accepts({ ...structuredClone(marking), phase })).toBe(false);

    const extra = structuredClone(marking) as { stones: (number | null)[] };
    extra.stones[0] = 0;
    expect(accepts(extra)).toBe(false);
    expect(accepts({ ...structuredClone(marking), currentTurnSeat: 'S' })).toBe(false);
    expect(accepts({ ...structuredClone(marking), captures: [0, 1] })).toBe(false);
    expect(accepts({ ...structuredClone(marking), passes: 1 })).toBe(false);
    expect(accepts({ ...structuredClone(marking), options: { size: 9 } })).toBe(false);
    expect(accepts({ ...structuredClone(marking), markDeadline: 0 })).toBe(false);
    expect(accepts({ ...structuredClone(marking), dead: [0] })).toBe(false);
    expect(accepts({ ...structuredClone(marking), confirmed: ['E'] })).toBe(false);
    expect(accepts({ ...structuredClone(marking), resumes: [3] })).toBe(false);

    const wrongSeat = structuredClone(marking) as { log: { seat: string }[] };
    wrongSeat.log[1].seat = 'N';
    expect(accepts(wrongSeat)).toBe(false);
    const reused = structuredClone(marking) as { log: { to?: string }[] };
    reused.log[1].to = reused.log[0].to;
    expect(accepts(reused)).toBe(false);
    const miscounted = structuredClone(marking) as { log: { captured?: number }[] };
    miscounted.log[8].captured = 2;
    expect(accepts(miscounted)).toBe(false);
  });

  it('accepts a resumed game and rejects a resume that no pair of passes allowed', () => {
    start();
    play('N:E5', 'S:A1', 'N:pass', 'S:pass');
    go.resume(CODE, 'N', false, 3_000);
    play('N:pass', 'S:E6');
    const stored = JSON.parse(JSON.stringify(game())) as Record<string, unknown>;
    expect(accepts(stored)).toBe(true);
    expect(accepts({ ...structuredClone(stored), resumes: [] })).toBe(false);
    expect(accepts({ ...structuredClone(stored), resumes: [3] })).toBe(false);
    expect(accepts({ ...structuredClone(stored), resumes: [4, 4] })).toBe(false);
  });

  it('keeps finished results consistent with the board', () => {
    start();
    play('N:E5', 'S:A1', 'N:pass', 'S:pass');
    game().dead = [];
    go.confirmScore(CODE, 'N', [], false, 3_000);
    go.confirmScore(CODE, 'S', [], false, 3_000);
    const stored = JSON.parse(JSON.stringify(game())) as { result: Record<string, unknown> };
    expect(accepts(stored)).toBe(true);
    expect(isGoResult(stored.result)).toBe(true);
    for (const change of [{ margin: 1.5 }, { winners: ['N'] }, { area: { N: 2, S: 1 } }, { komi: 0.5 }, { moves: 3 },
      { captured: { N: 1, S: 0 } }, { dead: [0] }, { reason: 'resign' }, { reason: 'checkmate' }, { seats: ['N'] }]) {
      expect(accepts({ ...structuredClone(stored), result: { ...stored.result, ...change } }), JSON.stringify(change)).toBe(false);
    }
    expect(isGoResult({ ...stored.result, gameType: 'gomoku' })).toBe(false);
  });
});

describe('Go through the game manager', () => {
  const MANAGED = 'GOMMG1';
  afterEach(() => manager.removeGame(MANAGED));

  function begin(options: { go?: GoOptions } = {}): void {
    expect(manager.startGame(MANAGED, 'go', { N: player('N'), S: player('S') }, undefined, options)).toEqual({ success: true });
    manager.initializeClock(MANAGED);
  }

  const act = (seat: GameSeat, action: Parameters<typeof manager.handleGameAction>[2]['action'], automatic = false) =>
    manager.handleGameAction(MANAGED, seat, { gameType: 'go', action } as never, automatic);

  const state = (): GoGameState => manager.getGameState(MANAGED) as GoGameState;

  it('runs a turn clock for the seat on move and moves it with each stone', () => {
    begin();
    expect(state().clock?.turn).toMatchObject({ seat: 'N' });
    expect(act('N', { type: 'place', to: '4,4' })).toEqual({ success: true });
    expect(state().clock?.turn).toMatchObject({ seat: 'S' });
    const turn = state().clock?.turn;
    expect(act('N', { type: 'resign' })).toEqual({ success: true });
    expect(turn).toMatchObject({ seat: 'S' });
    expect(state().clock?.turn).toBeNull();
  });

  it('stops the turn clock while marking and starts the mover clock again on resume', () => {
    begin();
    expect(act('N', { type: 'pass' })).toEqual({ success: true });
    expect(act('S', { type: 'pass' })).toEqual({ success: true });
    expect(state()).toMatchObject({ phase: 'marking', clock: { turn: null } });
    expect(act('S', { type: 'resume' })).toEqual({ success: true });
    expect(state()).toMatchObject({ phase: 'playing' });
    expect(state().clock?.turn).toMatchObject({ seat: 'N' });
  });

  it('collects the marking against one shared deadline and accepts automatic answers after it', () => {
    begin();
    act('N', { type: 'place', to: '4,4' });
    act('S', { type: 'pass' });
    act('N', { type: 'pass' });
    const window = manager.getSharedDeadlineWindow(state());
    expect(window).toEqual({ key: `${state().id}:mark:0`, deadline: state().markDeadline });
    expect(manager.getOwingSeats(state())).toEqual(['N', 'S']);
    expect(manager.overdueSharedDeadlineSeats(MANAGED, state().id, state().markDeadline - 1)).toEqual([]);
    expect(manager.overdueSharedDeadlineSeats(MANAGED, state().id, state().markDeadline)).toEqual(['N', 'S']);

    state().markDeadline = Date.now() - 10;
    const dead = [...state().dead];
    expect(act('N', { type: 'confirm-score', dead })).toEqual({ success: false, reason: 'The marking time is over' });
    expect(act('N', { type: 'confirm-score', dead }, true)).toEqual({ success: true });
    expect(act('S', { type: 'confirm-score', dead }, true)).toEqual({ success: true });
    expect(state()).toMatchObject({ phase: 'scoring', clock: { turn: null } });
    expect(manager.getMatchResult(state())).toMatchObject({ gameType: 'go', reason: 'score' });
    expect(accepts(JSON.parse(JSON.stringify(state())))).toBe(true);
  });

  it('keeps the stored state valid after every kind of action', () => {
    begin({ go: { size: 13, handicap: 3 } });
    for (const [seat, action] of [
      ['S', { type: 'place', to: '5,5' }], ['N', { type: 'place', to: '6,6' }], ['S', { type: 'pass' }], ['N', { type: 'pass' }],
      ['S', { type: 'resume' }], ['S', { type: 'place', to: '7,7' }], ['N', { type: 'pass' }], ['S', { type: 'pass' }],
    ] as const) {
      expect(act(seat, action)).toEqual({ success: true });
      expect(accepts(JSON.parse(JSON.stringify(state()))), JSON.stringify(action)).toBe(true);
    }
    const visible = manager.getPlayerVisibleState(MANAGED, 'N') as GoVisibleState;
    expect(visible).toMatchObject({ gameType: 'go', phase: 'marking', resumes: [4], options: { size: 13, handicap: 3 } });
  });
});
