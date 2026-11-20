import { afterEach, describe, expect, it } from 'vitest';
import type { GameSeat, PlayerInfo } from '@shared/types';
import type { BanqiGameState, BanqiVisibleState } from '@shared/games/banqi/types';
import { banqiMatchOptions, banqiRules } from '@shared/banqi-options';
import { BQ_CELLS, BQ_DOWN, BQ_EMPTY, bqMoves, bqMovesFrom, bqTally, bqFullSet } from '@shared/rules/banqi';
import type { BqRules } from '@shared/rules/banqi';
import type { BotAction } from '../../src/bots/bot-decisions';
import { BASE_VALUES, evaluate, pieceValues } from '../../src/bots/banqi-eval';
import { createPosition, generateAll, generateFrom, moveFrom, moveKind, moveTo } from '../../src/bots/banqi-position';
import { banqiState, searchBanqi } from '../../src/bots/banqi-search';
import type { BanqiSearchOptions } from '../../src/bots/banqi-search';
import { seededRandom } from '../../src/bots/search/seeded-random';
import * as banqi from '../../src/managers/games/banqi-game';
import { setPosition } from '../fixtures/banqi-position';

const CODE = 'BANQE1';
const player = (seat: GameSeat): PlayerInfo => ({
  id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null, isBot: true,
});

function start(options: { chain: boolean; rookDash: boolean }, rows: readonly string[], seed = 1): void {
  banqi.startGame(CODE, { N: player('N'), S: player('S') }, options, seededRandom(seed), 1_000);
  setPosition(game(), rows);
}

/**
 * Puts every piece that is neither on the board nor in `unseen` into the public log as captured, so the bot's
 * unseen pool is exactly `unseen` and agrees with the covered cells.
 */
function settle(unseen: readonly number[] = []): void {
  const state = game();
  const missing = bqFullSet();
  for (const slot of [...state.board, ...unseen]) {
    const at = missing.indexOf(slot);
    if (slot >= 0 && at >= 0) missing.splice(at, 1);
  }
  state.log = missing.map((piece) => ({ seat: 'N' as GameSeat, to: '0,0', captured: piece, timestamp: 1 }));
}

const game = (): BanqiGameState => banqi.getGameState(CODE)!;
const view = (seat: GameSeat = 'N'): BanqiVisibleState => banqi.getPlayerVisibleState(CODE, seat)!;

type Decoded = { type: 'flip'; to: string } | { type: 'move'; from: string; to: string } | { type: 'stop' } | null;
const decode = (action: BotAction | null): Decoded => {
  if (action?.type !== 'game-action' || action.request.gameType !== 'banqi') return null;
  const chosen = action.request.action;
  return chosen.type === 'flip' || chosen.type === 'move' || chosen.type === 'stop' ? chosen : null;
};
const decide = (visible: BanqiVisibleState, depth = 4, extra: Partial<BanqiSearchOptions> = {}): Decoded =>
  decode(searchBanqi(visible, { maxDepth: depth, expired: () => false, random: () => 0, ...extra }));

afterEach(() => banqi.abortGame(CODE));

const RULE_SETS: readonly BqRules[] = [
  { chain: false, rookDash: false, blindCapture: false },
  { chain: true, rookDash: false, blindCapture: true },
  { chain: true, rookDash: true, blindCapture: true },
  { chain: false, rookDash: true, blindCapture: false },
  { chain: true, rookDash: true, blindCapture: false },
];

