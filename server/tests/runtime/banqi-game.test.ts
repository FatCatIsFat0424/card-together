import { afterEach, describe, expect, it } from 'vitest';
import type { GameSeat, PlayerInfo } from '@shared/types';
import type { BanqiGameState, BanqiMatchOptions } from '@shared/games/banqi/types';
import { DEFAULT_BANQI_OPTIONS, LEGACY_BANQI_OPTIONS } from '@shared/banqi-options';
import { gameDefinition } from '@shared/games/registry';
import { parseGameAction } from '@shared/games/actions';
import { matchStanding } from '@shared/rules/match-standing';
import { DRAW_REOFFER_MOVES } from '@shared/rules/board/match-controls';
import { BQ_CELLS, BQ_DOWN, BQ_EMPTY, BQ_QUIET_LIMIT, bqColour, bqFlips, bqFullSet, bqNode, bqPiece, bqTally } from '@shared/rules/banqi';
import { banqiAdapter } from '../../src/managers/games/banqi-adapter';
import * as banqi from '../../src/managers/games/banqi-game';
import { banqiGame, coherentBanqiGame, isBanqiResult } from '../../src/managers/games/banqi-validation';
import { gameValidator } from '../../src/managers/games/validation-registry';
import { seededRandom } from '../../src/bots/search/seeded-random';
import { easyBanqiAction } from '../../src/bots/banqi-strategy';
import { recordReplayStep } from '../../src/runtime/replay-recording';
import * as manager from '../../src/managers/game-manager';
import { setPosition } from '../fixtures/banqi-position';

const CODE = 'BANQI1';

/** The parts of a stored game the tampering test edits. */
interface StoredBanqi {
  board: number[];
  hidden: number[];
  colours: [number, number];
  log: { revealed: number }[];
  quietMoves: number;
}

function player(seat: GameSeat): PlayerInfo {
  return { id: seat.toLowerCase(), username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null };
}

function start(options = DEFAULT_BANQI_OPTIONS, seed = 7, seats: readonly GameSeat[] = ['N', 'S']): void {
  banqi.startGame(CODE, Object.fromEntries(seats.map((seat) => [seat, player(seat)])), options, seededRandom(seed), 1_000);
}

function game(): BanqiGameState {
  const state = banqi.getGameState(CODE);
  if (!state) throw new Error('Expected a Banqi game');
  return state;
}

const coherent = (): boolean => coherentBanqiGame(structuredClone(game()));
const cell = (col: number, row: number): string => `${col},${row}`;

/** Plays random legal actions from a seeded generator until the match ends or `limit` actions were made. */
function playOut(seed: number, limit = Infinity): void {
  const random = seededRandom(seed);
  for (let step = 0; step < limit && game().phase === 'playing'; step++) {
    const seat = game().currentTurnSeat;
    // The Easy bot only ever picks legal actions from the seat's own view.
    const action = easyAction(banqi.getPlayerVisibleState(CODE, seat)!, random);
    const result = action.type === 'flip' ? banqi.flip(CODE, seat, action.to)
      : action.type === 'move' ? banqi.move(CODE, seat, action.from, action.to) : banqi.stop(CODE, seat);
    expect(result).toEqual({ success: true });
  }
}

function easyAction(view: NonNullable<ReturnType<typeof banqi.getPlayerVisibleState>>, random: () => number):
{ type: 'flip'; to: string } | { type: 'move'; from: string; to: string } | { type: 'stop' } {
  const action = easyBanqiAction(view, random);
  if (action?.type !== 'game-action' || action.request.gameType !== 'banqi') throw new Error('Expected a Banqi action');
  const chosen = action.request.action;
  if (chosen.type !== 'flip' && chosen.type !== 'move' && chosen.type !== 'stop') throw new Error('Unexpected action');
  return chosen;
}

afterEach(() => banqi.abortGame(CODE));

describe('Banqi setup and shuffle', () => {
  it('registers a two-player flexible board game with resign, draw offers, and the two room rules', () => {
    expect(gameDefinition('banqi')).toMatchObject({
      category: 'board', equipment: [], seats: { minPlayers: 2, maxPlayers: 2, flexible: true },
      matchControls: { resign: true, draw: true }, timeControl: { baseSeconds: 60, bankSeconds: 300 },
      options: { defaults: { chain: true, rookDash: false }, legacyDefaults: { chain: false, rookDash: false } },
    });
    const rules = gameDefinition('banqi').options!;
    expect(rules.isValid({ chain: true, rookDash: false })).toBe(true);
    // Blind attacks are part of 連吃, so a room never stores them on their own.
    expect(rules.isValid({ chain: true, rookDash: false, blindCapture: true })).toBe(false);
    expect(rules.isValid({ chain: true })).toBe(false);
    expect(rules.isValid({ chain: 1, rookDash: false })).toBe(false);
  });

  it('deals all 32 pieces face down with the first occupied seat to move and no colours yet', () => {
    start(DEFAULT_BANQI_OPTIONS, 7, ['E', 'W']);
    expect(game()).toMatchObject({ phase: 'playing', currentTurnSeat: 'E', colours: null, chain: null, quietMoves: 0, result: null, log: [] });
    expect(game().board).toEqual(new Array(BQ_CELLS).fill(BQ_DOWN));
    expect(bqTally(game().hidden)).toEqual(bqTally(bqFullSet()));
    expect(banqi.getPlayerVisibleState(CODE, 'W')).toMatchObject({ seats: ['E', 'W'], mySeat: 'W', currentTurnSeat: 'E', colours: null });
    expect(coherent()).toBe(true);
  });

  it('shuffles with the injected generator: equal seeds give equal layouts, different seeds differ', () => {
    start(DEFAULT_BANQI_OPTIONS, 11);
    const first = [...game().hidden];
    banqi.abortGame(CODE);
    start(DEFAULT_BANQI_OPTIONS, 11);
    expect(game().hidden).toEqual(first);
    banqi.abortGame(CODE);
    start(DEFAULT_BANQI_OPTIONS, 12);
    expect(game().hidden).not.toEqual(first);
  });

  it('shuffles with a secure generator by default, so two games differ', () => {
    banqi.startGame(CODE, { N: player('N'), S: player('S') });
    const first = [...game().hidden];
    banqi.abortGame(CODE);
    banqi.startGame(CODE, { N: player('N'), S: player('S') });
    expect(game().hidden).not.toEqual(first);
  });
});

