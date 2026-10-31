import { afterEach, describe, expect, it } from 'vitest';
import type { ChessGameState, GameSeat, PlayerInfo } from '@shared/types';
import { gameDefinition } from '@shared/games/registry';
import { parseGameAction } from '@shared/games/actions';
import { matchStanding } from '@shared/rules/match-standing';
import { DRAW_REOFFER_MOVES } from '@shared/rules/board/match-controls';
import { chessLegalMoves, chessNode } from '@shared/rules/chess';
import type { ChessPosition, ChessSide } from '@shared/rules/chess';
import { chessAdapter } from '../../src/managers/games/chess-adapter';
import * as chess from '../../src/managers/games/chess-game';
import { chessGame, coherentChessGame, isChessResult } from '../../src/managers/games/chess-validation';
import { gameValidator } from '../../src/managers/games/validation-registry';
import { gameBot } from '../../src/bots/bot-registry';
import { getBotAction } from '../../src/bots/bot-decisions';
import * as manager from '../../src/managers/game-manager';
import { chessFen, chessMoveOf, lcg } from '../fixtures/chess-positions';

const CODE = 'CHESS1';

function player(seat: GameSeat): PlayerInfo {
  return { id: seat.toLowerCase(), username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null };
}

function start(seats: readonly GameSeat[] = ['N', 'S']): void {
  chess.startGame(CODE, Object.fromEntries(seats.map((seat) => [seat, player(seat)])), 1_000);
}

function game(): ChessGameState {
  const state = chess.getGameState(CODE);
  if (!state) throw new Error('Expected a Chess game');
  return state;
}

/** Replaces the live position; the stored log no longer replays, so only the live flow is checked afterwards. */
function setPosition(position: ChessPosition): void {
  const state = game();
  state.board = [...position.board];
  state.castling = position.castling;
  state.enPassant = position.enPassant;
  state.halfmove = position.halfmove;
  state.currentTurnSeat = chess.chessSeats(state)[position.turn];
}

/** Plays a move written as `e2e4` or `e7e8q`. */
function play(seat: GameSeat, text: string, now = 2_000): ReturnType<typeof chess.move> {
  const move = chessMoveOf(text);
  return chess.move(CODE, seat, chessNode(move.from), chessNode(move.to), move.promotion, now);
}

const coherent = (): boolean => coherentChessGame(structuredClone(game()));
const sideOf = (seat: GameSeat): ChessSide => (chess.chessSeats(game()).indexOf(seat) === 0 ? 0 : 1);

function position(): ChessPosition {
  const state = game();
  return { board: state.board, turn: sideOf(state.currentTurnSeat), castling: state.castling, enPassant: state.enPassant, halfmove: state.halfmove };
}

/** Plays seeded random legal moves until the match ends or `limit` moves were made. */
function playOut(seed: number, limit = Infinity): void {
  const random = lcg(seed);
  for (let made = 0; made < limit && game().phase === 'playing'; made++) {
    const seat = game().currentTurnSeat;
    const moves = chessLegalMoves(position());
    expect(moves.length).toBeGreaterThan(0);
    const move = moves[Math.floor(random() * moves.length)];
    expect(chess.move(CODE, seat, chessNode(move.from), chessNode(move.to), move.promotion, 2_000)).toEqual({ success: true });
  }
}

afterEach(() => chess.abortGame(CODE));

describe('Chess setup', () => {
  it('registers a two-player board game on the board timer with resign and draw offers', () => {
    expect(gameDefinition('chess')).toMatchObject({
      category: 'board', equipment: [], seats: { minPlayers: 2, maxPlayers: 2, flexible: true, numbered: false },
      matchControls: { resign: true, draw: true }, timeControl: { baseSeconds: 60, bankSeconds: 300 },
    });
  });

  it('starts with the first occupied seat playing white and moving first', () => {
    start(['E', 'W']);
    expect(game()).toMatchObject({ phase: 'playing', currentTurnSeat: 'E', result: null, log: [], halfmove: 0, enPassant: null });
    expect(chess.getPlayerVisibleState(CODE, 'W')).toMatchObject({ seats: ['E', 'W'], mySeat: 'W', currentTurnSeat: 'E' });
    expect(coherent()).toBe(true);
  });
});