describe('Banqi search move generation', () => {
  it('lists exactly the moves of the shared rules in random positions, for every rule set', () => {
    const random = seededRandom(11);
    for (const rules of RULE_SETS) {
      for (let round = 0; round < 400; round++) {
        const board = Array.from({ length: BQ_CELLS }, () => {
          const roll = random();
          return roll < 0.3 ? BQ_EMPTY : roll < 0.45 ? BQ_DOWN : Math.floor(random() * 14);
        });
        const position = createPosition(board, new Array<number>(14).fill(0), 0, rules);
        const buffer = new Int32Array(512);
        for (const colour of [0, 1] as const) {
          for (const capturesOnly of [false, true]) {
            const ours = new Set<string>();
            const count = generateAll(position, colour, capturesOnly, buffer, 0);
            for (let index = 0; index < count; index++) {
              ours.add(`${moveFrom(buffer[index])}-${moveTo(buffer[index])}-${moveKind(buffer[index])}`);
            }
            const theirs = new Set<string>();
            for (let from = 0; from < BQ_CELLS; from++) {
              if (board[from] < 0 || Math.floor(board[from] / 7) !== colour) continue;
              for (const move of bqMovesFrom(board, from, rules, capturesOnly)) {
                theirs.add(`${move.from}-${move.to}-${move.blind ? 2 : move.capture ? 1 : 0}`);
              }
            }
            expect([...ours].sort()).toEqual([...theirs].sort());
            expect(count).toBe(ours.size);
          }
        }
        const total = bqMoves(board, 0, rules).length;
        expect(generateAll(position, 0, false, buffer, 0)).toBe(total);
        const first = board.findIndex((slot) => slot >= 0 && slot < 7);
        if (first >= 0) expect(generateFrom(position, first, false, buffer, 0)).toBe(bqMovesFrom(board, first, rules).length);
      }
    }
  });

  it('keeps the position and its hash consistent after a search that was cut off', () => {
    const rows = ['R#h.....', '#P.#..c.', '..H.#.p.', 'k......#'];
    start({ chain: true, rookDash: false }, rows);
    const state = banqiState(view())!;
    const before = [...state.position.board];
    // The search works on a copy built from the view, so the view stays as it was.
    let calls = 0;
    decide(view(), 6, { expired: () => ++calls > 3 });
    expect([...banqiState(view())!.position.board]).toEqual(before);
    expect(bqTally(bqFullSet()).reduce((a, b) => a + b, 0)).toBe(32);
  });
});

describe('Banqi search pruning', () => {
  const LETTERS = 'KAERHCPkaerhcp';

  /** A random small middlegame: a few face-up pieces, a few covered cells, and the log that makes the pool consistent. */
  function randomRows(random: () => number): { rows: string[]; unseen: number[] } {
    const pieces = bqFullSet();
    for (let i = pieces.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [pieces[i], pieces[j]] = [pieces[j], pieces[i]];
    }
    const cells = Array.from({ length: BQ_CELLS }, (_, cell) => cell);
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    const up = 5 + Math.floor(random() * 4);
    const covered = 2 + Math.floor(random() * 3);
    const board = new Array<string>(BQ_CELLS).fill('.');
    for (let index = 0; index < up; index++) board[cells[index]] = LETTERS[pieces[index]];
    const unseen: number[] = [];
    for (let index = up; index < up + covered; index++) {
      board[cells[index]] = '#';
      unseen.push(pieces[index]);
    }
    return { rows: [0, 1, 2, 3].map((row) => board.slice(row * 8, row * 8 + 8).join('')), unseen };
  }

  it('gives the pruned search the value of the exhaustive expectimax, with and without chain captures', () => {
    const random = seededRandom(21);
    for (const options of [{ chain: true, rookDash: false }, { chain: true, rookDash: true }, { chain: false, rookDash: false }]) {
      for (let round = 0; round < 14; round++) {
        const { rows, unseen } = randomRows(random);
        start(options, rows);
        settle(unseen);
        const top = (exhaustive: boolean): number => {
          let best = Number.NaN;
          searchBanqi(view(), {
            maxDepth: 3, expired: () => false, random: () => 0, exhaustive, noTable: true,
            onIteration: (depth, scores) => {
              if (depth === 3) best = Math.max(...scores.map((entry) => entry.score));
            },
          });
          return best;
        };
        const pruned = top(false);
        const reference = top(true);
        expect(Number.isNaN(reference)).toBe(false);
        expect(pruned).toBeCloseTo(reference, 5);
        banqi.abortGame(CODE);
      }
    }
  }, 120_000);
});

