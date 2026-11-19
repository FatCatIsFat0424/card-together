import { afterEach, describe, expect, it } from 'vitest';
import type { GameSeat, GomokuGameState, GomokuVisibleState, PlayerInfo } from '@shared/types';
import { GM_CELLS, gmCell, gmForbidden, gmLegalMoves, gmNode, gmStoneCount } from '@shared/rules/gomoku';
import type { GmCell, GomokuOptions } from '@shared/rules/gomoku';
import { getBotAction } from '../../src/bots/bot-decisions';
import type { BotAction } from '../../src/bots/bot-decisions';
import { gameBot } from '../../src/bots/bot-registry';
import { Position, gomokuSearch, searchBestMove } from '../../src/bots/gomoku-search';
import { createSearchPool } from '../../src/bots/search/search-worker-pool';
import type { SearchPool } from '../../src/bots/search/search-worker-pool';
import { seededRandom } from '../../src/bots/search/seeded-random';
import * as gomoku from '../../src/managers/games/gomoku-game';

const CODE = 'GOMBT1';
const player = (seat: GameSeat): PlayerInfo => ({
  id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null, isBot: true,
});

const at = (name: string): number => (15 - Number(name.slice(1))) * 15 + name.charCodeAt(0) - 97;

function start(options?: GomokuOptions): void {
  gomoku.startGame(CODE, { N: player('N'), S: player('S') }, options, 1_000);
}

const game = (): GomokuGameState => gomoku.getGameState(CODE)!;
const view = (seat: GameSeat): GomokuVisibleState => gomoku.getPlayerVisibleState(CODE, seat)!;

/**
 * Sets a position: `x` stones are black, `o` white, in the given coordinates. The log is rebuilt so black
 * and white alternate and `toMove` is next (the counts must allow it).
 */
function setPosition(black: string, white: string): void {
  const blacks = black.split(' ').filter(Boolean);
  const whites = white.split(' ').filter(Boolean);
  const state = game();
  state.stones = new Array<GmCell>(GM_CELLS).fill(null);
  state.log = [];
  for (let step = 0; step < blacks.length + whites.length; step++) {
    const side = step % 2 === 0 ? 0 : 1;
    const name = (side === 0 ? blacks : whites)[Math.floor(step / 2)];
    if (name === undefined) throw new Error('Black needs the same number of stones as white, or one more');
    state.stones[at(name)] = side;
    state.log.push({ seat: side === 0 ? 'N' : 'S', to: gmNode(at(name)), timestamp: 1 });
  }
  state.currentTurnSeat = blacks.length > whites.length ? 'S' : 'N';
}

const target = (action: BotAction | null): number | null => (action?.type === 'game-action'
  && action.request.gameType === 'gomoku' && action.request.action.type === 'place' ? gmCell(action.request.action.to) : null);

const choice = (action: BotAction | null): boolean | null => (action?.type === 'game-action'
  && action.request.gameType === 'gomoku' && action.request.action.type === 'choose-side' ? action.request.action.swap : null);

afterEach(() => gomoku.abortGame(CODE));

describe('Gomoku synchronous bot', () => {
  it('opens in the centre', () => {
    start();
    expect(target(getBotAction(view('N'), () => 0.5))).toBe(at('h8'));
  });

  it('plays only legal points and stays out of turn', () => {
    start();
    setPosition('h8 i9 j10', 'h9 i8');
    const empties = new Set(gmLegalMoves(game().stones, 1, false));
    for (let seed = 1; seed <= 5; seed++) expect(empties.has(target(getBotAction(view('S'), seededRandom(seed)))!)).toBe(true);
    expect(getBotAction(view('N'))).toBeNull();
  });

  it('places the opening stones, then picks a colour by the position', () => {
    start({ renju: false, swap: true });
    const first = target(getBotAction(view('N'), () => 0.5));
    expect(first).toBe(at('h8'));
    setPosition('h8 h9', 'h10');
    game().currentTurnSeat = 'S';
    // Black holds a strong pair and a free move to come: the second seat takes black.
    expect(choice(getBotAction(view('S'), () => 0.5))).toBe(true);
    setPosition('a1 o15', 'h8');
    expect(choice(getBotAction(view('S'), () => 0.5))).toBe(false);
  });
});

