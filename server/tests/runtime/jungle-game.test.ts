import { afterEach, describe, expect, it } from 'vitest';
import type { GameSeat, JungleGameState, PlayerInfo } from '@shared/types';
import { gameDefinition } from '@shared/games/registry';
import { parseGameAction } from '@shared/games/actions';
import { matchStanding } from '@shared/rules/match-standing';
import { DRAW_REOFFER_MOVES } from '@shared/rules/board/match-controls';
import { JG_CELLS, JG_NO_CAPTURE_LIMIT, jgIndex, jgInitialCells, jgLegalMoves, jgNode, jgPieceCount } from '@shared/rules/jungle';
import type { JgSide } from '@shared/rules/jungle';
import { jungleAdapter } from '../../src/managers/games/jungle-adapter';
import * as jungle from '../../src/managers/games/jungle-game';
import { coherentJungleGame, isJungleResult, jungleGame } from '../../src/managers/games/jungle-validation';
import { gameValidator } from '../../src/managers/games/validation-registry';
import { gameBot } from '../../src/bots/bot-registry';
import { getBotAction } from '../../src/bots/bot-decisions';
import * as manager from '../../src/managers/game-manager';

const CODE = 'JUNGL1';

function player(seat: GameSeat): PlayerInfo {
  return { id: seat.toLowerCase(), username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null };
}

function start(seats: readonly GameSeat[] = ['N', 'S']): void {
  jungle.startGame(CODE, Object.fromEntries(seats.map((seat) => [seat, player(seat)])), 1_000);
}

function game(): JungleGameState {
  const state = jungle.getGameState(CODE);
  if (!state) throw new Error('Expected a Jungle game');
  return state;
}

const coherent = (): boolean => coherentJungleGame(structuredClone(game()));

/** A position from nine rows of seven characters: `.` empty, `1`-`8` the first side, `a`-`h` the second. */
function setBoard(rows: readonly string[]): void {
  game().cells = rows.join('').split('').map((char) => (char === '.' ? 0 : /\d/.test(char) ? Number(char) : char.charCodeAt(0) - 96 + 8));
}

const EMPTY = Array<string>(9).fill('.......');
function board(...pieces: readonly [number, number, string][]): string[] {
  const rows = EMPTY.map((row) => row.split(''));
  for (const [col, row, char] of pieces) rows[row][col] = char;
  return rows.map((row) => row.join(''));
}

/** Plays random legal moves from a seeded generator until the match ends or `limit` moves were made. */
function playOut(seed: number, limit = Infinity): void {
  let state = seed;
  const random = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let plies = 0; plies < limit && game().phase === 'playing'; plies++) {
    const seat = game().currentTurnSeat;
    const side: JgSide = jungle.jungleSeats(game()).indexOf(seat) === 0 ? 0 : 1;
    const moves = jgLegalMoves(game().cells, side);
    expect(moves.length).toBeGreaterThan(0);
    const picked = moves[Math.floor(random() * moves.length)];
    expect(jungle.move(CODE, seat, jgNode(picked.from), jgNode(picked.to), 2_000)).toEqual({ success: true });
  }
}

afterEach(() => jungle.abortGame(CODE));

describe('Jungle setup', () => {
  it('registers a two-player flexible board game on the board timer with resign and draw offers', () => {
    expect(gameDefinition('jungle')).toMatchObject({
      category: 'board', equipment: [], seats: { minPlayers: 2, maxPlayers: 2, flexible: true },
      matchControls: { resign: true, draw: true }, timeControl: { baseSeconds: 60, bankSeconds: 300 },
    });
  });

  it('starts from the standard position with the first occupied seat moving first', () => {
    start(['E', 'W']);
    expect(game()).toMatchObject({ phase: 'playing', currentTurnSeat: 'E', result: null, log: [], cells: jgInitialCells() });
    expect(jungle.getPlayerVisibleState(CODE, 'W')).toMatchObject({ seats: ['E', 'W'], mySeat: 'W', currentTurnSeat: 'E' });
    expect(coherent()).toBe(true);
  });
});

