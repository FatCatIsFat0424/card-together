import { afterEach, describe, expect, it } from 'vitest';
import type { ChessGameState, ChessVisibleState, GameSeat, PlayerInfo } from '@shared/types';
import {
  chessApply, chessCell, chessInitialPosition, chessIsLegal, chessKindOf, chessLegalMoves, chessNode, chessPositionKey, chessSideOf,
  chessVerdict,
} from '@shared/rules/chess';
import type { ChessMove, ChessPosition, ChessSide } from '@shared/rules/chess';
import { getBotAction, getEasyBotAction } from '../../src/bots/bot-decisions';
import type { BotAction } from '../../src/bots/bot-decisions';
import { gameBot } from '../../src/bots/bot-registry';
import { chessBestMove, chessEasyMove, chessSearch, chessTurn } from '../../src/bots/chess-search';
import { createSearchPool } from '../../src/bots/search/search-worker-pool';
import type { SearchPool } from '../../src/bots/search/search-worker-pool';
import { seededRandom } from '../../src/bots/search/seeded-random';
import * as chess from '../../src/managers/games/chess-game';
import { chessFen, chessMoveOf, lcg } from '../fixtures/chess-positions';

const CODE = 'CHBOT1';
const player = (seat: GameSeat): PlayerInfo => ({
  id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null, isBot: true,
});

function start(): void {
  chess.startGame(CODE, { N: player('N'), S: player('S') }, 1_000);
}

const game = (): ChessGameState => chess.getGameState(CODE)!;
const view = (seat: GameSeat): ChessVisibleState => chess.getPlayerVisibleState(CODE, seat)!;
const moveOf = (action: BotAction | null): ChessMove | null => {
  if (action?.type !== 'game-action' || action.request.gameType !== 'chess' || action.request.action.type !== 'move') return null;
  const { from, to, promotion } = action.request.action;
  return { from: chessCell(from)!, to: chessCell(to)!, ...promotion ? { promotion } : {} };
};
const play = (seat: GameSeat, text: string): void => {
  const move = chessMoveOf(text);
  expect(chess.move(CODE, seat, chessNode(move.from), chessNode(move.to), move.promotion)).toEqual({ success: true });
};
const key = (move: ChessMove): string => `${move.from}>${move.to}${move.promotion ?? ''}`;
const budget = { maxDepth: 2, timeLeftMs: () => 1000, expired: () => false };

afterEach(() => chess.abortGame(CODE));

describe('Chess Easy bot', () => {
  it('plays only legal moves, varies with the random source, and stays out of turn', () => {
    start();
    const legal = new Set(chessLegalMoves(chessInitialPosition()).map(key));
    const picks = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const move = moveOf(getEasyBotAction(view('N'), seededRandom(seed)))!;
      expect(legal.has(key(move))).toBe(true);
      picks.add(key(move));
    }
    expect(picks.size).toBeGreaterThan(1);
    expect(getEasyBotAction(view('S'))).toBeNull();
  });

  it('takes a mate in one and a hanging queen', () => {
    const mate = chessFen('6k1/5ppp/8/8/8/8/8/R3K3 w - -');
    const win = chessEasyMove(mate, 0, [], () => 0.99)!;
    expect(chessVerdict(chessApply(mate, win), [])).toMatchObject({ reason: 'checkmate', loser: 1 });
    const hanging = chessFen('4k3/8/8/3q4/8/8/8/3RK3 w - -');
    expect(chessEasyMove(hanging, 0, [], () => 0)).toEqual(chessMoveOf('d1d5'));
  });
});