describe('Banqi flips and colours', () => {
  it('lets the first flip decide the flipper colour and gives the other colour to the opponent', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      start(DEFAULT_BANQI_OPTIONS, seed);
      const piece = game().hidden[5];
      expect(banqi.flip(CODE, 'N', cell(5, 0), 2_000)).toEqual({ success: true });
      expect(game().colours).toEqual(bqColour(piece) === 0 ? [0, 1] : [1, 0]);
      expect(game().log).toEqual([{ seat: 'N', to: '5,0', revealed: piece, timestamp: 2_000 }]);
      expect(game().board[5]).toBe(piece);
      expect(game().hidden[5]).toBe(BQ_EMPTY);
      expect(game().currentTurnSeat).toBe('S');
      // The second flip never changes the colours.
      const colours = game().colours;
      banqi.flip(CODE, 'S', cell(0, 0));
      expect(game().colours).toEqual(colours);
      expect(coherent()).toBe(true);
      banqi.abortGame(CODE);
    }
  });

  it('rejects flips out of turn, of an open cell, of a bad id, and after the end', () => {
    start();
    expect(banqi.flip(CODE, 'S', '0,0')).toMatchObject({ success: false, reason: 'Not your turn' });
    expect(banqi.flip(CODE, 'N', '9,9')).toMatchObject({ success: false, reason: 'Illegal move' });
    banqi.flip(CODE, 'N', '0,0');
    expect(banqi.flip(CODE, 'S', '0,0')).toMatchObject({ success: false, reason: 'Illegal move' });
    expect(banqi.move(CODE, 'S', '0,0', '1,0')).toMatchObject({ success: false });
    banqi.control(CODE, 'S', { type: 'resign' });
    expect(banqi.flip(CODE, 'N', '1,0')).toMatchObject({ success: false, reason: 'The game is over' });
    expect(banqi.flip('NOPE00', 'N', '1,0')).toMatchObject({ success: false, reason: 'Game not found' });
  });
});

describe('Banqi moves and captures', () => {
  it('moves a piece one step, passes the turn, and counts a quiet move', () => {
    start();
    setPosition(game(), ['R#......', '........', '........', '#......k']);
    expect(banqi.move(CODE, 'N', '0,0', '0,1', 3_000)).toEqual({ success: true });
    expect(game().board[8]).toBe(bqPiece(0, 3));
    expect(game().board[0]).toBe(BQ_EMPTY);
    expect(game().log.at(-1)).toEqual({ seat: 'N', from: '0,0', to: '0,1', piece: bqPiece(0, 3), timestamp: 3_000 });
    expect(game()).toMatchObject({ currentTurnSeat: 'S', quietMoves: 1 });
  });

  it('rejects illegal moves: opponent pieces, face-down cells, too far, out of rank, and without colours', () => {
    start(LEGACY_BANQI_OPTIONS);
    setPosition(game(), ['R#......', '........', '........', '#......k'], null);
    expect(banqi.move(CODE, 'N', '0,0', '0,1')).toMatchObject({ success: false, reason: 'Illegal move' });
    setPosition(game(), ['R#......', '........', '........', '#......k']);
    expect(banqi.move(CODE, 'N', '7,3', '7,2')).toMatchObject({ success: false });
    expect(banqi.move(CODE, 'N', '1,0', '2,0')).toMatchObject({ success: false });
    expect(banqi.move(CODE, 'N', '0,0', '1,0')).toMatchObject({ success: false });
    expect(banqi.move(CODE, 'N', '0,0', '2,2')).toMatchObject({ success: false });
    expect(banqi.move(CODE, 'N', '0,0', '9,9')).toMatchObject({ success: false });
    expect(game().log).toEqual([]);
  });

  it('captures a lower rank, logs the public piece, and resets the quiet counter', () => {
    start();
    setPosition(game(), ['Rh.....#', '........', '........', '#......k']);
    game().quietMoves = 12;
    expect(banqi.move(CODE, 'N', '0,0', '1,0', 3_000)).toEqual({ success: true });
    expect(game().log.at(-1)).toEqual({
      seat: 'N', from: '0,0', to: '1,0', piece: bqPiece(0, 3), capture: true, captured: bqPiece(1, 4), timestamp: 3_000,
    });
    expect(game().quietMoves).toBe(0);
  });

  it('lets the soldier take the general and refuses the general taking the soldier', () => {
    start();
    setPosition(game(), ['Pk.....r', '........', '........', '#......K']);
    expect(banqi.move(CODE, 'N', '0,0', '1,0')).toEqual({ success: true });
    setPosition(game(), ['Kp.....r', '........', '........', '#......k']);
    game().currentTurnSeat = 'N';
    expect(banqi.move(CODE, 'N', '0,0', '1,0')).toMatchObject({ success: false, reason: 'Illegal move' });
  });

  it('lets a cannon capture by jumping a face-down screen and refuses an adjacent capture', () => {
    start();
    setPosition(game(), ['C#..p...', '.......#', '........', '#......k']);
    expect(banqi.move(CODE, 'N', '0,0', '4,0')).toEqual({ success: true });
    expect(game().log.at(-1)).toMatchObject({ capture: true, captured: bqPiece(1, 6) });
    setPosition(game(), ['Cp.....#', '........', '........', '#......k']);
    game().currentTurnSeat = 'N';
    expect(banqi.move(CODE, 'N', '0,0', '1,0')).toMatchObject({ success: false });
  });

  it('keeps the draw-offer cooldown counting only on the first action of a turn', () => {
    start();
    setPosition(game(), ['R#......', '........', '........', '#......k']);
    banqi.control(CODE, 'N', { type: 'offer-draw' });
    banqi.control(CODE, 'S', { type: 'answer-draw', accept: false });
    expect(game().drawOffer.cooldown).toEqual({ N: DRAW_REOFFER_MOVES });
    banqi.move(CODE, 'N', '0,0', '0,1');
    expect(game().drawOffer.cooldown).toEqual({ N: DRAW_REOFFER_MOVES - 1 });
  });
});

