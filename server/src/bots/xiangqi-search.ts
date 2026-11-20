// ─── Xiangqi search: principal-variation alpha-beta with a transposition table, pruning, and quiescence ───
//
// Same design as the chess search over the bot's own board (`xiangqi-engine.ts`): iterative deepening with
// aspiration windows, PVS, null-move pruning (only with a chariot or two attacking pieces, against zugzwang),
// late-move reductions and pruning, futility and SEE pruning, killer, counter-move and history ordering, check
// extensions, and a quiescence search of captures that answers checks with every evasion and also tries quiet
// checks at its first ply. Repetitions follow the house rules: a one-sided perpetual check loses, any other cycle
// draws. Root moves are classified with the shared rules first, so every returned move is one the server accepts.

import type { XiangqiVisibleState } from '@shared/types';
import * as xiangqiRules from '@shared/rules/xiangqi';
import type { XqBoard, XqMove, XqPly, XqSide } from '@shared/rules/xiangqi';
import type { SearchBudget, SearchContext } from './search/search-types';
import * as transposition from './search/transposition-table';
import { iterativeDeepening } from './search/iterative-deepening';
import type { RootPass } from './search/iterative-deepening';
import type { BotAction } from './bot-decisions';
import * as xiangqiEngine from './xiangqi-engine';
import type { XqBoardState } from './xiangqi-engine';
import * as xiangqiEval from './xiangqi-eval';
import { xiangqiBookMove } from './xiangqi-book';

// Imported bindings are read once into module constants: under the CommonJS loader every use of an imported
// binding is a getter call, which costs measurably in the search's inner loops.
const {
  XQ_CANNON, XQ_CHARIOT, XQ_HORSE, xqApply, xqEngineBoard, xqFrom, xqInCheckEngine, xqLegalEngineMoves, xqNode,
  xqOpponent, xqPlies, xqTo, xqVerdict,
} = xiangqiRules;
const {
  TT_EXACT, TT_LOWER, TT_UPPER, createTranspositionTable, ttBound, ttDepth, ttMove, ttNewSearch, ttProbe,
  ttScoreFromStore, ttScoreToStore, ttStore,
} = transposition;
const {
  XQ_MAX_PLY, XQ_QUIET_LIMIT, XQ_REPEAT_DRAW, XQ_REPEAT_LOSS, XQ_REPEAT_WIN, XQ_SEE_VALUE, xqBoardState,
  xqGenerateMoves, xqMakeMove, xqMakeNull, xqRepetition, xqSee, xqStateInCheck, xqUnmakeMove, xqUnmakeNull,
} = xiangqiEngine;
const { xiangqiEvaluate } = xiangqiEval;

const MATE = 100_000;
/** Scores beyond this are mates (or rule wins) found in the tree. */
const MATE_BOUND = MATE - 1_000;
/** A perpetual-check loss: decisive, but ranked below any real mate. */
const RULE_WIN = MATE - 600;
const INFINITE = 1_000_000;
const MOVES_PER_PLY = 128;

// ─── Search tables (module level, so a worker allocates them once) ───

const TABLE = createTranspositionTable(20);
const moveLists = new Int32Array(XQ_MAX_PLY * MOVES_PER_PLY);
const moveScores = new Int32Array(XQ_MAX_PLY * MOVES_PER_PLY);
const quietsTried = new Int32Array(XQ_MAX_PLY * 64);
const killers = new Int32Array(XQ_MAX_PLY * 2);
/** Quiet-move success by side × from × to. */
const quietHistory = new Int32Array(2 * 90 * 128);
/** Reply that refuted a move, by the moved piece (`code + 7`) and its target. */
const counterMoves = new Int32Array(15 * 90);
const moveStack = new Int32Array(XQ_MAX_PLY + 8);
const pieceStack = new Int8Array(XQ_MAX_PLY + 8);
const evalStack = new Int32Array(XQ_MAX_PLY + 8);

