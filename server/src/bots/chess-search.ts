// ─── Chess search: principal-variation alpha-beta with a transposition table, pruning, and quiescence ───
//
// Iterative deepening with aspiration windows over the bot's own board (`chess-engine.ts`): PVS, null-move pruning
// (off when the side to move has only pawns), late-move reductions and pruning, futility and SEE pruning, killer,
// counter-move and history ordering, check extensions, and a quiescence search of SEE-safe captures that answers
// checks with every evasion. Root moves are first classified with the shared rules, so mates, draws by rule, and
// every returned move match what the server accepts. Runs in a bot worker with the pool's `SearchBudget`.

import * as chessRules from '@shared/rules/chess';
import type { ChessMove, ChessPosition, ChessSide } from '@shared/rules/chess';
import { chessHistoryOfLog } from '@shared/games/chess/log';
import type { ChessVisibleState } from '@shared/types';
import type { SearchContext, SearchBudget } from './search/search-types';
import * as transposition from './search/transposition-table';
import { iterativeDeepening } from './search/iterative-deepening';
import type { RootPass } from './search/iterative-deepening';
import type { BotAction } from './bot-decisions';
import * as chessEngine from './chess-engine';
import type { ChessBoardState } from './chess-engine';
import * as chessEval from './chess-eval';
import { chessBookMove } from './chess-book';

// Imported bindings are read once into module constants: under the CommonJS loader every use of an imported
// binding is a getter call, which costs measurably in the search's inner loops.
const {
  CHESS_BISHOP, CHESS_KNIGHT, CHESS_PAWN, CHESS_QUEEN, CHESS_ROOK, chessApply, chessDecode, chessEngine: chessRulesEngine,
  chessLegalEngineMoves, chessNode, chessPositionKey, chessVerdict,
} = chessRules;
const {
  TT_EXACT, TT_LOWER, TT_UPPER, createTranspositionTable, ttBound, ttDepth, ttMove, ttNewSearch, ttProbe,
  ttScoreFromStore, ttScoreToStore, ttStore,
} = transposition;
const {
  CHESS_MAX_PLY, SEE_VALUE, chessBoardState, chessGenerateMoves, chessMakeMove, chessMakeNull, chessRepetition,
  chessSee, chessSetHistory, chessStateInCheck, chessUnmakeMove, chessUnmakeNull,
} = chessEngine;
const { chessEvaluate } = chessEval;

const MATE = 100_000;
/** Scores beyond this are mates found in the tree. */
const MATE_BOUND = MATE - 1_000;
const INFINITE = 1_000_000;
const MOVES_PER_PLY = 256;

// ─── Search tables (module level, so a worker allocates them once) ───

const TABLE = createTranspositionTable(20);
const moveLists = new Int32Array(CHESS_MAX_PLY * MOVES_PER_PLY);
const moveScores = new Int32Array(CHESS_MAX_PLY * MOVES_PER_PLY);
const quietsTried = new Int32Array(CHESS_MAX_PLY * 64);
const killers = new Int32Array(CHESS_MAX_PLY * 2);
/** Quiet-move success by side × from × to. */
const quietHistory = new Int32Array(2 * 64 * 64);
/** Reply that refuted a move, by the moved piece (`code + 6`) and its target. */
const counterMoves = new Int32Array(13 * 64);
const moveStack = new Int32Array(CHESS_MAX_PLY + 8);
const pieceStack = new Int8Array(CHESS_MAX_PLY + 8);
const evalStack = new Int32Array(CHESS_MAX_PLY + 8);

/** Late-move reduction by depth and move number. */
const REDUCTION: Uint8Array = (() => {
  const table = new Uint8Array(64 * 64);
  for (let depth = 1; depth < 64; depth++) {
    for (let count = 1; count < 64; count++) table[depth * 64 + count] = Math.floor(0.8 + Math.log(depth) * Math.log(count) / 2.2);
  }
  return table;
})();

const HISTORY_LIMIT = 16_384;
/** Quiet moves tried before the rest are pruned at depths 1–4, without and with an improving evaluation. */
const LATE_MOVE_COUNT = [[0, 0], [3, 5], [5, 8], [9, 14], [14, 22]];

