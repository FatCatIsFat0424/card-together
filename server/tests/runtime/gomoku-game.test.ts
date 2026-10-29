import { afterEach, describe, expect, it } from 'vitest';
import type { GameSeat, GomokuGameState, PlayerInfo } from '@shared/types';
import { gameDefinition } from '@shared/games/registry';
import { parseGameAction } from '@shared/games/actions';
import { matchStanding } from '@shared/rules/match-standing';
import { DRAW_REOFFER_MOVES } from '@shared/rules/board/match-controls';
import { GM_CELLS, gmNode, gmStoneCount } from '@shared/rules/gomoku';
import type { GomokuOptions } from '@shared/rules/gomoku';
import { gomokuAdapter } from '../../src/managers/games/gomoku-adapter';
import * as gomoku from '../../src/managers/games/gomoku-game';
import { coherentGomokuGame, gomokuGame, isGomokuResult } from '../../src/managers/games/gomoku-validation';
import { gameValidator } from '../../src/managers/games/validation-registry';
import * as manager from '../../src/managers/game-manager';

const CODE = 'GOMOK1';

function player(seat: GameSeat): PlayerInfo {
  return { id: seat.toLowerCase(), username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null };
}

function start(options?: GomokuOptions, seats: readonly GameSeat[] = ['N', 'S']): void {
  gomoku.startGame(CODE, Object.fromEntries(seats.map((seat) => [seat, player(seat)])), options, 1_000);
}

function game(): GomokuGameState {
  const state = gomoku.getGameState(CODE);
  if (!state) throw new Error('Expected a Gomoku game');
  return state;
}

const coherent = (): boolean => coherentGomokuGame(structuredClone(game()));

/** Chess-style coordinate (`h8`) as a board node id; rank 15 is the top row. */
const node = (name: string): string => gmNode((15 - Number(name.slice(1))) * 15 + name.charCodeAt(0) - 97);

/** Plays `seat:point` steps in order and expects each to succeed. */
function play(...steps: string[]): void {
  for (const step of steps) {
    const [seat, point] = step.split(':');
    expect(gomoku.place(CODE, seat as GameSeat, node(point), 2_000)).toEqual({ success: true });
  }
}

/** Black plays the first of `blackMoves`, white one of the far-away fillers, and so on, ending on black's move. */
function alternate(blackMoves: readonly string[], fillers: readonly string[] = ['a1', 'a3', 'a5', 'a7', 'a9', 'a11']): void {
  blackMoves.forEach((point, index) => {
    play(`N:${point}`);
    if (index < blackMoves.length - 1) play(`S:${fillers[index]}`);
  });
}

afterEach(() => gomoku.abortGame(CODE));

describe('Gomoku setup', () => {
  it('registers a two-player flexible board game with room rules, the board timer, resign and draw offers', () => {
    expect(gameDefinition('gomoku')).toMatchObject({
      category: 'board', equipment: [], seats: { minPlayers: 2, maxPlayers: 2, flexible: true },
      matchControls: { resign: true, draw: true }, timeControl: { baseSeconds: 60, bankSeconds: 300 },
      options: { defaults: { renju: false, swap: false } },
    });
  });

  it('starts on an empty board with the first occupied seat playing black', () => {
    start(undefined, ['E', 'W']);
    expect(game()).toMatchObject({ phase: 'playing', currentTurnSeat: 'E', result: null, log: [],
      options: { renju: false, swap: false } });
    expect(gmStoneCount(game().stones)).toBe(0);
    expect(gomoku.getPlayerVisibleState(CODE, 'W')).toMatchObject({
      seats: ['E', 'W'], mySeat: 'W', currentTurnSeat: 'E', options: { renju: false, swap: false },
    });
    expect(coherent()).toBe(true);
  });
});

