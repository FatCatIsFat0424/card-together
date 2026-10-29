import { afterEach, describe, expect, it } from 'vitest';
import type { GameSeat, PlayerInfo, XiangqiGameState, XiangqiOptions } from '@shared/types';
import { gameDefinition } from '@shared/games/registry';
import { parseGameAction } from '@shared/games/actions';
import { isOptionsFor } from '@shared/games/room-options';
import { matchStanding } from '@shared/rules/match-standing';
import { DRAW_REOFFER_MOVES } from '@shared/rules/board/match-controls';
import { xqIndex, xqLegalMoves, xqNode } from '@shared/rules/xiangqi';
import type { XqSide } from '@shared/rules/xiangqi';
import { xiangqiAdapter } from '../../src/managers/games/xiangqi-adapter';
import * as xiangqi from '../../src/managers/games/xiangqi-game';
import { coherentXiangqiGame, isXiangqiResult, xiangqiGame } from '../../src/managers/games/xiangqi-validation';
import { gameValidator } from '../../src/managers/games/validation-registry';
import { gameBot } from '../../src/bots/bot-registry';
import { getBotAction } from '../../src/bots/bot-decisions';
import * as manager from '../../src/managers/game-manager';
import { lcg, xqPosition } from '../fixtures/xiangqi-positions';

const CODE = 'XIANG1';
const at = (col: number, row: number): string => xqNode(xqIndex(col, row));

function player(seat: GameSeat): PlayerInfo {
  return { id: seat.toLowerCase(), username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null };
}

function start(seats: readonly GameSeat[] = ['N', 'S'], options: XiangqiOptions = { handicap: 'none', handicapSide: 'red' }): void {
  xiangqi.startGame(CODE, Object.fromEntries(seats.map((seat) => [seat, player(seat)])), options, 1_000);
}

function game(): XiangqiGameState {
  const state = xiangqi.getGameState(CODE);
  if (!state) throw new Error('Expected a Xiangqi game');
  return state;
}

const coherent = (): boolean => coherentXiangqiGame(structuredClone(game()));
const sideOf = (seat: GameSeat): XqSide => (xiangqi.xiangqiSeats(game()).indexOf(seat) === 0 ? 0 : 1);

/** Plays seeded random legal moves until the match ends or `limit` moves were made. */
function playOut(seed: number, limit = Infinity): void {
  const random = lcg(seed);
  for (let made = 0; made < limit && game().phase === 'playing'; made++) {
    const seat = game().currentTurnSeat;
    const moves = xqLegalMoves(game().board, sideOf(seat));
    expect(moves.length).toBeGreaterThan(0);
    const move = moves[Math.floor(random() * moves.length)];
    expect(xiangqi.move(CODE, seat, xqNode(move.from), xqNode(move.to), 2_000)).toEqual({ success: true });
  }
}

afterEach(() => xiangqi.abortGame(CODE));

describe('Xiangqi setup', () => {
  it('registers a two-player board game on the board timer with resign, draw offers and the handicap option', () => {
    const definition = gameDefinition('xiangqi');
    expect(definition).toMatchObject({
      category: 'board', equipment: [], seats: { minPlayers: 2, maxPlayers: 2, flexible: true },
      matchControls: { resign: true, draw: true }, timeControl: { baseSeconds: 60, bankSeconds: 300 },
      options: { defaults: { handicap: 'none', handicapSide: 'red' } },
    });
    expect(isOptionsFor('xiangqi', { handicap: 'nine', handicapSide: 'black' })).toBe(true);
    for (const bad of [{}, { handicap: 'queen', handicapSide: 'red' }, { handicap: 'horse', handicapSide: 'blue' },
      { handicap: 'horse', handicapSide: 'red', extra: 1 }, null]) {
      expect(isOptionsFor('xiangqi', bad)).toBe(false);
    }
  });

  it('starts with the first occupied seat playing red and moving first', () => {
    start(['E', 'W']);
    expect(game()).toMatchObject({ phase: 'playing', currentTurnSeat: 'E', result: null, log: [] });
    expect(xiangqi.getPlayerVisibleState(CODE, 'W')).toMatchObject({
      seats: ['E', 'W'], mySeat: 'W', currentTurnSeat: 'E', options: { handicap: 'none' },
    });
    expect(coherent()).toBe(true);
  });

  it('removes the handicap pieces from the giving colour', () => {
    start(['N', 'S'], { handicap: 'horses', handicapSide: 'black' });
    expect(game().board.filter((cell) => cell === 'h')).toHaveLength(0);
    expect(game().board.filter((cell) => cell === 'H')).toHaveLength(2);
    expect(coherent()).toBe(true);
    // A handicap game is replayed from its own start.
    playOut(3, 10);
    expect(coherent()).toBe(true);
    const stored = structuredClone(game());
    expect(coherentXiangqiGame({ ...stored, options: { handicap: 'none', handicapSide: 'red' } })).toBe(false);
  });
});

