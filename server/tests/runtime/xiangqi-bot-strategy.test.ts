import { afterEach, describe, expect, it } from 'vitest';
import type { GameSeat, PlayerInfo, XiangqiGameState, XiangqiVisibleState } from '@shared/types';
import {
  xqApply, xqCell, xqIndex, xqInitialBoard, xqIsLegal, xqLegalMoves, xqMoveFacts, xqNode, xqOpponent, xqPlies, xqVerdict,
} from '@shared/rules/xiangqi';
import type { XqBoard, XqMove, XqPly, XqSide } from '@shared/rules/xiangqi';
import { getBotAction, getEasyBotAction } from '../../src/bots/bot-decisions';
import type { BotAction } from '../../src/bots/bot-decisions';
import { gameBot } from '../../src/bots/bot-registry';
import { xiangqiBestMove, xiangqiEasyMove, xiangqiSearch } from '../../src/bots/xiangqi-search';
import { createSearchPool } from '../../src/bots/search/search-worker-pool';
import type { SearchPool } from '../../src/bots/search/search-worker-pool';
import { seededRandom } from '../../src/bots/search/seeded-random';
import * as xiangqi from '../../src/managers/games/xiangqi-game';
import { lcg, xqFen, xqPosition } from '../fixtures/xiangqi-positions';

const CODE = 'XQBOT1';
const at = xqIndex;
const player = (seat: GameSeat): PlayerInfo => ({
  id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null, isBot: true,
});

function start(): void {
  xiangqi.startGame(CODE, { N: player('N'), S: player('S') }, { handicap: 'none', handicapSide: 'red' }, 1_000);
}

const game = (): XiangqiGameState => xiangqi.getGameState(CODE)!;
const view = (seat: GameSeat): XiangqiVisibleState => xiangqi.getPlayerVisibleState(CODE, seat)!;
const moveOf = (action: BotAction | null): XqMove | null => {
  if (action?.type !== 'game-action' || action.request.gameType !== 'xiangqi' || action.request.action.type !== 'move') return null;
  return { from: xqCell(action.request.action.from)!, to: xqCell(action.request.action.to)! };
};
const deep = { maxDepth: 4, expired: () => false, random: () => 0.5 };

/** Plays `moves` from `board`, recording the plies the verdict and the bots read. */
function line(board: XqBoard, side: XqSide, moves: readonly [number, number][]): { board: XqBoard; side: XqSide; plies: XqPly[] } {
  let current = board;
  let toMove = side;
  const plies: XqPly[] = [];
  for (const [from, to] of moves) {
    expect(xqIsLegal(current, toMove, from, to)).toBe(true);
    const facts = xqMoveFacts(current, from, to);
    plies.push({ from, to, piece: facts.piece, captured: facts.captured ?? null, check: facts.check === true });
    current = xqApply(current, from, to);
    toMove = xqOpponent(toMove);
  }
  return { board: current, side: toMove, plies };
}

afterEach(() => xiangqi.abortGame(CODE));

describe('Xiangqi Easy bot', () => {
  it('plays only legal moves, varies with the random source, and stays out of turn', () => {
    start();
    const legal = new Set(xqLegalMoves(game().board, 0).map((move) => `${move.from}>${move.to}`));
    const picks = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const move = moveOf(getEasyBotAction(view('N'), seededRandom(seed)))!;
      expect(legal.has(`${move.from}>${move.to}`)).toBe(true);
      picks.add(`${move.from}>${move.to}`);
    }
    expect(picks.size).toBeGreaterThan(1);
    expect(getEasyBotAction(view('S'))).toBeNull();
  });

  it('takes a mate in one and a hanging chariot', () => {
    const mate = xqPosition(['....k....', '........R', '.........', '.........', '.........', 'R........', '.........',
      '.........', '.........', '...K.....']);
    // Checkmate and stalemate both win on the spot.
    const win = xiangqiEasyMove(mate, 0, [], () => 0.99)!;
    expect(xqVerdict(xqApply(mate, win.from, win.to), 1, [])).toMatchObject({ loser: 1 });
    const hanging = xqPosition(['....k....', '.........', '.........', 'r........', '.........', '.........', '.........',
      '.........', '.........', 'R..K.....']);
    expect(xiangqiEasyMove(hanging, 0, [], () => 0)).toEqual({ from: at(0, 9), to: at(0, 3) });
  });
});