const REDUCTION: Uint8Array = (() => {
  const table = new Uint8Array(64 * 64);
  for (let depth = 1; depth < 64; depth++) {
    for (let count = 1; count < 64; count++) table[depth * 64 + count] = Math.floor(0.8 + Math.log(depth) * Math.log(count) / 2.2);
  }
  return table;
})();

const HISTORY_LIMIT = 16_384;
const LATE_MOVE_COUNT = [[0, 0], [4, 6], [6, 10], [10, 16], [16, 26]];

class Stop extends Error {}
const STOP = new Stop('search stopped');

interface Searcher {
  readonly state: XqBoardState;
  nodes: number;
  readonly expired: () => boolean;
  rootDepth: number;
}

function tick(searcher: Searcher): void {
  if ((++searcher.nodes & 1023) === 0 && searcher.expired()) throw STOP;
}

/** Null moves are safe only with real attacking power left (zugzwang decides many thin endings). */
function nullSafe(state: XqBoardState, side: XqSide): boolean {
  const sign = side === 0 ? 1 : -1;
  const { counts } = state;
  return counts[sign * XQ_CHARIOT + 7] > 0 || counts[sign * XQ_HORSE + 7] + counts[sign * XQ_CANNON + 7] >= 2;
}

/** Score of a repeated position for the side to move, or null when the position does not repeat. */
function repetitionScore(state: XqBoardState, ply: number): number | null {
  const outcome = xqRepetition(state);
  if (outcome === XQ_REPEAT_DRAW) return 0;
  if (outcome === XQ_REPEAT_WIN) return RULE_WIN - ply;
  if (outcome === XQ_REPEAT_LOSS) return -RULE_WIN + ply;
  return null;
}

function scoreMoves(state: XqBoardState, start: number, end: number, ply: number, hashMove: number): void {
  const { cells } = state;
  const side = state.side;
  const killerA = killers[ply * 2];
  const killerB = killers[ply * 2 + 1];
  const previous = ply > 0 ? moveStack[ply - 1] : 0;
  const counter = previous !== 0 ? counterMoves[(pieceStack[ply - 1] + 7) * 90 + (previous & 127)] : 0;
  for (let index = start; index < end; index++) {
    const move = moveLists[index];
    if (move === hashMove) {
      moveScores[index] = 30_000_000;
      continue;
    }
    const victim = cells[move & 127];
    if (victim !== 0) {
      const attacker = cells[move >> 7];
      const attackerValue = XQ_SEE_VALUE[attacker > 0 ? attacker : -attacker];
      const victimValue = XQ_SEE_VALUE[victim > 0 ? victim : -victim];
      const good = victimValue >= attackerValue || xqSee(state, move) >= 0;
      moveScores[index] = (good ? 20_000_000 : -2_000_000) + victimValue * 16 - attackerValue / 16;
    } else if (move === killerA) {
      moveScores[index] = 15_000_000;
    } else if (move === killerB) {
      moveScores[index] = 14_000_000;
    } else if (move === counter) {
      moveScores[index] = 13_000_000;
    } else {
      moveScores[index] = quietHistory[side * 11_520 + move];
    }
  }
}

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

function updateHistory(side: XqSide, move: number, bonus: number): void {
  const slot = side * 11_520 + move;
  quietHistory[slot] += bonus - Math.trunc(quietHistory[slot] * Math.abs(bonus) / HISTORY_LIMIT);
}

/**
 * Captures (SEE-safe, within reach of alpha) until quiet; in check every evasion. At the first ply quiet checks
 * are tried too, since xiangqi tactics run on checks.
 */