class Stop extends Error {}
const STOP = new Stop('search stopped');

interface Searcher {
  readonly state: ChessBoardState;
  nodes: number;
  readonly expired: () => boolean;
  /** Plies the current iteration started from; extensions stay within twice that. */
  rootDepth: number;
  selDepth: number;
}

function tick(searcher: Searcher): void {
  if ((++searcher.nodes & 1023) === 0 && searcher.expired()) throw STOP;
}

const sideHasPieces = (state: ChessBoardState, side: ChessSide): boolean => {
  const sign = side === 0 ? 1 : -1;
  const { counts } = state;
  return counts[sign * CHESS_KNIGHT + 6] + counts[sign * CHESS_BISHOP + 6] + counts[sign * CHESS_ROOK + 6]
    + counts[sign * CHESS_QUEEN + 6] > 0;
};

/** Dead draws the rules end at once: bare kings or a single minor piece. */
function deadDraw(state: ChessBoardState): boolean {
  const { counts } = state;
  if (counts[CHESS_PAWN + 6] + counts[-CHESS_PAWN + 6] + counts[CHESS_ROOK + 6] + counts[-CHESS_ROOK + 6]
    + counts[CHESS_QUEEN + 6] + counts[-CHESS_QUEEN + 6] > 0) return false;
  return counts[CHESS_KNIGHT + 6] + counts[-CHESS_KNIGHT + 6] + counts[CHESS_BISHOP + 6] + counts[-CHESS_BISHOP + 6] <= 1;
}

const isCapture = (state: ChessBoardState, move: number): boolean => {
  const to = (move >> 6) & 63;
  if (state.squares[to] !== 0) return true;
  const piece = state.squares[move & 63];
  return (piece === CHESS_PAWN || piece === -CHESS_PAWN) && (move & 7) !== (to & 7);
};

/** Victim value for ordering and delta pruning (en passant takes a pawn). */
function victimValue(state: ChessBoardState, move: number): number {
  const victim = state.squares[(move >> 6) & 63];
  return victim === 0 ? SEE_VALUE[CHESS_PAWN] : SEE_VALUE[victim > 0 ? victim : -victim];
}

/** Scores the moves in `[start, end)` for ordering. */
function scoreMoves(state: ChessBoardState, start: number, end: number, ply: number, hashMove: number): void {
  const { squares } = state;
  const side = state.side;
  const killerA = killers[ply * 2];
  const killerB = killers[ply * 2 + 1];
  const previous = ply > 0 ? moveStack[ply - 1] : 0;
  const counter = ply > 0 && previous !== 0 ? counterMoves[(pieceStack[ply - 1] + 6) * 64 + ((previous >> 6) & 63)] : 0;
  for (let index = start; index < end; index++) {
    const move = moveLists[index];
    if (move === hashMove) {
      moveScores[index] = 30_000_000;
      continue;
    }
    const promotion = (move >> 12) & 7;
    if (isCapture(state, move) || promotion !== 0) {
      const attacker = squares[move & 63];
      const attackerValue = SEE_VALUE[attacker > 0 ? attacker : -attacker];
      const victim = isCapture(state, move) ? victimValue(state, move) : 0;
      let score = victim * 16 - attackerValue / 16 + (promotion === CHESS_QUEEN ? 8_000 : promotion !== 0 ? -20_000 : 0);
      // Captures of a cheaper piece are checked by exchange; losing ones go after the quiet moves.
      const good = promotion === CHESS_QUEEN || victim >= attackerValue || chessSee(state, move) >= 0;
      score += good ? 20_000_000 : -2_000_000;
      moveScores[index] = score;
    } else if (move === killerA) {
      moveScores[index] = 15_000_000;
    } else if (move === killerB) {
      moveScores[index] = 14_000_000;
    } else if (move === counter) {
      moveScores[index] = 13_000_000;
    } else {
      moveScores[index] = quietHistory[side * 4096 + (move & 4095)];
    }
  }
}