describe('Xiangqi moves', () => {
  it('moves a piece, passes the turn, and logs the public facts', () => {
    start();
    expect(xiangqi.move(CODE, 'N', at(7, 7), at(4, 7), 1_500)).toEqual({ success: true });
    expect(game().log).toEqual([{ seat: 'N', from: '7,7', to: '4,7', piece: 'C', timestamp: 1_500 }]);
    expect(game().currentTurnSeat).toBe('S');
    expect(xiangqi.move(CODE, 'S', at(1, 2), at(1, 9), 1_600)).toEqual({ success: true });
    expect(game().log[1]).toEqual({ seat: 'S', from: '1,2', to: '1,9', piece: 'c', captured: 'H', capture: true, timestamp: 1_600 });
    expect(coherent()).toBe(true);
  });

  it('rejects moves out of turn, illegal moves, bad points, and moves after the end', () => {
    start();
    expect(xiangqi.move(CODE, 'S', at(1, 2), at(4, 2))).toMatchObject({ success: false, reason: 'Not your turn' });
    expect(xiangqi.move(CODE, 'N', at(1, 2), at(4, 2))).toMatchObject({ success: false, reason: 'Illegal move' });
    expect(xiangqi.move(CODE, 'N', at(2, 9), at(0, 7))).toEqual({ success: true });
    expect(xiangqi.move(CODE, 'S', at(4, 0), at(4, 2))).toMatchObject({ success: false, reason: 'Illegal move' });
    expect(xiangqi.move(CODE, 'S', '9,9', '0,0')).toMatchObject({ success: false, reason: 'Illegal move' });
    xiangqi.control(CODE, 'N', { type: 'resign' });
    expect(xiangqi.move(CODE, 'S', at(1, 0), at(2, 2))).toMatchObject({ success: false, reason: 'The game is over' });
    expect(xiangqi.move('NOPE00', 'N', at(7, 7), at(4, 7))).toMatchObject({ success: false, reason: 'Game not found' });
  });

  it('records check and ends by checkmate with the mover winning', () => {
    start();
    game().board = xqPosition(['....k....', '........R', '.........', '.........', '.........', 'R........', '.........',
      '.........', '.........', '...K.....']);
    // The stored board no longer replays from the start; only the live flow is checked here.
    expect(xiangqi.move(CODE, 'N', at(0, 5), at(0, 0), 3_000)).toEqual({ success: true });
    expect(game().log.at(-1)).toMatchObject({ check: true });
    expect(game()).toMatchObject({ phase: 'scoring', currentTurnSeat: 'N' });
    expect(game().result).toEqual({ gameType: 'xiangqi', seats: ['N', 'S'], moves: 1, winners: ['N'], reason: 'checkmate' });
    expect(isXiangqiResult(JSON.parse(JSON.stringify(game().result)))).toBe(true);
  });

  it('ends a perpetual check with a loss for the checking side', () => {
    start();
    game().board = xqPosition(['....k....', '.........', '.........', '.........', '.........', 'R........', '.........',
      '.........', '.........', '...K.....']);
    const moves: [GameSeat, string, string][] = [['N', at(0, 5), at(0, 0)]];
    for (let cycle = 0; cycle < 2; cycle++) {
      moves.push(['S', at(4, 0), at(4, 1)], ['N', at(0, 0), at(0, 1)], ['S', at(4, 1), at(4, 0)], ['N', at(0, 1), at(0, 0)]);
    }
    for (const [seat, from, to] of moves) expect(xiangqi.move(CODE, seat, from, to)).toEqual({ success: true });
    expect(game().result).toMatchObject({ winners: ['S'], reason: 'perpetual-check', moves: 9 });
  });

  it('draws a threefold repetition from the start and keeps the log coherent', () => {
    start();
    const shuffle: [GameSeat, string, string][] = [
      ['N', at(1, 9), at(2, 7)], ['S', at(1, 0), at(2, 2)], ['N', at(2, 7), at(1, 9)], ['S', at(2, 2), at(1, 0)],
    ];
    for (const [seat, from, to] of [...shuffle, ...shuffle]) expect(xiangqi.move(CODE, seat, from, to)).toEqual({ success: true });
    expect(game().result).toMatchObject({ winners: [], reason: 'repetition', moves: 8 });
    expect(coherent()).toBe(true);
    const result = game().result!;
    expect(['N', 'S'].map((seat) => matchStanding(result, seat as GameSeat))).toMatchObject([
      { rank: 1, tied: true, won: true }, { rank: 1, tied: true, won: true },
    ]);
  });

  it('plays seeded random matches with a coherent log at every step', () => {
    for (const seed of [1, 2]) {
      start();
      for (let step = 0; step < 30 && game().phase === 'playing'; step++) {
        playOut(seed * 100 + step, 1);
        expect(coherent()).toBe(true);
      }
      playOut(seed, 400);
      expect(coherent()).toBe(true);
      if (game().result) expect(isXiangqiResult(JSON.parse(JSON.stringify(game().result)))).toBe(true);
      xiangqi.abortGame(CODE);
    }
  });
});