describe('Gomoku moves', () => {
  it('alternates colours, logs the public move, and passes the turn', () => {
    start();
    play('N:h8');
    expect(game().log).toEqual([{ seat: 'N', to: '7,7', timestamp: 2_000 }]);
    expect(game().currentTurnSeat).toBe('S');
    play('S:i9');
    expect([game().stones[7 * 15 + 7], game().stones[6 * 15 + 8]]).toEqual([0, 1]);
    expect(game().currentTurnSeat).toBe('N');
    expect(coherent()).toBe(true);
  });

  it('rejects moves out of turn, on occupied or invalid points, and after the end', () => {
    start();
    expect(gomoku.place(CODE, 'S', node('h8'))).toMatchObject({ success: false, reason: 'Not your turn' });
    play('N:h8');
    expect(gomoku.place(CODE, 'S', node('h8'))).toMatchObject({ success: false, reason: 'Illegal move' });
    expect(gomoku.place(CODE, 'S', '15,0')).toMatchObject({ success: false, reason: 'Illegal move' });
    expect(gomoku.place(CODE, 'S', 'h8')).toMatchObject({ success: false, reason: 'Illegal move' });
    expect(gomoku.chooseSide(CODE, 'S', true)).toMatchObject({ success: false, reason: 'No side to choose' });
    expect(game().log).toHaveLength(1);
    gomoku.control(CODE, 'S', { type: 'resign' });
    expect(gomoku.place(CODE, 'N', node('a1'))).toMatchObject({ success: false, reason: 'The game is over' });
    expect(gomoku.place('NOPE00', 'N', node('a1'))).toMatchObject({ success: false, reason: 'Game not found' });
  });

  it('ends on five in a row, crediting the mover with a result that agrees with the board', () => {
    start();
    alternate(['h8', 'i8', 'j8', 'k8', 'l8']);
    expect(game().phase).toBe('scoring');
    expect(game().result).toMatchObject({
      gameType: 'gomoku', seats: ['N', 'S'], blackSeat: 'N', winners: ['N'], reason: 'five-in-row', moves: 9,
      options: { renju: false, swap: false },
    });
    expect(game().currentTurnSeat).toBe('N');
    expect(coherent()).toBe(true);
    expect(isGomokuResult(JSON.parse(JSON.stringify(game().result)))).toBe(true);
    expect(['N', 'S'].map((seat) => matchStanding(game().result!, seat as GameSeat))).toMatchObject([
      { rank: 1, won: true }, { rank: 2, won: false },
    ]);
  });

  it('lets white win by five too', () => {
    start();
    play('N:a1', 'S:h8', 'N:o15', 'S:i8', 'N:o13', 'S:j8', 'N:o11', 'S:k8', 'N:o9', 'S:l8');
    expect(game().result).toMatchObject({ winners: ['S'], reason: 'five-in-row', blackSeat: 'N', moves: 10 });
    expect(coherent()).toBe(true);
  });

  it('counts six in a row as a win in free-style play', () => {
    start();
    alternate(['e8', 'f8', 'g8', 'i8', 'j8', 'h8']);
    expect(game().result).toMatchObject({ winners: ['N'], reason: 'five-in-row' });
    expect(coherent()).toBe(true);
  });

  it('draws when the board fills without a line', () => {
    start();
    // Black holds pairs of columns on alternate rows, which never lines up three, let alone five.
    const colour = (index: number): 0 | 1 => ((((index % 15) >> 1) + Math.floor(index / 15)) % 2) as 0 | 1;
    const cells = Array.from({ length: GM_CELLS }, (_, index) => index);
    const black = cells.filter((index) => colour(index) === 0 && index !== 0);
    const white = cells.filter((index) => colour(index) === 1);
    expect([black.length, white.length]).toEqual([112, 112]);
    const state = game();
    black.forEach((index, order) => {
      state.stones[index] = 0;
      state.log.push({ seat: 'N', to: gmNode(index), timestamp: 1 });
      state.stones[white[order]] = 1;
      state.log.push({ seat: 'S', to: gmNode(white[order]), timestamp: 1 });
    });
    expect(coherent()).toBe(true);
    expect(gomoku.place(CODE, 'N', gmNode(0), 3_000)).toEqual({ success: true });
    expect(game().phase).toBe('scoring');
    expect(game().result).toMatchObject({ winners: [], reason: 'board-full', moves: GM_CELLS });
    expect(coherent()).toBe(true);
    expect(isGomokuResult(JSON.parse(JSON.stringify(game().result)))).toBe(true);
  });
});

