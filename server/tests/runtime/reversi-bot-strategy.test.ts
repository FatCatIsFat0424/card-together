import { afterEach, describe, expect, it } from 'vitest';
import type { GameSeat, PlayerInfo, ReversiGameState, ReversiVisibleState } from '@shared/types';
import { rvCell, rvIndex, rvLegalMoves } from '@shared/rules/reversi';
import type { RvCell } from '@shared/rules/reversi';
import { getBotAction, getEasyBotAction } from '../../src/bots/bot-decisions';
import type { BotAction } from '../../src/bots/bot-decisions';
import { gameBot } from '../../src/bots/bot-registry';
import { reversiSearch, searchBestCell, searchBoard } from '../../src/bots/reversi-search';
import { createSearchPool } from '../../src/bots/search/search-worker-pool';
import type { SearchPool } from '../../src/bots/search/search-worker-pool';
import { seededRandom } from '../../src/bots/search/seeded-random';
import * as reversi from '../../src/managers/games/reversi-game';

const CODE = 'REVBT1';
const player = (seat: GameSeat): PlayerInfo => ({
  id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null, isBot: true,
});

function position(rows: readonly string[]): RvCell[] {
  return rows.join('').split('').map((char): RvCell => (char === 'x' ? 0 : char === 'o' ? 1 : null));
}

function start(): void {
  reversi.startGame(CODE, { N: player('N'), S: player('S') }, 1_000);
}

const game = (): ReversiGameState => reversi.getGameState(CODE)!;
const view = (seat: GameSeat): ReversiVisibleState => reversi.getPlayerVisibleState(CODE, seat)!;
const target = (action: BotAction | null): number | null => (action?.type === 'game-action'
  && action.request.gameType === 'reversi' && action.request.action.type === 'place' ? rvCell(action.request.action.to) : null);

afterEach(() => reversi.abortGame(CODE));

describe('Reversi Easy bot', () => {
  it('picks the move that flips the most discs when the noise is zero', () => {
    start();
    game().discs = position([
      '.ooooox.', '........', '........', '........', '........', 'xo......', '........', '........',
    ]);
    // a8 flips five discs; c3 flips one.
    expect(target(getEasyBotAction(view('N'), () => 0))).toBe(rvIndex(0, 0));
  });

  it('plays only legal moves, varies with the random source, and stays out of turn', () => {
    start();
    const legal = new Set(rvLegalMoves(game().discs, 0));
    const picks = new Set<number | null>();
    for (let seed = 1; seed <= 40; seed++) {
      const cell = target(getEasyBotAction(view('N'), seededRandom(seed)));
      expect(legal.has(cell!)).toBe(true);
      picks.add(cell);
    }
    expect(picks.size).toBeGreaterThan(1);
    expect(getEasyBotAction(view('S'))).toBeNull();
  });
});

describe('Reversi Hard bot', () => {
  it('takes a free corner over a bigger flip elsewhere', () => {
    start();
    game().discs = position([
      '.ox.....', '........', '........', '...ox...', '...xo...', '........', '........', '........',
    ]);
    // Dark can take a8 (flipping b8) or flip along the centre; the corner is worth more.
    expect(target(getReversiAction('N'))).toBe(rvIndex(0, 0));
  });

  it('plays only legal moves for a whole match against itself', () => {
    start();
    for (let guard = 0; guard < 200 && game().phase === 'playing'; guard++) {
      const seat = game().currentTurnSeat;
      const cell = target(getBotAction(view(seat), seededRandom(guard + 1), 'hard'));
      expect(cell).not.toBeNull();
      expect(reversi.place(CODE, seat, `${cell! % 8},${Math.floor(cell! / 8)}`)).toEqual({ success: true });
    }
    expect(game().phase).toBe('scoring');
  });

  it('beats the Easy bot over several seeded matches', () => {
    let hardWins = 0;
    for (let seed = 1; seed <= 6; seed++) {
      start();
      const hardSeat: GameSeat = seed % 2 === 0 ? 'N' : 'S';
      for (let guard = 0; guard < 200 && game().phase === 'playing'; guard++) {
        const seat = game().currentTurnSeat;
        const random = seededRandom(seed * 1000 + guard);
        const cell = target(getBotAction(view(seat), random, seat === hardSeat ? 'hard' : 'easy'));
        reversi.place(CODE, seat, `${cell! % 8},${Math.floor(cell! / 8)}`);
      }
      if (game().result?.winners.includes(hardSeat)) hardWins++;
      reversi.abortGame(CODE);
    }
    expect(hardWins).toBeGreaterThanOrEqual(5);
  });
});

function getReversiAction(seat: GameSeat): BotAction | null {
  return gameBot('reversi').hard(view(seat), () => 0.5);
}

describe('Reversi search', () => {
  it('takes the only legal move without searching', () => {
    const board = searchBoard(position([
      'xxxxxxxx', 'xxxxxxxx', 'xxxxxxxx', 'xxxxxxxx', 'xxxxxxxx', 'xxxxxxxx', 'xxxxxxxx', 'xooooo..',
    ]));
    expect(searchBestCell(board, 1, { maxDepth: 10, expired: () => true, random: () => 0 })).toBe(rvIndex(6, 7));
  });

  it('returns null with no legal move and the only move without searching', () => {
    const empty = searchBoard(position(Array(8).fill('........')));
    expect(searchBestCell(empty, 1, { maxDepth: 4, expired: () => false, random: () => 0 })).toBeNull();
  });

  it('stops within its time budget and still returns a legal move', () => {
    start();
    const started = performance.now();
    const limit = started + 150;
    const cell = searchBestCell(searchBoard(game().discs), 1, {
      maxDepth: 30, expired: () => performance.now() >= limit, random: () => 0.3,
    });
    expect(performance.now() - started).toBeLessThan(400);
    expect(rvLegalMoves(game().discs, 0)).toContain(cell);
  });

  it('respects the depth cap from the search context', () => {
    start();
    const action = reversiSearch(view('N'), {
      random: () => 0, budget: { maxDepth: 2, timeLeftMs: () => 1000, expired: () => false },
    });
    expect(rvLegalMoves(game().discs, 0)).toContain(target(action)!);
    expect(reversiSearch(view('S'), {
      random: () => 0, budget: { maxDepth: 2, timeLeftMs: () => 1000, expired: () => false },
    })).toBeNull();
  });

  it('declares the worker search with a one-second budget and a depth cap', () => {
    expect(gameBot('reversi').search).toMatchObject({ budgetMs: 1000, maxDepth: expect.any(Number) });
  });
});

describe('Reversi search in the bot worker pool', () => {
  const pools: SearchPool[] = [];
  afterEach(async () => {
    await Promise.all(pools.splice(0).map((pool) => pool.close()));
  });

  it('answers with a legal move inside its budget', async () => {
    start();
    const pool = createSearchPool({ workers: 1, memoryMb: 256, queueLimit: 2 });
    pools.push(pool);
    const spec = gameBot('reversi').search!;
    const started = Date.now();
    const outcome = await pool.run({
      strategy: spec.strategy, visible: JSON.parse(JSON.stringify(view('N'))), budgetMs: 400, maxDepth: spec.maxDepth, seed: 5,
    });
    expect(outcome.status).toBe('ok');
    expect(Date.now() - started).toBeLessThan(5_000);
    const action = outcome.status === 'ok' ? outcome.action : null;
    expect(rvLegalMoves(game().discs, 0)).toContain(target(action)!);
  }, 20_000);
});