function quiesce(searcher: Searcher, alpha: number, beta: number, ply: number, checks: boolean): number {
  tick(searcher);
  const { state } = searcher;
  if (ply >= XQ_MAX_PLY - 2) return xiangqiEvaluate(state);
  const repeated = repetitionScore(state, ply);
  if (repeated !== null) return repeated;
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
  const inCheck = xqStateInCheck(state, side);
  let best = -INFINITE;
  let stand = 0;
  const alphaStart = alpha;
  if (!inCheck) {
    stand = slot >= 0 ? TABLE.evals[slot] : xiangqiEvaluate(state);
    if (stand >= beta) {
      if (slot < 0) ttStore(TABLE, state.hashLow, state.hashHigh, 0, TT_LOWER, 0, ttScoreToStore(stand, ply, MATE_BOUND), stand);
      return stand;
    }
    if (stand > alpha) alpha = stand;
    best = stand;
  }
  const tryChecks = checks && !inCheck && stand + 150 > alpha;
  const start = ply * MOVES_PER_PLY;
  const end = xqGenerateMoves(state, moveLists, start, !inCheck && !tryChecks);
  scoreMoves(state, start, end, ply, hashMove);
  let legal = 0;
  let bestMove = 0;
  for (let index = start; index < end; index++) {
    const move = pick(index, end);
    const victim = state.cells[move & 127];
    if (!inCheck && victim !== 0) {
      if (stand + XQ_SEE_VALUE[victim > 0 ? victim : -victim] + 200 <= alpha) continue;
      if (moveScores[index] < 0) continue;
    }
    xqMakeMove(state, move);
    if (xqStateInCheck(state, side)) {
      xqUnmakeMove(state, move);
      continue;
    }
    const givesCheck = xqStateInCheck(state, state.side);
    // Without check, a quiet move is searched only as a checking move at the first ply.
    if (!inCheck && victim === 0 && !givesCheck) {
      xqUnmakeMove(state, move);
      continue;
    }
    state.checks[state.historyLength] = givesCheck ? 1 : 0;
    legal++;
    moveStack[ply] = move;
    pieceStack[ply] = state.cells[move & 127];
    let score: number;
    try {
      score = -quiesce(searcher, -beta, -alpha, ply + 1, false);
    } finally {
      xqUnmakeMove(state, move);
    }
    if (score > best) {
      best = score;
      if (score > alpha) {
        alpha = score;
        bestMove = move;
        if (alpha >= beta) break;
      }
    }
  }
  // Checkmate and stalemate both lose; only an evasion search sees every move.
  if (inCheck && legal === 0) return -MATE + ply;
  const bound = best >= beta ? TT_LOWER : best > alphaStart ? TT_EXACT : TT_UPPER;
  ttStore(TABLE, state.hashLow, state.hashHigh, 0, bound, bestMove, ttScoreToStore(best, ply, MATE_BOUND), inCheck ? 0 : stand);
  return best;
}

