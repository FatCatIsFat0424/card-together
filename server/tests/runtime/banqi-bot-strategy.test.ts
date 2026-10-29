import { afterEach, describe, expect, it } from 'vitest';
import type { GameSeat, PlayerInfo } from '@shared/types';
import type { BanqiGameState, BanqiVisibleState } from '@shared/games/banqi/types';
import { DEFAULT_BANQI_OPTIONS, banqiRules } from '@shared/banqi-options';
import { BQ_DOWN, bqFlips, bqMoves, bqNode } from '@shared/rules/banqi';
import { getBotAction } from '../../src/bots/bot-decisions';
import type { BotAction } from '../../src/bots/bot-decisions';
import { gameBot } from '../../src/bots/bot-registry';
import { banqiSearch, searchBanqi } from '../../src/bots/banqi-search';
import { createSearchPool } from '../../src/bots/search/search-worker-pool';
import type { SearchPool } from '../../src/bots/search/search-worker-pool';
import { seededRandom } from '../../src/bots/search/seeded-random';
import * as banqi from '../../src/managers/games/banqi-game';
import { setPosition } from '../fixtures/banqi-position';

const CODE = 'BANQB1';
const player = (seat: GameSeat): PlayerInfo => ({
  id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null, isBot: true,
});

function start(options = DEFAULT_BANQI_OPTIONS, seed = 1): void {
  banqi.startGame(CODE, { N: player('N'), S: player('S') }, options, seededRandom(seed), 1_000);
}

const game = (): BanqiGameState => banqi.getGameState(CODE)!;
const view = (seat: GameSeat): BanqiVisibleState => banqi.getPlayerVisibleState(CODE, seat)!;

type Decoded = { type: 'flip'; to: string } | { type: 'move'; from: string; to: string } | { type: 'stop' } | null;
const decode = (action: BotAction | null): Decoded => {
  if (action?.type !== 'game-action' || action.request.gameType !== 'banqi') return null;
  const chosen = action.request.action;
  return chosen.type === 'flip' || chosen.type === 'move' || chosen.type === 'stop' ? chosen : null;
};

function apply(seat: GameSeat, action: Decoded): { success: boolean } {
  if (!action) return { success: false };
  if (action.type === 'flip') return banqi.flip(CODE, seat, action.to);
  if (action.type === 'move') return banqi.move(CODE, seat, action.from, action.to);
  return banqi.stop(CODE, seat);
}

/** Every action the seat could take in the current position, as the server would accept it. */
function legal(seat: GameSeat): string[] {
  const state = game();
  const index = banqi.banqiSeats(state).indexOf(seat);
  const rules = banqiRules(state.options);
  const list = bqFlips(state.board).map((cell) => `flip ${bqNode(cell)}`);
  if (state.colours !== null) {
    const from = state.chain;
    const moves = bqMoves(state.board, state.colours[index], rules)
      .filter((move) => from === null || (bqNode(move.from) === from && (move.capture || move.blind)));
    list.push(...moves.map((move) => `move ${bqNode(move.from)} ${bqNode(move.to)}`));
  }
  if (state.chain !== null) return [...list.filter((entry) => entry.startsWith('move')), 'stop'];
  return list;
}
const key = (action: Decoded): string => (!action ? 'none' : action.type === 'flip' ? `flip ${action.to}`
  : action.type === 'move' ? `move ${action.from} ${action.to}` : 'stop');

afterEach(() => banqi.abortGame(CODE));