/** Swaps the best remaining move to `index` and returns it. */
function pick(index: number, end: number): number {
  let best = index;
  for (let other = index + 1; other < end; other++) if (moveScores[other] > moveScores[best]) best = other;
  if (best !== index) {
    const move = moveLists[best];
    const score = moveScores[best];
    moveLists[best] = moveLists[index];
    moveScores[best] = moveScores[index];
    moveLists[index] = move;
    moveScores[index] = score;
  }
  return moveLists[index];
}

function updateHistory(side: ChessSide, move: number, bonus: number): void {
  const slot = side * 4096 + (move & 4095);
  quietHistory[slot] += bonus - Math.trunc(quietHistory[slot] * Math.abs(bonus) / HISTORY_LIMIT);
}

function quiesce(searcher: Searcher, alpha: number, beta: number, ply: number): number {
  tick(searcher);
  const { state } = searcher;
  if (ply > searcher.selDepth) searcher.selDepth = ply;
  if (ply >= CHESS_MAX_PLY - 2) return chessEvaluate(state);
  if (deadDraw(state)) return 0;
  const pv = beta - alpha > 1;
  const slot = ttProbe(TABLE, state.hashLow, state.hashHigh);
  let hashMove = 0;
  if (slot >= 0) {
    hashMove = ttMove(TABLE, slot);
    const score = ttScoreFromStore(TABLE.scores[slot], ply, MATE_BOUND);
    const bound = ttBound(TABLE, slot);
    if (!pv && (bound === TT_EXACT || (bound === TT_LOWER && score >= beta) || (bound === TT_UPPER && score <= alpha))) return score;
  }
  const side = state.side;
  const inCheck = chessStateInCheck(state, side);
  let best = -INFINITE;
  let stand = 0;
  const alphaStart = alpha;
  if (!inCheck) {
    stand = slot >= 0 ? TABLE.evals[slot] : chessEvaluate(state);
    if (stand >= beta) {
      if (slot < 0) ttStore(TABLE, state.hashLow, state.hashHigh, 0, TT_LOWER, 0, ttScoreToStore(stand, ply, MATE_BOUND), stand);
      return stand;
    }
    if (stand > alpha) alpha = stand;
    best = stand;
  }
  const start = ply * MOVES_PER_PLY;
  const end = chessGenerateMoves(state, moveLists, start, !inCheck);
  scoreMoves(state, start, end, ply, hashMove);
  let legal = 0;
  let bestMove = 0;
  for (let index = start; index < end; index++) {
    const move = pick(index, end);
    if (!inCheck) {
      const promotion = (move >> 12) & 7;
      // Delta pruning: even winning the victim outright would not reach alpha.
      if (promotion === 0 && stand + victimValue(state, move) + 200 <= alpha) continue;
      if (moveScores[index] < 0 && promotion === 0) continue;
    }
    chessMakeMove(state, move);
    if (chessStateInCheck(state, side)) {
      chessUnmakeMove(state, move);
      continue;
    }
    legal++;
    moveStack[ply] = move;
    pieceStack[ply] = state.squares[(move >> 6) & 63];
    const score = -quiesce(searcher, -beta, -alpha, ply + 1);
    chessUnmakeMove(state, move);
    if (score > best) {
      best = score;
      if (score > alpha) {
        alpha = score;
        bestMove = move;
        if (alpha >= beta) break;
      }
    }
  }
  if (inCheck && legal === 0) return -MATE + ply;
  const bound = best >= beta ? TT_LOWER : best > alphaStart ? TT_EXACT : TT_UPPER;
  ttStore(TABLE, state.hashLow, state.hashHigh, 0, bound, bestMove, ttScoreToStore(best, ply, MATE_BOUND), inCheck ? 0 : stand);
  return best;
}