describe('Chess moves', () => {
  it('moves a piece, passes the turn, and logs the public facts with SAN', () => {
    start();
    expect(play('N', 'e2e4', 1_500)).toEqual({ success: true });
    expect(game().log).toEqual([{ seat: 'N', from: '4,6', to: '4,4', piece: 'P', san: 'e4', timestamp: 1_500 }]);
    expect(game()).toMatchObject({ currentTurnSeat: 'S', enPassant: 44, halfmove: 0 });
    expect(play('S', 'd7d5', 1_600)).toEqual({ success: true });
    expect(play('N', 'e4d5', 1_700)).toEqual({ success: true });
    expect(game().log[2]).toEqual({
      seat: 'N', from: '4,4', to: '3,3', piece: 'P', captured: 'p', capture: true, san: 'exd5', timestamp: 1_700,
    });
    expect(coherent()).toBe(true);
  });

  it('rejects moves out of turn, illegal moves, bad squares, and moves after the end', () => {
    start();
    expect(play('S', 'e7e5')).toMatchObject({ success: false, reason: 'Not your turn' });
    expect(play('N', 'e2e5')).toMatchObject({ success: false, reason: 'Illegal move' });
    expect(play('N', 'e2e4')).toEqual({ success: true });
    expect(chess.move(CODE, 'S', '9,9', '0,0')).toMatchObject({ success: false, reason: 'Illegal move' });
    expect(play('S', 'e7e8q')).toMatchObject({ success: false, reason: 'Illegal move' });
    chess.control(CODE, 'N', { type: 'resign' });
    expect(play('S', 'e7e5')).toMatchObject({ success: false, reason: 'The game is over' });
    expect(chess.move('NOPE00', 'N', '4,6', '4,4')).toMatchObject({ success: false, reason: 'Game not found' });
  });

  it('records castling and keeps the rights in the stored position', () => {
    start();
    for (const [seat, text] of [['N', 'e2e4'], ['S', 'e7e5'], ['N', 'g1f3'], ['S', 'b8c6'], ['N', 'f1c4'], ['S', 'g8f6']] as const) {
      expect(play(seat, text)).toEqual({ success: true });
    }
    expect(play('N', 'e1g1')).toEqual({ success: true });
    expect(game().log.at(-1)).toMatchObject({ piece: 'K', castle: 'k', san: 'O-O' });
    expect(game().castling).toEqual({ K: false, Q: false, k: true, q: true });
    expect([game().board[62], game().board[61]]).toEqual(['K', 'R']);
    expect(coherent()).toBe(true);
  });

  it('records an en passant capture of the pawn beside the target', () => {
    start();
    for (const [seat, text] of [['N', 'e2e4'], ['S', 'a7a6'], ['N', 'e4e5'], ['S', 'd7d5']] as const) {
      expect(play(seat, text)).toEqual({ success: true });
    }
    expect(play('N', 'e5d6')).toEqual({ success: true });
    expect(game().log.at(-1)).toMatchObject({ piece: 'P', captured: 'p', capture: true, enPassant: true, san: 'exd6' });
    expect(game().board[27]).toBeNull();
    expect(coherent()).toBe(true);
  });

  it('needs the promotion piece and records it', () => {
    start();
    setPosition(chessFen('4k3/P6p/8/8/8/8/8/4K3 w - -'));
    expect(play('N', 'a7a8')).toMatchObject({ success: false, reason: 'Illegal move' });
    expect(play('N', 'a7a8k')).toMatchObject({ success: false, reason: 'Illegal move' });
    expect(play('N', 'a7a8n')).toEqual({ success: true });
    expect(game().log.at(-1)).toMatchObject({ piece: 'P', promotion: 'n', san: 'a8=N' });
    expect(game().board[0]).toBe('N');
    expect(game().phase).toBe('playing');
  });

  it('ends with checkmate for the mover and marks the check', () => {
    start();
    for (const [seat, text] of [['N', 'f2f3'], ['S', 'e7e5'], ['N', 'g2g4']] as const) expect(play(seat, text)).toEqual({ success: true });
    expect(play('S', 'd8h4', 3_000)).toEqual({ success: true });
    expect(game().log.at(-1)).toMatchObject({ san: 'Qh4#', check: true, checkmate: true });
    expect(game()).toMatchObject({ phase: 'scoring', currentTurnSeat: 'S' });
    expect(game().result).toEqual({ gameType: 'chess', seats: ['N', 'S'], moves: 4, winners: ['S'], reason: 'checkmate' });
    expect(isChessResult(JSON.parse(JSON.stringify(game().result)))).toBe(true);
    expect(coherent()).toBe(true);
  });

  it('draws by stalemate, which is not a loss', () => {
    start();
    setPosition(chessFen('7k/4Q3/6K1/8/8/8/8/8 w - -'));
    expect(play('N', 'e7f7')).toEqual({ success: true });
    expect(game().result).toMatchObject({ winners: [], reason: 'stalemate', moves: 1 });
  });

  it('draws when no mate is possible any more', () => {
    start();
    setPosition(chessFen('7k/8/8/8/8/8/r7/K7 w - -'));
    expect(play('N', 'a1a2')).toEqual({ success: true });
    expect(game().result).toMatchObject({ winners: [], reason: 'insufficient-material' });
  });

  it('draws after fifty moves by each side without a capture or pawn move', () => {
    start();
    game().halfmove = 99;
    expect(play('N', 'g1f3')).toEqual({ success: true });
    expect(game().result).toMatchObject({ winners: [], reason: 'fifty-move' });
  });

  it('draws a threefold repetition from the start and keeps the log coherent', () => {
    start();
    const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
    shuffle.concat(shuffle).forEach((text, index) => expect(play(index % 2 === 0 ? 'N' : 'S', text)).toEqual({ success: true }));
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
      playOut(seed, 300);
      expect(coherent()).toBe(true);
      if (game().result) expect(isChessResult(JSON.parse(JSON.stringify(game().result)))).toBe(true);
      chess.abortGame(CODE);
    }
  });
});