describe('Gomoku Renju rule', () => {
  it('rejects a black double three without changing the position, and lets white play the same point', () => {
    start({ renju: true, swap: false });
    alternate(['f8', 'g8', 'h9', 'h10']);
    play('S:a11');
    const before = structuredClone(game());
    expect(gomoku.place(CODE, 'N', node('h8'))).toMatchObject({ success: false, reason: 'Forbidden move' });
    expect(game()).toEqual(before);
    play('N:o1');
    expect(gomoku.place(CODE, 'S', node('h8'))).toEqual({ success: true });
    expect(coherent()).toBe(true);
  });

  it('plays the same point freely when Renju is off', () => {
    start();
    alternate(['f8', 'g8', 'h9', 'h10']);
    play('S:a11', 'N:h8');
    expect(game().phase).toBe('playing');
  });

  it('rejects an overline for black but not five', () => {
    start({ renju: true, swap: false });
    alternate(['e8', 'f8', 'g8', 'i8', 'j8']);
    play('S:a11');
    expect(gomoku.place(CODE, 'N', node('h8'))).toMatchObject({ success: false, reason: 'Forbidden move' });
    expect(game().phase).toBe('playing');
  });

  it('wins for black with exactly five', () => {
    start({ renju: true, swap: false });
    alternate(['f8', 'g8', 'h8', 'i8', 'j8']);
    expect(game().result).toMatchObject({ winners: ['N'], reason: 'five-in-row', options: { renju: true } });
    expect(coherent()).toBe(true);
  });

  it('keeps white free of the forbidden-move rule: six in a row still wins', () => {
    start({ renju: true, swap: false });
    play('N:a1', 'S:e8', 'N:o15', 'S:f8', 'N:o13', 'S:g8', 'N:o11', 'S:i8', 'N:o9', 'S:j8', 'N:o7', 'S:h8');
    expect(game().result).toMatchObject({ winners: ['S'], reason: 'five-in-row' });
    expect(coherent()).toBe(true);
  });
});

describe('Gomoku swap opening', () => {
  const OPTIONS: GomokuOptions = { renju: false, swap: true };

  it('lets the first seat place black, white, black, then asks the second seat for a colour', () => {
    start(OPTIONS);
    expect(gomoku.place(CODE, 'S', node('h8'))).toMatchObject({ reason: 'Not your turn' });
    play('N:h8', 'N:i9');
    expect(game().currentTurnSeat).toBe('N');
    expect(gomoku.chooseSide(CODE, 'N', true)).toMatchObject({ reason: 'No side to choose' });
    play('N:g7');
    expect(game().currentTurnSeat).toBe('S');
    expect(game().stones[8 * 15 + 6]).toBe(0);
    expect(gomoku.place(CODE, 'S', node('a1'))).toMatchObject({ reason: 'Choose a side first' });
    expect(gomoku.chooseSide(CODE, 'N', false)).toMatchObject({ reason: 'Not your turn' });
    expect(coherent()).toBe(true);
  });

  it('keeps the colours when the second seat stays white, who then moves', () => {
    start(OPTIONS);
    play('N:h8', 'N:i9', 'N:g7');
    expect(gomoku.chooseSide(CODE, 'S', false, 4_000)).toEqual({ success: true });
    expect(game().log.at(-1)).toEqual({ seat: 'S', swap: false, timestamp: 4_000 });
    expect(game().currentTurnSeat).toBe('S');
    play('S:j10', 'N:f6');
    expect(game().stones[5 * 15 + 9]).toBe(1);
    expect(game().stones[9 * 15 + 5]).toBe(0);
    expect(coherent()).toBe(true);
  });

  it('swaps the sides when the second seat takes black: the first seat becomes white and moves', () => {
    start(OPTIONS);
    play('N:h8', 'N:i9', 'N:g7');
    expect(gomoku.chooseSide(CODE, 'S', true)).toEqual({ success: true });
    expect(game().currentTurnSeat).toBe('N');
    play('N:j10', 'S:f6');
    expect(game().stones[5 * 15 + 9]).toBe(1);
    expect(game().stones[9 * 15 + 5]).toBe(0);
    expect(coherent()).toBe(true);
    // The new black seat owns the opening stones h8 and g7, so f6, e5 and d4 complete its diagonal.
    play('N:a1', 'S:e5', 'N:a3', 'S:d4');
    expect(game().result).toMatchObject({ winners: ['S'], blackSeat: 'S', reason: 'five-in-row' });
    expect(coherent()).toBe(true);
  });

  it('does not run in a room without the option', () => {
    start();
    play('N:h8', 'S:i9', 'N:g7');
    expect(game().currentTurnSeat).toBe('S');
    expect(gomoku.chooseSide(CODE, 'S', true)).toMatchObject({ reason: 'No side to choose' });
  });

  it('allows a draw offer and resignation during the opening choice', () => {
    start(OPTIONS);
    play('N:h8', 'N:i9', 'N:g7');
    expect(gomoku.control(CODE, 'S', { type: 'offer-draw' })).toEqual({ success: true });
    expect(gomoku.control(CODE, 'N', { type: 'answer-draw', accept: true })).toEqual({ success: true });
    expect(game().result).toMatchObject({ winners: [], reason: 'agreed-draw', moves: 3, blackSeat: 'N' });
    expect(coherent()).toBe(true);
  });
});

