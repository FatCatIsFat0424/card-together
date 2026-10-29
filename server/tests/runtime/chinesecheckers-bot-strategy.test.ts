import { afterEach, describe, expect, it } from 'vitest';
import type { ChineseCheckersGameState, ChineseCheckersVisibleState, GameSeat, PlayerInfo } from '@shared/types';
import { CC_HOLES, CC_TRIANGLES, ccIndex, ccMoves, ccNode } from '@shared/rules/chinesecheckers';
import type { CcHole } from '@shared/rules/chinesecheckers';
import type { BotAction } from '../../src/bots/bot-decisions';
import { gameBot } from '../../src/bots/bot-registry';
import {
  chineseCheckersSearch, searchBestMove, searchBoard, searchMoves,
} from '../../src/bots/chinesecheckers-search';
import { easyChineseCheckersAction, getChineseCheckersBotAction } from '../../src/bots/chinesecheckers-strategy';
import { createSearchPool } from '../../src/bots/search/search-worker-pool';
import type { SearchPool } from '../../src/bots/search/search-worker-pool';
import * as checkers from '../../src/managers/games/chinesecheckers-game';

const CODE = 'CCHBT1';
const SEATS: readonly GameSeat[] = ['N', 'E', 'S', 'W', 'P5', 'P6'];
const player = (seat: GameSeat): PlayerInfo => ({
  id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null, isBot: true,
});

function start(count = 2): void {
  checkers.startGame(CODE, Object.fromEntries(SEATS.slice(0, count).map((seat) => [seat, player(seat)])), 1_000);
}

const game = (): ChineseCheckersGameState => checkers.getGameState(CODE)!;
const view = (seat: GameSeat): ChineseCheckersVisibleState => checkers.getPlayerVisibleState(CODE, seat)!;

function setBoard(marbles: Readonly<Record<string, number>>): void {
  const holes: CcHole[] = new Array<CcHole>(CC_HOLES).fill(null);
  for (const [node, corner] of Object.entries(marbles)) holes[ccIndex(node)!] = corner;
  game().holes = holes;
}

const chosen = (action: BotAction | null): { from: string; to: string } | null => (action?.type === 'game-action'
  && action.request.gameType === 'chinesecheckers' && action.request.action.type === 'move'
  ? { from: action.request.action.from, to: action.request.action.to } : null);

function legal(action: BotAction | null, corner: number): boolean {
  const move = chosen(action);
  return move !== null && ccMoves(game().holes, corner)
    .some((candidate) => ccNode(candidate.from) === move.from && ccNode(candidate.to) === move.to);
}

const budget = (expired: () => boolean, maxDepth = 2) => ({ maxDepth, timeLeftMs: () => 1000, expired });

afterEach(() => checkers.abortGame(CODE));

describe('Chinese checkers Easy bot', () => {
  it('takes the move that gains the most rows when the noise is zero', () => {
    start();
    setBoard({ '0,12': 0, '1,11': 3, '3,9': 3, '0,0': 3 });
    // The chain over both marbles reaches 4,8: four rows forward, more than any step or single jump.
    expect(chosen(easyChineseCheckersAction(view('N'), () => 0))).toEqual({ from: '0,12', to: '4,8' });
  });

  it('plays only legal moves, varies with the random source, and stays out of turn', () => {
    start();
    const picks = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      let state = seed;
      const random = (): number => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
      };
      const action = easyChineseCheckersAction(view('N'), random);
      expect(legal(action, 0)).toBe(true);
      picks.add(JSON.stringify(chosen(action)));
    }
    expect(picks.size).toBeGreaterThan(1);
    expect(easyChineseCheckersAction(view('E'), Math.random)).toBeNull();
  });
});