function search(searcher: Searcher, depth: number, alpha: number, beta: number, ply: number, nullAllowed: boolean): number {
  const { state } = searcher;
  const pv = beta - alpha > 1;
  const side = state.side;
  const inCheck = chessStateInCheck(state, side);
  if (depth <= 0 && !inCheck) return quiesce(searcher, alpha, beta, ply);
  tick(searcher);
  if (ply > searcher.selDepth) searcher.selDepth = ply;
  if (ply >= CHESS_MAX_PLY - 4) return chessEvaluate(state);
  if (depth < 1) depth = 1;
  if (ply > 0) {
    if (state.halfmove >= 100 || deadDraw(state) || chessRepetition(state) === 2) return 0;
    // Mate-distance pruning: no line from here beats a mate already found nearer the root.
    alpha = Math.max(alpha, -MATE + ply);
    beta = Math.min(beta, MATE - ply - 1);
    if (alpha >= beta) return alpha;
  }

  const slot = ttProbe(TABLE, state.hashLow, state.hashHigh);
  let hashMove = 0;
  let ttScore = 0;
  let ttBoundKind = 0;
  if (slot >= 0) {
    hashMove = ttMove(TABLE, slot);
    ttScore = ttScoreFromStore(TABLE.scores[slot], ply, MATE_BOUND);
    ttBoundKind = ttBound(TABLE, slot);
    if (!pv && ply > 0 && ttDepth(TABLE, slot) >= depth && (ttBoundKind === TT_EXACT
      || (ttBoundKind === TT_LOWER && ttScore >= beta) || (ttBoundKind === TT_UPPER && ttScore <= alpha))) {
      return ttScore;
    }
  }

  let staticEval = -INFINITE;
  let improving = false;
  if (!inCheck) {
    staticEval = slot >= 0 ? TABLE.evals[slot] : chessEvaluate(state);
    let estimate = staticEval;
    if (slot >= 0 && ((ttBoundKind === TT_LOWER && ttScore > estimate) || (ttBoundKind === TT_UPPER && ttScore < estimate)
      || ttBoundKind === TT_EXACT) && Math.abs(ttScore) < MATE_BOUND) {
      estimate = ttScore;
    }
    evalStack[ply] = staticEval;
    improving = ply >= 2 && evalStack[ply - 2] !== -INFINITE && staticEval > evalStack[ply - 2];

    if (!pv && ply > 0 && Math.abs(beta) < MATE_BOUND) {
      // Reverse futility: far enough above beta that a quiet reply will not bring it back.
      if (depth <= 7 && estimate - (improving ? 70 : 90) * depth >= beta) return estimate;
      // Null move: passing still fails high, so a real move surely does. Skipped with only pawns (zugzwang).
      if (nullAllowed && depth >= 3 && estimate >= beta && staticEval >= beta && sideHasPieces(state, side)) {
        const reduction = 3 + (depth >> 2) + Math.min(3, Math.trunc((estimate - beta) / 200));
        chessMakeNull(state);
        moveStack[ply] = 0;
        pieceStack[ply] = 0;
        let score: number;
        try {
          score = -search(searcher, depth - 1 - reduction, -beta, -beta + 1, ply + 1, false);
        } finally {
          chessUnmakeNull(state);
        }
        if (score >= beta) return score >= MATE_BOUND ? beta : score;
      }
      // Razoring: hopeless at the frontier unless a capture saves it.
      if (depth <= 2 && estimate + 250 * depth <= alpha) {
        const score = quiesce(searcher, alpha, alpha + 1, ply);
        if (score <= alpha) return score;
      }
    }
  } else {
    evalStack[ply] = -INFINITE;
  }

  // Internal iterative reduction: without a stored move this node was never searched well; spend less on it.
  if (hashMove === 0 && depth >= 4) depth--;

  const start = ply * MOVES_PER_PLY;
  const end = chessGenerateMoves(state, moveLists, start, false);
  scoreMoves(state, start, end, ply, hashMove);
  killers[(ply + 1) * 2] = 0;
  killers[(ply + 1) * 2 + 1] = 0;

  const alphaStart = alpha;
  let best = -INFINITE;
  let bestMove = 0;
  let legal = 0;
  let quiets = 0;
  const canPrune = ply > 0 && !inCheck && sideHasPieces(state, side);
  const lateMoves = depth <= 4 ? LATE_MOVE_COUNT[depth][improving ? 1 : 0] : 1_000;
  const futile = depth <= 6 && staticEval + 100 + 90 * depth <= alpha;
  for (let index = start; index < end; index++) {
    const move = pick(index, end);
    const promotion = (move >> 12) & 7;
    const capture = isCapture(state, move);
    const quiet = !capture && promotion === 0;
    const special = move === killers[ply * 2] || move === killers[ply * 2 + 1] || moveScores[index] >= 13_000_000;
    if (canPrune && best > -MATE_BOUND && legal > 0 && !quiet && depth <= 6 && moveScores[index] < 0
      && chessSee(state, move) < -110 * depth) continue;
    chessMakeMove(state, move);
    if (chessStateInCheck(state, side)) {
      chessUnmakeMove(state, move);
      continue;
    }
    legal++;
    const givesCheck = chessStateInCheck(state, state.side);
    // Quiet moves that do not check: prune late ones and those too far below alpha near the frontier.
    if (canPrune && quiet && !givesCheck && best > -MATE_BOUND && legal > 1 && (futile || quiets >= lateMoves)) {
      chessUnmakeMove(state, move);
      continue;
    }
    moveStack[ply] = move;
    pieceStack[ply] = state.squares[(move >> 6) & 63];
    const extension = givesCheck && ply < searcher.rootDepth * 2 ? 1 : 0;
    const next = depth - 1 + extension;
    let score: number;
    try {
      if (legal === 1) {
        score = -search(searcher, next, -beta, -alpha, ply + 1, true);
      } else {
        let reduction = 0;
        if (depth >= 3 && quiet && !inCheck && !givesCheck && legal > (pv ? 3 : 2)) {
          reduction = REDUCTION[Math.min(depth, 63) * 64 + Math.min(legal, 63)];
          if (pv) reduction--;
          if (!improving) reduction++;
          if (special) reduction--;
          reduction -= Math.trunc(quietHistory[side * 4096 + (move & 4095)] / 6_000);
          reduction = Math.max(0, Math.min(reduction, next - 1));
        }
        score = -search(searcher, next - reduction, -alpha - 1, -alpha, ply + 1, true);
        if (score > alpha && reduction > 0) score = -search(searcher, next, -alpha - 1, -alpha, ply + 1, true);
        if (score > alpha && score < beta) score = -search(searcher, next, -beta, -alpha, ply + 1, true);
      }
    } finally {
      chessUnmakeMove(state, move);
    }
    if (score > best) {
      best = score;
      if (score > alpha) {
        bestMove = move;
        alpha = score;
        if (alpha >= beta) {
          if (quiet) {
            if (killers[ply * 2] !== move) {
              killers[ply * 2 + 1] = killers[ply * 2];
              killers[ply * 2] = move;
            }
            const bonus = Math.min(depth * depth, 400);
            updateHistory(side, move, bonus);
            for (let tried = 0; tried < quiets && tried < 64; tried++) updateHistory(side, quietsTried[ply * 64 + tried], -bonus);
            if (ply > 0 && moveStack[ply - 1] !== 0) {
              counterMoves[(pieceStack[ply - 1] + 6) * 64 + ((moveStack[ply - 1] >> 6) & 63)] = move;
            }
          }
          break;
        }
      }
    }
    if (quiet) {
      if (quiets < 64) quietsTried[ply * 64 + quiets] = move;
      quiets++;
    }
  }
  if (legal === 0) return inCheck ? -MATE + ply : 0;
  if (best === -INFINITE) return alpha;
  const bound = best >= beta ? TT_LOWER : best > alphaStart ? TT_EXACT : TT_UPPER;
  ttStore(TABLE, state.hashLow, state.hashHigh, depth, bound, bestMove, ttScoreToStore(best, ply, MATE_BOUND),
    inCheck ? 0 : staticEval);
  return best;
}