describe('Gomoku resignation and draw offers', () => {
  it('lets either seat resign at any time, even off turn, and gives the other seat the win', () => {
    start();
    expect(gomoku.control(CODE, 'S', { type: 'resign' })).toEqual({ success: true });
    expect(game().result).toMatchObject({ winners: ['N'], reason: 'resign', moves: 0, blackSeat: 'N' });
    expect(game().phase).toBe('scoring');
    expect(coherent()).toBe(true);
  });

  it('offers a draw only on the own turn and ends in a draw when the opponent accepts', () => {
    start();
    expect(gomoku.control(CODE, 'S', { type: 'offer-draw' })).toMatchObject({ success: false });
    expect(gomoku.control(CODE, 'N', { type: 'offer-draw' })).toEqual({ success: true });
    expect(gomoku.control(CODE, 'N', { type: 'answer-draw', accept: true })).toMatchObject({ success: false });
    expect(gomoku.control(CODE, 'S', { type: 'answer-draw', accept: true })).toEqual({ success: true });
    expect(game().result).toMatchObject({ winners: [], reason: 'agreed-draw' });
    expect(coherent()).toBe(true);
    expect(['N', 'S'].map((seat) => matchStanding(game().result!, seat as GameSeat))).toMatchObject([
      { rank: 1, tied: true, won: true }, { rank: 1, tied: true, won: true },
    ]);
  });

  it('treats the opponent moving as a rejection and then blocks new offers for three own moves', () => {
    start();
    gomoku.control(CODE, 'N', { type: 'offer-draw' });
    play('N:h8');
    expect(game().drawOffer.offeredBy).toBe('N');
    play('S:i9');
    expect(game().drawOffer).toEqual({ offeredBy: null, cooldown: { N: DRAW_REOFFER_MOVES } });
    expect(gomoku.control(CODE, 'N', { type: 'offer-draw' })).toMatchObject({ success: false });
  });
});