describe('Banqi chain captures (連吃)', () => {
  const chain = { chain: true, rookDash: false };

  it('keeps the turn after a capture that can continue, and passes it when the piece stops or has no more captures', () => {
    start(chain);
    setPosition(game(), ['Rpp.....', '........', '........', '#......k']);
    expect(banqi.move(CODE, 'N', '0,0', '1,0')).toEqual({ success: true });
    expect(game()).toMatchObject({ currentTurnSeat: 'N', chain: '1,0' });
    // Flipping, quiet moves, other pieces, and other targets are not allowed during a chain.
    expect(banqi.flip(CODE, 'N', '0,3')).toMatchObject({ success: false });
    expect(banqi.move(CODE, 'N', '1,0', '1,1')).toMatchObject({ success: false });
    expect(banqi.move(CODE, 'N', '0,0', '0,1')).toMatchObject({ success: false });
    expect(banqi.control(CODE, 'S', { type: 'offer-draw' })).toMatchObject({ success: false });
  });

  it('marks the continued capture, ends the chain when no capture is left, and then passes the turn', () => {
    start(chain);
    setPosition(game(), ['.Rpp....', '........', '........', '#......k']);
    expect(banqi.move(CODE, 'N', '1,0', '2,0')).toEqual({ success: true });
    expect(game().chain).toBe('2,0');
    expect(banqi.move(CODE, 'N', '2,0', '3,0')).toEqual({ success: true });
    expect(game().log.at(-1)).toMatchObject({ from: '2,0', to: '3,0', capture: true, chain: true });
    expect(game()).toMatchObject({ chain: null, currentTurnSeat: 'S' });
  });

  it('lets the player end the chain with stop, and rejects stop outside a chain', () => {
    start(chain);
    setPosition(game(), ['Rpp.....', '........', '........', '#......k']);
    expect(banqi.stop(CODE, 'N')).toMatchObject({ success: false });
    banqi.move(CODE, 'N', '0,0', '1,0');
    expect(banqi.stop(CODE, 'S')).toMatchObject({ success: false, reason: 'Not your turn' });
    expect(banqi.stop(CODE, 'N')).toEqual({ success: true });
    expect(game()).toMatchObject({ chain: null, currentTurnSeat: 'S' });
  });

  it('does not chain when the room rule is off', () => {
    start(LEGACY_BANQI_OPTIONS);
    setPosition(game(), ['Rpp.....', '........', '........', '#......k']);
    banqi.move(CODE, 'N', '0,0', '1,0');
    expect(game()).toMatchObject({ chain: null, currentTurnSeat: 'S' });
  });

  it('chains a cannon through repeated jumps', () => {
    start(chain);
    setPosition(game(), ['C#p#p...', '........', '........', '#......k']);
    expect(banqi.move(CODE, 'N', '0,0', '2,0')).toEqual({ success: true });
    expect(game().chain).toBe('2,0');
    expect(banqi.move(CODE, 'N', '2,0', '4,0')).toEqual({ success: true });
  });
});

describe('Banqi chariot dash (車衝)', () => {
  it('moves and captures at a distance only when the room rule is on', () => {
    start({ chain: false, rookDash: true });
    setPosition(game(), ['R...p...', '........', '........', '#......k']);
    expect(banqi.move(CODE, 'N', '0,0', '0,2')).toEqual({ success: true });
    setPosition(game(), ['R...p...', '........', '........', '#......k']);
    game().currentTurnSeat = 'N';
    expect(banqi.move(CODE, 'N', '0,0', '4,0')).toEqual({ success: true });
    expect(game().log.at(-1)).toMatchObject({ capture: true, captured: bqPiece(1, 6) });
    banqi.abortGame(CODE);
    start();
    setPosition(game(), ['R...p...', '........', '........', '#......k']);
    expect(banqi.move(CODE, 'N', '0,0', '0,2')).toMatchObject({ success: false });
    expect(banqi.move(CODE, 'N', '0,0', '4,0')).toMatchObject({ success: false });
  });
});