describe('Xiangqi Hard search', () => {
  it('forces a win in two moves', () => {
    const board = xqPosition(['....k....', '.........', '.........', '.........', '.........', 'R.......R', '.........',
      '.........', '.........', '...K.....']);
    const first = xiangqiBestMove(board, 0, [], deep)!;
    let current = xqApply(board, first.from, first.to);
    const reply = xqLegalMoves(current, 1)[0];
    current = xqApply(current, reply.from, reply.to);
    const second = xiangqiBestMove(current, 0, [], deep)!;
    current = xqApply(current, second.from, second.to);
    expect(xqVerdict(current, 1, [])).toMatchObject({ loser: 1 });
  });

  it('wins material when a piece hangs and avoids walking into a capture', () => {
    const hanging = xqPosition(['....k....', '.........', '.........', 'r........', '.........', '.........', '.........',
      '.........', '.........', 'R..K.....']);
    expect(xiangqiBestMove(hanging, 0, [], deep)).toEqual({ from: at(0, 9), to: at(0, 3) });
  });

  it('never chooses the move that loses by perpetual check while another exists', () => {
    const board = xqPosition(['....k....', '.........', '.........', '.........', '.........', 'R........', '.........',
      '.........', '.........', '...K.....']);
    const cycle: [number, number][] = [[at(4, 0), at(4, 1)], [at(0, 0), at(0, 1)], [at(4, 1), at(4, 0)], [at(0, 1), at(0, 0)]];
    // Red has checked on every move; checking again now would repeat the position a third time.
    const before = line(board, 0, [[at(0, 5), at(0, 0)], ...cycle, ...cycle.slice(0, 3)]);
    expect(before.side).toBe(0);
    const losing = { from: at(0, 1), to: at(0, 0) };
    const after = line(before.board, 0, [[losing.from, losing.to]]);
    expect(xqVerdict(after.board, after.side, [...before.plies, ...after.plies])).toMatchObject({ reason: 'perpetual-check', loser: 0 });
    for (let seed = 1; seed <= 5; seed++) {
      expect(xiangqiBestMove(before.board, 0, before.plies, { ...deep, random: seededRandom(seed) })).not.toEqual(losing);
      expect(xiangqiEasyMove(before.board, 0, before.plies, seededRandom(seed))).not.toEqual(losing);
    }
  });

  it('returns null without a legal move and the only move without searching', () => {
    const stalemated = xqPosition(['....k....', '........R', '.........', '.........', '.........', '.....R...', '.........',
      '.........', '.........', '...K.....']);
    expect(xiangqiBestMove(stalemated, 1, [], deep)).toBeNull();
    expect(xiangqiEasyMove(stalemated, 1, [], Math.random)).toBeNull();
  });

  it('stops within its time budget and still returns a legal move', () => {
    const board = xqFen('r1ba1a3/4kn3/2n1b4/pNp1p1p1p/4c4/6P2/P1P2R2P/1CcC5/9/2BAKAB2 w');
    const started = performance.now();
    const limit = started + 200;
    const move = xiangqiBestMove(board, 0, [], { maxDepth: 30, expired: () => performance.now() >= limit, random: () => 0.3 });
    expect(performance.now() - started).toBeLessThan(600);
    expect(move && xqIsLegal(board, 0, move.from, move.to)).toBe(true);
  });

  it('respects the depth cap from the search context and returns nothing off turn', () => {
    start();
    const budget = { maxDepth: 2, timeLeftMs: () => 1000, expired: () => false };
    const move = moveOf(xiangqiSearch(view('N'), { random: () => 0, budget }))!;
    expect(xqIsLegal(game().board, 0, move.from, move.to)).toBe(true);
    expect(xiangqiSearch(view('S'), { random: () => 0, budget })).toBeNull();
  });

  it('declares the worker search with a 1.5-second budget and a depth cap', () => {
    expect(gameBot('xiangqi').search).toMatchObject({ budgetMs: 1500, maxDepth: expect.any(Number) });
  });

  it('plays only legal moves for a stretch of a match against the easy bot', () => {
    start();
    for (let guard = 0; guard < 40 && game().phase === 'playing'; guard++) {
      const seat = game().currentTurnSeat;
      const move = moveOf(getBotAction(view(seat), seededRandom(guard + 1), seat === 'N' ? 'hard' : 'easy'))!;
      expect(xiangqi.move(CODE, seat, xqNode(move.from), xqNode(move.to))).toEqual({ success: true });
    }
    expect(xqPlies(game().log)).toHaveLength(game().log.length);
  });

  it('beats the easy bot on material in short seeded games', () => {
    let ahead = 0;
    for (let seed = 1; seed <= 3; seed++) {
      let board: XqBoard = xqInitialBoard();
      let side: XqSide = 0;
      const plies: XqPly[] = [];
      const hard: XqSide = seed % 2 === 0 ? 0 : 1;
      for (let ply = 0; ply < 60; ply++) {
        const move = side === hard
          ? xiangqiBestMove(board, side, plies, { maxDepth: 3, expired: () => false, random: lcg(seed * 100 + ply) })
          : xiangqiEasyMove(board, side, plies, lcg(seed * 100 + ply));
        if (!move) break;
        const facts = xqMoveFacts(board, move.from, move.to);
        plies.push({ ...move, piece: facts.piece, captured: facts.captured ?? null, check: facts.check === true });
        board = xqApply(board, move.from, move.to);
        side = xqOpponent(side);
        if (xqVerdict(board, side, plies)) break;
      }
      const value: Record<string, number> = { r: 9, c: 4.5, h: 4, a: 2, e: 2, p: 1, k: 0 };
      const material = (owner: XqSide): number => board.reduce((total, cell) => total
        + (cell && (cell === cell.toUpperCase() ? 0 : 1) === owner ? value[cell.toLowerCase()] : 0), 0);
      if (material(hard) > material(xqOpponent(hard))) ahead++;
    }
    expect(ahead).toBeGreaterThanOrEqual(2);
  });
});

describe('Xiangqi search in the bot worker pool', () => {
  const pools: SearchPool[] = [];
  afterEach(async () => {
    await Promise.all(pools.splice(0).map((pool) => pool.close()));
  });

  it('answers with a legal move inside its budget', async () => {
    start();
    const pool = createSearchPool({ workers: 1, memoryMb: 256, queueLimit: 2 });
    pools.push(pool);
    const spec = gameBot('xiangqi').search!;
    const started = Date.now();
    const outcome = await pool.run({
      strategy: spec.strategy, visible: JSON.parse(JSON.stringify(view('N'))), budgetMs: 400, maxDepth: spec.maxDepth, seed: 5,
    });
    expect(outcome.status).toBe('ok');
    expect(Date.now() - started).toBeLessThan(5_000);
    const move = moveOf(outcome.status === 'ok' ? outcome.action : null)!;
    expect(xqIsLegal(game().board, 0, move.from, move.to)).toBe(true);
  }, 20_000);
});