function search(searcher: Searcher, depth: number, alpha: number, beta: number, ply: number, nullAllowed: boolean): number {
  const { state } = searcher;
  const pv = beta - alpha > 1;
  const side = state.side;
  const inCheck = xqStateInCheck(state, side);
  if (depth <= 0 && !inCheck) return quiesce(searcher, alpha, beta, ply, true);
  tick(searcher);
  if (ply >= XQ_MAX_PLY - 4) return xiangqiEvaluate(state);
  if (depth < 1) depth = 1;
  if (ply > 0) {
    const repeated = repetitionScore(state, ply);
    if (repeated !== null) return repeated;
    if (state.quiet >= XQ_QUIET_LIMIT) return 0;
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
    staticEval = slot >= 0 ? TABLE.evals[slot] : xiangqiEvaluate(state);
    let estimate = staticEval;
    if (slot >= 0 && ((ttBoundKind === TT_LOWER && ttScore > estimate) || (ttBoundKind === TT_UPPER && ttScore < estimate)
      || ttBoundKind === TT_EXACT) && Math.abs(ttScore) < MATE_BOUND) {
      estimate = ttScore;
    }
    evalStack[ply] = staticEval;
    improving = ply >= 2 && evalStack[ply - 2] !== -INFINITE && staticEval > evalStack[ply - 2];
    if (!pv && ply > 0 && Math.abs(beta) < MATE_BOUND) {
      if (depth <= 7 && estimate - (improving ? 80 : 100) * depth >= beta) return estimate;
      if (nullAllowed && depth >= 3 && estimate >= beta && staticEval >= beta && nullSafe(state, side)) {
        const reduction = 3 + (depth >> 2) + Math.min(3, Math.trunc((estimate - beta) / 200));
        xqMakeNull(state);
        moveStack[ply] = 0;
        pieceStack[ply] = 0;
        let score: number;
        try {
          score = -search(searcher, depth - 1 - reduction, -beta, -beta + 1, ply + 1, false);
        } finally {
          xqUnmakeNull(state);
        }
        if (score >= beta) return score >= MATE_BOUND ? beta : score;
      }
      if (depth <= 2 && estimate + 300 * depth <= alpha) {
        const score = quiesce(searcher, alpha, alpha + 1, ply, true);
        if (score <= alpha) return score;
      }
    }
  } else {
    evalStack[ply] = -INFINITE;
  }

  if (hashMove === 0 && depth >= 4) depth--;

  const start = ply * MOVES_PER_PLY;
  const end = xqGenerateMoves(state, moveLists, start, false);
  scoreMoves(state, start, end, ply, hashMove);
  killers[(ply + 1) * 2] = 0;
  killers[(ply + 1) * 2 + 1] = 0;

  const alphaStart = alpha;
  let best = -INFINITE;
  let bestMove = 0;
  let legal = 0;
  let quiets = 0;
  const canPrune = ply > 0 && !inCheck && nullSafe(state, side);
  const lateMoves = depth <= 4 ? LATE_MOVE_COUNT[depth][improving ? 1 : 0] : 1_000;
  const futile = depth <= 6 && staticEval + 120 + 100 * depth <= alpha;
  for (let index = start; index < end; index++) {
    const move = pick(index, end);
    const quiet = state.cells[move & 127] === 0;
    const special = moveScores[index] >= 13_000_000;
    if (canPrune && best > -MATE_BOUND && legal > 0 && !quiet && depth <= 6 && moveScores[index] < 0
      && xqSee(state, move) < -120 * depth) continue;
    xqMakeMove(state, move);
    if (xqStateInCheck(state, side)) {
      xqUnmakeMove(state, move);
      continue;
    }
    legal++;
    const givesCheck = xqStateInCheck(state, state.side);
    if (canPrune && quiet && !givesCheck && best > -MATE_BOUND && legal > 1 && (futile || quiets >= lateMoves)) {
      xqUnmakeMove(state, move);
      continue;
    }
    state.checks[state.historyLength] = givesCheck ? 1 : 0;
    moveStack[ply] = move;
    pieceStack[ply] = state.cells[move & 127];
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
          reduction -= Math.trunc(quietHistory[side * 11_520 + move] / 6_000);
          reduction = Math.max(0, Math.min(reduction, next - 1));
        }
        score = -search(searcher, next - reduction, -alpha - 1, -alpha, ply + 1, true);
        if (score > alpha && reduction > 0) score = -search(searcher, next, -alpha - 1, -alpha, ply + 1, true);
        if (score > alpha && score < beta) score = -search(searcher, next, -beta, -alpha, ply + 1, true);
      }
    } finally {
      xqUnmakeMove(state, move);
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
            if (ply > 0 && moveStack[ply - 1] !== 0) counterMoves[(pieceStack[ply - 1] + 7) * 90 + (moveStack[ply - 1] & 127)] = move;
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
  // No legal move loses, whether checkmated or stalemated.
  if (legal === 0) return -MATE + ply;
  if (best === -INFINITE) return alpha;
  const bound = best >= beta ? TT_LOWER : best > alphaStart ? TT_EXACT : TT_UPPER;
  ttStore(TABLE, state.hashLow, state.hashHigh, depth, bound, bestMove, ttScoreToStore(best, ply, MATE_BOUND), inCheck ? 0 : staticEval);
  return best;
}

// ─── Root ───

type RootKind = 'win' | 'loss' | 'draw' | 'open';

