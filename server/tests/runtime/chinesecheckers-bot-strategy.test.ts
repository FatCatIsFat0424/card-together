import { afterEach, describe, expect, it } from 'vitest';
import type { ChineseCheckersGameState, ChineseCheckersVisibleState, GameSeat, PlayerInfo } from '@shared/types';
import {
  CC_HOLES, CC_NEIGHBOURS, CC_TIP_DISTANCE, CC_TRIANGLES, CC_TURN_LIMIT, ccIndex, ccMoves, ccNode, ccTarget,
} from '@shared/rules/chinesecheckers';
import type { CcHole } from '@shared/rules/chinesecheckers';
import type { BotAction } from '../../src/bots/bot-decisions';
import { gameBot } from '../../src/bots/bot-registry';
import {
  chineseCheckersSearch, moveAction, searchBestMove, searchBoard, searchMoves, searchSetup,
} from '../../src/bots/chinesecheckers-search';
import { getChineseCheckersBotAction } from '../../src/bots/chinesecheckers-strategy';
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

/** A uniformly random legal move: the weak baseline the search has to beat. */
function randomMoveAction(visible: ChineseCheckersVisibleState, random: () => number): BotAction | null {
  const setup = searchSetup(visible);
  const moves = setup ? searchMoves(searchBoard(visible.holes), setup.corner) : [];
  return moves.length > 0 ? moveAction(moves[Math.floor(random() * moves.length)]) : null;
}

const budget = (expired: () => boolean, maxDepth?: number) => ({ maxDepth, timeLeftMs: () => 1000, expired });

afterEach(() => checkers.abortGame(CODE));

