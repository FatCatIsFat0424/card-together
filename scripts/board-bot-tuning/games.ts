// Per-game adapters for the evaluation tuner: self-play with the bot's own search, position serialization, and
// evaluation traces (parameter counts) of quiet positions.

import { fileURLToPath } from 'node:url';
import {
  chessApply, chessInCheck, chessInitialPosition, chessLegalMoves, chessPositionKey, chessVerdict,
} from '@shared/rules/chess';
import type { ChessCell, ChessPosition } from '@shared/rules/chess';
import {
  xqApply, xqInCheck, xqInitialBoard, xqLegalMoves, xqMoveFacts, xqVerdict,
} from '@shared/rules/xiangqi';
import type { XqBoard, XqCell, XqPly, XqSide } from '@shared/rules/xiangqi';
import { chessAnalyse, chessQuiescence } from '../../server/src/bots/chess-search';
import { chessBoardState } from '../../server/src/bots/chess-engine';
import {
  CHESS_EVAL_PARAMETERS, CHESS_TRACE_EXTRA, CHESS_TRACE_PHASE, CHESS_TRACE_SCALE, CHESS_TRACE_SIZE, chessActiveWeights,
  chessEvaluateWhite, chessSetWeights,
} from '../../server/src/bots/chess-eval';
import { xiangqiAnalyse, xiangqiQuiescence } from '../../server/src/bots/xiangqi-search';
import { xqBoardState } from '../../server/src/bots/xiangqi-engine';
import {
  XQ_EVAL_PARAMETERS, XQ_MAX_PHASE, XQ_TRACE_EXTRA, XQ_TRACE_PHASE, XQ_TRACE_SCALE, XQ_TRACE_SIZE, xiangqiActiveWeights,
  xiangqiEvaluateRed, xiangqiSetWeights,
} from '../../server/src/bots/xiangqi-eval';

export type TuningGameName = 'chess' | 'xiangqi';

/** One self-play game: the result for the first player (1 win, 0.5 draw, 0 loss) and its later positions. */
export interface GameRecord {
  readonly result: number;
  readonly positions: readonly string[];
}

export interface TuningGame {
  readonly parameters: number;
  readonly traceSize: number;
  readonly phaseSlot: number;
  readonly scaleSlot: number;
  readonly extraSlot: number;
  readonly maxPhase: number;
  /** Default L2 pull towards the starting weights, chosen on held-out error with the committed data volumes. */
  readonly pull: number;
  /** Generated weights module and its exported constant. */
  readonly weightsPath: string;
  readonly weightsExport: string;
  readonly weightsGame: string;
  readonly activeWeights: () => number[];
  readonly setWeights: (weights: readonly number[]) => void;
  /** Plays one game: `randomPlies` uniformly random moves, then searches of about `nodes` nodes per move. */
  readonly play: (random: () => number, nodes: number, randomPlies: number) => GameRecord;
  /** Fills `trace` for a quiet position (no check, quiescence equals the static score); false otherwise. */
  readonly trace: (position: string, trace: Float64Array) => boolean;
}

/** Plies after which an undecided game is scored a draw. */
const PLY_LIMIT = 300;
/** Both engines agreeing on a score this large for this many plies ends the game. */
const RESIGN_SCORE = 1_200;
const RESIGN_PLIES = 6;

/** A stop flag for about `nodes` nodes: the searches poll it every 1024 nodes. */
function nodeLimit(nodes: number): () => boolean {
  let polls = 0;
  return () => ++polls * 1024 >= nodes;
}

/** Tracks scores (first player's view) for resignation. */
function resignation(): (score: number) => number | null {
  let streak = 0;
  let sign = 0;
  return (score) => {
    const current = score >= RESIGN_SCORE ? 1 : score <= -RESIGN_SCORE ? -1 : 0;
    streak = current !== 0 && current === sign ? streak + 1 : current !== 0 ? 1 : 0;
    sign = current;
    return streak >= RESIGN_PLIES ? (sign > 0 ? 1 : 0) : null;
  };
}

const weightsPath = (file: string): string => fileURLToPath(new URL(`../../server/src/bots/${file}`, import.meta.url));

// ─── Chess ───

const chessSerialize = (position: ChessPosition): string => `${position.board.map((cell) => cell ?? '.').join('')}${position.turn}`;

function chessParse(text: string): ChessPosition {
  const board = Array.from(text.slice(0, 64), (char) => (char === '.' ? null : char as ChessCell));
  return { board, turn: text[64] === '1' ? 1 : 0, castling: { K: false, Q: false, k: false, q: false }, enPassant: null, halfmove: 0 };
}

const chessTrace = (text: string, trace: Float64Array): boolean => {
  const position = chessParse(text);
  if (chessInCheck(position)) return false;
  const state = chessBoardState(position);
  const white = chessEvaluateWhite(state, trace);
  if (trace[CHESS_TRACE_PHASE] === 0 && white === 0 && trace.every((value) => value === 0)) return false;
  const quiet = chessQuiescence(position);
  return quiet === (position.turn === 0 ? white : -white);
};