/** What the rules say right after `move`: an immediate win, a perpetual-check loss, a forced draw, or play on. */
function classifyRoot(board: XqBoard, side: XqSide, plies: readonly XqPly[], move: XqMove): RootKind {
  const piece = board[move.from]!;
  const after = xqApply(board, move.from, move.to);
  const check = xqInCheckEngine(xqEngineBoard(after), xqOpponent(side));
  const verdict = xqVerdict(after, xqOpponent(side), [...plies, {
    from: move.from, to: move.to, piece, captured: board[move.to], check,
  }]);
  if (verdict === null) return 'open';
  if (verdict.loser === null) return 'draw';
  return verdict.loser === side ? 'loss' : 'win';
}

interface RootMove {
  readonly move: number;
  readonly kind: RootKind;
}

/**
 * Legal root moves with their rule outcome. Moves that lose by perpetual check are dropped while any other move
 * exists; the server would accept them, but a bot must not throw the game away.
 */
function rootMoves(board: XqBoard, side: XqSide, plies: readonly XqPly[]): RootMove[] {
  const legal = xqLegalEngineMoves(xqEngineBoard(board), side)
    .map((move) => ({ move, kind: classifyRoot(board, side, plies, { from: xqFrom(move), to: xqTo(move) }) }));
  const safe = legal.filter((entry) => entry.kind !== 'loss');
  return safe.length > 0 ? safe : legal;
}

export interface XiangqiSearchOptions {
  readonly maxDepth: number;
  readonly expired: () => boolean;
  /** Milliseconds left, when known, so the search can stop once another iteration would not finish. */
  readonly timeLeftMs?: SearchBudget['timeLeftMs'];
  readonly random: () => number;
  /** Plays from the opening book when the position is in it (default true). */
  readonly book?: boolean;
}

export interface XiangqiSearchResult {
  readonly move: XqMove;
  readonly score: number;
  readonly depth: number;
  readonly nodes: number;
}