describe('Jungle moves', () => {
  it('moves a piece, passes the turn, and logs the public move', () => {
    start();
    expect(jungle.move(CODE, 'N', '0,6', '0,5', 1_500)).toEqual({ success: true });
    expect(game().log).toEqual([{ seat: 'N', from: '0,6', to: '0,5', piece: 8, capture: false, timestamp: 1_500 }]);
    expect(game().currentTurnSeat).toBe('S');
    expect(game().cells[jgIndex(0, 5)]).toBe(8);
    expect(game().cells[jgIndex(0, 6)]).toBe(0);
    expect(coherent()).toBe(true);
  });

  it('logs captures with the animal that moved and the one taken', () => {
    start();
    setBoard(board([3, 4, '1'], [3, 3, 'h'], [0, 8, '2'], [6, 0, 'b']));
    expect(jungle.move(CODE, 'N', '3,4', '3,3', 2_000)).toEqual({ success: true });
    expect(game().log.at(-1)).toEqual({ seat: 'N', from: '3,4', to: '3,3', piece: 1, capture: true, captured: 8, timestamp: 2_000 });
    expect(jgPieceCount(game().cells, 1)).toBe(1);
  });

  it('rejects moves out of turn, illegal moves, bad ids, and moves after the end', () => {
    start();
    expect(jungle.move(CODE, 'S', '0,2', '0,3')).toMatchObject({ success: false, reason: 'Not your turn' });
    expect(jungle.move(CODE, 'N', '0,6', '0,4')).toMatchObject({ success: false, reason: 'Illegal move' });
    expect(jungle.move(CODE, 'N', '0,0', '0,1')).toMatchObject({ success: false, reason: 'Illegal move' });
    expect(jungle.move(CODE, 'N', '9,9', '0,5')).toMatchObject({ success: false, reason: 'Illegal move' });
    expect(jungle.move(CODE, 'N', '3,8', '3,7')).toMatchObject({ success: false, reason: 'Illegal move' });
    expect(game().log).toEqual([]);
    jungle.control(CODE, 'S', { type: 'resign' });
    expect(jungle.move(CODE, 'N', '0,6', '0,5')).toMatchObject({ success: false, reason: 'The game is over' });
    expect(jungle.move('NOPE00', 'N', '0,6', '0,5')).toMatchObject({ success: false, reason: 'Game not found' });
  });

  it('ends the match when a piece enters the opponent’s den', () => {
    start();
    setBoard(board([3, 1, '4'], [0, 0, 'g'], [6, 8, '2']));
    expect(jungle.move(CODE, 'N', '3,1', '3,0', 3_000)).toEqual({ success: true });
    expect(game().phase).toBe('scoring');
    expect(game().result).toMatchObject({
      gameType: 'jungle', seats: ['N', 'S'], winners: ['N'], reason: 'den-entered', pieces: { N: 2, S: 1 }, moves: 1,
    });
  });

  it('ends the match when the last opposing piece is captured', () => {
    start();
    setBoard(board([3, 4, '4'], [3, 3, 'c'], [6, 8, '2']));
    expect(jungle.move(CODE, 'N', '3,4', '3,3', 3_000)).toEqual({ success: true });
    expect(game().result).toMatchObject({ winners: ['N'], reason: 'all-captured', pieces: { N: 2, S: 0 } });
  });

  it('ends the match when the opponent is left without a legal move', () => {
    start();
    setBoard(board([0, 0, 'a'], [1, 0, '7'], [0, 2, '7'], [5, 8, '2']));
    // The rat's only exit, (0,1), is taken by the lion stepping in.
    expect(jungle.move(CODE, 'N', '0,2', '0,1', 3_000)).toEqual({ success: true });
    expect(game().result).toMatchObject({ winners: ['N'], reason: 'no-moves' });
  });

  it('draws after a hundred plies without a capture', () => {
    start();
    setBoard(board([0, 8, '2'], [6, 0, 'b']));
    const hops: readonly (readonly [GameSeat, string, string])[] = [
      ['N', '0,8', '0,7'], ['S', '6,0', '6,1'], ['N', '0,7', '0,8'], ['S', '6,1', '6,0'],
    ];
    for (let cycle = 0; cycle < JG_NO_CAPTURE_LIMIT / hops.length; cycle++) {
      for (const [seat, from, to] of hops) {
        expect(game().phase).toBe('playing');
        expect(jungle.move(CODE, seat, from, to)).toEqual({ success: true });
      }
    }
    expect(game().phase).toBe('scoring');
    expect(game().result).toMatchObject({ winners: [], reason: 'no-capture-limit', moves: JG_NO_CAPTURE_LIMIT });
  });

  it('plays seeded random matches to the end with a coherent log at every step', () => {
    for (const seed of [1, 2, 3]) {
      start();
      for (let step = 0; step < 6 && game().phase === 'playing'; step++) {
        playOut(seed + step * 100, 7);
        expect(coherent()).toBe(true);
      }
      playOut(seed);
      expect(game().phase).toBe('scoring');
      expect(coherent()).toBe(true);
      const result = game().result!;
      expect(result.moves).toBe(game().log.length);
      expect(result.pieces).toEqual({ N: jgPieceCount(game().cells, 0), S: jgPieceCount(game().cells, 1) });
      expect(game().cells).toHaveLength(JG_CELLS);
      expect(isJungleResult(JSON.parse(JSON.stringify(result)))).toBe(true);
      jungle.abortGame(CODE);
    }
  });
});