// ─── Root ───

type RootKind = 'win' | 'draw' | 'open';

interface RootMove {
  readonly move: number;
  readonly kind: RootKind;
}

/** What the rules say right after `move`: an immediate win (checkmate), a draw by rule, or play on. */
function rootMoves(position: ChessPosition, history: readonly string[]): RootMove[] {
  const engine = chessRulesEngine(position);
  const earlier = [...history, chessPositionKey(position)];
  return chessLegalEngineMoves(engine).map((move) => {
    const verdict = chessVerdict(chessApply(position, chessDecode(move)), earlier);
    return { move, kind: verdict === null ? 'open' : verdict.loser === null ? 'draw' : 'win' };
  });
}

export interface ChessSearchOptions {
  /** Deepest iteration; the clock may end the search sooner. */
  readonly maxDepth: number;
  /** `timeLeftMs`, when given, lets the search stop early once another iteration would not finish. */
  readonly budget: Pick<SearchBudget, 'expired'> & Partial<Pick<SearchBudget, 'timeLeftMs'>>;
  readonly random: () => number;
  /** Plays from the opening book when the position is in it (default true). */
  readonly book?: boolean;
}

export interface ChessSearchResult {
  readonly move: ChessMove;
  /** Score for the side to move in centipawns; mates are near ±100000. */
  readonly score: number;
  /** Deepest completed iteration (0 for book and forced moves). */
  readonly depth: number;
  readonly nodes: number;
}