describe('Banqi endings', () => {
  it('wins by capturing the last opposing piece', () => {
    start();
    setPosition(game(), ['Rp......', '........', '........', '........']);
    expect(banqi.move(CODE, 'N', '0,0', '1,0', 4_000)).toEqual({ success: true });
    expect(game()).toMatchObject({ phase: 'scoring' });
    expect(game().result).toEqual({
      gameType: 'banqi', seats: ['N', 'S'], winners: ['N'], reason: 'all-captured', remaining: { N: 1, S: 0 }, moves: 1,
    });
    expect(isBanqiResult(JSON.parse(JSON.stringify(game().result)))).toBe(true);
  });

  it('does not count the opponent as wiped out while a face-down piece of their colour remains', () => {
    start();
    setPosition(game(), ['Rp.....#', '........', '........', '........']);
    game().hidden[7] = bqPiece(1, 2);
    banqi.move(CODE, 'N', '0,0', '1,0');
    expect(game().phase).toBe('playing');
  });

  it('wins by leaving the opponent without any action', () => {
    start();
    // Black's only piece is a soldier boxed in by a chariot and an advisor it cannot capture, and nothing is face down.
    setPosition(game(), ['pR......', 'A.......', '........', '.......H']);
    expect(banqi.move(CODE, 'N', '7,3', '6,3')).toEqual({ success: true });
    expect(game().phase).toBe('scoring');
    expect(game().result).toMatchObject({ winners: ['N'], reason: 'no-moves', remaining: { N: 3, S: 1 } });
  });

  it('does not end the game while the opponent can still flip', () => {
    start();
    setPosition(game(), ['pR....#.', 'A.......', '........', '.......H']);
    expect(banqi.move(CODE, 'N', '7,3', '6,3')).toEqual({ success: true });
    expect(game().phase).toBe('playing');
  });

  it('draws after fifty moves in a row without a flip or capture', () => {
    start();
    setPosition(game(), ['R......k', '........', '........', '........']);
    game().quietMoves = BQ_QUIET_LIMIT - 1;
    expect(banqi.move(CODE, 'N', '0,0', '0,1', 5_000)).toEqual({ success: true });
    expect(game().result).toMatchObject({ winners: [], reason: 'no-capture-limit', remaining: { N: 1, S: 1 } });
    expect(matchStanding(game().result!, 'N')).toMatchObject({ rank: 1, tied: true, won: true });
  });

  it('lets a flip or a capture restart the fifty-move count', () => {
    start();
    setPosition(game(), ['R......k', '.......#', '........', '........']);
    game().quietMoves = 30;
    banqi.flip(CODE, 'N', '7,1');
    expect(game().quietMoves).toBe(0);
  });
});

describe('Banqi blind captures (連吃 attacks on face-down pieces)', () => {
  /** Puts `piece` under the face-down cell at `col,row`. */
  const hide = (col: number, row: number, piece: number): void => { game().hidden[row * 8 + col] = piece; };
  const R = bqPiece(0, 3);

  it('takes a capturable enemy it reveals, moves in, resets the count, and logs only what was revealed', () => {
    start();
    setPosition(game(), ['R#......', '........', '........', '#......k']);
    hide(1, 0, bqPiece(1, 6));
    game().quietMoves = 12;
    expect(banqi.move(CODE, 'N', '0,0', '1,0', 4_000)).toEqual({ success: true });
    expect(game().board.slice(0, 2)).toEqual([BQ_EMPTY, R]);
    expect(game().hidden[1]).toBe(BQ_EMPTY);
    expect(game().log.at(-1)).toEqual({
      seat: 'N', from: '0,0', to: '1,0', piece: R, blind: true, revealed: bqPiece(1, 6), capture: true, captured: bqPiece(1, 6),
      timestamp: 4_000,
    });
    expect(game()).toMatchObject({ quietMoves: 0, chain: null, currentTurnSeat: 'S' });
  });

  it('only turns over a bigger enemy or an own piece: the attacker stays and the turn ends', () => {
    for (const [revealed, label] of [[bqPiece(1, 0), 'bigger'], [bqPiece(0, 6), 'own'], [bqPiece(1, 1), 'advisor']] as const) {
      start();
      setPosition(game(), ['R#......', '........', '........', '#......k']);
      hide(1, 0, revealed);
      game().quietMoves = 9;
      expect(banqi.move(CODE, 'N', '0,0', '1,0'), label).toEqual({ success: true });
      expect(game().board.slice(0, 2), label).toEqual([R, revealed]);
      expect(game().log.at(-1), label).toMatchObject({ blind: true, revealed, piece: R });
      expect(game().log.at(-1)?.captured, label).toBeUndefined();
      expect(game(), label).toMatchObject({ quietMoves: 0, chain: null, currentTurnSeat: 'S' });
      banqi.abortGame(CODE);
    }
  });

  it('keeps the soldier and general exceptions: the soldier takes a hidden general, the general only reveals a soldier', () => {
    start();
    setPosition(game(), ['P#......', '........', '........', '#......k']);
    hide(1, 0, bqPiece(1, 0));
    banqi.move(CODE, 'N', '0,0', '1,0');
    expect(game().log.at(-1)).toMatchObject({ captured: bqPiece(1, 0) });
    start();
    setPosition(game(), ['K#......', '........', '........', '#......p']);
    hide(1, 0, bqPiece(1, 6));
    banqi.move(CODE, 'N', '0,0', '1,0');
    expect(game().board.slice(0, 2)).toEqual([bqPiece(0, 0), bqPiece(1, 6)]);
  });

  it('lets the cannon jump onto a face-down piece and take any enemy, but never attack an adjacent one', () => {
    start();
    setPosition(game(), ['C#.#....', '........', '........', '#......k']);
    hide(3, 0, bqPiece(1, 0));
    expect(banqi.move(CODE, 'N', '0,0', '1,0')).toMatchObject({ success: false });
    expect(banqi.move(CODE, 'N', '0,0', '3,0')).toEqual({ success: true });
    expect(game().log.at(-1)).toMatchObject({ blind: true, captured: bqPiece(1, 0) });
    expect(game().board[3]).toBe(bqPiece(0, 5));
  });

  it('continues a chain after a blind capture, and a failed blind attack in the chain ends the turn', () => {
    start();
    setPosition(game(), ['R##.....', '........', '........', '#......k']);
    hide(1, 0, bqPiece(1, 5));
    hide(2, 0, bqPiece(1, 0));
    expect(banqi.move(CODE, 'N', '0,0', '1,0')).toEqual({ success: true });
    expect(game()).toMatchObject({ chain: '1,0', currentTurnSeat: 'N' });
    expect(banqi.move(CODE, 'N', '1,0', '2,0')).toEqual({ success: true });
    expect(game().log.at(-1)).toMatchObject({ chain: true, blind: true, revealed: bqPiece(1, 0) });
    expect(game()).toMatchObject({ chain: null, currentTurnSeat: 'S' });
    expect(game().board.slice(0, 3)).toEqual([BQ_EMPTY, R, bqPiece(1, 0)]);
  });

  it('reaches face-down pieces at a distance with 車衝 only', () => {
    start({ chain: true, rookDash: true });
    setPosition(game(), ['R..#....', '........', '........', '#......k']);
    hide(3, 0, bqPiece(1, 6));
    expect(banqi.move(CODE, 'N', '0,0', '3,0')).toEqual({ success: true });
    expect(game().board[3]).toBe(R);
    start();
    setPosition(game(), ['R..#....', '........', '........', '#......k']);
    expect(banqi.move(CODE, 'N', '0,0', '3,0')).toMatchObject({ success: false });
  });

  it('is off with 連吃 off, and is never the first action of a match', () => {
    start();
    expect(banqi.move(CODE, 'N', '0,0', '1,0')).toMatchObject({ success: false, reason: 'Illegal move' });
    start(LEGACY_BANQI_OPTIONS);
    setPosition(game(), ['R#......', '........', '........', '#......k']);
    expect(banqi.move(CODE, 'N', '0,0', '1,0')).toMatchObject({ success: false });
  });

  it('shows seats only a face-down marker until the attack, then the revealed piece', () => {
    start();
    setPosition(game(), ['R#......', '........', '........', '#......k']);
    hide(1, 0, bqPiece(1, 2));
    const before = banqi.getPlayerVisibleState(CODE, 'S')!;
    expect(before.board[1]).toBe(BQ_DOWN);
    expect(before.log).toEqual([]);
    banqi.move(CODE, 'N', '0,0', '1,0');
    const after = banqi.getPlayerVisibleState(CODE, 'S')!;
    expect(after.board[1]).toBe(bqPiece(1, 2));
    expect(after.log.at(-1)).toMatchObject({ blind: true, revealed: bqPiece(1, 2) });
  });
});