describe('Banqi Easy bot', () => {
  it('flips a random covered piece before the colours are known, and stays out of turn', () => {
    start();
    const picks = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const action = decode(gameBot('banqi').easy(view('N'), seededRandom(seed)));
      expect(action?.type).toBe('flip');
      picks.add(key(action));
    }
    expect(picks.size).toBeGreaterThan(5);
    expect(gameBot('banqi').easy(view('S'), Math.random)).toBeNull();
  });

  it('takes a safe capture over a flip or a step', () => {
    start();
    setPosition(game(), ['Rh.....#', '........', '........', '#......k']);
    for (let seed = 1; seed <= 10; seed++) {
      expect(decode(gameBot('banqi').easy(view('N'), seededRandom(seed)))).toEqual({ type: 'move', from: '0,0', to: '1,0' });
    }
  });

  it('prefers the most valuable safe capture', () => {
    start();
    setPosition(game(), ['pR.....#', '.h......', '........', '#......k']);
    // The chariot can take the soldier on its left or the horse below; the horse is worth more.
    expect(decode(gameBot('banqi').easy(view('N'), () => 0))).toEqual({ type: 'move', from: '1,0', to: '1,1' });
  });

  it('skips a capture that loses the capturer when it has another option, and takes it when it has none', () => {
    start();
    // Capturing the soldier at 1,0 lands the horse next to a black chariot that takes it back.
    setPosition(game(), ['Hpr.....', '........', '........', '........']);
    const picks = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) picks.add(key(decode(gameBot('banqi').easy(view('N'), seededRandom(seed)))));
    expect(picks.has('move 0,0 1,0')).toBe(false);
    setPosition(game(), ['Hpr.....', 'k.......', '........', '........']);
    expect(decode(gameBot('banqi').easy(view('N'), () => 0))).toEqual({ type: 'move', from: '0,0', to: '1,0' });
  });

  it('continues a chain with a safe capture and otherwise stops', () => {
    start({ chain: true, rookDash: false });
    setPosition(game(), ['Rpp....#', '........', '........', '#......k']);
    banqi.move(CODE, 'N', '0,0', '1,0');
    expect(decode(gameBot('banqi').easy(view('N'), () => 0))).toEqual({ type: 'move', from: '1,0', to: '2,0' });
    banqi.abortGame(CODE);
    start({ chain: true, rookDash: false });
    // The second capture lands next to a black chariot that takes it back, so the bot ends its turn instead.
    setPosition(game(), ['Rppr....', '........', '........', '#......k']);
    banqi.move(CODE, 'N', '0,0', '1,0');
    expect(game().chain).toBe('1,0');
    expect(decode(gameBot('banqi').easy(view('N'), () => 0))).toEqual({ type: 'stop' });
  });

  it('plays only legal actions through a whole match', () => {
    for (const options of [DEFAULT_BANQI_OPTIONS, { chain: true, rookDash: true }]) {
      start(options, 4);
      for (let guard = 0; guard < 6000 && game().phase === 'playing'; guard++) {
        const seat = game().currentTurnSeat;
        const action = decode(getBotAction(view(seat), seededRandom(guard + 1), 'easy'));
        expect(legal(seat)).toContain(key(action));
        expect(apply(seat, action)).toEqual({ success: true });
      }
      expect(game().phase).toBe('scoring');
      banqi.abortGame(CODE);
    }
  });
});