describe('Banqi search capture chains', () => {
  it('captures again inside a chain when the next capture is free', () => {
    // After the chariot takes the horse it stands next to a soldier it takes too, and nothing can answer.
    start({ chain: true, rookDash: false }, ['RhP.....', '.p......', '........', '.......K']);
    settle();
    expect(decide(view())).toEqual({ type: 'move', from: '0,0', to: '1,0' });
    banqi.move(CODE, 'N', '0,0', '1,0');
    expect(game().chain).toBe('1,0');
    expect(decide(view())).toEqual({ type: 'move', from: '1,0', to: '1,1' });
  });

  it('stops a chain whose next capture walks into a heavier recapture', () => {
    // The horse has taken one soldier; the next soldier lies beside a chariot that would take the horse.
    start({ chain: true, rookDash: false }, ['Hppr....', '........', '........', '.......A']);
    settle();
    banqi.move(CODE, 'N', '0,0', '1,0');
    expect(game().chain).toBe('1,0');
    expect(decide(view())).toEqual({ type: 'stop' });
  });

  it('prices the opponent chain: a move that lets a chariot take both soldiers is declined', () => {
    // Stepping either soldier next to the chariot loses both in one turn, which ends the match.
    const rows = ['P.r.....', '.P......', '........', '.......k'];
    for (const options of [{ chain: true, rookDash: false }, { chain: false, rookDash: false }]) {
      start(options, rows);
      settle();
      const decision = decide(view());
      const exposed = [{ type: 'move', from: '0,0', to: '1,0' }, { type: 'move', from: '1,1', to: '1,0' }];
      if (options.chain) expect(exposed).not.toContainEqual(decision);
      banqi.abortGame(CODE);
    }
  });

  it('follows the dashing chariot: it captures along a line at a distance', () => {
    start({ chain: true, rookDash: true }, ['R...h...', '......p.', '........', '.......k']);
    settle();
    expect(decide(view())).toEqual({ type: 'move', from: '0,0', to: '4,0' });
    expect(banqi.move(CODE, 'N', '0,0', '4,0').success).toBe(true);
  });

  it('offers only what the rules allow in a chain: further captures by the same piece, or a stop', () => {
    start({ chain: true, rookDash: false }, ['RhP.....', '.pp.....', '........', 'K......k']);
    settle();
    banqi.move(CODE, 'N', '0,0', '1,0');
    expect(game().chain).toBe('1,0');
    const decision = decide(view());
    const legalChain = decision !== null && (decision.type === 'stop' || (decision.type === 'move' && decision.from === '1,0'));
    expect(legalChain).toBe(true);
    if (decision !== null) expect(banqi.move(CODE, 'N', 'from' in decision ? decision.from : '1,0', 'to' in decision ? decision.to : '1,0').success
      || decision.type === 'stop').toBe(true);
  });
});

describe('Banqi search and hidden information', () => {
  it('never reads what lies under face-down cells or the spectator extras of a view', () => {
    start({ chain: true, rookDash: false }, ['R#h.....', '#P.#..c.', '..H.#.p.', 'k......#']);
    const plain = view();
    const trapped = new Proxy({ ...plain, observer: 'spectator', observedPieces: { '1,0': 3 } }, {
      get(target, key, receiver) {
        if (key === 'observedPieces' || key === 'hidden' || key === 'observer') throw new Error(`read ${String(key)}`);
        return Reflect.get(target, key, receiver) as unknown;
      },
    }) as unknown as BanqiVisibleState;
    expect(decide(trapped, 3, { random: seededRandom(2) })).toEqual(decide(plain, 3, { random: seededRandom(2) }));
  });

  it('decides alike when only the hidden identities differ', () => {
    const rows = ['R#h.....', '#P.#..c.', '..H.#.p.', 'k......#'];
    start({ chain: true, rookDash: false }, rows);
    const first = decide(view(), 3, { random: seededRandom(4) });
    const hidden = [...game().hidden].reverse();
    game().hidden = hidden;
    expect(decide(view(), 3, { random: seededRandom(4) })).toEqual(first);
  });

  it('leaves the view it was given untouched', () => {
    start({ chain: true, rookDash: true }, ['R#h.....', '#P.#..c.', '..H.#.p.', 'k......#']);
    const frozen = structuredClone(view());
    Object.freeze(frozen.board);
    Object.freeze(frozen.log);
    Object.freeze(frozen);
    expect(() => decide(frozen, 3)).not.toThrow();
    expect(frozen).toEqual(view());
  });
});