describe('Chess resignation and draw offers', () => {
  it('lets either seat resign at any time and gives the other seat the win', () => {
    start();
    expect(chess.control(CODE, 'S', { type: 'resign' })).toEqual({ success: true });
    expect(game().result).toMatchObject({ winners: ['N'], reason: 'resign', moves: 0 });
    expect(coherent()).toBe(true);
  });

  it('offers a draw on the own turn, ends on acceptance, and starts a cooldown when a move declines it', () => {
    start();
    expect(chess.control(CODE, 'S', { type: 'offer-draw' })).toMatchObject({ success: false });
    expect(chess.control(CODE, 'N', { type: 'offer-draw' })).toEqual({ success: true });
    play('N', 'e2e4');
    play('S', 'e7e5');
    expect(game().drawOffer).toEqual({ offeredBy: null, cooldown: { N: DRAW_REOFFER_MOVES } });
    chess.abortGame(CODE);
    start();
    chess.control(CODE, 'N', { type: 'offer-draw' });
    expect(chess.control(CODE, 'S', { type: 'answer-draw', accept: true })).toEqual({ success: true });
    expect(game().result).toMatchObject({ winners: [], reason: 'agreed-draw' });
    expect(coherent()).toBe(true);
  });
});

describe('Chess adapter and stored state', () => {
  it('routes controls without the clock and moves through it', () => {
    const timed: string[] = [];
    const context = {
      automatic: false, settings: { baseSeconds: 60, bankSeconds: 300 },
      timed: (operation: () => { success: boolean }) => { timed.push('timed'); return operation(); },
      present: (operation: () => { success: boolean }) => { timed.push('present'); return operation(); },
      simultaneous: (operation: () => { success: boolean }) => operation(),
      resetClock: () => undefined,
    };
    expect(chessAdapter.start({
      roomCode: CODE, players: { N: player('N'), S: player('S') }, settings: context.settings, options: {},
    })).toEqual({ success: true });
    expect(chessAdapter.applyAction(CODE, 'N', { type: 'offer-draw' }, context as never)).toEqual({ success: true });
    expect(timed).toEqual([]);
    expect(chessAdapter.applyAction(CODE, 'N', { type: 'move', from: '4,6', to: '4,4' }, context as never)).toEqual({ success: true });
    expect(timed).toEqual(['timed']);
    expect(chessAdapter.turnSeat(game())).toBe('S');
    expect(chessAdapter.matchResult(game())).toBeNull();
  });

  it('gives spectators the same public position with only the observer flag added', () => {
    start();
    play('N', 'e2e4');
    const own = chess.getPlayerVisibleState(CODE, 'S')!;
    const spectator = chessAdapter.withObserverView(chess.getPlayerVisibleState(CODE, 'W')!, game(), 'spectator');
    expect(spectator).toMatchObject({ observer: 'spectator', board: own.board, log: own.log, seats: own.seats });
    expect(Object.keys(own).sort()).toEqual(['board', 'castling', 'currentTurnSeat', 'drawOffer', 'enPassant', 'gameType', 'halfmove',
      'log', 'mySeat', 'phase', 'result', 'seats']);
  });

  it('accepts a played game as stored state and rejects tampering', () => {
    start();
    playOut(7, 24);
    const stored = JSON.parse(JSON.stringify(game())) as Record<string, unknown>;
    const accepts = (value: unknown): boolean => gameValidator('chess').shape(value as never, () => true)
      && gameValidator('chess').coherent(value as ChessGameState);
    expect(accepts(stored)).toBe(true);
    expect(chessGame(stored, () => true)).toBe(true);

    const moved = structuredClone(stored) as { board: (string | null)[] };
    moved.board[28] = 'R';
    expect(accepts(moved)).toBe(false);
    expect(accepts({ ...structuredClone(stored), currentTurnSeat: game().currentTurnSeat === 'N' ? 'S' : 'N' })).toBe(false);
    expect(accepts({ ...structuredClone(stored), castling: { K: false, Q: false, k: false, q: false } })).toBe(false);
    expect(accepts({ ...structuredClone(stored), halfmove: 100 })).toBe(false);
    const badMove = structuredClone(stored) as { log: { to: string }[] };
    badMove.log[1].to = '0,0';
    expect(accepts(badMove)).toBe(false);
    const hiddenCheck = structuredClone(stored) as { log: { check?: boolean }[] };
    hiddenCheck.log[0].check = true;
    expect(accepts(hiddenCheck)).toBe(false);
    const wrongNotation = structuredClone(stored) as { log: { san: string }[] };
    wrongNotation.log[0].san = 'Qh5';
    expect(accepts(wrongNotation)).toBe(false);
    expect(accepts({ ...structuredClone(stored), result: { gameType: 'chess' } })).toBe(false);
    expect(accepts({ ...structuredClone(stored), phase: 'scoring' })).toBe(false);
    const extra = structuredClone(stored) as { log: Record<string, unknown>[] };
    extra.log[0].rank = 'secret';
    expect(accepts(extra)).toBe(false);
  });

  it('keeps stored results consistent with their reason', () => {
    const result = { gameType: 'chess', seats: ['N', 'S'], moves: 41, winners: ['N'], reason: 'checkmate' };
    expect(isChessResult(result)).toBe(true);
    expect(isChessResult({ ...result, reason: 'resign' })).toBe(true);
    expect(isChessResult({ ...result, winners: [] })).toBe(false);
    expect(isChessResult({ ...result, reason: 'stalemate' })).toBe(false);
    for (const reason of ['stalemate', 'repetition', 'fifty-move', 'insufficient-material', 'agreed-draw']) {
      expect(isChessResult({ ...result, reason, winners: [] })).toBe(true);
    }
    expect(isChessResult({ ...result, reason: 'perpetual-check', winners: ['S'] })).toBe(false);
    expect(isChessResult({ ...result, reason: 'disc-count' })).toBe(false);
    expect(isChessResult({ ...result, seats: ['N'] })).toBe(false);
    expect(isChessResult({ ...result, winners: ['E'] })).toBe(false);
  });

  it('parses only moves between squares, with an optional promotion piece, and the match controls', () => {
    const parse = (action: unknown): unknown => parseGameAction({ gameType: 'chess', action });
    expect(parse({ type: 'move', from: '4,6', to: '4,4' })).toEqual({ gameType: 'chess', action: { type: 'move', from: '4,6', to: '4,4' } });
    expect(parse({ type: 'move', from: '0,1', to: '0,0', promotion: 'q' }))
      .toEqual({ gameType: 'chess', action: { type: 'move', from: '0,1', to: '0,0', promotion: 'q' } });
    expect(parse({ type: 'resign' })).toEqual({ gameType: 'chess', action: { type: 'resign' } });
    for (const bad of [{ type: 'move', from: '8,0', to: '0,0' }, { type: 'move', from: '0,8', to: '0,0' },
      { type: 'move', from: '1,1', to: '1,1' }, { type: 'move', to: '0,0' }, { type: 'place', to: '0,0' },
      { type: 'move', from: '0,1', to: '0,0', promotion: 'k' }, { type: 'move', from: '0,1', to: '0,0', promotion: 'p' }, null]) {
      expect(typeof parse(bad)).toBe('string');
    }
  });
});