describe('Banqi matches stored before blind captures', () => {
  /** A match started with 連吃 before attacks on face-down pieces existed: its options lack `blindCapture`. */
  function startOld(options: BanqiMatchOptions, seed = 7): void {
    start(options, seed);
    (game() as { options: BanqiMatchOptions }).options = { chain: options.chain, rookDash: options.rookDash };
  }

  it('keeps chaining face-up captures only, and stays valid stored state through the end', () => {
    startOld({ chain: true, rookDash: false });
    playOut(41, 30);
    const stored = JSON.parse(JSON.stringify(game())) as BanqiGameState;
    expect(stored.options).toEqual({ chain: true, rookDash: false });
    expect(banqiGame(stored as unknown as Record<string, unknown>, () => true) && coherentBanqiGame(stored)).toBe(true);
    banqi.restoreGames([stored]);
    playOut(42, 6000);
    expect(game().phase).toBe('scoring');
    expect(game().log.some((entry) => entry.blind)).toBe(false);
    expect(coherent()).toBe(true);
  }, 30_000);

  it('refuses a blind attack in an old match and rejects one written into its log', () => {
    startOld({ chain: true, rookDash: false });
    setPosition(game(), ['R#......', '........', '........', '#......k']);
    expect(banqi.move(CODE, 'N', '0,0', '1,0')).toMatchObject({ success: false });
    // A new match's log with blind attacks is not coherent under the old rules.
    start(DEFAULT_BANQI_OPTIONS, 9);
    for (let seed = 100; !game().log.some((entry) => entry.blind) && game().phase === 'playing'; seed++) playOut(seed, 1);
    const stored = JSON.parse(JSON.stringify(game())) as BanqiGameState;
    expect(stored.log.some((entry) => entry.blind)).toBe(true);
    expect(coherentBanqiGame(stored)).toBe(true);
    expect(coherentBanqiGame({ ...stored, options: { chain: true, rookDash: false } })).toBe(false);
    // Blind attacks come only with 連吃.
    expect(banqiGame({ ...stored, options: { chain: false, rookDash: false, blindCapture: true } } as never, () => true)).toBe(false);
  });
});