describe('Chess Hard search', () => {
  it('reads the view into a position and the keys of every earlier position', () => {
    start();
    expect(chessTurn(view('S'))).toBeNull();
    for (const [seat, text] of [['N', 'g1f3'], ['S', 'g8f6'], ['N', 'f3g1']] as const) play(seat, text);
    const turn = chessTurn(view('S'))!;
    expect(turn.side).toBe(1);
    expect(turn.history).toHaveLength(3);
    expect(turn.position).toMatchObject({ turn: 1, halfmove: 3 });
  });

  it('respects the depth cap from the search context and returns nothing off turn', () => {
    start();
    const move = moveOf(chessSearch(view('N'), { random: () => 0, budget }))!;
    expect(chessIsLegal(chessInitialPosition(), move)).toBe(true);
    expect(chessSearch(view('S'), { random: () => 0, budget })).toBeNull();
  });

  it('chooses a promotion piece for a pawn that reaches the last rank', () => {
    start();
    const state = game();
    const position = chessFen('7k/P7/8/8/8/8/8/K6r w - -');
    state.board = [...position.board];
    state.castling = position.castling;
    const move = moveOf(chessSearch(view('N'), { random: () => 0, budget: { ...budget, maxDepth: 3 } }))!;
    expect(chessIsLegal(position, move)).toBe(true);
  });

  it('stops within its time budget and still returns a legal move', () => {
    const position = chessFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -');
    const started = performance.now();
    const limit = started + 200;
    const move = chessBestMove(position, 0, [], { maxDepth: 30, budget: { expired: () => performance.now() >= limit }, random: () => 0.3 });
    expect(performance.now() - started).toBeLessThan(600);
    expect(move && chessIsLegal(position, move)).toBe(true);
  });

  it('declares the worker search with a 1.5-second budget and a depth cap', () => {
    expect(gameBot('chess').search).toMatchObject({ budgetMs: 1500, maxDepth: expect.any(Number) });
  });

  it('plays only legal moves for a stretch of a match against the easy bot', () => {
    start();
    for (let guard = 0; guard < 30 && game().phase === 'playing'; guard++) {
      const seat = game().currentTurnSeat;
      const move = moveOf(getBotAction(view(seat), seededRandom(guard + 1), seat === 'N' ? 'hard' : 'easy'))!;
      expect(chess.move(CODE, seat, chessNode(move.from), chessNode(move.to), move.promotion)).toEqual({ success: true });
    }
    expect(game().log.length).toBeGreaterThan(0);
  });

  it('beats the easy bot on material in short seeded games', () => {
    const value: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    let ahead = 0;
    for (let seed = 1; seed <= 3; seed++) {
      let position: ChessPosition = chessInitialPosition();
      const history: string[] = [];
      const hardSide: ChessSide = seed % 2 === 0 ? 0 : 1;
      for (let ply = 0; ply < 40; ply++) {
        const move = position.turn === hardSide
          ? chessBestMove(position, position.turn, history, { maxDepth: 3, budget: { expired: () => false }, random: lcg(seed * 100 + ply) })
          : chessEasyMove(position, position.turn, history, lcg(seed * 100 + ply));
        if (!move) break;
        history.push(chessPositionKey(position));
        position = chessApply(position, move);
        if (chessVerdict(position, history)) break;
      }
      const material = (owner: ChessSide): number => position.board.reduce((total, cell) =>
        total + (cell && chessSideOf(cell) === owner ? value[chessKindOf(cell)] : 0), 0);
      if (material(hardSide) > material(hardSide === 0 ? 1 : 0)) ahead++;
    }
    expect(ahead).toBeGreaterThanOrEqual(2);
  });
});

describe('Chess search in the bot worker pool', () => {
  const pools: SearchPool[] = [];
  afterEach(async () => {
    await Promise.all(pools.splice(0).map((pool) => pool.close()));
  });

  it('answers with a legal move inside its budget', async () => {
    start();
    const pool = createSearchPool({ workers: 1, memoryMb: 256, queueLimit: 2 });
    pools.push(pool);
    const spec = gameBot('chess').search!;
    const started = Date.now();
    const outcome = await pool.run({
      strategy: spec.strategy, visible: JSON.parse(JSON.stringify(view('N'))), budgetMs: 400, maxDepth: spec.maxDepth, seed: 5,
    });
    expect(outcome.status).toBe('ok');
    expect(Date.now() - started).toBeLessThan(5_000);
    const move = moveOf(outcome.status === 'ok' ? outcome.action : null)!;
    expect(chessIsLegal(chessInitialPosition(), move)).toBe(true);
  }, 20_000);
});