describe('Gomoku adapter and stored state', () => {
  it('starts with the room rules, routes controls without the clock, and placements and colour choices through it', () => {
    const timed: string[] = [];
    const context = {
      automatic: false, settings: { baseSeconds: 60, bankSeconds: 300 },
      timed: (operation: () => { success: boolean }) => { timed.push('timed'); return operation(); },
      present: (operation: () => { success: boolean }) => { timed.push('present'); return operation(); },
      simultaneous: (operation: () => { success: boolean }) => operation(),
      resetClock: () => undefined,
    };
    expect(gomokuAdapter.start({
      roomCode: CODE, players: { N: player('N'), S: player('S') }, settings: context.settings,
      options: { gomoku: { renju: true, swap: true } },
    })).toEqual({ success: true });
    expect(game().options).toEqual({ renju: true, swap: true });
    expect(gomokuAdapter.applyAction(CODE, 'N', { type: 'offer-draw' }, context as never)).toEqual({ success: true });
    expect(timed).toEqual([]);
    for (const point of ['h8', 'i9', 'g7']) {
      expect(gomokuAdapter.applyAction(CODE, 'N', { type: 'place', to: node(point) }, context as never)).toEqual({ success: true });
    }
    expect(gomokuAdapter.applyAction(CODE, 'S', { type: 'choose-side', swap: true }, context as never)).toEqual({ success: true });
    expect(timed).toEqual(['timed', 'timed', 'timed', 'timed']);
    expect(gomokuAdapter.turnSeat(game())).toBe('N');
    expect(gomokuAdapter.matchResult(game())).toBeNull();
  });

  it('gives spectators the same public position with only the observer flag added', () => {
    start();
    play('N:h8');
    const own = gomoku.getPlayerVisibleState(CODE, 'S')!;
    const spectator = gomokuAdapter.withObserverView(gomoku.getPlayerVisibleState(CODE, 'W')!, game(), 'spectator');
    expect(spectator).toMatchObject({ observer: 'spectator', stones: own.stones, log: own.log, seats: own.seats });
    expect(Object.keys(own).sort()).toEqual(['currentTurnSeat', 'drawOffer', 'gameType', 'log', 'mySeat', 'options',
      'phase', 'result', 'seats', 'stones']);
  });

  it('accepts played games as stored state and rejects tampering', () => {
    start({ renju: true, swap: true });
    play('N:h8', 'N:i9', 'N:g7');
    gomoku.chooseSide(CODE, 'S', true);
    play('N:j10', 'S:f6', 'N:a1');
    const stored = JSON.parse(JSON.stringify(game())) as Record<string, unknown>;
    const accepts = (value: unknown): boolean => gameValidator('gomoku').shape(value as never, () => true)
      && gameValidator('gomoku').coherent(value as GomokuGameState);
    expect(accepts(stored)).toBe(true);
    expect(gomokuGame(stored, () => true)).toBe(true);

    const extra = structuredClone(stored) as { stones: (number | null)[] };
    extra.stones[0] = 0;
    expect(accepts(extra)).toBe(false);

    const wrongTurn = { ...structuredClone(stored), currentTurnSeat: game().currentTurnSeat === 'N' ? 'S' : 'N' };
    expect(accepts(wrongTurn)).toBe(false);

    const wrongSeat = structuredClone(stored) as { log: { seat: string }[] };
    wrongSeat.log[1].seat = 'S';
    expect(accepts(wrongSeat)).toBe(false);

    const earlyChoice = structuredClone(stored) as { log: Record<string, unknown>[] };
    earlyChoice.log[1] = { seat: 'S', swap: true, timestamp: 1 };
    expect(accepts(earlyChoice)).toBe(false);

    const bothFields = structuredClone(stored) as { log: Record<string, unknown>[] };
    bothFields.log[3].to = '0,0';
    expect(accepts(bothFields)).toBe(false);

    const reused = structuredClone(stored) as { log: { to: string }[] };
    reused.log[1].to = reused.log[0].to;
    expect(accepts(reused)).toBe(false);

    expect(accepts({ ...structuredClone(stored), options: { renju: true } })).toBe(false);
    expect(accepts({ ...structuredClone(stored), result: { gameType: 'gomoku' } })).toBe(false);
    expect(accepts({ ...structuredClone(stored), phase: 'scoring' })).toBe(false);
  });

  it('rejects a stored forbidden move and a finished game whose result disagrees with the board', () => {
    start({ renju: true, swap: false });
    alternate(['f8', 'g8', 'h9', 'h10']);
    play('S:a11');
    const stored = JSON.parse(JSON.stringify(game())) as { log: Record<string, unknown>[]; stones: (number | null)[] };
    stored.log.push({ seat: 'N', to: node('h8'), timestamp: 3 });
    stored.stones[7 * 15 + 7] = 0;
    expect(coherentGomokuGame(stored as never)).toBe(false);
    stored.log.pop();
    stored.stones[7 * 15 + 7] = null;

    gomoku.abortGame(CODE);
    start();
    alternate(['h8', 'i8', 'j8', 'k8', 'l8']);
    const won = JSON.parse(JSON.stringify(game())) as { result: Record<string, unknown> };
    expect(coherentGomokuGame(won as never)).toBe(true);
    expect(coherentGomokuGame({ ...won, result: { ...won.result, winners: ['S'] } } as never)).toBe(false);
    expect(coherentGomokuGame({ ...won, result: { ...won.result, reason: 'board-full', winners: [] } } as never)).toBe(false);
    expect(coherentGomokuGame({ ...won, result: { ...won.result, blackSeat: 'S' } } as never)).toBe(false);
    expect(coherentGomokuGame({ ...won, result: { ...won.result, moves: 8 } } as never)).toBe(false);
    expect(coherentGomokuGame({ ...won, result: { ...won.result, options: { renju: true, swap: false } } } as never)).toBe(false);
  });

  it('keeps stored results consistent with their reason', () => {
    const result = {
      gameType: 'gomoku', seats: ['N', 'S'], blackSeat: 'N', moves: 21, winners: ['N'], reason: 'five-in-row',
      options: { renju: false, swap: false },
    };
    expect(isGomokuResult(result)).toBe(true);
    expect(isGomokuResult({ ...result, winners: [] })).toBe(false);
    expect(isGomokuResult({ ...result, moves: 8 })).toBe(false);
    expect(isGomokuResult({ ...result, reason: 'resign' })).toBe(true);
    expect(isGomokuResult({ ...result, reason: 'agreed-draw' })).toBe(false);
    expect(isGomokuResult({ ...result, reason: 'agreed-draw', winners: [] })).toBe(true);
    expect(isGomokuResult({ ...result, reason: 'board-full', winners: [] })).toBe(false);
    expect(isGomokuResult({ ...result, reason: 'board-full', winners: [], moves: 225 })).toBe(true);
    expect(isGomokuResult({ ...result, reason: 'timeout' })).toBe(false);
    expect(isGomokuResult({ ...result, blackSeat: 'E' })).toBe(false);
    expect(isGomokuResult({ ...result, seats: ['N'] })).toBe(false);
    expect(isGomokuResult({ ...result, moves: 226 })).toBe(false);
    expect(isGomokuResult({ ...result, options: { renju: false } })).toBe(false);
  });

  it('parses only placements on board points, colour choices, and the match controls', () => {
    const parse = (action: unknown): unknown => parseGameAction({ gameType: 'gomoku', action });
    expect(parse({ type: 'place', to: '14,14' })).toEqual({ gameType: 'gomoku', action: { type: 'place', to: '14,14' } });
    expect(parse({ type: 'choose-side', swap: true })).toEqual({ gameType: 'gomoku', action: { type: 'choose-side', swap: true } });
    expect(parse({ type: 'resign' })).toEqual({ gameType: 'gomoku', action: { type: 'resign' } });
    expect(parse({ type: 'answer-draw', accept: false })).toEqual({ gameType: 'gomoku', action: { type: 'answer-draw', accept: false } });
    for (const bad of [{ type: 'place', to: '15,0' }, { type: 'place', to: 12 }, { type: 'place' },
      { type: 'choose-side' }, { type: 'choose-side', swap: 'yes' }, { type: 'answer-draw' }, { type: 'pass' }, null, 'resign']) {
      expect(typeof parse(bad)).toBe('string');
    }
  });
});

