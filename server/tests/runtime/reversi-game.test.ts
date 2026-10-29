import { afterEach, describe, expect, it } from 'vitest';
import type { GameSeat, PlayerInfo, ReversiGameState } from '@shared/types';
import { gameDefinition } from '@shared/games/registry';
import { parseGameAction } from '@shared/games/actions';
import { matchStanding } from '@shared/rules/match-standing';
import { DRAW_REOFFER_MOVES } from '@shared/rules/board/match-controls';
import { RV_CELLS, rvCounts, rvIndex, rvLegalMoves, rvNode } from '@shared/rules/reversi';
import type { RvCell, RvSide } from '@shared/rules/reversi';
import { reversiAdapter } from '../../src/managers/games/reversi-adapter';
import * as reversi from '../../src/managers/games/reversi-game';
import { coherentReversiGame, isReversiResult, reversiGame } from '../../src/managers/games/reversi-validation';
import { gameValidator } from '../../src/managers/games/validation-registry';
import { gameBot } from '../../src/bots/bot-registry';
import { getBotAction } from '../../src/bots/bot-decisions';
import * as manager from '../../src/managers/game-manager';

const CODE = 'REVER1';

function player(seat: GameSeat): PlayerInfo {
  return { id: seat.toLowerCase(), username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null };
}

function start(seats: readonly GameSeat[] = ['N', 'S']): void {
  reversi.startGame(CODE, Object.fromEntries(seats.map((seat) => [seat, player(seat)])), 1_000);
}

function game(): ReversiGameState {
  const state = reversi.getGameState(CODE);
  if (!state) throw new Error('Expected a Reversi game');
  return state;
}

const coherent = (): boolean => coherentReversiGame(structuredClone(game()));

/** Plays random legal moves from a seeded generator until the match ends or `limit` placements were made. */
function playOut(seed: number, limit = Infinity): void {
  let state = seed;
  const random = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let placements = 0; placements < limit && game().phase === 'playing'; placements++) {
    const seat = game().currentTurnSeat;
    const side: RvSide = reversi.reversiSeats(game()).indexOf(seat) === 0 ? 0 : 1;
    const moves = rvLegalMoves(game().discs, side);
    expect(moves.length).toBeGreaterThan(0);
    expect(reversi.place(CODE, seat, rvNode(moves[Math.floor(random() * moves.length)]), 2_000)).toEqual({ success: true });
  }
}

/** A position written as eight rows of `.`, `x` (dark), and `o` (light), top row first. */
function setBoard(rows: readonly string[]): void {
  game().discs = rows.join('').split('').map((char): RvCell => (char === 'x' ? 0 : char === 'o' ? 1 : null));
}

afterEach(() => reversi.abortGame(CODE));

describe('Reversi setup', () => {
  it('registers a two-player flexible board game on the board timer with resign and draw offers', () => {
    expect(gameDefinition('reversi')).toMatchObject({
      category: 'board', equipment: [], seats: { minPlayers: 2, maxPlayers: 2, flexible: true },
      matchControls: { resign: true, draw: true }, timeControl: { baseSeconds: 60, bankSeconds: 300 },
    });
  });

  it('starts from the standard position with the first occupied seat playing dark', () => {
    start(['E', 'W']);
    expect(game()).toMatchObject({ phase: 'playing', currentTurnSeat: 'E', result: null, log: [] });
    expect(rvCounts(game().discs)).toEqual([2, 2]);
    expect(reversi.getPlayerVisibleState(CODE, 'W')).toMatchObject({ seats: ['E', 'W'], mySeat: 'W', currentTurnSeat: 'E' });
    expect(coherent()).toBe(true);
  });
});