describe('Banqi resignation and draw offers', () => {
  it('lets either seat resign at any time, even off turn', () => {
    start();
    expect(banqi.control(CODE, 'S', { type: 'resign' })).toEqual({ success: true });
    expect(game().result).toMatchObject({ winners: ['N'], reason: 'resign', moves: 0, remaining: {} });
    expect(game().phase).toBe('scoring');
    expect(coherent()).toBe(true);
  });

  it('offers a draw only on the own turn and ends in a draw when the opponent accepts', () => {
    start();
    expect(banqi.control(CODE, 'S', { type: 'offer-draw' })).toMatchObject({ success: false });
    expect(banqi.control(CODE, 'N', { type: 'offer-draw' })).toEqual({ success: true });
    expect(banqi.control(CODE, 'S', { type: 'answer-draw', accept: true })).toEqual({ success: true });
    expect(game().result).toMatchObject({ winners: [], reason: 'agreed-draw' });
    expect(coherent()).toBe(true);
  });

  it('treats the opponent flipping as a rejection', () => {
    start();
    banqi.control(CODE, 'N', { type: 'offer-draw' });
    banqi.flip(CODE, 'N', '0,0');
    expect(game().drawOffer.offeredBy).toBe('N');
    banqi.flip(CODE, 'S', '1,0');
    expect(game().drawOffer).toEqual({ offeredBy: null, cooldown: { N: DRAW_REOFFER_MOVES } });
  });
});

describe('Banqi hidden information', () => {
  it('shows every seat only face-down markers under unflipped cells, and never the hidden array', () => {
    start();
    banqi.flip(CODE, 'N', '2,1');
    banqi.flip(CODE, 'S', '3,2');
    for (const seat of ['N', 'S', 'E'] as const) {
      const view = banqi.getPlayerVisibleState(CODE, seat)!;
      expect(Object.keys(view).sort()).toEqual(['board', 'chain', 'colours', 'currentTurnSeat', 'drawOffer', 'gameType', 'log',
        'mySeat', 'options', 'phase', 'quietMoves', 'result', 'seats']);
      view.board.forEach((slot, index) => {
        if (game().board[index] === BQ_DOWN) expect(slot).toBe(BQ_DOWN);
      });
      expect(JSON.stringify(view)).not.toContain('observedPieces');
      expect(JSON.stringify(view)).not.toContain('hidden');
    }
    // The two seats see the identical board, so neither knows more than the other.
    const { mySeat: _a, ...north } = banqi.getPlayerVisibleState(CODE, 'N')!;
    const { mySeat: _b, ...south } = banqi.getPlayerVisibleState(CODE, 'S')!;
    expect(north).toEqual(south);
  });

  it('never lets a seated visible view reveal an identity before the flip, even when the layout is known to the test', () => {
    start(DEFAULT_BANQI_OPTIONS, 3);
    const layout = [...game().hidden];
    const before = JSON.stringify(banqi.getPlayerVisibleState(CODE, 'N'));
    // The 32 identities never appear as a sequence in the view: only the board's face-down markers do.
    expect(before).not.toContain(JSON.stringify(layout));
    expect(JSON.parse(before).board).toEqual(new Array(BQ_CELLS).fill(BQ_DOWN));
    banqi.flip(CODE, 'N', '4,2');
    const after = banqi.getPlayerVisibleState(CODE, 'S')!;
    expect(after.board[2 * 8 + 4]).toBe(layout[2 * 8 + 4]);
    expect(after.board.filter((slot) => slot === BQ_DOWN)).toHaveLength(31);
  });

  it('keeps log entries and move notation free of hidden identities: only flipped and captured pieces appear', () => {
    start(DEFAULT_BANQI_OPTIONS, 5);
    playOut(21, 40);
    const layoutAtEnd = game().hidden.filter((piece) => piece >= 0);
    for (const entry of game().log) {
      expect(Object.keys(entry).every((key) => ['seat', 'from', 'to', 'revealed', 'piece', 'capture', 'captured', 'chain', 'blind',
        'timestamp'].includes(key))).toBe(true);
      if (entry.revealed !== undefined && !entry.blind) expect(entry.from).toBeUndefined();
    }
    // Every identity still under a face-down cell is absent from the serialised log.
    const flippedCells = new Set(game().log.filter((entry) => entry.revealed !== undefined).map((entry) => entry.to));
    for (let index = 0; index < BQ_CELLS; index++) {
      if (game().board[index] === BQ_DOWN) expect(flippedCells.has(bqNode(index))).toBe(false);
    }
    expect(layoutAtEnd.length).toBe(game().board.filter((slot) => slot === BQ_DOWN).length);
  });

  it('gives an unseated spectator the pieces under face-down cells and nobody else', () => {
    start();
    banqi.flip(CODE, 'N', '0,0');
    const own = banqi.getPlayerVisibleState(CODE, 'W')!;
    const spectator = banqiAdapter.withObserverView(own, game(), 'spectator');
    expect(spectator.observer).toBe('spectator');
    expect(Object.keys(spectator.observedPieces!)).toHaveLength(31);
    for (const [node, piece] of Object.entries(spectator.observedPieces!)) {
      const [col, row] = node.split(',').map(Number);
      expect(piece).toBe(game().hidden[row * 8 + col]);
      expect(own.board[row * 8 + col]).toBe(BQ_DOWN);
    }
    expect(spectator.observedPieces!['0,0']).toBeUndefined();
    // A permanently out seat is not a spectator: it gets no god view of the board.
    expect(banqiAdapter.withObserverView(own, game(), 'eliminated').observedPieces).toBeUndefined();
  });

  it('keeps the shuffle, the replay recording, and the hidden array out of every seated recipient view', () => {
    const code = 'BANQM1';
    expect(manager.startGame(code, 'banqi', { N: player('N'), S: player('S') })).toEqual({ success: true });
    manager.initializeClock(code);
    try {
      expect(manager.handleGameAction(code, 'N', { gameType: 'banqi', action: { type: 'flip', to: '1,1' } })).toEqual({ success: true });
      const state = manager.getGameState(code) as BanqiGameState;
      const hidden = JSON.stringify(state.hidden);
      for (const seat of ['N', 'S'] as const) {
        const json = JSON.stringify(manager.getRecipientVisibleState(code, seat));
        expect(json).not.toContain(hidden);
        expect(json).not.toContain('observedPieces');
        expect(json).not.toContain('replayRecording');
        expect(json).not.toContain('"hidden"');
        expect(json).not.toContain('presentation');
      }
      const spectator = manager.getRecipientVisibleState(code, null) as { observedPieces?: Record<string, number>; observer?: string };
      expect(spectator.observer).toBe('spectator');
      expect(Object.keys(spectator.observedPieces ?? {})).toHaveLength(31);
      // The recording is server-only and stores the unseated spectator's view, never a seated one.
      recordReplayStep(state, undefined);
      expect(state.replayRecording?.initial).toMatchObject({ observer: 'spectator' });
      expect(Object.keys((state.replayRecording?.initial as { observedPieces?: object }).observedPieces ?? {})).toHaveLength(31);
      expect(manager.getGameState(code)?.presentation).toBeUndefined();
    } finally {
      manager.removeGame(code);
    }
  });
});