describe('Jungle resignation and draw offers', () => {
  it('lets either seat resign at any time, even off turn, and gives the other seat the win', () => {
    start();
    expect(jungle.control(CODE, 'S', { type: 'resign' })).toEqual({ success: true });
    expect(game().result).toMatchObject({ winners: ['N'], reason: 'resign', moves: 0, pieces: { N: 8, S: 8 } });
    expect(game().phase).toBe('scoring');
    expect(coherent()).toBe(true);
  });

  it('offers a draw only on the own turn and ends in a draw when the opponent accepts', () => {
    start();
    expect(jungle.control(CODE, 'S', { type: 'offer-draw' })).toMatchObject({ success: false });
    expect(jungle.control(CODE, 'N', { type: 'offer-draw' })).toEqual({ success: true });
    expect(game().drawOffer.offeredBy).toBe('N');
    expect(jungle.control(CODE, 'N', { type: 'answer-draw', accept: true })).toMatchObject({ success: false });
    expect(jungle.control(CODE, 'S', { type: 'answer-draw', accept: true })).toEqual({ success: true });
    expect(game().result).toMatchObject({ winners: [], reason: 'agreed-draw' });
    expect(coherent()).toBe(true);
    const result = game().result!;
    expect(['N', 'S'].map((seat) => matchStanding(result, seat as GameSeat))).toMatchObject([
      { rank: 1, tied: true, won: true }, { rank: 1, tied: true, won: true },
    ]);
  });

  it('treats the opponent moving as a rejection and then blocks new offers for three own moves', () => {
    start();
    jungle.control(CODE, 'N', { type: 'offer-draw' });
    jungle.move(CODE, 'N', '0,6', '0,5');
    expect(game().drawOffer.offeredBy).toBe('N');
    jungle.move(CODE, 'S', '0,2', '0,3');
    expect(game().drawOffer).toEqual({ offeredBy: null, cooldown: { N: DRAW_REOFFER_MOVES } });
    expect(jungle.control(CODE, 'N', { type: 'offer-draw' })).toMatchObject({ success: false });
  });
});