describe('Reversi moves', () => {
  it('flips the bracketed discs, passes the turn, and logs the public move', () => {
    start();
    expect(reversi.place(CODE, 'N', '3,5', 1_500)).toEqual({ success: true });
    expect(game().log).toEqual([{ seat: 'N', to: '3,5', flips: ['3,4'], timestamp: 1_500 }]);
    expect(game().currentTurnSeat).toBe('S');
    expect(rvCounts(game().discs)).toEqual([4, 1]);
    expect(coherent()).toBe(true);
  });

  it('rejects moves out of turn, illegal cells, bad ids, and moves after the end', () => {
    start();
    expect(reversi.place(CODE, 'S', '3,5')).toMatchObject({ success: false, reason: 'Not your turn' });
    expect(reversi.place(CODE, 'N', '0,0')).toMatchObject({ success: false, reason: 'Illegal move' });
    expect(reversi.place(CODE, 'N', '3,3')).toMatchObject({ success: false, reason: 'Illegal move' });
    expect(reversi.place(CODE, 'N', '9,9')).toMatchObject({ success: false, reason: 'Illegal move' });
    expect(game().log).toEqual([]);
    reversi.control(CODE, 'S', { type: 'resign' });
    expect(reversi.place(CODE, 'N', '3,5')).toMatchObject({ success: false, reason: 'The game is over' });
    expect(reversi.place('NOPE00', 'N', '3,5')).toMatchObject({ success: false, reason: 'Game not found' });
  });

  it('skips a seat with no legal move, logs the pass, and lets the mover play again', () => {
    start();
    setBoard([
      '.......x', '.......x', '.......x', '.......x', '.......x', '.......x', '.......o', 'xo.....'.padEnd(8, '.'),
    ]);
    expect(reversi.place(CODE, 'N', rvNode(rvIndex(2, 7)), 3_000)).toEqual({ success: true });
    expect(game().log.slice(-2)).toEqual([
      { seat: 'N', to: '2,7', flips: ['1,7'], timestamp: 3_000 },
      { seat: 'S', flips: [], timestamp: 3_000 },
    ]);
    expect(game().currentTurnSeat).toBe('N');
    expect(game().phase).toBe('playing');
  });

  it('ends by disc count when neither side can move and credits the larger side', () => {
    start();
    setBoard([
      '.......x', '.......x', '.......x', '.......x', '.......x', '.......x', '.......o', 'xxx.....',
    ]);
    expect(reversi.place(CODE, 'N', rvNode(rvIndex(7, 7)), 3_000)).toEqual({ success: true });
    expect(game()).toMatchObject({ phase: 'scoring' });
    expect(game().result).toMatchObject({
      gameType: 'reversi', seats: ['N', 'S'], winners: ['N'], reason: 'disc-count', discs: { N: 11, S: 0 }, moves: 1,
    });
    expect(game().log).toHaveLength(1);
  });

  it('plays seeded random matches to the end with a coherent log at every step', () => {
    for (const seed of [1, 2, 3]) {
      start();
      for (let step = 0; step < 6 && game().phase === 'playing'; step++) {
        playOut(seed + step * 100, 1);
        expect(coherent()).toBe(true);
      }
      playOut(seed);
      expect(game().phase).toBe('scoring');
      expect(coherent()).toBe(true);
      const result = game().result!;
      const [dark, light] = rvCounts(game().discs);
      expect(result.discs).toEqual({ N: dark, S: light });
      expect(result.winners).toEqual(dark === light ? [] : [dark > light ? 'N' : 'S']);
      expect(dark + light).toBeLessThanOrEqual(RV_CELLS);
      expect(isReversiResult(JSON.parse(JSON.stringify(result)))).toBe(true);
      reversi.abortGame(CODE);
    }
  });
});

describe('Reversi resignation and draw offers', () => {
  it('lets either seat resign at any time, even off turn, and gives the other seat the win', () => {
    start();
    expect(reversi.control(CODE, 'S', { type: 'resign' })).toEqual({ success: true });
    expect(game().result).toMatchObject({ winners: ['N'], reason: 'resign', moves: 0, discs: { N: 2, S: 2 } });
    expect(game().phase).toBe('scoring');
    expect(coherent()).toBe(true);
  });

  it('offers a draw only on the own turn and ends in a draw when the opponent accepts', () => {
    start();
    expect(reversi.control(CODE, 'S', { type: 'offer-draw' })).toMatchObject({ success: false });
    expect(reversi.control(CODE, 'N', { type: 'offer-draw' })).toEqual({ success: true });
    expect(game().drawOffer.offeredBy).toBe('N');
    expect(reversi.control(CODE, 'N', { type: 'answer-draw', accept: true })).toMatchObject({ success: false });
    expect(reversi.control(CODE, 'S', { type: 'answer-draw', accept: true })).toEqual({ success: true });
    expect(game().result).toMatchObject({ winners: [], reason: 'agreed-draw' });
    expect(game().drawOffer.offeredBy).toBeNull();
    expect(coherent()).toBe(true);
    const result = game().result!;
    expect(['N', 'S'].map((seat) => matchStanding(result, seat as GameSeat))).toMatchObject([
      { rank: 1, tied: true, won: true }, { rank: 1, tied: true, won: true },
    ]);
  });

  it('treats the opponent moving as a rejection and then blocks new offers for three own moves', () => {
    start();
    reversi.control(CODE, 'N', { type: 'offer-draw' });
    // The offerer's own move leaves the offer open for the opponent.
    reversi.place(CODE, 'N', '3,5');
    expect(game().drawOffer.offeredBy).toBe('N');
    reversi.place(CODE, 'S', rvNode(rvLegalMoves(game().discs, 1)[0]));
    expect(game().drawOffer).toEqual({ offeredBy: null, cooldown: { N: DRAW_REOFFER_MOVES } });
    expect(reversi.control(CODE, 'N', { type: 'offer-draw' })).toMatchObject({ success: false });
  });

  it('lets the opponent decline, which also starts the offerer cooldown', () => {
    start();
    reversi.control(CODE, 'N', { type: 'offer-draw' });
    expect(reversi.control(CODE, 'S', { type: 'answer-draw', accept: false })).toEqual({ success: true });
    expect(game().drawOffer).toEqual({ offeredBy: null, cooldown: { N: DRAW_REOFFER_MOVES } });
    expect(game().phase).toBe('playing');
  });
});