describe('Banqi adapter and stored state', () => {
  it('routes controls without the clock and board actions through it', () => {
    start();
    const timed: string[] = [];
    const context = {
      automatic: false, settings: { baseSeconds: 60, bankSeconds: 300 },
      timed: (operation: () => { success: boolean }) => { timed.push('timed'); return operation(); },
      present: (operation: () => { success: boolean }) => { timed.push('present'); return operation(); },
      simultaneous: (operation: () => { success: boolean }) => operation(),
      resetClock: () => undefined,
    };
    expect(banqiAdapter.applyAction(CODE, 'N', { type: 'offer-draw' }, context as never)).toEqual({ success: true });
    expect(timed).toEqual([]);
    expect(banqiAdapter.applyAction(CODE, 'N', { type: 'flip', to: '3,3' }, context as never)).toEqual({ success: true });
    expect(timed).toEqual(['timed']);
    expect(banqiAdapter.applyAction(CODE, 'S', { type: 'stop' }, context as never)).toMatchObject({ success: false });
    expect(banqiAdapter.turnSeat(game())).toBe('S');
    expect(banqiAdapter.matchResult(game())).toBeNull();
  });

  it('accepts a played game as stored state and rejects tampering', () => {
    for (const options of [DEFAULT_BANQI_OPTIONS, { chain: true, rookDash: true }]) {
      start(options, 9);
      playOut(33, 60);
      const stored = JSON.parse(JSON.stringify(game())) as StoredBanqi;
      const accepts = (value: unknown): boolean => gameValidator('banqi').shape(value as never, () => true)
        && gameValidator('banqi').coherent(value as BanqiGameState);
      expect(accepts(stored)).toBe(true);
      expect(banqiGame(stored as unknown as Record<string, unknown>, () => true)).toBe(true);

      const duplicate = structuredClone(stored);
      const covered = duplicate.board.findIndex((slot: number) => slot === BQ_DOWN);
      duplicate.hidden[covered] = (duplicate.hidden[covered] + 1) % 14;
      expect(accepts(duplicate)).toBe(false);

      const extraSecret = structuredClone(stored);
      const open = extraSecret.board.findIndex((slot: number) => slot !== BQ_DOWN);
      extraSecret.hidden[open] = 0;
      expect(accepts(extraSecret)).toBe(false);

      const wrongColours = structuredClone(stored);
      wrongColours.colours = wrongColours.colours[0] === 0 ? [1, 0] : [0, 1];
      expect(accepts(wrongColours)).toBe(false);
      expect(accepts({ ...structuredClone(stored), colours: [0, 0] })).toBe(false);

      const wrongTurn = { ...structuredClone(stored), currentTurnSeat: game().currentTurnSeat === 'N' ? 'S' : 'N' };
      expect(accepts(wrongTurn)).toBe(false);

      const lied = structuredClone(stored);
      lied.log[0].revealed = (lied.log[0].revealed + 1) % 14;
      expect(accepts(lied)).toBe(false);

      const moved = structuredClone(stored);
      const board = moved.board as number[];
      const first = board.findIndex((slot) => slot >= 0);
      board[first] = BQ_EMPTY;
      expect(accepts(moved)).toBe(false);

      expect(accepts({ ...structuredClone(stored), quietMoves: stored.quietMoves + 1 })).toBe(false);
      expect(accepts({ ...structuredClone(stored), result: { gameType: 'banqi' } })).toBe(false);
      expect(accepts({ ...structuredClone(stored), phase: 'scoring' })).toBe(false);
      expect(accepts({ ...structuredClone(stored), options: { chain: true } })).toBe(false);
      banqi.abortGame(CODE);
    }
  });

  it('plays seeded random matches to the end with a coherent log at every step', () => {
    for (const [seed, options] of [[1, DEFAULT_BANQI_OPTIONS], [2, LEGACY_BANQI_OPTIONS], [3, { chain: true, rookDash: true }]] as const) {
      start(options, seed);
      for (let step = 0; step < 12 && game().phase === 'playing'; step++) {
        playOut(seed + step * 100, 1);
        expect(coherent()).toBe(true);
      }
      playOut(seed + 500, 6000);
      expect(game().phase).toBe('scoring');
      expect(coherent()).toBe(true);
      const result = game().result!;
      expect(isBanqiResult(JSON.parse(JSON.stringify(result)))).toBe(true);
      expect(result.moves).toBe(game().log.length);
      banqi.abortGame(CODE);
    }
  }, 30_000);

  it('keeps stored results consistent with their reason', () => {
    const result = { gameType: 'banqi', seats: ['N', 'S'], remaining: { N: 7, S: 0 }, moves: 90, winners: ['N'], reason: 'all-captured' };
    expect(isBanqiResult(result)).toBe(true);
    expect(isBanqiResult({ ...result, remaining: { N: 7, S: 2 } })).toBe(false);
    expect(isBanqiResult({ ...result, winners: [] })).toBe(false);
    expect(isBanqiResult({ ...result, reason: 'no-capture-limit', winners: [], remaining: { N: 3, S: 4 } })).toBe(true);
    expect(isBanqiResult({ ...result, reason: 'no-capture-limit', remaining: { N: 3, S: 4 } })).toBe(false);
    expect(isBanqiResult({ ...result, reason: 'resign', remaining: {} })).toBe(true);
    expect(isBanqiResult({ ...result, reason: 'timeout' })).toBe(false);
    expect(isBanqiResult({ ...result, seats: ['N'] })).toBe(false);
    expect(isBanqiResult({ ...result, remaining: { N: 17, S: 0 } })).toBe(false);
  });

  it('parses flips, moves, stops, and match controls only on board cells', () => {
    const parse = (action: unknown): unknown => parseGameAction({ gameType: 'banqi', action });
    expect(parse({ type: 'flip', to: '3,2', extra: 1 })).toEqual({ gameType: 'banqi', action: { type: 'flip', to: '3,2' } });
    expect(parse({ type: 'move', from: '0,0', to: '1,0' })).toEqual({ gameType: 'banqi', action: { type: 'move', from: '0,0', to: '1,0' } });
    expect(parse({ type: 'stop' })).toEqual({ gameType: 'banqi', action: { type: 'stop' } });
    expect(parse({ type: 'resign' })).toEqual({ gameType: 'banqi', action: { type: 'resign' } });
    for (const bad of [{ type: 'flip', to: '8,0' }, { type: 'flip', to: '0,4' }, { type: 'flip' }, { type: 'move', from: '0,0' },
      { type: 'move', from: '9,9', to: '0,0' }, { type: 'place', to: '0,0' }, null, 'flip']) {
      expect(typeof parse(bad)).toBe('string');
    }
  });
});

