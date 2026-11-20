// Self-play games for fitting the Reversi evaluation. Each game opens with a few random moves, then both sides
// search to a fixed depth until `EXACT_EMPTIES` squares are empty, where the solver proves the final disc
// difference under perfect play. Every position after the opening is labelled with that result from the
// side to move; later positions, down to `LAST_RECORDED` empties, get their own exact value. Searched
// positions also keep the search score, which the fit can blend with the result to cut the label noise.
import { rvInitialDiscs } from '../../shared/src/rules/reversi';
import { CELL_HI, CELL_LO, discDifference, flips, fromDiscs, out } from '../../server/src/bots/reversi-board';
import type { Bitboards } from '../../server/src/bots/reversi-board';
import { emptiesOf, rootMoves, searchPosition, solveExact } from '../../server/src/bots/reversi-engine';

const EXACT_EMPTIES = 14;
const LAST_RECORDED = 8;
/** Values per record: the four bitboard halves, the label in discs, and the search score (or `NO_SCORE`). */
export const RECORD_INTS = 6;
/** Score slot of a record without a usable search score: exact labels, or searches with hand-made weights. */
export const NO_SCORE = -32768;

/** The opening position, dark to move. */
export const START: Bitboards = fromDiscs(rvInitialDiscs(), 0);

export interface SelfPlayOptions {
  readonly random: () => number;
  /** Midgame search depth of each side */
  readonly depths: readonly [number, number];
  /** Random moves before the searching starts */
  readonly openingMoves: number;
  /** Keep the search scores (the weights are fitted, so their scores are in discs) */
  readonly keepScores: boolean;
}

const play = (board: Bitboards, move: number): Bitboards => {
  flips(move, board.pl, board.ph, board.ol, board.oh);
  return {
    pl: board.ol & ~out.lo,
    ph: board.oh & ~out.hi,
    ol: board.pl | out.lo | CELL_LO[move],
    oh: board.ph | out.hi | CELL_HI[move],
  };
};

const pass = (board: Bitboards): Bitboards => ({ pl: board.ol, ph: board.oh, ol: board.pl, oh: board.ph });

/** One game's labelled positions as flat records. */
export function selfPlayGame(options: SelfPlayOptions): number[] {
  let board = START;
  let side = 0;
  let ply = 0;
  const positions: { board: Bitboards; side: number; exact: number | null; score: number }[] = [];
  let result: number | null = null;
  let resultSide = 0;
  for (;;) {
    const children = rootMoves(board);
    if (children.length === 0) {
      if (rootMoves(pass(board)).length === 0) break;
      board = pass(board);
      side ^= 1;
      continue;
    }
    const empties = emptiesOf(board);
    if (empties <= EXACT_EMPTIES) {
      const exact = solveExact(board);
      if (result === null) {
        result = exact;
        resultSide = side;
      }
      if (ply >= options.openingMoves) positions.push({ board, side, exact, score: NO_SCORE });
      if (empties <= LAST_RECORDED) break;
      // The best move by exact value keeps the remaining labels consistent with perfect play.
      let best = children[0].move;
      let bestScore = -100;
      for (const child of children) {
        const score = -solveExact({ pl: child.pl, ph: child.ph, ol: child.ol, oh: child.oh });
        if (score > bestScore) {
          bestScore = score;
          best = child.move;
        }
      }
      board = play(board, best);
    } else {
      let move: number;
      if (ply < options.openingMoves) move = children[Math.floor(options.random() * children.length)].move;
      else {
        const searched = searchPosition(board, {
          maxDepth: options.depths[side], expired: () => false, clock: null, solveEmpties: 0, tableBits: 16, probCut: false,
        });
        move = searched.move;
        const score = options.keepScores && searched.depth > 0 ? searched.score : NO_SCORE;
        positions.push({ board, side, exact: null, score });
      }
      board = play(board, move);
    }
    side ^= 1;
    ply++;
  }
  if (result === null) {
    // The game ended before the exact phase: the final position is the result.
    result = discDifference(board.pl, board.ph, board.ol, board.oh);
    resultSide = side;
  }
  const records: number[] = [];
  for (const position of positions) {
    const label = position.exact ?? (position.side === resultSide ? result : -result);
    records.push(position.board.pl, position.board.ph, position.board.ol, position.board.oh, label, position.score);
  }
  return records;
}