describe('Chinese checkers Hard bot', () => {
  it('takes a finishing move over any other progress', () => {
    start();
    const top = CC_TRIANGLES[3].map(ccNode).filter((node) => node !== '3,3');
    setBoard({ ...Object.fromEntries(top.map((node) => [node, 0])), '4,4': 0, '0,14': 0, '0,16': 3 });
    expect(chosen(getChineseCheckersBotAction(view('N'), () => 0.5))).toEqual({ from: '4,4', to: '3,3' });
    expect(chosen(chineseCheckersSearch(view('N'), { random: () => 0.5, budget: budget(() => false) })))
      .toEqual({ from: '4,4', to: '3,3' });
  });

  it('brings a straggler forward before pushing a front marble further', () => {
    start();
    // Equal one-row steps: the marble far behind gains more because the cost grows with the square of the rows.
    setBoard({ '0,14': 0, '0,4': 0, '0,0': 3 });
    const action = getChineseCheckersBotAction(view('N'), () => 0);
    expect(chosen(action)?.from).toBe('0,14');
  });

  it('returns null with no legal move and the only move without searching', () => {
    start(3);
    setBoard({ '0,16': 0, '-1,15': 2, '1,15': 2, '-2,14': 2, '2,14': 2, '0,0': 4 });
    const board = searchBoard(game().holes);
    const options = { previous: null, opponents: [2, 4], expired: () => true, random: () => 0, depth: 2 as const };
    expect(searchBestMove(board, 0, options)).toBeNull();
    setBoard({ '0,16': 0, '-1,15': 2, '1,15': 2, '-2,14': 2, '0,0': 4 });
    expect(searchBestMove(searchBoard(game().holes), 0, options)).toEqual({ from: ccIndex('0,16'), to: ccIndex('2,14') });
  });

  it('agrees with the shared rules on every legal move', () => {
    start(6);
    for (let corner = 0; corner < 6; corner++) {
      const rules = ccMoves(game().holes, corner).map((move) => `${move.from}-${move.to}`).sort();
      const search = searchMoves(searchBoard(game().holes), corner).map((move) => `${move.from}-${move.to}`).sort();
      expect(search).toEqual(rules);
    }
    setBoard({ '0,12': 0, '2,12': 1, '3,11': 1, '1,11': 1, '-1,13': 2, '-3,13': 2 });
    for (const corner of [0, 1, 2]) {
      expect(searchMoves(searchBoard(game().holes), corner).map((move) => `${move.from}-${move.to}`).sort())
        .toEqual(ccMoves(game().holes, corner).map((move) => `${move.from}-${move.to}`).sort());
    }
  });

  it('stops within its time budget and still returns a legal move', () => {
    start(6);
    const started = performance.now();
    const limit = started + 50;
    const action = chineseCheckersSearch(view('N'), { random: () => 0.3, budget: budget(() => performance.now() >= limit) });
    expect(performance.now() - started).toBeLessThan(400);
    expect(legal(action, 0)).toBe(true);
    // An already expired budget still refines one move and answers.
    expect(legal(chineseCheckersSearch(view('N'), { random: () => 0.3, budget: budget(() => true) }), 0)).toBe(true);
  });

  it('respects a one-ply cap and stays out of turn', () => {
    start();
    expect(legal(chineseCheckersSearch(view('N'), { random: () => 0, budget: budget(() => false, 1) }), 0)).toBe(true);
    expect(chineseCheckersSearch(view('E'), { random: () => 0, budget: budget(() => false) })).toBeNull();
  });

  it('beats the Easy bot in seeded two-player races', () => {
    let wins = 0;
    for (let seed = 1; seed <= 4; seed++) {
      start();
      let state = seed;
      const random = (): number => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
      };
      const hard = seed % 2 === 0 ? 'N' : 'E';
      for (let guard = 0; guard < 600 && game().phase === 'playing'; guard++) {
        const seat = game().currentTurnSeat;
        const action = seat === hard
          ? chineseCheckersSearch(view(seat), { random, budget: budget(() => false) })
          : easyChineseCheckersAction(view(seat), random);
        const move = chosen(action)!;
        expect(checkers.move(CODE, seat, move.from, move.to)).toEqual({ success: true });
      }
      if (game().result?.winners.includes(hard)) wins++;
      checkers.abortGame(CODE);
    }
    expect(wins).toBe(4);
  });

  it('declares the worker search with a budget and a two-ply cap', () => {
    expect(gameBot('chinesecheckers').search).toMatchObject({ budgetMs: 800, maxDepth: 2 });
  });
});

describe('Chinese checkers search in the bot worker pool', () => {
  const pools: SearchPool[] = [];
  afterEach(async () => {
    await Promise.all(pools.splice(0).map((pool) => pool.close()));
  });

  it('answers with a legal move inside its budget', async () => {
    start(4);
    const pool = createSearchPool({ workers: 1, memoryMb: 256, queueLimit: 2 });
    pools.push(pool);
    const spec = gameBot('chinesecheckers').search!;
    const started = Date.now();
    const outcome = await pool.run({
      strategy: spec.strategy, visible: JSON.parse(JSON.stringify(view('N'))), budgetMs: 400, maxDepth: spec.maxDepth, seed: 5,
    });
    expect(outcome.status).toBe('ok');
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(legal(outcome.status === 'ok' ? outcome.action : null, 0)).toBe(true);
  }, 20_000);
});