describe('Banqi search and the no-capture counter', () => {
  it('avoids the quiet move that ends the match in a draw while ahead', () => {
    // Red holds a chariot and a general against a horse; the covered cell hides a black soldier.
    start({ chain: true, rookDash: false }, ['R.h.....', '........', '........', '#......K']);
    settle([13]);
    game().quietMoves = 49;
    // Every move but the flip would be the fiftieth quiet one.
    expect(decide(view(), 3)).toEqual({ type: 'flip', to: '0,3' });
    game().quietMoves = 0;
    expect(decide(view(), 3)?.type).not.toBeNull();
  });

  it('takes the draw while behind', () => {
    // Red's lone horse faces a black general and chariot; the covered cell hides another black chariot.
    start({ chain: true, rookDash: false }, ['k.r.....', '........', '........', '#......H']);
    settle([10]);
    game().quietMoves = 49;
    expect(decide(view(), 3)?.type).toBe('move');
  });
});

describe('Banqi evaluation', () => {
  const remaining = (alive: Record<number, number>): number[] => {
    const counts = new Array<number>(14).fill(0);
    for (const [piece, count] of Object.entries(alive)) counts[Number(piece)] = count;
    return counts;
  };
  const values = (counts: number[]): Float64Array => {
    const out = new Float64Array(14);
    pieceValues(counts, counts.reduce((a, b) => a + b, 0), out);
    return out;
  };
  const start32 = bqTally(bqFullSet());

  it('starts from the base values, with the soldier and cannon scaled by the board', () => {
    const out = values(start32);
    for (const rank of [0, 1, 2, 3, 4]) expect(out[rank]).toBeCloseTo(BASE_VALUES[rank], 5);
    expect(out[5]).toBeGreaterThan(BASE_VALUES[5]);
    expect(out[6]).toBeGreaterThan(BASE_VALUES[6]);
  });

  it('values a general more once the enemy soldiers are gone, and a soldier less once the enemy general is', () => {
    const noSoldiers = [...start32];
    noSoldiers[13] = 0;
    expect(values(noSoldiers)[0]).toBeGreaterThan(values(start32)[0] * 1.2);
    const noGeneral = [...start32];
    noGeneral[7] = 0;
    expect(values(noGeneral)[6]).toBeLessThan(values(start32)[6]);
  });

  it('lifts the top remaining rank when the stronger enemy ranks are gone', () => {
    const counts = remaining({ 0: 0, 1: 1, 2: 2, 3: 2, 4: 2, 5: 2, 6: 5, 7: 0, 8: 0, 9: 0, 10: 2, 11: 2, 12: 2, 13: 5 });
    const out = values(counts);
    // Red's advisor cannot be taken by any black piece except a soldier-class threat: the enemy advisors and generals are gone.
    expect(out[1]).toBeGreaterThan(BASE_VALUES[1] * 1.3);
  });

  it('weakens the cannon as the board empties and prefers the side with more material', () => {
    const full = values(start32)[5];
    const sparse = remaining({ 5: 1, 12: 1 });
    expect(values(sparse)[5]).toBeLessThan(full);
    const board = new Array<number>(BQ_CELLS).fill(BQ_EMPTY);
    board[0] = 3;
    board[1] = 2;
    board[31] = 10;
    const rules = banqiRules(banqiMatchOptions({ chain: true, rookDash: false }));
    const position = createPosition(board, new Array<number>(14).fill(0), 0, rules);
    expect(evaluate(position, 0)).toBeGreaterThan(0);
    expect(evaluate(position, 1)).toBeLessThan(0);
  });
});