/**
 * Iterative deepening from the root: each iteration searches the previous best move first inside an aspiration
 * window, and a stopped iteration still counts once it has proved a better move. Mates in one are played at once
 * and moves the rules draw score zero. `history` holds the keys of the positions before `position`. Returns null
 * without a legal move or when `side` is not the one to move.
 */
export function chessAnalyse(
  position: ChessPosition, side: ChessSide, history: readonly string[], options: ChessSearchOptions,
): ChessSearchResult | null {
  if (side !== position.turn) return null;
  const roots = rootMoves(position, history);
  if (roots.length === 0) return null;
  const win = roots.find((entry) => entry.kind === 'win');
  if (win) return { move: chessDecode(win.move), score: MATE - 1, depth: 0, nodes: 0 };
  if (roots.length === 1) return { move: chessDecode(roots[0].move), score: 0, depth: 0, nodes: 0 };
  if (options.book !== false) {
    const book = chessBookMove(position, roots.map((entry) => entry.move), options.random);
    if (book !== null) return { move: chessDecode(book), score: 0, depth: 0, nodes: 0 };
  }

  const state = chessBoardState(position);
  chessSetHistory(state, history);
  const searcher: Searcher = { state, nodes: 0, expired: options.budget.expired, rootDepth: 1, selDepth: 0 };
  // Every search starts from empty tables, so a depth-limited search does not depend on what ran before it.
  ttNewSearch(TABLE);
  killers.fill(0);
  counterMoves.fill(0);
  quietHistory.fill(0);

  const order = Int32Array.from(roots.map((entry) => entry.move));
  const drawn = new Set(roots.filter((entry) => entry.kind === 'draw').map((entry) => entry.move));
  // Initial order: captures and queen promotions by exchange value, then the rest.
  const keys = new Map(roots.map((entry) => [entry.move, isCapture(state, entry.move) ? chessSee(state, entry.move) + 1_000
    : ((entry.move >> 12) & 7) === CHESS_QUEEN ? 900 : 0]));
  order.sort((a, b) => keys.get(b)! - keys.get(a)!);
  const result = iterativeDeepening({
    order, maxDepth: Math.min(options.maxDepth, CHESS_MAX_PLY / 2), infinite: INFINITE, mate: MATE, mateBound: MATE_BOUND,
    totalMs: options.budget.timeLeftMs?.() ?? Infinity,
    searchRoot: (depth, alpha, beta) => {
      searcher.rootDepth = depth;
      return searchRoot(searcher, order, drawn, depth, alpha, beta);
    },
  });
  return { move: chessDecode(result.move), score: result.score, depth: result.depth, nodes: searcher.nodes };
}