describe('Gomoku Hard bot', () => {
  it('wins in one move over blocking, and blocks a four it cannot win against', () => {
    start();
    setPosition('d4 e4 f4 g4 o1', 'e5 f5 g5 h5 a15');
    expect([at('c4'), at('h4')]).toContain(target(getBotAction(view('N'), seededRandom(1))));
    gomoku.abortGame(CODE);
    start();
    setPosition('e5 f5 g5 h5 o1', 'd5 a15 o15 a1');
    expect(target(getBotAction(view('S'), seededRandom(1)))).toBe(at('i5'));
  });

  it('makes an open four from an open three instead of a weaker move', () => {
    start();
    setPosition('f8 g8 h8 a1', 'f12 l3 n10 a15');
    const found = target(getBotAction(view('N'), seededRandom(2)));
    expect([at('e8'), at('i8')]).toContain(found);
  });

  it('never plays a forbidden point as black under Renju, even where it scores best', () => {
    start({ renju: true, swap: false });
    setPosition('f8 g8 h9 h10 o15', 'a1 a3 a5 a7');
    const forbidden = at('h8');
    expect(gmForbidden(game().stones, forbidden)).toBe(true);
    for (let seed = 1; seed <= 6; seed++) {
      expect(target(getBotAction(view('N'), seededRandom(seed)))).not.toBe(forbidden);
    }
    const search = new Position(game().stones);
    const best = searchBestMove(search, 0, true, { maxDepth: 3, expired: () => false, maxNodes: 4000, random: seededRandom(3) });
    expect(best?.index).not.toBe(forbidden);
  });

  it('plays only legal moves for a whole match against itself, with every option on', () => {
    start({ renju: true, swap: true });
    for (let guard = 0; guard < 260 && game().phase === 'playing'; guard++) {
      const seat = game().currentTurnSeat;
      const action = getBotAction(view(seat), seededRandom(guard + 1));
      expect(action).not.toBeNull();
      if (choice(action) !== null) {
        expect(gomoku.chooseSide(CODE, seat, choice(action)!)).toEqual({ success: true });
      } else {
        expect(gomoku.place(CODE, seat, gmNode(target(action)!))).toEqual({ success: true });
      }
    }
    expect(game().phase).toBe('scoring');
    expect(gmStoneCount(game().stones)).toBeLessThanOrEqual(GM_CELLS);
  }, 60_000);

  it('beats a random legal mover over several seeded matches', () => {
    let botWins = 0;
    for (let seed = 1; seed <= 6; seed++) {
      start();
      const botSeat: GameSeat = seed % 2 === 0 ? 'N' : 'S';
      const rolls = seededRandom(seed * 1000);
      for (let guard = 0; guard < 260 && game().phase === 'playing'; guard++) {
        const seat = game().currentTurnSeat;
        if (seat === botSeat) {
          gomoku.place(CODE, seat, gmNode(target(getBotAction(view(seat), seededRandom(seed * 1000 + guard)))!));
        } else {
          const open = gmLegalMoves(game().stones, seat === 'N' ? 0 : 1, false);
          gomoku.place(CODE, seat, gmNode(open[Math.floor(rolls() * open.length)]));
        }
      }
      if (game().result?.winners.includes(botSeat)) botWins++;
      gomoku.abortGame(CODE);
    }
    expect(botWins).toBeGreaterThanOrEqual(5);
  }, 120_000);
});

