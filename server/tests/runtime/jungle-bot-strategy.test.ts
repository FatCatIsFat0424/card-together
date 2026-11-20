import { afterEach, describe, expect, it } from 'vitest';
import type { GameSeat, JungleGameState, JungleVisibleState, PlayerInfo } from '@shared/types';
import {
  JG_CELLS, JG_NO_CAPTURE_LIMIT, jgApply, jgCell, jgIndex, jgInitialCells, jgLegalMoves, jgNode, jgOpponent, jgOutcome,
} from '@shared/rules/jungle';
import type { JgSide } from '@shared/rules/jungle';
import { getBotAction } from '../../src/bots/bot-decisions';
import type { BotAction } from '../../src/bots/bot-decisions';
import { gameBot } from '../../src/bots/bot-registry';
import { MAX_MOVES, boardFrom, generate } from '../../src/bots/jungle-board';
import { gameHistory, jungleSearch, searchBestMove, searchCells } from '../../src/bots/jungle-search';
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

describe('Jungle synchronous bot', () => {
  it('plays only legal moves and stays out of turn', () => {
    start();
    const legal = new Set(jgLegalMoves(game().cells, 0).map((m) => `${m.from}>${m.to}`));
    for (let seed = 1; seed <= 5; seed++) {
      const picked = move(getBotAction(view('N'), seededRandom(seed)))!;
      const [from, to] = picked.split('>').map((node) => jgCell(node)!);
      expect(legal.has(`${from}>${to}`)).toBe(true);
    }
    expect(getBotAction(view('S'))).toBeNull();
  });
});

describe('Jungle Hard bot', () => {
  const hard = (seat: GameSeat): string | null => move(gameBot('jungle').decide(view(seat), () => 0.5));

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
      const picked = move(getBotAction(view(seat), seededRandom(guard + 1)))!;
      expect(picked).not.toBeNull();
      const [from, to] = picked.split('>');
      expect(jungle.move(CODE, seat, from, to)).toEqual({ success: true });
    }
  }, 30_000);

  it('beats a random legal mover over several seeded matches', () => {
    let botWins = 0;
    for (let seed = 1; seed <= 4; seed++) {
      start();
      const botSeat: GameSeat = seed % 2 === 0 ? 'N' : 'S';
      for (let guard = 0; guard < 400 && game().phase === 'playing'; guard++) {
        const seat = game().currentTurnSeat;
        const random = seededRandom(seed * 1000 + guard);
        let picked: string;
        if (seat === botSeat) {
          picked = move(getBotAction(view(seat), random))!;
        } else {
          const options = jgLegalMoves(game().cells, seat === 'N' ? 0 : 1);
          const chosen = options[Math.floor(random() * options.length)];
          picked = `${jgNode(chosen.from)}>${jgNode(chosen.to)}`;
        }
        const [from, to] = picked.split('>');
        jungle.move(CODE, seat, from, to);
      }
      if (game().result?.winners.includes(botSeat)) botWins++;
      jungle.abortGame(CODE);
    }
    expect(botWins).toBeGreaterThanOrEqual(3);
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

  it('declares the worker search with a budget of about two seconds', () => {
    expect(gameBot('jungle').search).toMatchObject({ budgetMs: 2000 });
  });
});