describe('Xiangqi resignation and draw offers', () => {
  it('lets either seat resign at any time and gives the other seat the win', () => {
    start();
    expect(xiangqi.control(CODE, 'S', { type: 'resign' })).toEqual({ success: true });
    expect(game().result).toMatchObject({ winners: ['N'], reason: 'resign', moves: 0 });
    expect(coherent()).toBe(true);
  });

  it('offers a draw on the own turn, ends on acceptance, and starts a cooldown when a move declines it', () => {
    start();
    expect(xiangqi.control(CODE, 'S', { type: 'offer-draw' })).toMatchObject({ success: false });
    expect(xiangqi.control(CODE, 'N', { type: 'offer-draw' })).toEqual({ success: true });
    xiangqi.move(CODE, 'N', at(7, 7), at(4, 7));
    xiangqi.move(CODE, 'S', at(7, 0), at(6, 2));
    expect(game().drawOffer).toEqual({ offeredBy: null, cooldown: { N: DRAW_REOFFER_MOVES } });
    xiangqi.abortGame(CODE);
    start();
    xiangqi.control(CODE, 'N', { type: 'offer-draw' });
    expect(xiangqi.control(CODE, 'S', { type: 'answer-draw', accept: true })).toEqual({ success: true });
    expect(game().result).toMatchObject({ winners: [], reason: 'agreed-draw' });
    expect(coherent()).toBe(true);
  });
});