/** One pass over the root moves: the first with the full window, the rest with null windows and re-searches. */
function searchRoot(searcher: Searcher, order: Int32Array, drawn: ReadonlySet<number>, depth: number, alphaIn: number, beta: number): RootPass {
  const { state } = searcher;
  const side = state.side;
  let alpha = alphaIn;
  let best = -INFINITE;
  let bestMove = 0;
  const inCheck = chessStateInCheck(state, side);
  evalStack[0] = inCheck ? -INFINITE : chessEvaluate(state);
  try {
    for (let index = 0; index < order.length; index++) {
      const move = order[index];
      let score: number;
      if (drawn.has(move)) {
        score = 0;
      } else {
        chessMakeMove(state, move);
        moveStack[0] = move;
        pieceStack[0] = state.squares[(move >> 6) & 63];
        const givesCheck = chessStateInCheck(state, state.side);
        const next = depth - 1 + (givesCheck ? 1 : 0);
        try {
          if (index === 0) {
            score = -search(searcher, next, -beta, -alpha, 1, true);
          } else {
            const quiet = !givesCheck && state.undoCaptured[0] === 0 && ((move >> 12) & 7) === 0;
            const reduction = depth >= 3 && quiet && index >= 4 ? Math.max(0, REDUCTION[Math.min(depth, 63) * 64 + Math.min(index, 63)] - 1) : 0;
            score = -search(searcher, next - reduction, -alpha - 1, -alpha, 1, true);
            if (score > alpha && reduction > 0) score = -search(searcher, next, -alpha - 1, -alpha, 1, true);
            if (score > alpha && score < beta) score = -search(searcher, next, -beta, -alpha, 1, true);
          }
        } finally {
          chessUnmakeMove(state, move);
        }
      }
      if (score > best) {
        best = score;
        if (score > alpha) {
          bestMove = move;
          alpha = score;
          if (alpha >= beta) break;
        }
      }
    }
  } catch (error) {
    if (error !== STOP) throw error;
    return { move: best > alphaIn ? bestMove : 0, score: best, stopped: true };
  }
  return { move: bestMove !== 0 ? bestMove : order[0], score: best, stopped: false };
}

/** Quiescence score of `position` for the side to move: the tuner keeps positions where it equals the static score. */
export function chessQuiescence(position: ChessPosition): number {
  const searcher: Searcher = { state: chessBoardState(position), nodes: 0, expired: () => false, rootDepth: 1, selDepth: 0 };
  ttNewSearch(TABLE);
  return quiesce(searcher, -INFINITE, INFINITE, 0);
}

/** The best move found within the options' limits (see `chessAnalyse`). */
export function chessBestMove(
  position: ChessPosition, side: ChessSide, history: readonly string[], options: ChessSearchOptions,
): ChessMove | null {
  return chessAnalyse(position, side, history, options)?.move ?? null;
}

// ─── Bot actions from a view ───

/** The viewer's side, position, and earlier position keys when it is their turn in a running match, otherwise null. */
export function chessTurn(visible: ChessVisibleState): { side: ChessSide; position: ChessPosition; history: string[] } | null {
  const index = visible.seats.indexOf(visible.mySeat);
  if (index < 0 || visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat) return null;
  const side: ChessSide = index === 0 ? 0 : 1;
  const position: ChessPosition = {
    board: visible.board, turn: side, castling: visible.castling, enPassant: visible.enPassant, halfmove: visible.halfmove,
  };
  return { side, position, history: chessHistoryOfLog(visible.log) };
}

export function moveAction(move: ChessMove): BotAction {
  return {
    type: 'game-action',
    request: {
      gameType: 'chess',
      action: { type: 'move', from: chessNode(move.from), to: chessNode(move.to), ...move.promotion ? { promotion: move.promotion } : {} },
    },
  };
}

/** Plies the synchronous fallback may search, within `QUICK_BUDGET_MS`. */
export const QUICK_DEPTH = 8;
export const QUICK_BUDGET_MS = 150;

/** Search strategy for the bot worker pool. */
export function chessSearch(visible: ChessVisibleState, context: SearchContext): BotAction | null {
  const turn = chessTurn(visible);
  if (!turn) return null;
  const move = chessBestMove(turn.position, turn.side, turn.history, {
    maxDepth: context.budget.maxDepth ?? 64, budget: context.budget, random: context.random,
  });
  return move ? moveAction(move) : null;
}