describe('Chess bots through the registry', () => {
  it('play only legal moves on both difficulties and return nothing off turn', () => {
    start();
    expect(getBotAction(chess.getPlayerVisibleState(CODE, 'S')!, Math.random, 'easy')).toBeNull();
    for (let guard = 0; guard < 12 && game().phase === 'playing'; guard++) {
      const seat = game().currentTurnSeat;
      const action = getBotAction(chess.getPlayerVisibleState(CODE, seat)!, lcg(guard + 1), seat === 'N' ? 'easy' : 'hard');
      expect(action).toMatchObject({ type: 'game-action', request: { gameType: 'chess', action: { type: 'move' } } });
      const request = (action as { request: { action: { from: string; to: string; promotion?: never } } }).request.action;
      expect(chess.move(CODE, seat, request.from, request.to, request.promotion)).toEqual({ success: true });
    }
    expect(coherent()).toBe(true);
  });

  it('names a promotion piece, falls back to the first legal move, and uses the easy policy on timeouts', () => {
    start();
    const bot = gameBot('chess');
    expect(bot.firstLegal(chess.getPlayerVisibleState(CODE, 'S')!)).toBeNull();
    const first = bot.firstLegal(chess.getPlayerVisibleState(CODE, 'N')!) as { request: { action: { from: string; to: string } } };
    expect(chess.move(CODE, 'N', first.request.action.from, first.request.action.to)).toEqual({ success: true });
    const timeout = bot.turnTimeout!(chess.getPlayerVisibleState(CODE, 'S')!, { isBot: false, strategy: () => null }) as
      { request: { action: { from: string; to: string } } };
    expect(chess.move(CODE, 'S', timeout.request.action.from, timeout.request.action.to)).toEqual({ success: true });

    chess.abortGame(CODE);
    start();
    setPosition(chessFen('4k3/P6p/8/8/8/8/8/4K3 w - -'));
    for (const strategy of [bot.easy, bot.firstLegal]) {
      const action = (strategy as (visible: never, random: () => number) => { request: { action: { promotion?: string } } } | null)(
        chess.getPlayerVisibleState(CODE, 'N') as never, lcg(5),
      );
      expect(action?.request.action.promotion).toMatch(/^[qrbn]$/);
    }
  });
});