describe('Xiangqi adapter and stored state', () => {
  it('routes controls without the clock and moves through it, and starts with the room handicap', () => {
    const timed: string[] = [];
    const context = {
      automatic: false, settings: { baseSeconds: 60, bankSeconds: 300 },
      timed: (operation: () => { success: boolean }) => { timed.push('timed'); return operation(); },
      present: (operation: () => { success: boolean }) => { timed.push('present'); return operation(); },
      simultaneous: (operation: () => { success: boolean }) => operation(),
      resetClock: () => undefined,
    };
    expect(xiangqiAdapter.start({
      roomCode: CODE, players: { N: player('N'), S: player('S') }, settings: context.settings,
      options: { xiangqi: { handicap: 'chariot', handicapSide: 'red' } },
    })).toEqual({ success: true });
    expect(game().options).toEqual({ handicap: 'chariot', handicapSide: 'red' });
    expect(game().board[xqIndex(0, 9)]).toBeNull();
    expect(xiangqiAdapter.applyAction(CODE, 'N', { type: 'offer-draw' }, context as never)).toEqual({ success: true });
    expect(timed).toEqual([]);
    expect(xiangqiAdapter.applyAction(CODE, 'N', { type: 'move', from: at(7, 7), to: at(4, 7) }, context as never))
      .toEqual({ success: true });
    expect(timed).toEqual(['timed']);
    expect(xiangqiAdapter.turnSeat(game())).toBe('S');
    expect(xiangqiAdapter.matchResult(game())).toBeNull();
  });

  it('starts with the default options when the room has none', () => {
    expect(xiangqiAdapter.start({
      roomCode: CODE, players: { N: player('N'), S: player('S') }, settings: { baseSeconds: 60, bankSeconds: 300 },
      options: {},
    })).toEqual({ success: true });
    expect(game().options).toEqual({ handicap: 'none', handicapSide: 'red' });
  });

  it('gives spectators the same public position with only the observer flag added', () => {
    start();
    xiangqi.move(CODE, 'N', at(7, 7), at(4, 7));
    const own = xiangqi.getPlayerVisibleState(CODE, 'S')!;
    const spectator = xiangqiAdapter.withObserverView(xiangqi.getPlayerVisibleState(CODE, 'W')!, game(), 'spectator');
    expect(spectator).toMatchObject({ observer: 'spectator', board: own.board, log: own.log, seats: own.seats });
    expect(Object.keys(own).sort()).toEqual(['board', 'currentTurnSeat', 'drawOffer', 'gameType', 'log', 'mySeat', 'options',
      'phase', 'result', 'seats']);
  });

  it('accepts a played game as stored state and rejects tampering', () => {
    start();
    playOut(7, 16);
    const stored = JSON.parse(JSON.stringify(game())) as Record<string, unknown>;
    const accepts = (value: unknown): boolean => gameValidator('xiangqi').shape(value as never, () => true)
      && gameValidator('xiangqi').coherent(value as XiangqiGameState);
    expect(accepts(stored)).toBe(true);
    expect(xiangqiGame(stored, () => true)).toBe(true);

    const moved = structuredClone(stored) as { board: (string | null)[] };
    moved.board[xqIndex(4, 4)] = 'R';
    expect(accepts(moved)).toBe(false);
    expect(accepts({ ...structuredClone(stored), currentTurnSeat: game().currentTurnSeat === 'N' ? 'S' : 'N' })).toBe(false);
    const badMove = structuredClone(stored) as { log: { to: string }[] };
    badMove.log[1].to = '0,0';
    expect(accepts(badMove)).toBe(false);
    const hiddenCheck = structuredClone(stored) as { log: { check?: boolean }[] };
    hiddenCheck.log[0].check = true;
    expect(accepts(hiddenCheck)).toBe(false);
    const wrongPiece = structuredClone(stored) as { log: { piece: string }[] };
    wrongPiece.log[0].piece = 'R';
    expect(accepts(wrongPiece)).toBe(false);
    expect(accepts({ ...structuredClone(stored), options: { handicap: 'queen', handicapSide: 'red' } })).toBe(false);
    expect(accepts({ ...structuredClone(stored), result: { gameType: 'xiangqi' } })).toBe(false);
    expect(accepts({ ...structuredClone(stored), phase: 'scoring' })).toBe(false);
    const extra = structuredClone(stored) as { log: Record<string, unknown>[] };
    extra.log[0].rank = 'secret';
    expect(accepts(extra)).toBe(false);
  });

  it('keeps stored results consistent with their reason', () => {
    const result = { gameType: 'xiangqi', seats: ['N', 'S'], moves: 41, winners: ['N'], reason: 'checkmate' };
    expect(isXiangqiResult(result)).toBe(true);
    expect(isXiangqiResult({ ...result, reason: 'stalemate' })).toBe(true);
    expect(isXiangqiResult({ ...result, reason: 'perpetual-check', winners: ['S'] })).toBe(true);
    expect(isXiangqiResult({ ...result, winners: [] })).toBe(false);
    expect(isXiangqiResult({ ...result, reason: 'repetition' })).toBe(false);
    expect(isXiangqiResult({ ...result, reason: 'no-capture-limit', winners: [] })).toBe(true);
    expect(isXiangqiResult({ ...result, reason: 'disc-count' })).toBe(false);
    expect(isXiangqiResult({ ...result, seats: ['N'] })).toBe(false);
    expect(isXiangqiResult({ ...result, winners: ['E'] })).toBe(false);
  });

  it('parses only moves between board points and the match controls', () => {
    const parse = (action: unknown): unknown => parseGameAction({ gameType: 'xiangqi', action });
    expect(parse({ type: 'move', from: '7,7', to: '4,7' })).toEqual({ gameType: 'xiangqi', action: { type: 'move', from: '7,7', to: '4,7' } });
    expect(parse({ type: 'resign' })).toEqual({ gameType: 'xiangqi', action: { type: 'resign' } });
    for (const bad of [{ type: 'move', from: '9,0', to: '0,0' }, { type: 'move', from: '0,10', to: '0,0' },
      { type: 'move', from: '1,1', to: '1,1' }, { type: 'move', to: '0,0' }, { type: 'place', to: '0,0' }, null]) {
      expect(typeof parse(bad)).toBe('string');
    }
  });
});