describe('Reversi adapter and stored state', () => {
  it('routes controls without the clock and placements through it', () => {
    start();
    const timed: string[] = [];
    const context = {
      automatic: false, settings: { baseSeconds: 60, bankSeconds: 300 },
      timed: (operation: () => { success: boolean }) => { timed.push('timed'); return operation(); },
      present: (operation: () => { success: boolean }) => { timed.push('present'); return operation(); },
      simultaneous: (operation: () => { success: boolean }) => operation(),
      resetClock: () => undefined,
    };
    expect(reversiAdapter.applyAction(CODE, 'N', { type: 'offer-draw' }, context as never)).toEqual({ success: true });
    expect(timed).toEqual([]);
    expect(reversiAdapter.applyAction(CODE, 'N', { type: 'place', to: '3,5' }, context as never)).toEqual({ success: true });
    expect(timed).toEqual(['timed']);
    expect(reversiAdapter.turnSeat(game())).toBe('S');
    expect(reversiAdapter.matchResult(game())).toBeNull();
  });

  it('gives spectators the same public position with only the observer flag added', () => {
    start();
    reversi.place(CODE, 'N', '3,5');
    const own = reversi.getPlayerVisibleState(CODE, 'S')!;
    const spectator = reversiAdapter.withObserverView(reversi.getPlayerVisibleState(CODE, 'W')!, game(), 'spectator');
    expect(spectator).toMatchObject({ observer: 'spectator', discs: own.discs, log: own.log, seats: own.seats });
    expect(Object.keys(own).sort()).toEqual(['currentTurnSeat', 'discs', 'drawOffer', 'gameType', 'log', 'mySeat', 'phase',
      'result', 'seats']);
  });

  it('accepts a played game as stored state and rejects tampering', () => {
    start();
    playOut(7, 12);
    const stored = JSON.parse(JSON.stringify(game())) as Record<string, unknown>;
    const accepts = (value: unknown): boolean => gameValidator('reversi').shape(value as never, () => true)
      && gameValidator('reversi').coherent(value as ReversiGameState);
    expect(accepts(stored)).toBe(true);
    expect(reversiGame(stored, () => true)).toBe(true);

    const flipped = structuredClone(stored) as { discs: (number | null)[] };
    flipped.discs[rvIndex(0, 0)] = 0;
    expect(accepts(flipped)).toBe(false);

    const wrongTurn = { ...structuredClone(stored), currentTurnSeat: game().currentTurnSeat === 'N' ? 'S' : 'N' };
    expect(accepts(wrongTurn)).toBe(false);

    const badMove = structuredClone(stored) as { log: { to: string }[] };
    badMove.log[1].to = '0,0';
    expect(accepts(badMove)).toBe(false);

    const lostFlip = structuredClone(stored) as { log: { flips: string[] }[] };
    lostFlip.log[0].flips = [];
    expect(accepts(lostFlip)).toBe(false);

    expect(accepts({ ...structuredClone(stored), result: { gameType: 'reversi' } })).toBe(false);
    expect(accepts({ ...structuredClone(stored), phase: 'scoring' })).toBe(false);
  });

  it('keeps stored results consistent with their reason', () => {
    const result = { gameType: 'reversi', seats: ['N', 'S'], discs: { N: 40, S: 24 }, moves: 60, winners: ['N'], reason: 'disc-count' };
    expect(isReversiResult(result)).toBe(true);
    expect(isReversiResult({ ...result, winners: ['S'] })).toBe(false);
    expect(isReversiResult({ ...result, winners: [] })).toBe(false);
    expect(isReversiResult({ ...result, discs: { N: 32, S: 32 }, winners: [] })).toBe(true);
    expect(isReversiResult({ ...result, reason: 'resign' })).toBe(true);
    expect(isReversiResult({ ...result, reason: 'agreed-draw' })).toBe(false);
    expect(isReversiResult({ ...result, reason: 'timeout' })).toBe(false);
    expect(isReversiResult({ ...result, seats: ['N'] })).toBe(false);
    expect(isReversiResult({ ...result, discs: { N: 40, S: 40 } })).toBe(false);
  });

  it('parses only placements on board cells and the match controls', () => {
    const parse = (action: unknown): unknown => parseGameAction({ gameType: 'reversi', action });
    expect(parse({ type: 'place', to: '3,5' })).toEqual({ gameType: 'reversi', action: { type: 'place', to: '3,5' } });
    expect(parse({ type: 'resign' })).toEqual({ gameType: 'reversi', action: { type: 'resign' } });
    expect(parse({ type: 'answer-draw', accept: false })).toEqual({ gameType: 'reversi', action: { type: 'answer-draw', accept: false } });
    for (const bad of [{ type: 'place', to: '8,0' }, { type: 'place', to: 12 },
      { type: 'place' }, { type: 'answer-draw' }, { type: 'pass' }, null, 'resign']) {
      expect(typeof parse(bad)).toBe('string');
    }
  });
});