describe('Jungle search engine', () => {
  const random = () => 0;
  const search = (cells: number[], side: JgSide, extra: Partial<Parameters<typeof searchBestMove>[2]> = {}) =>
    searchBestMove(cells, side, { maxDepth: 10, expired: () => false, random, maxNodes: 300_000, tableBits: 16, ...extra });

  it('generates exactly the moves of the shared rules over random games', () => {
    let state = 7;
    const next = (): number => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
    const out = new Int16Array(MAX_MOVES);
    for (let match = 0; match < 40; match++) {
      let cells = jgInitialCells();
      let side: JgSide = 0;
      for (let ply = 0; ply < 200; ply++) {
        const rules = jgLegalMoves(cells, side);
        const count = generate(boardFrom(cells), side, out, 0, false);
        expect(Array.from(out.subarray(0, count)).sort((a, b) => a - b))
          .toEqual(rules.map(({ from, to }) => from * 64 + to).sort((a, b) => a - b));
        if (rules.length === 0) break;
        const move = rules[Math.floor(next() * rules.length)];
        const quiet = cells[move.to] === 0 ? 1 : 0;
        cells = jgApply(cells, move);
        if (jgOutcome(cells, side, move.to, quiet)) break;
        side = jgOpponent(side);
      }
    }
  });

  it('does not change the position it searches', () => {
    const cells = jgInitialCells();
    const before = [...cells];
    search(cells, 0);
    expect(cells).toEqual(before);
    start();
    const visible = JSON.parse(JSON.stringify(view('N'))) as JungleVisibleState;
    jungleSearch(visible, { random, budget: { maxDepth: 5, timeLeftMs: () => 1000, expired: () => false } });
    expect(visible).toEqual(JSON.parse(JSON.stringify(view('N'))));
  });

  it('takes the river jump that wins the race to the den', () => {
    // The lion is five moves from the den across the river; the lone enemy rat is too far to stop it.
    const cells = position([1, 6, '7'], [6, 0, 'a'], [6, 8, '1']);
    expect(search(cells, 0)).toEqual({ from: jgIndex(1, 6), to: jgIndex(1, 2) });
  });

  it('captures a piece standing in its own trap with anything', () => {
    // Blue's elephant stands in red's trap, so even the red cat takes it.
    const cells = position([3, 6, '2'], [3, 7, 'h'], [0, 0, 'b'], [6, 8, '5']);
    expect(search(cells, 0)).toEqual({ from: jgIndex(3, 6), to: jgIndex(3, 7) });
  });

  it('sees the no-capture draw: a race that cannot finish before the limit is worth nothing', () => {
    const cells = position([1, 6, '7'], [6, 0, 'a'], [6, 8, '1']);
    const score = (quiet: number): number => {
      let last = Number.NaN;
      search(cells, 0, { quiet, maxDepth: 12, onDepth: (_depth, value) => { last = value; } });
      return last;
    };
    expect(score(0)).toBeGreaterThan(50_000);
    expect(Math.abs(score(JG_NO_CAPTURE_LIMIT - 3))).toBeLessThan(5_000);
  });

  it('rebuilds the no-capture count and the positions since the last capture from the log', () => {
    start();
    const first = [...game().cells];
    for (let ply = 0; ply < 4; ply++) {
      const seat = game().currentTurnSeat;
      const [pick] = jgLegalMoves(game().cells, seat === 'N' ? 0 : 1).filter((m) => game().cells[m.to] === 0);
      expect(jungle.move(CODE, seat, jgNode(pick.from), jgNode(pick.to))).toEqual({ success: true });
    }
    const { quiet, history } = gameHistory(view('N'));
    expect(quiet).toBe(4);
    expect(history).toHaveLength(4);
    expect([...history[0]]).toEqual(first);
    expect([...history[3]]).not.toEqual(game().cells);
  });

  it('stays close to its time budget with the table and move stacks in use', () => {
    const started = performance.now();
    const limit = started + 100;
    const cells = position([1, 6, '7'], [3, 6, '8'], [5, 6, '3'], [6, 8, '1'], [0, 0, 'g'], [6, 2, 'h'], [2, 2, 'e'], [4, 0, 'c']);
    expect(search(cells, 0, { maxDepth: 40, maxNodes: Infinity, expired: () => performance.now() >= limit })).not.toBeNull();
    expect(performance.now() - started).toBeLessThan(400);
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
      strategy: spec.strategy, visible: JSON.parse(JSON.stringify(view('N'))), budgetMs: 1000, maxDepth: spec.maxDepth, seed: 5,
    });
    expect(outcome.status).toBe('ok');
    expect(Date.now() - started).toBeLessThan(5_000);
    const picked = move(outcome.status === 'ok' ? outcome.action : null)!;
    const [from, to] = picked.split('>').map((node) => jgCell(node)!);
    expect(jgLegalMoves(game().cells, 0)).toContainEqual({ from, to });
  }, 20_000);
});
