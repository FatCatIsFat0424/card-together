import { afterEach, describe, expect, it } from 'vitest';
import type { GameSeat, JungleGameState, JungleVisibleState, PlayerInfo } from '@shared/types';
import { JG_CELLS, jgCell, jgIndex, jgLegalMoves } from '@shared/rules/jungle';
import { getBotAction, getEasyBotAction } from '../../src/bots/bot-decisions';
import type { BotAction } from '../../src/bots/bot-decisions';
import { gameBot } from '../../src/bots/bot-registry';
import { jungleSearch, searchBestMove, searchCells } from '../../src/bots/jungle-search';
import { createSearchPool } from '../../src/bots/search/search-worker-pool';
import type { SearchPool } from '../../src/bots/search/search-worker-pool';
import { seededRandom } from '../../src/bots/search/seeded-random';
import * as jungle from '../../src/managers/games/jungle-game';

const CODE = 'JUNBT1';
const player = (seat: GameSeat): PlayerInfo => ({
  id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null, isBot: true,
});

/** A position from nine rows of seven characters: `.` empty, `1`-`8` the first side, `a`-`h` the second. */
function position(...pieces: readonly [number, number, string][]): number[] {
  const cells = new Array<number>(JG_CELLS).fill(0);
  for (const [col, row, char] of pieces) cells[jgIndex(col, row)] = /\d/.test(char) ? Number(char) : char.charCodeAt(0) - 96 + 8;
  return cells;
}

function start(): void {
  jungle.startGame(CODE, { N: player('N'), S: player('S') }, 1_000);
}

const game = (): JungleGameState => jungle.getGameState(CODE)!;
const view = (seat: GameSeat): JungleVisibleState => jungle.getPlayerVisibleState(CODE, seat)!;

/** The `from → to` of a bot move, as node ids. */
function move(action: BotAction | null): string | null {
  return action?.type === 'game-action' && action.request.gameType === 'jungle' && action.request.action.type === 'move'
    ? `${action.request.action.from}>${action.request.action.to}` : null;
}

afterEach(() => jungle.abortGame(CODE));

describe('Jungle Easy bot', () => {
  it('enters the den when it can and otherwise takes the biggest capture when the noise is zero', () => {
    start();
    game().cells = position([3, 1, '4'], [0, 8, '2'], [6, 0, 'g'], [5, 4, 'c']);
    expect(move(getEasyBotAction(view('N'), () => 0))).toBe('3,1>3,0');
    game().cells = position([2, 6, '7'], [0, 0, 'b'], [3, 6, 'c'], [1, 6, 'e']);
    // Lion on (2,6) can take the dog on (3,6) or the leopard on (1,6): the leopard is worth more.
    expect(move(getEasyBotAction(view('N'), () => 0))).toBe('2,6>1,6');
  });

  it('plays only legal moves, varies with the random source, and stays out of turn', () => {
    start();
    const legal = new Set(jgLegalMoves(game().cells, 0).map((m) => `${m.from}>${m.to}`));
    const picks = new Set<string | null>();
    for (let seed = 1; seed <= 40; seed++) {
      const picked = move(getEasyBotAction(view('N'), seededRandom(seed)))!;
      const [from, to] = picked.split('>').map((node) => jgCell(node)!);
      expect(legal.has(`${from}>${to}`)).toBe(true);
      picks.add(picked);
    }
    expect(picks.size).toBeGreaterThan(1);
    expect(getEasyBotAction(view('S'))).toBeNull();
  });
});