describe('Banqi Hard bot', () => {
  it('captures the general with a soldier rather than wandering', () => {
    start();
    setPosition(game(), ['.Pk.....', '........', '........', '.......r']);
    expect(decode(searchBanqi(view('N'), { maxDepth: 3, expired: () => false, random: () => 0 })))
      .toEqual({ type: 'move', from: '1,0', to: '2,0' });
  });

  it('weighs a blind attack over the unseen pieces and prefers it to flipping the same cell', () => {
    // Every other piece is face down, so the unseen pool is exactly what the 30 covered cells hide.
    const rows = ['R#######', '########', '########', '#######k'];
    start();
    setPosition(game(), rows);
    const blind = decode(searchBanqi(view('N'), { maxDepth: 2, expired: () => false, random: () => 0 }));
    expect(blind).toMatchObject({ type: 'move', from: '0,0' });
    // Matches without blind attacks never offer one: the boxed-in chariot can only flip.
    start({ chain: false, rookDash: false });
    setPosition(game(), rows);
    expect(decode(searchBanqi(view('N'), { maxDepth: 2, expired: () => false, random: () => 0 }))?.type).toBe('flip');
  });

  it('avoids a capture that is answered by a heavier recapture', () => {
    start();
    // Taking the soldier with the horse puts it where the chariot takes it; stepping away or flipping is better.
    setPosition(game(), ['Hpr.....', '........', '........', '#......k']);
    const action = decode(searchBanqi(view('N'), { maxDepth: 3, expired: () => false, random: () => 0 }));
    expect(key(action)).not.toBe('move 0,0 1,0');
  });

  it('does not use anything but the public board: a spectator-augmented view gives the same decision', () => {
    start(DEFAULT_BANQI_OPTIONS, 5);
    banqi.flip(CODE, 'N', '0,0');
    banqi.flip(CODE, 'S', '1,1');
    const plain = view('N');
    const augmented = { ...plain, observer: 'spectator' as const, observedPieces: { '5,3': 0, '6,3': 7 } };
    const run = (v: BanqiVisibleState): Decoded => decode(searchBanqi(v, { maxDepth: 3, expired: () => false, random: seededRandom(3) }));
    expect(run(augmented)).toEqual(run(plain));
    // Two games that differ only in what lies under the face-down pieces look the same to the bot.
    const first = JSON.stringify(plain);
    banqi.abortGame(CODE);
    start(DEFAULT_BANQI_OPTIONS, 6);
    banqi.flip(CODE, 'N', '0,0');
    expect(JSON.stringify(view('N')).includes('"hidden"')).toBe(false);
    expect(first.includes('"hidden"')).toBe(false);
  }, 20_000);

  it('flips at random while the colours are unknown and returns nothing off turn or after the end', () => {
    start();
    expect(decode(searchBanqi(view('N'), { maxDepth: 3, expired: () => false, random: () => 0.5 }))?.type).toBe('flip');
    expect(searchBanqi(view('S'), { maxDepth: 3, expired: () => false, random: () => 0 })).toBeNull();
    banqi.control(CODE, 'N', { type: 'resign' });
    expect(searchBanqi(view('S'), { maxDepth: 3, expired: () => false, random: () => 0 })).toBeNull();
  });

  it('plays only legal actions on both difficulties, including with the room variants', () => {
    for (const options of [DEFAULT_BANQI_OPTIONS, { chain: true, rookDash: true }]) {
      start(options, 8);
      for (let guard = 0; guard < 6000 && game().phase === 'playing'; guard++) {
        const seat = game().currentTurnSeat;
        const action = decode(getBotAction(view(seat), seededRandom(guard + 7), seat === 'N' ? 'hard' : 'easy'));
        expect(legal(seat)).toContain(key(action));
        expect(apply(seat, action)).toEqual({ success: true });
      }
      expect(game().phase).toBe('scoring');
      banqi.abortGame(CODE);
    }
  }, 60_000);

  it('beats the Easy bot over several seeded matches', () => {
    let hard = 0;
    let easy = 0;
    for (let seed = 1; seed <= 8; seed++) {
      start(DEFAULT_BANQI_OPTIONS, seed);
      const hardSeat: GameSeat = seed % 2 === 0 ? 'N' : 'S';
      for (let guard = 0; guard < 6000 && game().phase === 'playing'; guard++) {
        const seat = game().currentTurnSeat;
        apply(seat, decode(getBotAction(view(seat), seededRandom(seed * 10_000 + guard), seat === hardSeat ? 'hard' : 'easy')));
      }
      if (game().result?.winners.includes(hardSeat)) hard++;
      else if (game().result?.winners.length === 1) easy++;
      banqi.abortGame(CODE);
    }
    expect(hard).toBeGreaterThan(easy);
  }, 120_000);

  it('serves a timed-out player with a legal Easy-policy action', () => {
    start();
    const timeout = gameBot('banqi').turnTimeout!;
    const action = decode(timeout(view('N'), { isBot: false, strategy: () => null }));
    expect(legal('N')).toContain(key(action));
    expect(gameBot('banqi').firstLegal(view('S'))).toBeNull();
    expect(legal('N')).toContain(key(decode(gameBot('banqi').firstLegal(view('N')))));
  });

  it('breaks no rule when the first legal fallback is used for a whole match', () => {
    start({ chain: true, rookDash: true }, 2);
    for (let guard = 0; guard < 6000 && game().phase === 'playing'; guard++) {
      const seat = game().currentTurnSeat;
      const action = decode(gameBot('banqi').firstLegal(view(seat)));
      expect(legal(seat)).toContain(key(action));
      expect(apply(seat, action)).toEqual({ success: true });
    }
  });
});