describe('Gomoku through the game manager', () => {
  const MANAGED = 'GOMMG1';
  afterEach(() => manager.removeGame(MANAGED));

  function begin(options: { gomoku?: GomokuOptions } = {}): void {
    expect(manager.startGame(MANAGED, 'gomoku', { N: player('N'), S: player('S') }, undefined, options)).toEqual({ success: true });
    manager.initializeClock(MANAGED);
  }

  it('runs a turn clock for the seat on move and moves it with each placement', () => {
    begin();
    expect(manager.getGameState(MANAGED)?.clock?.turn).toMatchObject({ seat: 'N' });
    expect(manager.handleGameAction(MANAGED, 'N', { gameType: 'gomoku', action: { type: 'place', to: '7,7' } }))
      .toEqual({ success: true });
    expect(manager.getGameState(MANAGED)?.clock?.turn).toMatchObject({ seat: 'S' });
    const turn = manager.getGameState(MANAGED)?.clock?.turn;
    expect(manager.handleGameAction(MANAGED, 'S', { gameType: 'gomoku', action: { type: 'offer-draw' } })).toEqual({ success: true });
    expect(manager.getGameState(MANAGED)?.clock?.turn).toEqual(turn);
  });

  it('moves the clock to the second seat for the colour choice and back to white afterwards', () => {
    begin({ gomoku: { renju: false, swap: true } });
    for (const to of ['7,7', '8,6', '6,8']) {
      expect(manager.handleGameAction(MANAGED, 'N', { gameType: 'gomoku', action: { type: 'place', to } })).toEqual({ success: true });
    }
    expect(manager.getGameState(MANAGED)?.clock?.turn).toMatchObject({ seat: 'S' });
    expect(manager.handleGameAction(MANAGED, 'S', { gameType: 'gomoku', action: { type: 'choose-side', swap: true } }))
      .toEqual({ success: true });
    expect(manager.getGameState(MANAGED)?.clock?.turn).toMatchObject({ seat: 'N' });
  });

  it('stops the clock when resigning ends the match, and keeps the stored state valid', () => {
    begin();
    expect(manager.handleGameAction(MANAGED, 'S', { gameType: 'gomoku', action: { type: 'resign' } })).toEqual({ success: true });
    expect(manager.getGameState(MANAGED)).toMatchObject({ phase: 'scoring', clock: { turn: null } });
    expect(manager.getMatchResult(manager.getGameState(MANAGED)!)).toMatchObject({ winners: ['N'], reason: 'resign' });
    const state = JSON.parse(JSON.stringify(manager.getGameState(MANAGED))) as GomokuGameState;
    expect(gameValidator('gomoku').shape(state as never, () => true)).toBe(true);
    expect(gameValidator('gomoku').coherent(state)).toBe(true);
  });
});