describe('Chess through the game manager', () => {
  const MANAGED = 'CHMGR1';
  afterEach(() => manager.removeGame(MANAGED));

  function begin(): void {
    expect(manager.startGame(MANAGED, 'chess', { N: player('N'), S: player('S') })).toEqual({ success: true });
    manager.initializeClock(MANAGED);
  }

  it('runs a turn clock for the seat on move and leaves it alone for draw offers', () => {
    begin();
    expect(manager.getGameState(MANAGED)?.clock?.turn).toMatchObject({ seat: 'N' });
    expect(manager.handleGameAction(MANAGED, 'N', { gameType: 'chess', action: { type: 'move', from: '4,6', to: '4,4' } }))
      .toEqual({ success: true });
    expect(manager.getGameState(MANAGED)?.clock?.turn).toMatchObject({ seat: 'S' });
    const turn = manager.getGameState(MANAGED)?.clock?.turn;
    expect(manager.handleGameAction(MANAGED, 'S', { gameType: 'chess', action: { type: 'offer-draw' } })).toEqual({ success: true });
    expect(manager.getGameState(MANAGED)?.clock?.turn).toEqual(turn);
  });

  it('stops the clock on resignation and keeps the match valid as stored runtime state', () => {
    begin();
    expect(manager.handleGameAction(MANAGED, 'S', { gameType: 'chess', action: { type: 'resign' } })).toEqual({ success: true });
    expect(manager.getGameState(MANAGED)).toMatchObject({ phase: 'scoring', clock: { turn: null } });
    const state = JSON.parse(JSON.stringify(manager.getGameState(MANAGED))) as ChessGameState;
    expect(gameValidator('chess').shape(state as never, () => true)).toBe(true);
    expect(gameValidator('chess').coherent(state)).toBe(true);
  });
});