describe('Gomoku search', () => {
  it('stops within its time budget and still returns a legal move', () => {
    start();
    setPosition('h8 g9 i9 f10 j10 h10', 'g8 i8 h9 h7 g10');
    const started = performance.now();
    const limit = started + 150;
    const best = searchBestMove(new Position(game().stones), 1, false, {
      maxDepth: 30, expired: () => performance.now() >= limit, random: () => 0.3,
    });
    expect(performance.now() - started).toBeLessThan(500);
    expect(gmLegalMoves(game().stones, 1, false)).toContain(best!.index);
  });

  it('respects the node budget of the synchronous move', () => {
    start();
    setPosition('h8 g9 i9 f10 j10 h10', 'g8 i8 h9 h7 g10');
    const started = performance.now();
    const best = searchBestMove(new Position(game().stones), 1, false, {
      maxDepth: 30, expired: () => false, maxNodes: 1500, random: () => 0.3,
    });
    expect(performance.now() - started).toBeLessThan(500);
    expect(gmLegalMoves(game().stones, 1, false)).toContain(best!.index);
  });

  it('respects the depth cap from the search context and ignores seats that are not on turn', () => {
    start();
    const context = { random: () => 0, budget: { maxDepth: 2, timeLeftMs: () => 1000, expired: () => false } };
    expect(target(gomokuSearch(view('N'), context))).toBe(at('h8'));
    expect(gomokuSearch(view('S'), context)).toBeNull();
  });

  it('declares the worker search with a one-second budget and a depth cap', () => {
    expect(gameBot('gomoku').search).toMatchObject({ budgetMs: 1000, maxDepth: expect.any(Number) });
  });

  it('keeps its window counts exact through make and unmake', () => {
    start();
    setPosition('h8 g9 i9', 'g8 i8 h9');
    const position = new Position(game().stones);
    const score = position.score;
    const fours = [...position.fours];
    position.make(at('h10'), 0);
    position.make(at('h7'), 1);
    position.unmake(at('h7'), 1);
    position.unmake(at('h10'), 0);
    expect([position.score, position.fours]).toEqual([score, fours]);
    expect(position.stoneCount).toBe(6);
  });
});

describe('Gomoku fallbacks', () => {
  it('returns nothing off turn or after the end, and the first legal fallback is a legal placement near the centre', () => {
    start();
    expect(getBotAction(view('S'), Math.random)).toBeNull();
    const bot = gameBot('gomoku');
    expect(bot.firstLegal(view('S'))).toBeNull();
    expect(target(bot.firstLegal(view('N')))).toBe(at('h8'));
    gomoku.control(CODE, 'N', { type: 'resign' });
    expect(getBotAction(view('S'), Math.random)).toBeNull();
  });

  it('chooses a colour in the opening, and a timeout follows the decision of the bot', () => {
    start({ renju: false, swap: true });
    setPosition('h8 g9', 'h9');
    game().currentTurnSeat = 'S';
    const bot = gameBot('gomoku');
    expect(bot.firstLegal(view('S'))).toMatchObject({ request: { action: { type: 'choose-side', swap: false } } });
    expect(bot.turnTimeout).toBeUndefined();
    expect(typeof choice(getBotAction(view('S'), seededRandom(4)))).toBe('boolean');
    expect(typeof choice(bot.decide(view('S'), seededRandom(4)))).toBe('boolean');
  });

  it('answers a timeout in the opening with a legal placement', () => {
    start();
    expect(target(getBotAction(view('N'), seededRandom(6)))).toBe(at('h8'));
  });
});

describe('Gomoku search in the bot worker pool', () => {
  const pools: SearchPool[] = [];
  afterEach(async () => {
    await Promise.all(pools.splice(0).map((pool) => pool.close()));
  });

  it('answers with a legal move inside its budget', async () => {
    start();
    setPosition('h8 g9 i9', 'g8 i8 h9');
    game().currentTurnSeat = 'N';
    const pool = createSearchPool({ workers: 1, memoryMb: 256, queueLimit: 2 });
    pools.push(pool);
    const spec = gameBot('gomoku').search!;
    const started = Date.now();
    const outcome = await pool.run({
      strategy: spec.strategy, visible: JSON.parse(JSON.stringify(view('N'))), budgetMs: 400, maxDepth: spec.maxDepth, seed: 5,
    });
    expect(outcome.status).toBe('ok');
    expect(Date.now() - started).toBeLessThan(5_000);
    const action = outcome.status === 'ok' ? outcome.action : null;
    expect(gmLegalMoves(game().stones, 0, false)).toContain(target(action)!);
  }, 20_000);
});