describe('Banqi search budget', () => {
  function midGame(): void {
    start(DEFAULT_BANQI_OPTIONS, 3);
    for (let step = 0; step < 14; step++) {
      const seat = game().currentTurnSeat;
      apply(seat, decode(getBotAction(view(seat), seededRandom(step + 1), 'easy')));
    }
  }

  it('stops within its time budget and still returns a legal action', () => {
    midGame();
    const seat = game().currentTurnSeat;
    const started = performance.now();
    const limit = started + 150;
    const action = decode(searchBanqi(view(seat), { maxDepth: 30, expired: () => performance.now() >= limit, random: () => 0.3 }));
    expect(performance.now() - started).toBeLessThan(600);
    expect(legal(seat)).toContain(key(action));
  });

  it('respects the depth cap from the search context', () => {
    midGame();
    const seat = game().currentTurnSeat;
    const context = { random: () => 0, budget: { maxDepth: 2, timeLeftMs: () => 1000, expired: () => false } };
    expect(legal(seat)).toContain(key(decode(banqiSearch(view(seat), context))));
    expect(banqiSearch(view(seat === 'N' ? 'S' : 'N'), context)).toBeNull();
  });

  it('keeps the synchronous hard decision cheap', () => {
    midGame();
    const seat = game().currentTurnSeat;
    const started = performance.now();
    gameBot('banqi').hard(view(seat), () => 0.4);
    expect(performance.now() - started).toBeLessThan(250);
  });

  it('declares the worker search with a one-second budget and a depth cap', () => {
    expect(gameBot('banqi').search).toMatchObject({ budgetMs: 1000, maxDepth: expect.any(Number) });
  });
});

describe('Banqi search in the bot worker pool', () => {
  const pools: SearchPool[] = [];
  afterEach(async () => {
    await Promise.all(pools.splice(0).map((pool) => pool.close()));
  });

  it('answers with a legal action inside its budget', async () => {
    start(DEFAULT_BANQI_OPTIONS, 3);
    for (let step = 0; step < 10; step++) {
      const seat = game().currentTurnSeat;
      apply(seat, decode(getBotAction(view(seat), seededRandom(step + 1), 'easy')));
    }
    const seat = game().currentTurnSeat;
    const pool = createSearchPool({ workers: 1, memoryMb: 256, queueLimit: 2 });
    pools.push(pool);
    const spec = gameBot('banqi').search!;
    const started = Date.now();
    const outcome = await pool.run({
      strategy: spec.strategy, visible: JSON.parse(JSON.stringify(view(seat))), budgetMs: 400, maxDepth: spec.maxDepth, seed: 5,
    });
    expect(outcome.status).toBe('ok');
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(legal(seat)).toContain(key(decode(outcome.status === 'ok' ? outcome.action : null)));
  }, 20_000);

  it('never sees what lies under face-down pieces: the request carries only the seat view', () => {
    start();
    const request = JSON.stringify(view('N'));
    expect(request).not.toContain('observedPieces');
    expect(JSON.parse(request).board.every((slot: number) => slot === BQ_DOWN)).toBe(true);
  });
});
