// ─── Iterative deepening with aspiration windows and time management, shared by the chess and xiangqi searches ───

/** Outcome of one pass over the root moves inside a window. */
export interface RootPass {
  /** Best move of the pass; for a stopped pass only a move that raised alpha, otherwise 0. */
  readonly move: number;
  readonly score: number;
  readonly stopped: boolean;
}

export interface DeepeningOptions {
  /** Root moves, best first; reordered in place so each iteration starts with the previous best. */
  readonly order: Int32Array;
  readonly maxDepth: number;
  /** Bound larger than any score. */
  readonly infinite: number;
  /** Mate score at ply 0 and the bound beyond which scores are mates. */
  readonly mate: number;
  readonly mateBound: number;
  /** Wall-clock budget, or Infinity when only the depth or a stop flag limits the search. */
  readonly totalMs: number;
  /** Searches every root move at `depth` inside (alpha, beta). */
  readonly searchRoot: (depth: number, alpha: number, beta: number) => RootPass;
}

export interface DeepeningResult {
  readonly move: number;
  readonly score: number;
  /** Deepest completed iteration. */
  readonly depth: number;
}

/** Initial half-width of the aspiration window, in centipawns. */
const ASPIRATION = 30;

/**
 * Deepens one ply at a time. From depth 5 each iteration starts in a narrow window around the previous score and
 * widens on failure. A pass cut short by the clock still counts once it proved a better move. Stops early after a
 * proven mate, or when the elapsed time suggests the next iteration would not finish (sooner when the best move
 * has been stable).
 */
export function iterativeDeepening(options: DeepeningOptions): DeepeningResult {
  const { order, infinite, mateBound } = options;
  const started = performance.now();
  let bestMove = order[0];
  let bestScore = -infinite;
  let completed = 0;
  let stable = 0;
  for (let depth = 1; depth <= options.maxDepth; depth++) {
    let delta = ASPIRATION;
    const narrow = depth >= 5 && Math.abs(bestScore) < mateBound;
    let alpha = narrow ? bestScore - delta : -infinite;
    let beta = narrow ? bestScore + delta : infinite;
    let iterationMove = 0;
    let iterationScore = -infinite;
    let stopped = false;
    for (;;) {
      const pass = options.searchRoot(depth, alpha, beta);
      if (pass.stopped) {
        if (pass.move !== 0) {
          iterationMove = pass.move;
          iterationScore = pass.score;
        }
        stopped = true;
        break;
      }
      if (pass.score <= alpha && alpha > -infinite) {
        beta = Math.trunc((alpha + beta) / 2);
        alpha = Math.max(pass.score - delta, -infinite);
      } else if (pass.score >= beta && beta < infinite) {
        iterationMove = pass.move;
        iterationScore = pass.score;
        beta = Math.min(pass.score + delta, infinite);
      } else {
        iterationMove = pass.move;
        iterationScore = pass.score;
        break;
      }
      delta += delta;
      if (delta > 1_000) {
        alpha = -infinite;
        beta = infinite;
      }
    }
    if (iterationMove !== 0) {
      stable = iterationMove === bestMove ? stable + 1 : 0;
      bestMove = iterationMove;
      bestScore = iterationScore;
      const at = order.indexOf(bestMove);
      if (at > 0) {
        order.copyWithin(1, 0, at);
        order[0] = bestMove;
      }
    }
    if (stopped) break;
    completed = depth;
    if (Math.abs(bestScore) >= mateBound && depth >= options.mate - Math.abs(bestScore) + 2) break;
    const elapsed = performance.now() - started;
    // An iteration costs a few times the previous one; past this share of the budget the next one rarely finishes.
    if (elapsed > options.totalMs * (stable >= 3 ? 0.4 : 0.65)) break;
  }
  return { move: bestMove, score: bestScore, depth: completed };
}