describe('Banqi through the game manager', () => {
  const MANAGED = 'BANQM2';
  afterEach(() => manager.removeGame(MANAGED));

  function begin(options = DEFAULT_BANQI_OPTIONS): void {
    expect(manager.startGame(MANAGED, 'banqi', { N: player('N'), S: player('S') }, undefined, { banqi: options })).toEqual({ success: true });
    manager.initializeClock(MANAGED);
  }

  it('starts with the room options, runs a turn clock, and moves it with each action', () => {
    begin({ chain: true, rookDash: false });
    expect((manager.getGameState(MANAGED) as BanqiGameState).options).toEqual({ chain: true, rookDash: false, blindCapture: true });
    expect(manager.getGameState(MANAGED)?.clock?.turn).toMatchObject({ seat: 'N' });
    expect(manager.handleGameAction(MANAGED, 'N', { gameType: 'banqi', action: { type: 'flip', to: '3,1' } })).toEqual({ success: true });
    expect(manager.getGameState(MANAGED)?.clock?.turn).toMatchObject({ seat: 'S' });
    const turn = manager.getGameState(MANAGED)?.clock?.turn;
    expect(manager.handleGameAction(MANAGED, 'S', { gameType: 'banqi', action: { type: 'offer-draw' } })).toEqual({ success: true });
    expect(manager.getGameState(MANAGED)?.clock?.turn).toEqual(turn);
  });

  it('keeps the same seat clock running through a capture chain', () => {
    begin({ chain: true, rookDash: false });
    const state = manager.getGameState(MANAGED) as BanqiGameState;
    setPosition(state, ['Rpp.....', '........', '........', '#......k']);
    expect(manager.handleGameAction(MANAGED, 'N', { gameType: 'banqi', action: { type: 'move', from: '0,0', to: '1,0' } }))
      .toEqual({ success: true });
    expect(manager.getGameState(MANAGED)?.clock?.turn).toMatchObject({ seat: 'N' });
    expect(manager.handleGameAction(MANAGED, 'N', { gameType: 'banqi', action: { type: 'stop' } })).toEqual({ success: true });
    expect(manager.getGameState(MANAGED)?.clock?.turn).toMatchObject({ seat: 'S' });
  });

  it('stops the clock when a resignation or a win ends the match, and stays valid as stored state', () => {
    begin();
    expect(manager.handleGameAction(MANAGED, 'S', { gameType: 'banqi', action: { type: 'resign' } })).toEqual({ success: true });
    expect(manager.getGameState(MANAGED)).toMatchObject({ phase: 'scoring', clock: { turn: null } });
    expect(manager.getMatchResult(manager.getGameState(MANAGED)!)).toMatchObject({ winners: ['N'], reason: 'resign' });
    const state = JSON.parse(JSON.stringify(manager.getGameState(MANAGED))) as BanqiGameState;
    expect(gameValidator('banqi').shape(state as never, () => true)).toBe(true);
    expect(gameValidator('banqi').coherent(state)).toBe(true);
  });

  it('flips of every cell remain legal until none is face down', () => {
    begin();
    for (let index = 0; index < BQ_CELLS; index++) {
      const seat = index % 2 === 0 ? 'N' : 'S';
      expect(bqFlips((manager.getGameState(MANAGED) as BanqiGameState).board)).toHaveLength(BQ_CELLS - index);
      expect(manager.handleGameAction(MANAGED, seat, { gameType: 'banqi', action: { type: 'flip', to: bqNode(index) } }))
        .toEqual({ success: true });
      if (manager.getGameState(MANAGED)?.phase === 'scoring') break;
    }
  });
});