describe('Reversi bots through the registry', () => {
  it('plays only legal moves in a full bot match on both difficulties', () => {
    start();
    for (let guard = 0; guard < 200 && game().phase === 'playing'; guard++) {
      const seat = game().currentTurnSeat;
      const view = reversi.getPlayerVisibleState(CODE, seat)!;
      const action = getBotAction(view, Math.random, seat === 'N' ? 'easy' : 'hard');
      expect(action).toMatchObject({ type: 'game-action', request: { gameType: 'reversi', action: { type: 'place' } } });
      const request = (action as { request: { action: { to: string } } }).request.action;
      expect(reversi.place(CODE, seat, request.to)).toEqual({ success: true });
    }
    expect(game().phase).toBe('scoring');
    expect(coherent()).toBe(true);
  });

  it('returns nothing off turn or after the end, and the first legal fallback is a legal placement', () => {
    start();
    expect(getBotAction(reversi.getPlayerVisibleState(CODE, 'S')!, Math.random, 'easy')).toBeNull();
    const bot = gameBot('reversi');
    expect(bot.firstLegal(reversi.getPlayerVisibleState(CODE, 'S')!)).toBeNull();
    const first = bot.firstLegal(reversi.getPlayerVisibleState(CODE, 'N')!);
    expect(first).toMatchObject({ request: { action: { type: 'place' } } });
    expect(reversi.place(CODE, 'N', (first as { request: { action: { to: string } } }).request.action.to)).toEqual({ success: true });
    reversi.control(CODE, 'N', { type: 'resign' });
    expect(getBotAction(reversi.getPlayerVisibleState(CODE, 'S')!, Math.random, 'hard')).toBeNull();
  });
});

describe('Reversi through the game manager', () => {
  const MANAGED = 'REVMG1';
  afterEach(() => manager.removeGame(MANAGED));

  function begin(): void {
    expect(manager.startGame(MANAGED, 'reversi', { N: player('N'), S: player('S') })).toEqual({ success: true });
    manager.initializeClock(MANAGED);
  }

  it('runs a turn clock for the seat on move and moves it with each placement', () => {
    begin();
    expect(manager.getGameState(MANAGED)?.clock?.turn).toMatchObject({ seat: 'N' });
    expect(manager.handleGameAction(MANAGED, 'N', { gameType: 'reversi', action: { type: 'place', to: '3,5' } }))
      .toEqual({ success: true });
    expect(manager.getGameState(MANAGED)?.clock?.turn).toMatchObject({ seat: 'S' });
    // A draw offer leaves the clock alone.
    const turn = manager.getGameState(MANAGED)?.clock?.turn;
    expect(manager.handleGameAction(MANAGED, 'S', { gameType: 'reversi', action: { type: 'offer-draw' } })).toEqual({ success: true });
    expect(manager.getGameState(MANAGED)?.clock?.turn).toEqual(turn);
  });

  it('stops the clock when resigning or an agreed draw ends the match', () => {
    begin();
    expect(manager.handleGameAction(MANAGED, 'S', { gameType: 'reversi', action: { type: 'resign' } })).toEqual({ success: true });
    expect(manager.getGameState(MANAGED)).toMatchObject({ phase: 'scoring', clock: { turn: null } });
    expect(manager.getMatchResult(manager.getGameState(MANAGED)!)).toMatchObject({ winners: ['N'], reason: 'resign' });
    manager.removeGame(MANAGED);
    begin();
    manager.handleGameAction(MANAGED, 'N', { gameType: 'reversi', action: { type: 'offer-draw' } });
    manager.handleGameAction(MANAGED, 'S', { gameType: 'reversi', action: { type: 'answer-draw', accept: true } });
    expect(manager.getGameState(MANAGED)).toMatchObject({ phase: 'scoring', clock: { turn: null } });
  });

  it('keeps a resigned match valid as stored runtime state', () => {
    begin();
    manager.handleGameAction(MANAGED, 'N', { gameType: 'reversi', action: { type: 'resign' } });
    const state = JSON.parse(JSON.stringify(manager.getGameState(MANAGED))) as ReversiGameState;
    expect(gameValidator('reversi').shape(state as never, () => true)).toBe(true);
    expect(gameValidator('reversi').coherent(state)).toBe(true);
  });
});