describe('Chinese checkers synchronous bot', () => {
  it('takes the move that gains the most rows when the noise is zero', () => {
    start();
    setBoard({ '0,12': 0, '1,11': 3, '3,9': 3, '0,0': 3 });
    // The chain over both marbles reaches 4,8: four rows forward, more than any step or single jump.
    expect(chosen(getChineseCheckersBotAction(view('N'), () => 0))).toEqual({ from: '0,12', to: '4,8' });
  });

  it('plays only legal moves and stays out of turn', () => {
    start();
    for (let seed = 1; seed <= 5; seed++) expect(legal(getChineseCheckersBotAction(view('N'), () => seed / 6), 0)).toBe(true);
    expect(getChineseCheckersBotAction(view('E'), Math.random)).toBeNull();
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

  it('brings a marble that is far behind forward before a front marble that is already close', () => {
    start();
    // Equal one-row steps: the marble far behind costs more rows, so moving it first is the better race.
    setBoard({ '0,14': 0, '0,4': 0, '0,0': 3 });
    const action = chineseCheckersSearch(view('N'), { random: () => 0, budget: budget(() => false, 4) });
    expect(chosen(action)?.from).toBe('0,14');
  });

  describe('when a move would fill a rival\'s last target hole', () => {
    interface Entry { readonly hole: number; readonly outside: number; readonly rival: number }

    const strategies: readonly [string, () => BotAction | null][] = [
      ['synchronous', () => getChineseCheckersBotAction(view('N'), () => 0)],
      ['one-ply search', () => chineseCheckersSearch(view('N'), { random: () => 0, budget: budget(() => false, 1) })],
      ['deep search', () => chineseCheckersSearch(view('N'), { random: () => 0, budget: budget(() => false, 4) })],
    ];

    /**
     * North has one marble beside the rival's target, boxed in so that stepping into the hole is its only move,
     * and a marble on its own tip whose every move loses ground. The rival has filled its target but for the
     * hole, plus one more hole when `short`.
     */
    function setUp(short: boolean): Entry {
      const rival = 2;
      const target = CC_TRIANGLES[ccTarget(rival)];
      const hole = target.find((index) => CC_NEIGHBOURS[index].some((next) => next >= 0 && !target.includes(next)))!;
      const outside = CC_NEIGHBOURS[hole].find((next) => next >= 0 && !target.includes(next))!;
      const boxed = new Set<number>();
      CC_NEIGHBOURS[outside].forEach((over, direction) => {
        if (over < 0 || over === hole) return;
        boxed.add(over);
        boxed.add(CC_NEIGHBOURS[over][direction]);
      });
      boxed.delete(hole);
      boxed.delete(outside);
      boxed.delete(-1);
      const marbles: Record<string, number> = {};
      for (const index of boxed) marbles[ccNode(index)] = 5;
      const open = target.find((index) => index !== hole && !boxed.has(index) && !CC_NEIGHBOURS[outside].includes(index))!;
      for (const index of target) if (index !== hole && !(short && index === open)) marbles[ccNode(index)] = rival;
      marbles[ccNode(outside)] = 0;
      marbles['0,0'] = 0;
      start(6);
      setBoard(marbles);
      return { hole, outside, rival };
    }

    const stepsIn = (action: BotAction | null, entry: Entry): boolean => {
      const move = chosen(action);
      return move?.from === ccNode(entry.outside) && move.to === ccNode(entry.hole);
    };

    it.each(strategies)('%s: steps in while it does not complete the target', (_name, act) => {
      const entry = setUp(true);
      expect(stepsIn(act(), entry)).toBe(true);
    });

    it.each(strategies)('%s: plays another move once the step would complete it', (_name, act) => {
      const entry = setUp(false);
      const action = act();
      expect(legal(action, 0)).toBe(true);
      expect(stepsIn(action, entry)).toBe(false);
    });
  });

  it('returns null with no legal move and the only move without searching', () => {
    start(3);
    setBoard({ '0,16': 0, '-1,15': 2, '1,15': 2, '-2,14': 2, '2,14': 2, '0,0': 4 });
    const board = searchBoard(game().holes);
    const options = { previous: null, opponents: [2, 4], expired: () => true, random: () => 0 };
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
    // An already expired budget still answers with a one-ply move.
    expect(legal(chineseCheckersSearch(view('N'), { random: () => 0.3, budget: budget(() => true) }), 0)).toBe(true);
  });

  it.each([2, 3, 6])('stays within its budget and plays a legal move with %i players', (count) => {
    start(count);
    const started = performance.now();
    const limit = started + 100;
    const action = chineseCheckersSearch(view('N'), { random: () => 0.3, budget: budget(() => performance.now() >= limit) });
    expect(performance.now() - started).toBeLessThan(500);
    expect(legal(action, 0)).toBe(true);
  });

  it('caps the search at eight plies with three or more seats but not with two', () => {
    start(4);
    const deepest = (opponents: number[]): number => {
      let reached = 0;
      searchBestMove(searchBoard(game().holes), 0, {
        previous: null, opponents, expired: () => false, random: () => 0, maxNodes: 600_000, onDepth: (depth) => { reached = depth; },
      });
      return reached;
    };
    expect(deepest([1, 3, 4])).toBe(8);
    expect(deepest([3])).toBeGreaterThan(8);
  });

  it('does not change the board it searches', () => {
    start(4);
    const visible = JSON.parse(JSON.stringify(view('N'))) as ChineseCheckersVisibleState;
    chineseCheckersSearch(visible, { random: () => 0.1, budget: budget(() => false, 3) });
    expect(visible).toEqual(JSON.parse(JSON.stringify(view('N'))));
    const board = searchBoard(game().holes);
    const copy = Int8Array.from(board);
    searchBestMove(board, 0, { previous: null, opponents: [1, 3, 4], expired: () => false, random: () => 0, maxDepth: 3 });
    expect(board).toEqual(copy);
  });

  it('counts the turns left before the limit, passes included, and then plays for plain rows', () => {
    start();
    const move = (seat: GameSeat) => ({ seat, from: '0,16', to: '1,15', timestamp: 1 });
    const early = { ...view('N'), log: [...Array.from({ length: 10 }, () => move('N')), { seat: 'E' as GameSeat, timestamp: 1 }] };
    expect(searchSetup(early)?.turnsLeft).toBe(CC_TURN_LIMIT - 10);
    const late = { ...view('N'), log: Array.from({ length: CC_TURN_LIMIT - 1 }, () => move('N')) };
    expect(searchSetup(late)?.turnsLeft).toBe(1);
    // With one turn left only the rows count: the marble far from home jumps as far as it can.
    setBoard({ '0,12': 0, '1,11': 3, '3,9': 3, '4,12': 0, '0,0': 3 });
    const holes = game().holes;
    const rows = (from: number, to: number): number => CC_TIP_DISTANCE[ccTarget(0)][from] - CC_TIP_DISTANCE[ccTarget(0)][to];
    const best = Math.max(...ccMoves(holes, 0).map((m) => rows(m.from, m.to)));
    const picked = searchBestMove(searchBoard(holes), 0, {
      previous: null, opponents: [3], expired: () => false, random: () => 0, turnsLeft: 1, maxDepth: 1,
    })!;
    expect(rows(picked.from, picked.to)).toBe(best);
  });

  it('respects a depth cap and stays out of turn', () => {
    start();
    expect(legal(chineseCheckersSearch(view('N'), { random: () => 0, budget: budget(() => false, 1) }), 0)).toBe(true);
    expect(chineseCheckersSearch(view('E'), { random: () => 0, budget: budget(() => false) })).toBeNull();
  });

  it('beats a random legal mover in seeded two-player races', () => {
    let wins = 0;
    for (let seed = 1; seed <= 4; seed++) {
      start();
      let state = seed;
      const random = (): number => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
      };
      const bot = seed % 2 === 0 ? 'N' : 'E';
      for (let guard = 0; guard < 600 && game().phase === 'playing'; guard++) {
        const seat = game().currentTurnSeat;
        const action = seat === bot
          ? chineseCheckersSearch(view(seat), { random, budget: budget(() => false, 3) })
          : randomMoveAction(view(seat), random);
        const move = chosen(action)!;
        expect(checkers.move(CODE, seat, move.from, move.to)).toEqual({ success: true });
      }
      if (game().result?.winners.includes(bot)) wins++;
      checkers.abortGame(CODE);
    }
    expect(wins).toBe(4);
  });

  it('plays a legal four-player match to its end against itself', () => {
    start(4);
    for (let guard = 0; guard < 700 && game().phase === 'playing'; guard++) {
      const seat = game().currentTurnSeat;
      const action = getChineseCheckersBotAction(view(seat), () => 0.5);
      const move = chosen(action)!;
      expect(checkers.move(CODE, seat, move.from, move.to)).toEqual({ success: true });
    }
    expect(game().phase).toBe('scoring');
  }, 60_000);

  it('declares the worker search with a budget of about two seconds', () => {
    expect(gameBot('chinesecheckers').search).toMatchObject({ budgetMs: 2000 });
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
      strategy: spec.strategy, visible: JSON.parse(JSON.stringify(view('N'))), budgetMs: 1000, maxDepth: spec.maxDepth, seed: 5,
    });
    expect(outcome.status).toBe('ok');
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(legal(outcome.status === 'ok' ? outcome.action : null, 0)).toBe(true);
  }, 20_000);
});
