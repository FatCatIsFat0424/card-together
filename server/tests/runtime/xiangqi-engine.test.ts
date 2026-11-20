import { describe, expect, it } from 'vitest';
import {
  XQ_ADVISOR, XQ_CANNON, XQ_CHARIOT, XQ_ELEPHANT, XQ_GENERAL, XQ_HORSE, XQ_SOLDIER, xqApply, xqIndex, xqInitialBoard, xqIsLegal,
  xqLegalMoves, xqMoveFacts, xqPerft,
} from '@shared/rules/xiangqi';
import type { XqBoard, XqCell, XqPly, XqSide } from '@shared/rules/xiangqi';
import {
  XQ_REPEAT_DRAW, XQ_REPEAT_LOSS, XQ_REPEAT_NONE, XQ_REPEAT_WIN, XQ_SEE_VALUE, xqBoardState, xqGenerateMoves, xqHashOf,
  xqMakeMove, xqRepetition, xqSee, xqStateInCheck, xqUnmakeMove,
} from '../../src/bots/xiangqi-engine';
import type { XqBoardState } from '../../src/bots/xiangqi-engine';
import { xiangqiEvaluateRed } from '../../src/bots/xiangqi-eval';
import { XIANGQI_BOOK_LINES, xiangqiBookCode, xiangqiBookMove } from '../../src/bots/xiangqi-book';
import { seededRandom } from '../../src/bots/search/seeded-random';
import { xqFen, xqPosition } from '../fixtures/xiangqi-positions';

const at = xqIndex;

function perft(state: XqBoardState, depth: number, faults: { count: number }): number {
  const moves = new Int32Array(128);
  const end = xqGenerateMoves(state, moves, 0, false);
  const cells = state.cells.join();
  const low = state.hashLow;
  let total = 0;
  for (const move of moves.subarray(0, end)) {
    const mover = state.side;
    xqMakeMove(state, move);
    if (!xqStateInCheck(state, mover)) {
      const hash = xqHashOf(state.cells, state.side);
      if (hash.low !== state.hashLow || hash.high !== state.hashHigh) faults.count++;
      total += depth <= 1 ? 1 : perft(state, depth - 1, faults);
    }
    xqUnmakeMove(state, move);
  }
  if (state.cells.join() !== cells || state.hashLow !== low) faults.count++;
  return total;
}

/** Plays moves on the search board, recording which gave check as the search does. */
function play(state: XqBoardState, moves: readonly [number, number][]): void {
  for (const [from, to] of moves) {
    xqMakeMove(state, (from << 7) | to);
    state.checks[state.historyLength] = xqStateInCheck(state, state.side) ? 1 : 0;
  }
}

/** The board turned half a circle with the colours swapped. */
const flipped = (board: XqBoard): XqCell[] => board.map((_, cell) => {
  const piece = board[89 - cell];
  return piece === null ? null : (piece === piece.toUpperCase() ? piece.toLowerCase() : piece.toUpperCase()) as XqCell;
});