describe('Jungle adapter and stored state', () => {
  it('routes controls without the clock and moves through it', () => {
    start();
    const timed: string[] = [];
    const context = {
      automatic: false, settings: { baseSeconds: 60, bankSeconds: 300 },
      timed: (operation: () => { success: boolean }) => { timed.push('timed'); return operation(); },
      present: (operation: () => { success: boolean }) => { timed.push('present'); return operation(); },
      simultaneous: (operation: () => { success: boolean }) => operation(),
      resetClock: () => undefined,
    };
    expect(jungleAdapter.applyAction(CODE, 'N', { type: 'offer-draw' }, context as never)).toEqual({ success: true });
    expect(timed).toEqual([]);
    expect(jungleAdapter.applyAction(CODE, 'N', { type: 'move', from: '0,6', to: '0,5' }, context as never)).toEqual({ success: true });
    expect(timed).toEqual(['timed']);
    expect(jungleAdapter.turnSeat(game())).toBe('S');
    expect(jungleAdapter.matchResult(game())).toBeNull();
  });

  it('gives spectators the same public position with only the observer flag added', () => {
    start();
    jungle.move(CODE, 'N', '0,6', '0,5');
    const own = jungle.getPlayerVisibleState(CODE, 'S')!;
    const spectator = jungleAdapter.withObserverView(jungle.getPlayerVisibleState(CODE, 'W')!, game(), 'spectator');
    expect(spectator).toMatchObject({ observer: 'spectator', cells: own.cells, log: own.log, seats: own.seats });
    expect(Object.keys(own).sort()).toEqual(['cells', 'currentTurnSeat', 'drawOffer', 'gameType', 'log', 'mySeat', 'phase',
      'result', 'seats']);
  });

  it('accepts a played game as stored state and rejects tampering', () => {
    start();
    playOut(7, 30);
    const stored = JSON.parse(JSON.stringify(game())) as Record<string, unknown>;
    const accepts = (value: unknown): boolean => gameValidator('jungle').shape(value as never, () => true)
      && gameValidator('jungle').coherent(value as JungleGameState);
    expect(accepts(stored)).toBe(true);
    expect(jungleGame(stored, () => true)).toBe(true);

    const moved = structuredClone(stored) as { cells: number[] };
    moved.cells[jgIndex(3, 4)] = 3;
    expect(accepts(moved)).toBe(false);

    const wrongTurn = { ...structuredClone(stored), currentTurnSeat: game().currentTurnSeat === 'N' ? 'S' : 'N' };
    expect(accepts(wrongTurn)).toBe(false);

    const badMove = structuredClone(stored) as { log: { to: string }[] };
    badMove.log[1].to = '3,4';
    expect(accepts(badMove)).toBe(false);

    const wrongAnimal = structuredClone(stored) as { log: { piece: number }[] };
    wrongAnimal.log[0].piece = wrongAnimal.log[0].piece === 1 ? 2 : 1;
    expect(accepts(wrongAnimal)).toBe(false);

    const falseCapture = structuredClone(stored) as { log: { capture: boolean }[] };
    falseCapture.log[0].capture = true;
    expect(accepts(falseCapture)).toBe(false);

    expect(accepts({ ...structuredClone(stored), result: { gameType: 'jungle' } })).toBe(false);
    expect(accepts({ ...structuredClone(stored), phase: 'scoring' })).toBe(false);
  });

  it('refuses a stored game whose log does not replay onto its board', () => {
    start();
    setBoard(board([3, 1, '4'], [0, 0, 'g'], [6, 8, '2']));
    jungle.move(CODE, 'N', '3,1', '3,0');
    const stored = JSON.parse(JSON.stringify(game())) as JungleGameState;
    expect(gameValidator('jungle').coherent(stored)).toBe(false);
  });

  it('keeps stored results consistent with their reason', () => {
    const result = { gameType: 'jungle', seats: ['N', 'S'], pieces: { N: 5, S: 0 }, moves: 40, winners: ['N'], reason: 'all-captured' };
    expect(isJungleResult(result)).toBe(true);
    expect(isJungleResult({ ...result, reason: 'den-entered' })).toBe(true);
    expect(isJungleResult({ ...result, reason: 'no-capture-limit' })).toBe(false);
    expect(isJungleResult({ ...result, reason: 'no-capture-limit', winners: [] })).toBe(true);
    expect(isJungleResult({ ...result, reason: 'agreed-draw', winners: [] })).toBe(true);
    expect(isJungleResult({ ...result, reason: 'resign' })).toBe(true);
    expect(isJungleResult({ ...result, winners: [] })).toBe(false);
    expect(isJungleResult({ ...result, reason: 'disc-count' })).toBe(false);
    expect(isJungleResult({ ...result, seats: ['N'] })).toBe(false);
    expect(isJungleResult({ ...result, pieces: { N: 9, S: 0 } })).toBe(false);
  });

  it('parses only moves between board cells and the match controls', () => {
    const parse = (action: unknown): unknown => parseGameAction({ gameType: 'jungle', action });
    expect(parse({ type: 'move', from: '0,6', to: '0,5' })).toEqual({ gameType: 'jungle', action: { type: 'move', from: '0,6', to: '0,5' } });
    expect(parse({ type: 'resign' })).toEqual({ gameType: 'jungle', action: { type: 'resign' } });
    expect(parse({ type: 'answer-draw', accept: false })).toEqual({ gameType: 'jungle', action: { type: 'answer-draw', accept: false } });
    for (const bad of [{ type: 'move', from: '7,0', to: '0,5' }, { type: 'move', from: '0,6', to: '0,9' }, { type: 'move', from: '0,6' },
      { type: 'move', to: '0,5' }, { type: 'move', from: 5, to: 6 }, { type: 'place', to: '0,5' }, { type: 'answer-draw' }, null, 'resign']) {
      expect(typeof parse(bad)).toBe('string');
    }
  });
});