describe('Jungle Hard bot', () => {
  const hard = (seat: GameSeat): string | null => move(gameBot('jungle').hard(view(seat), () => 0.5));

  it('takes a win in one move', () => {
    start();
    game().cells = position([3, 1, '4'], [0, 8, '2'], [6, 0, 'g'], [5, 4, 'c']);
    expect(hard('N')).toBe('3,1>3,0');
  });

  it('wins an unprotected elephant with the rat and keeps its own elephant away from a rat', () => {
    start();
    game().cells = position([3, 4, '1'], [3, 3, 'h'], [6, 8, '2'], [0, 0, 'b']);
    expect(hard('N')).toBe('3,4>3,3');
    // A blue rat on land next to the red elephant would take it, and the elephant cannot take the rat back.
    game().cells = position([3, 4, '8'], [3, 3, 'a'], [6, 8, '2'], [0, 0, 'b']);
    expect(move(searchOnce('N', 4))).toBe('3,4>3,5');
  });

  it('blocks a runner heading for its own den', () => {
    start();
    // Blue wolf on (3,6) is one step from stepping next to red's den and the red cat is the only defender.
    game().cells = position([4, 8, '2'], [3, 6, 'd'], [6, 8, '5'], [0, 0, 'b']);
    expect(move(searchOnce('N', 4))).toBe('4,8>4,7');
  });

  it('plays only legal moves for a whole match against itself', () => {
    start();
    for (let guard = 0; guard < 300 && game().phase === 'playing'; guard++) {
      const seat = game().currentTurnSeat;
      const picked = move(getBotAction(view(seat), seededRandom(guard + 1), 'hard'))!;
      expect(picked).not.toBeNull();
      const [from, to] = picked.split('>');
      expect(jungle.move(CODE, seat, from, to)).toEqual({ success: true });
    }
  }, 30_000);

  it('beats the Easy bot over several seeded matches', () => {
    let hardWins = 0;
    for (let seed = 1; seed <= 4; seed++) {
      start();
      const hardSeat: GameSeat = seed % 2 === 0 ? 'N' : 'S';
      for (let guard = 0; guard < 400 && game().phase === 'playing'; guard++) {
        const seat = game().currentTurnSeat;
        const random = seededRandom(seed * 1000 + guard);
        const picked = move(getBotAction(view(seat), random, seat === hardSeat ? 'hard' : 'easy'))!;
        const [from, to] = picked.split('>');
        jungle.move(CODE, seat, from, to);
      }
      if (game().result?.winners.includes(hardSeat)) hardWins++;
      jungle.abortGame(CODE);
    }
    expect(hardWins).toBeGreaterThanOrEqual(3);
  }, 60_000);

  function searchOnce(seat: GameSeat, maxDepth: number): BotAction | null {
    return jungleSearch(view(seat), { random: () => 0, budget: { maxDepth, timeLeftMs: () => 1000, expired: () => false } });
  }
});

describe('Jungle search', () => {
  it('takes the only legal move without searching and returns null with none', () => {
    const only = position([0, 0, 'a'], [1, 0, '7'], [0, 1, '7']);
    expect(searchBestMove(searchCells(only), 1, { maxDepth: 6, expired: () => true, random: () => 0 })).toBeNull();
    const single = position([0, 0, '1'], [1, 0, 'g']);
    expect(searchBestMove(searchCells(single), 0, { maxDepth: 6, expired: () => true, random: () => 0 })).toEqual({
      from: jgIndex(0, 0), to: jgIndex(0, 1),
    });
  });

  it('stops within its time budget and still returns a legal move', () => {
    start();
    const started = performance.now();
    const limit = started + 150;
    const best = searchBestMove(searchCells(game().cells), 0, {
      maxDepth: 30, expired: () => performance.now() >= limit, random: () => 0.3,
    });
    expect(performance.now() - started).toBeLessThan(500);
    expect(jgLegalMoves(game().cells, 0)).toContainEqual(best);
  });

  it('respects the depth cap from the search context', () => {
    start();
    const context = { random: () => 0, budget: { maxDepth: 2, timeLeftMs: () => 1000, expired: () => false } };
    const picked = move(jungleSearch(view('N'), context))!;
    const [from, to] = picked.split('>').map((node) => jgCell(node)!);
    expect(jgLegalMoves(game().cells, 0)).toContainEqual({ from, to });
    expect(jungleSearch(view('S'), context)).toBeNull();
  });

  it('declares the worker search with a one-second budget and a depth cap', () => {
    expect(gameBot('jungle').search).toMatchObject({ budgetMs: 1000, maxDepth: expect.any(Number) });
  });
});

describe('Jungle search in the bot worker pool', () => {
  const pools: SearchPool[] = [];
  afterEach(async () => {
    await Promise.all(pools.splice(0).map((pool) => pool.close()));
  });

  it('answers with a legal move inside its budget', async () => {
    start();
    const pool = createSearchPool({ workers: 1, memoryMb: 256, queueLimit: 2 });
    pools.push(pool);
    const spec = gameBot('jungle').search!;
    const started = Date.now();
    const outcome = await pool.run({
      strategy: spec.strategy, visible: JSON.parse(JSON.stringify(view('N'))), budgetMs: 400, maxDepth: spec.maxDepth, seed: 5,
    });
    expect(outcome.status).toBe('ok');
    expect(Date.now() - started).toBeLessThan(5_000);
    const picked = move(outcome.status === 'ok' ? outcome.action : null)!;
    const [from, to] = picked.split('>').map((node) => jgCell(node)!);
    expect(jgLegalMoves(game().cells, 0)).toContainEqual({ from, to });
  }, 20_000);
});