function chessPlay(random: () => number, nodes: number, randomPlies: number): GameRecord {
  let position = chessInitialPosition();
  const history: string[] = [];
  const positions: string[] = [];
  const resign = resignation();
  for (let ply = 0; ply < PLY_LIMIT; ply++) {
    const verdict = chessVerdict(position, history);
    if (verdict) return { result: verdict.loser === null ? 0.5 : verdict.loser === 0 ? 0 : 1, positions };
    let move;
    if (ply < randomPlies) {
      const moves = chessLegalMoves(position);
      move = moves[Math.floor(random() * moves.length)];
    } else {
      positions.push(chessSerialize(position));
      const result = chessAnalyse(position, position.turn, history, { maxDepth: 64, budget: { expired: nodeLimit(nodes) }, random, book: false })!;
      move = result.move;
      const decided = resign(position.turn === 0 ? result.score : -result.score);
      if (decided !== null) return { result: decided, positions };
    }
    history.push(chessPositionKey(position));
    position = chessApply(position, move);
  }
  return { result: 0.5, positions };
}

export const CHESS_TUNING: TuningGame = {
  parameters: CHESS_EVAL_PARAMETERS, traceSize: CHESS_TRACE_SIZE, phaseSlot: CHESS_TRACE_PHASE, scaleSlot: CHESS_TRACE_SCALE,
  extraSlot: CHESS_TRACE_EXTRA, maxPhase: 24, pull: 2e-6, weightsPath: weightsPath('chess-eval-weights.ts'),
  weightsExport: 'CHESS_TUNED_WEIGHTS', weightsGame: 'chess', activeWeights: chessActiveWeights, setWeights: chessSetWeights,
  play: chessPlay, trace: chessTrace,
};

// ─── Xiangqi ───

const xqSerialize = (board: XqBoard, side: XqSide): string => `${board.map((cell) => cell ?? '.').join('')}${side}`;

function xqParse(text: string): { board: XqCell[]; side: XqSide } {
  return { board: Array.from(text.slice(0, 90), (char) => (char === '.' ? null : char as XqCell)), side: text[90] === '1' ? 1 : 0 };
}

const xqTrace = (text: string, trace: Float64Array): boolean => {
  const { board, side } = xqParse(text);
  if (xqInCheck(board, side)) return false;
  const red = xiangqiEvaluateRed(xqBoardState(board, side, []), trace);
  return xiangqiQuiescence(board, side) === (side === 0 ? red : -red);
};

function xqPlay(random: () => number, nodes: number, randomPlies: number): GameRecord {
  let board: XqBoard = xqInitialBoard();
  let side: XqSide = 0;
  const plies: XqPly[] = [];
  const positions: string[] = [];
  const resign = resignation();
  for (let ply = 0; ply < PLY_LIMIT; ply++) {
    const verdict = xqVerdict(board, side, plies);
    if (verdict) return { result: verdict.loser === null ? 0.5 : verdict.loser === 0 ? 0 : 1, positions };
    let move;
    if (ply < randomPlies) {
      const moves = xqLegalMoves(board, side);
      move = moves[Math.floor(random() * moves.length)];
    } else {
      positions.push(xqSerialize(board, side));
      const result = xiangqiAnalyse(board, side, plies, { maxDepth: 64, expired: nodeLimit(nodes), random, book: false })!;
      move = result.move;
      const decided = resign(side === 0 ? result.score : -result.score);
      if (decided !== null) return { result: decided, positions };
    }
    const facts = xqMoveFacts(board, move.from, move.to);
    plies.push({ from: move.from, to: move.to, piece: facts.piece, captured: facts.captured ?? null, check: facts.check === true });
    board = xqApply(board, move.from, move.to);
    side = side === 0 ? 1 : 0;
  }
  return { result: 0.5, positions };
}

export const XIANGQI_TUNING: TuningGame = {
  parameters: XQ_EVAL_PARAMETERS, traceSize: XQ_TRACE_SIZE, phaseSlot: XQ_TRACE_PHASE, scaleSlot: XQ_TRACE_SCALE,
  extraSlot: XQ_TRACE_EXTRA, maxPhase: XQ_MAX_PHASE, pull: 1e-8, weightsPath: weightsPath('xiangqi-eval-weights.ts'),
  weightsExport: 'XIANGQI_TUNED_WEIGHTS', weightsGame: 'xiangqi', activeWeights: xiangqiActiveWeights,
  setWeights: xiangqiSetWeights, play: xqPlay, trace: xqTrace,
};

export const TUNING_GAMES: Readonly<Record<TuningGameName, TuningGame>> = { chess: CHESS_TUNING, xiangqi: XIANGQI_TUNING };