describe('Jungle bots through the registry', () => {
  it('plays only legal moves in a full bot match on both difficulties', () => {
    start();
    for (let guard = 0; guard < 400 && game().phase === 'playing'; guard++) {
      const seat = game().currentTurnSeat;
      const view = jungle.getPlayerVisibleState(CODE, seat)!;
      const action = getBotAction(view, Math.random, seat === 'N' ? 'easy' : 'hard');
      expect(action).toMatchObject({ type: 'game-action', request: { gameType: 'jungle', action: { type: 'move' } } });
      const request = (action as { request: { action: { from: string; to: string } } }).request.action;
      expect(jungle.move(CODE, seat, request.from, request.to)).toEqual({ success: true });
    }
    expect(coherent()).toBe(true);
  }, 30_000);

  it('returns nothing off turn or after the end, and the first legal fallback is a legal move', () => {
    start();
    expect(getBotAction(jungle.getPlayerVisibleState(CODE, 'S')!, Math.random, 'easy')).toBeNull();
    const bot = gameBot('jungle');
    expect(bot.firstLegal(jungle.getPlayerVisibleState(CODE, 'S')!)).toBeNull();
    const first = bot.firstLegal(jungle.getPlayerVisibleState(CODE, 'N')!);
    expect(first).toMatchObject({ request: { action: { type: 'move' } } });
    const { from, to } = (first as { request: { action: { from: string; to: string } } }).request.action;
    expect(jungle.move(CODE, 'N', from, to)).toEqual({ success: true });
    jungle.control(CODE, 'N', { type: 'resign' });
    expect(getBotAction(jungle.getPlayerVisibleState(CODE, 'S')!, Math.random, 'hard')).toBeNull();
  });
});

describe('Jungle through the game manager', () => {
  const MANAGED = 'JUNMG1';
  afterEach(() => manager.removeGame(MANAGED));

  function begin(): void {
    expect(manager.startGame(MANAGED, 'jungle', { N: player('N'), S: player('S') })).toEqual({ success: true });
    manager.initializeClock(MANAGED);
  }

  it('runs a turn clock for the seat on move and moves it with each move', () => {
    begin();
    expect(manager.getGameState(MANAGED)?.clock?.turn).toMatchObject({ seat: 'N' });
    expect(manager.handleGameAction(MANAGED, 'N', { gameType: 'jungle', action: { type: 'move', from: '0,6', to: '0,5' } }))
      .toEqual({ success: true });
    expect(manager.getGameState(MANAGED)?.clock?.turn).toMatchObject({ seat: 'S' });
    const turn = manager.getGameState(MANAGED)?.clock?.turn;
    expect(manager.handleGameAction(MANAGED, 'S', { gameType: 'jungle', action: { type: 'offer-draw' } })).toEqual({ success: true });
    expect(manager.getGameState(MANAGED)?.clock?.turn).toEqual(turn);
  });

  it('stops the clock when resigning ends the match and keeps it valid as stored state', () => {
    begin();
    expect(manager.handleGameAction(MANAGED, 'S', { gameType: 'jungle', action: { type: 'resign' } })).toEqual({ success: true });
    expect(manager.getGameState(MANAGED)).toMatchObject({ phase: 'scoring', clock: { turn: null } });
    expect(manager.getMatchResult(manager.getGameState(MANAGED)!)).toMatchObject({ winners: ['N'], reason: 'resign' });
    const state = JSON.parse(JSON.stringify(manager.getGameState(MANAGED))) as JungleGameState;
    expect(gameValidator('jungle').shape(state as never, () => true)).toBe(true);
    expect(gameValidator('jungle').coherent(state)).toBe(true);
  });
});