describe('Xiangqi bots through the registry', () => {
  it('play only legal moves on both difficulties and return nothing off turn', () => {
    start();
    expect(getBotAction(xiangqi.getPlayerVisibleState(CODE, 'S')!, Math.random, 'easy')).toBeNull();
    for (let guard = 0; guard < 16 && game().phase === 'playing'; guard++) {
      const seat = game().currentTurnSeat;
      const action = getBotAction(xiangqi.getPlayerVisibleState(CODE, seat)!, lcg(guard + 1), seat === 'N' ? 'easy' : 'hard');
      expect(action).toMatchObject({ type: 'game-action', request: { gameType: 'xiangqi', action: { type: 'move' } } });
      const request = (action as { request: { action: { from: string; to: string } } }).request.action;
      expect(xiangqi.move(CODE, seat, request.from, request.to)).toEqual({ success: true });
    }
    expect(coherent()).toBe(true);
  });

  it('falls back to the first legal move and uses the easy policy on timeouts', () => {
    start();
    const bot = gameBot('xiangqi');
    expect(bot.firstLegal(xiangqi.getPlayerVisibleState(CODE, 'S')!)).toBeNull();
    const first = bot.firstLegal(xiangqi.getPlayerVisibleState(CODE, 'N')!) as { request: { action: { from: string; to: string } } };
    expect(xiangqi.move(CODE, 'N', first.request.action.from, first.request.action.to)).toEqual({ success: true });
    const timeout = bot.turnTimeout!(xiangqi.getPlayerVisibleState(CODE, 'S')!, { isBot: false, strategy: () => null }) as
      { request: { action: { from: string; to: string } } };
    expect(xiangqi.move(CODE, 'S', timeout.request.action.from, timeout.request.action.to)).toEqual({ success: true });
  });
});

describe('Xiangqi through the game manager', () => {
  const MANAGED = 'XQMGR1';
  afterEach(() => manager.removeGame(MANAGED));

  function begin(): void {
    expect(manager.startGame(MANAGED, 'xiangqi', { N: player('N'), S: player('S') })).toEqual({ success: true });
    manager.initializeClock(MANAGED);
  }

  it('runs a turn clock for the seat on move and leaves it alone for draw offers', () => {
    begin();
    expect(manager.getGameState(MANAGED)?.clock?.turn).toMatchObject({ seat: 'N' });
    expect(manager.handleGameAction(MANAGED, 'N', { gameType: 'xiangqi', action: { type: 'move', from: '7,7', to: '4,7' } }))
      .toEqual({ success: true });
    expect(manager.getGameState(MANAGED)?.clock?.turn).toMatchObject({ seat: 'S' });
    const turn = manager.getGameState(MANAGED)?.clock?.turn;
    expect(manager.handleGameAction(MANAGED, 'S', { gameType: 'xiangqi', action: { type: 'offer-draw' } })).toEqual({ success: true });
    expect(manager.getGameState(MANAGED)?.clock?.turn).toEqual(turn);
  });

  it('stops the clock on resignation and keeps the match valid as stored runtime state', () => {
    begin();
    expect(manager.handleGameAction(MANAGED, 'S', { gameType: 'xiangqi', action: { type: 'resign' } })).toEqual({ success: true });
    expect(manager.getGameState(MANAGED)).toMatchObject({ phase: 'scoring', clock: { turn: null } });
    const state = JSON.parse(JSON.stringify(manager.getGameState(MANAGED))) as XiangqiGameState;
    expect(gameValidator('xiangqi').shape(state as never, () => true)).toBe(true);
    expect(gameValidator('xiangqi').coherent(state)).toBe(true);
  });
});