describe('xiangqi bot board', () => {
  it('uses the shared rules engine codes', () => {
    expect([XQ_GENERAL, XQ_ADVISOR, XQ_ELEPHANT, XQ_HORSE, XQ_CHARIOT, XQ_CANNON, XQ_SOLDIER]).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('generates the same moves as the shared rules (perft) and keeps its hash and undo exact', () => {
    for (const board of [
      xqInitialBoard(),
      xqFen('r1ba1a3/4kn3/2n1b4/pNp1p1p1p/4c4/6P2/P1P2R2P/1CcC5/9/2BAKAB2 w'),
      xqFen('1cbak4/9/n2a5/2p1p3p/5cp2/2n2N3/6PCP/3AB4/2C6/3A1K1N1 w'),
      xqInitialBoard('nine', 'black'),
    ]) {
      const faults = { count: 0 };
      expect(perft(xqBoardState(board, 0, []), 3, faults)).toBe(xqPerft(board, 0, 3));
      expect(faults.count).toBe(0);
    }
  }, 30_000);

  it('rebuilds the earlier positions since the last capture from the move record', () => {
    let board: XqBoard = xqInitialBoard();
    let side: XqSide = 0;
    const plies: XqPly[] = [];
    for (const [from, to] of [[at(7, 7), at(4, 7)], [at(7, 0), at(6, 2)], [at(7, 9), at(6, 7)], [at(8, 0), at(7, 0)]]) {
      const facts = xqMoveFacts(board, from, to);
      plies.push({ from, to, piece: facts.piece, captured: facts.captured ?? null, check: facts.check === true });
      board = xqApply(board, from, to);
      side = side === 0 ? 1 : 0;
    }
    const state = xqBoardState(board, side, plies);
    expect(state.historyLength).toBe(4);
    const start = xqHashOf(xqBoardState(xqInitialBoard(), 0, []).cells, 0);
    expect([state.historyLow[0], state.historyHigh[0]]).toEqual([start.low, start.high]);
  });

  it('judges a returning cycle by the house rules: one-sided perpetual check loses, anything else draws', () => {
    const board = xqPosition(['....k....', '.........', '.........', '.........', '.........', 'R........', '.........',
      '.........', '.........', '...K.....']);
    const checking = xqBoardState(board, 0, []);
    play(checking, [[at(0, 5), at(0, 0)], [at(4, 0), at(4, 1)], [at(0, 0), at(0, 1)], [at(4, 1), at(4, 0)]]);
    expect(xqRepetition(checking)).toBe(XQ_REPEAT_NONE);
    play(checking, [[at(0, 1), at(0, 0)]]);
    // Black is to move and red has checked on every move of the cycle: red loses.
    expect(xqRepetition(checking)).toBe(XQ_REPEAT_WIN);
    play(checking, [[at(4, 0), at(4, 1)]]);
    expect(xqRepetition(checking)).toBe(XQ_REPEAT_LOSS);

    const quiet = xqBoardState(board, 0, []);
    play(quiet, [[at(0, 5), at(0, 6)], [at(4, 0), at(4, 1)], [at(0, 6), at(0, 5)], [at(4, 1), at(4, 0)]]);
    expect(xqRepetition(quiet)).toBe(XQ_REPEAT_DRAW);
  });

  it('scores exchanges with recaptures, including through cannon screens', () => {
    const board = xqPosition(['....k....', '.........', '.........', '....p....', '.........', '....R....', '.........',
      '.........', '.........', '...K.....']);
    expect(xqSee(xqBoardState(board, 0, []), (at(4, 5) << 7) | at(4, 3))).toBe(XQ_SEE_VALUE[XQ_SOLDIER]);
    // A cannon behind a screen recaptures, so the chariot pays for the soldier.
    const screened = xqPosition(['...k.....', '....c....', '....e....', '....p....', '.........', '....R....', '.........',
      '.........', '.........', '...K.....']);
    expect(xqSee(xqBoardState(screened, 0, []), (at(4, 5) << 7) | at(4, 3)))
      .toBe(XQ_SEE_VALUE[XQ_SOLDIER] - XQ_SEE_VALUE[XQ_CHARIOT]);
  });

  it('evaluates both colours alike', () => {
    let board: XqBoard = xqInitialBoard();
    let side: XqSide = 0;
    const random = seededRandom(9);
    for (let ply = 0; ply < 80; ply++) {
      const red = xiangqiEvaluateRed(xqBoardState(board, side, []), null);
      expect(xiangqiEvaluateRed(xqBoardState(flipped(board), side === 0 ? 1 : 0, []), null) + red).toBe(0);
      const moves = xqLegalMoves(board, side);
      if (moves.length === 0) break;
      const move = moves[Math.floor(random() * moves.length)];
      board = xqApply(board, move.from, move.to);
      side = side === 0 ? 1 : 0;
    }
  });
});

describe('xiangqi opening book', () => {
  it('holds only legal lines', () => {
    for (const line of XIANGQI_BOOK_LINES) {
      let board: XqBoard = xqInitialBoard();
      let side: XqSide = 0;
      for (const text of line.split(' ')) {
        const move = xiangqiBookCode(text);
        expect(xqIsLegal(board, side, move >> 7, move & 127), `${line}: ${text}`).toBe(true);
        board = xqApply(board, move >> 7, move & 127);
        side = side === 0 ? 1 : 0;
      }
    }
  });

  it('answers the start with varied main-line moves but not a handicap start', () => {
    const legal = xqLegalMoves(xqInitialBoard(), 0).map((move) => (move.from << 7) | move.to);
    const state = xqBoardState(xqInitialBoard(), 0, []);
    const picks = new Set(Array.from({ length: 30 }, (_, seed) => xiangqiBookMove(state, legal, seededRandom(seed + 1))));
    expect(picks.size).toBeGreaterThan(2);
    expect(picks).toContain(xiangqiBookCode('h2e2'));
    expect(xiangqiBookMove(xqBoardState(xqInitialBoard('horse', 'red'), 0, []), legal, seededRandom(1))).toBeNull();
  });
});