function searchRoot(searcher: Searcher, order: Int32Array, drawn: ReadonlySet<number>, depth: number, alphaIn: number, beta: number): RootPass {
  const { state } = searcher;
  let alpha = alphaIn;
  let best = -INFINITE;
  let bestMove = 0;
  evalStack[0] = xqStateInCheck(state, state.side) ? -INFINITE : xiangqiEvaluate(state);
  try {
    for (let index = 0; index < order.length; index++) {
      const move = order[index];
      let score: number;
      if (drawn.has(move)) {
        score = 0;
      } else {
        const capture = state.cells[move & 127] !== 0;
        xqMakeMove(state, move);
        const givesCheck = xqStateInCheck(state, state.side);
        state.checks[state.historyLength] = givesCheck ? 1 : 0;
        moveStack[0] = move;
        pieceStack[0] = state.cells[move & 127];
        const next = depth - 1 + (givesCheck ? 1 : 0);
        try {
          if (index === 0) {
            score = -search(searcher, next, -beta, -alpha, 1, true);
          } else {
            const reduction = depth >= 3 && !capture && !givesCheck && index >= 4
              ? Math.max(0, REDUCTION[Math.min(depth, 63) * 64 + Math.min(index, 63)] - 1) : 0;
            score = -search(searcher, next - reduction, -alpha - 1, -alpha, 1, true);
            if (score > alpha && reduction > 0) score = -search(searcher, next, -alpha - 1, -alpha, 1, true);
            if (score > alpha && score < beta) score = -search(searcher, next, -beta, -alpha, 1, true);
          }
        } finally {
          xqUnmakeMove(state, move);
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

/**
 * Iterative deepening from the root (see `iterativeDeepening`). A move that wins on the spot is played at once,
 * moves the rules draw score zero, and moves that would lose by perpetual check are never chosen while another
 * exists. Returns null without a legal move.
 */
export function xiangqiAnalyse(board: XqBoard, side: XqSide, plies: readonly XqPly[], options: XiangqiSearchOptions): XiangqiSearchResult | null {
  const roots = rootMoves(board, side, plies);
  if (roots.length === 0) return null;
  const decode = (move: number): XqMove => ({ from: xqFrom(move), to: xqTo(move) });
  const win = roots.find((entry) => entry.kind === 'win');
  if (win) return { move: decode(win.move), score: MATE - 1, depth: 0, nodes: 0 };
  if (roots.length === 1) return { move: decode(roots[0].move), score: 0, depth: 0, nodes: 0 };
  const state = xqBoardState(board, side, plies);
  if (options.book !== false) {
    const book = xiangqiBookMove(state, roots.map((entry) => entry.move), options.random);
    if (book !== null) return { move: decode(book), score: 0, depth: 0, nodes: 0 };
  }

  const searcher: Searcher = { state, nodes: 0, expired: options.expired, rootDepth: 1 };
  // Every search starts from empty tables, so a depth-limited search does not depend on what ran before it.
  ttNewSearch(TABLE);
  killers.fill(0);
  counterMoves.fill(0);
  quietHistory.fill(0);

  const order = Int32Array.from(roots.map((entry) => entry.move));
  const drawn = new Set(roots.filter((entry) => entry.kind === 'draw').map((entry) => entry.move));
  const keys = new Map(roots.map((entry) => [entry.move, state.cells[entry.move & 127] !== 0 ? xqSee(state, entry.move) + 1_000 : 0]));
  order.sort((a, b) => keys.get(b)! - keys.get(a)!);
  const result = iterativeDeepening({
    order, maxDepth: Math.min(options.maxDepth, XQ_MAX_PLY / 2), infinite: INFINITE, mate: MATE, mateBound: MATE_BOUND,
    totalMs: options.timeLeftMs?.() ?? Infinity,
    searchRoot: (depth, alpha, beta) => {
      searcher.rootDepth = depth;
      return searchRoot(searcher, order, drawn, depth, alpha, beta);
    },
  });
  return { move: decode(result.move), score: result.score, depth: result.depth, nodes: searcher.nodes };
}

/** Quiescence score for the side to move: the tuner keeps positions where it equals the static score. */
export function xiangqiQuiescence(board: XqBoard, side: XqSide): number {
  const searcher: Searcher = { state: xqBoardState(board, side, []), nodes: 0, expired: () => false, rootDepth: 1 };
  ttNewSearch(TABLE);
  return quiesce(searcher, -INFINITE, INFINITE, 0, true);
}

/** The best move found within the options' limits (see `xiangqiAnalyse`). */
export function xiangqiBestMove(board: XqBoard, side: XqSide, plies: readonly XqPly[], options: XiangqiSearchOptions): XqMove | null {
  return xiangqiAnalyse(board, side, plies, options)?.move ?? null;
}

// ─── Bot actions from a view ───

/** The viewer's side, board, and history when it is their turn in a running match, otherwise null. */
export function xiangqiTurn(visible: XiangqiVisibleState): { side: XqSide; board: XqBoard; plies: XqPly[] } | null {
  const index = visible.seats.indexOf(visible.mySeat);
  if (index < 0 || visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat) return null;
  return { side: index === 0 ? 0 : 1, board: visible.board, plies: xqPlies(visible.log) };
}

export function moveAction(move: XqMove): BotAction {
  return {
    type: 'game-action',
    request: { gameType: 'xiangqi', action: { type: 'move', from: xqNode(move.from), to: xqNode(move.to) } },
  };
}

/** Plies the synchronous fallback may search, within `QUICK_BUDGET_MS`. */
export const QUICK_DEPTH = 8;
export const QUICK_BUDGET_MS = 150;

/** Search strategy for the bot worker pool. */
export function xiangqiSearch(visible: XiangqiVisibleState, context: SearchContext): BotAction | null {
  const turn = xiangqiTurn(visible);
  if (!turn) return null;
  const move = xiangqiBestMove(turn.board, turn.side, turn.plies, {
    maxDepth: context.budget.maxDepth ?? 64, expired: context.budget.expired, timeLeftMs: context.budget.timeLeftMs,
    random: context.random,
  });
  return move ? moveAction(move) : null;
}
