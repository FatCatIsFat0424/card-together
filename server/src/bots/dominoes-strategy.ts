import type { DominoesVisibleState, DominoPip, DominoTile } from '@shared/games/dominoes/types';
import {
  dmCompareHeavy, dmHandPips, dmHasPip, dmIsDouble, dmKnownVoids, dmPlacement, dmSameTile, dmTilePips, dmTurnOptions,
  DM_PIPS,
} from '@shared/rules/dominoes';
import type { DominoPlay, DominoTurnOptions } from '@shared/rules/dominoes';
import type { BotAction } from './bot-decisions';
import { dominoesKnowledge, maskPips, sampleDominoesWorld, tileId } from './dominoes-knowledge';
import type { DominoesKnowledge } from './dominoes-knowledge';
import {
  copyDominoesSim, dominoesMoves, dominoesRolloutMove, dominoesValues, playDominoes, SIDE_FIRST, SIDE_LEFT, SIDE_RIGHT,
  solveDominoes,
} from './dominoes-sim';
import type { DominoesMatch, DominoesSim } from './dominoes-sim';
import { determinizedSearch } from './search/determinized';
import type { Candidate, DeterminizedGame } from './search/determinized';
import type { SearchBudget, SearchContext } from './search/search-types';

// The Dominoes bot: a heuristic that ranks the legal plays, an exact solve of heads-up rounds once the boneyard
// is empty, and a determinized search over sampled deals (see `decideDominoes`). The worker entry in
// dominoes-search.ts runs the same decision with the worker's budget.

/** Solver nodes spent on a heads-up round with an empty boneyard before the search takes over, with and without a budget. */
const PERFECT_INFORMATION_NODES = 100_000;
const SYNC_PERFECT_INFORMATION_NODES = 10_000;
/** Deals per decision at most with a budget (the worker) and without one (the synchronous decision). */
const MAX_SAMPLES = 600;
const SYNC_SAMPLES = 32;
/** Fewer deals than this leave the decision to the heuristic. */
const MIN_SAMPLES = 16;
/** Standard errors within which two plays count as equal and the heuristic decides. */
const CONFIDENCE = 1;
/** Rollouts per candidate on each deal when the exact solver does not apply. */
const ROLLOUTS = 6;
const ROLLOUT_PLIES = 200;
/** Solver nodes per candidate on one deal before falling back to rollouts, with and without a budget. */
const SOLVER_NODES = 20_000;
const SYNC_SOLVER_NODES = 2_000;

function turnOptions(visible: DominoesVisibleState): DominoTurnOptions | null {
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat) return null;
  return dmTurnOptions(visible.myHand, visible.line, visible.boneyardCount, visible.openingTile);
}

function dominoesPlayAction(play: DominoPlay): BotAction {
  return {
    type: 'game-action',
    request: { gameType: 'dominoes', action: { type: 'play', tile: play.tile, ...(play.side ? { side: play.side } : {}) } },
  };
}

/** No playable tile: draw while the boneyard has one, otherwise pass. */
function drawOrPassAction(options: DominoTurnOptions): BotAction | null {
  if (options.canDraw) return { type: 'game-action', request: { gameType: 'dominoes', action: { type: 'draw' } } };
  return options.canPass ? { type: 'game-action', request: { gameType: 'dominoes', action: { type: 'pass' } } } : null;
}

/** The heaviest legal tile, as a timeout plays it. */
export function dominoesFirstLegalAction(visible: DominoesVisibleState): BotAction | null {
  const options = turnOptions(visible);
  if (!options) return null;
  const heaviest = [...options.plays].sort((a, b) => dmCompareHeavy(a.tile, b.tile))[0];
  return heaviest ? dominoesPlayAction(heaviest) : drawOrPassAction(options);
}

/** A rules play as a simulator move. */
function simMove(play: DominoPlay): number {
  return tileId(play.tile) * 4 + (play.side === null ? SIDE_FIRST : play.side === 'left' ? SIDE_LEFT : SIDE_RIGHT);
}

function dominoesMatch(visible: DominoesVisibleState, knowledge: DominoesKnowledge): DominoesMatch {
  return { scores: knowledge.seats.map((seat) => visible.scores[seat] ?? 0), target: visible.options.targetScore, round: visible.round };
}

/** Tiles holding `pip` that this seat can neither see in its hand nor on the line. */
function unseenWith(visible: DominoesVisibleState, pip: DominoPip): number {
  const seen = new Set<string>([...visible.myHand, ...visible.line.map((placed) => placed.tile)]
    .map((tile) => `${tile[0]}-${tile[1]}`));
  let unseen = 0;
  for (const other of DM_PIPS) {
    const tile: DominoTile = other < pip ? [other, pip] : [pip, other];
    if (!seen.has(`${tile[0]}-${tile[1]}`)) unseen++;
  }
  return unseen;
}

/**
 * Scores each legal play: shed heavy tiles and doubles early, keep a spread of numbers, and leave ends the
 * seat can continue on and opponents are known (from their draws and passes) or likely (from the tiles still
 * unseen) to lack. Also the search's prior.
 */
export function scoreDominoesPlays(
  visible: DominoesVisibleState, options: DominoTurnOptions,
): { readonly play: DominoPlay; readonly score: number }[] {
  const voids = dmKnownVoids(visible.log);
  const opponents = visible.seats.filter((seat) => seat !== visible.mySeat);
  const smallest = Math.min(...opponents.map((seat) => visible.handCounts[seat]));
  // An opponent close to going out makes every pip kept in hand a larger liability.
  const urgency = smallest <= 2 ? 1.6 : 1;
  const unseen = new Map<DominoPip, number>(DM_PIPS.map((pip) => [pip, unseenWith(visible, pip)]));
  return options.plays.map((play) => {
    const rest = visible.myHand.filter((tile) => !dmSameTile(tile, play.tile));
    if (rest.length === 0) return { play, score: 1000 };
    const placement = dmPlacement(play.tile, play.side, visible.line);
    const ends = placement
      ? visible.line.length === 0 ? [placement.left, placement.right]
        : play.side === 'left' ? [placement.left, visible.line[visible.line.length - 1].right]
          : [visible.line[0].left, placement.right]
      : [];
    let score = dmTilePips(play.tile) * 1.1 * urgency + (dmIsDouble(play.tile) ? 4 : 0);
    score += new Set(rest.flatMap((tile) => [tile[0], tile[1]])).size * 1.5;
    for (const end of ends) {
      score += rest.filter((tile) => dmHasPip(tile, end)).length * 1.4;
      score -= (unseen.get(end) ?? 0) * 0.45;
      score += opponents.filter((seat) => voids.get(seat)?.has(end)).length * 4;
    }
    // Keep the leftover hand light as well.
    score -= dmHandPips(rest) * 0.05;
    return { play, score };
  });
}

/** A full round state from the seat's view and a deal of the hidden tiles. */
function dominoesSimFrom(
  visible: DominoesVisibleState, knowledge: DominoesKnowledge, hands: Int32Array, boneyard: Int8Array,
): DominoesSim {
  const ends = visible.line.length === 0 ? null : { left: visible.line[0].left, right: visible.line[visible.line.length - 1].right };
  return {
    hands, pips: Int16Array.from(hands, maskPips), boneyard, boneTop: 0, left: ends ? ends.left : -1,
    right: ends ? ends.right : -1, turn: knowledge.mine, over: false, winner: -1, points: 0,
  };
}

/**
 * Heads-up with an empty boneyard every tile is placed (the opponent holds exactly the unseen ones), so the
 * rest of the round is solved exactly; null when that does not apply or is too large.
 */
function perfectInformationPlay(visible: DominoesVisibleState, options: DominoTurnOptions, nodes: number): DominoPlay | null {
  if (visible.seats.length !== 2 || visible.boneyardCount !== 0) return null;
  const knowledge = dominoesKnowledge(visible);
  const hands = new Int32Array(2);
  hands[knowledge.mine] = knowledge.own;
  hands[1 - knowledge.mine] = knowledge.unseen;
  const root = dominoesSimFrom(visible, knowledge, hands, new Int8Array(0));
  const match = dominoesMatch(visible, knowledge);
  let best: DominoPlay | null = null;
  let bestValue = -Infinity;
  const budget = Math.floor(nodes / options.plays.length);
  for (const play of options.plays) {
    const child = copyDominoesSim(root);
    playDominoes(child, simMove(play));
    const values = solveDominoes(child, match, budget);
    if (!values) return null;
    if (values[knowledge.mine] > bestValue) {
      bestValue = values[knowledge.mine];
      best = play;
    }
  }
  return best;
}

/** Mean seat value over `count` rollouts from `state`, which is left untouched. */
function rolloutValue(state: DominoesSim, seat: number, match: DominoesMatch, random: () => number, count: number): number {
  let total = 0;
  for (let index = 0; index < count; index++) {
    const run = copyDominoesSim(state);
    for (let ply = 0; ply < ROLLOUT_PLIES && !run.over; ply++) playDominoes(run, dominoesRolloutMove(run, random));
    total += dominoesValues(run, match)[seat];
  }
  return total / count;
}

/** The plug-in for the determinized search; reads the view only through `knowledge`. */
function dominoesGame(
  visible: DominoesVisibleState, knowledge: DominoesKnowledge, match: DominoesMatch, solverNodes = SOLVER_NODES,
): DeterminizedGame<DominoesSim, number> {
  return {
    seat: visible.mySeat,
    sample: (random) => {
      const world = sampleDominoesWorld(knowledge, random);
      return world ? { state: dominoesSimFrom(visible, knowledge, world.hands, world.boneyard) } : null;
    },
    copy: copyDominoesSim,
    legalMoves: (state) => dominoesMoves(state, []),
    play: playDominoes,
    rolloutMove: dominoesRolloutMove,
    isTerminal: (state) => state.over,
    utility: (state, seat) => dominoesValues(state, match)[knowledge.seats.indexOf(seat)],
    evaluate: (state, seat, random) => {
      const index = knowledge.seats.indexOf(seat);
      const exact = solveDominoes(state, match, solverNodes);
      return exact ? exact[index] : rolloutValue(state, index, match, random, ROLLOUTS);
    },
  };
}

const UNLIMITED: SearchBudget = { maxDepth: undefined, timeLeftMs: () => Infinity, expired: () => false };

/**
 * The bot's decision. Forced draws, passes, and single plays answer at once, and a heads-up round with an
 * empty boneyard is solved exactly. Otherwise each legal play is compared on deals of the hidden tiles that
 * fit every draw and pass (see dominoes-knowledge): once the boneyard is empty and few tiles remain the rest
 * of the round is solved exactly on the deal (each seat playing for its own match chances, so blocks and pip
 * races are read precisely), otherwise it is averaged over quick rollouts. Rounds are valued as the chance
 * of winning the match, so the target score shapes the play. Without a budget (`context` omitted) a fixed
 * small number of deals keeps the decision fast enough for the event loop.
 */
export function decideDominoes(
  visible: DominoesVisibleState, random: () => number, context?: SearchContext,
): BotAction | null {
  const options = turnOptions(visible);
  if (!options) return null;
  if (options.plays.length === 0) return drawOrPassAction(options);
  if (options.plays.length === 1) return dominoesPlayAction(options.plays[0]);
  const exact = perfectInformationPlay(visible, options, context ? PERFECT_INFORMATION_NODES : SYNC_PERFECT_INFORMATION_NODES);
  if (exact) return dominoesPlayAction(exact);
  const knowledge = dominoesKnowledge(visible);
  const scored = scoreDominoesPlays(visible, options);
  const candidates: Candidate<number>[] = scored.map(({ play, score }) => ({ move: simMove(play), prior: score }));
  const choice = determinizedSearch(
    dominoesGame(visible, knowledge, dominoesMatch(visible, knowledge), context ? SOLVER_NODES : SYNC_SOLVER_NODES), candidates,
    context ?? { random, budget: UNLIMITED },
    { maxSamples: context ? MAX_SAMPLES : SYNC_SAMPLES, minSamples: MIN_SAMPLES, confidence: CONFIDENCE },
  );
  const chosen = scored.find(({ play }) => simMove(play) === choice.move) ?? scored[0];
  return dominoesPlayAction(chosen.play);
}

/** The synchronous decision: the same search on a fixed small number of deals. */
export function getDominoesBotAction(visible: DominoesVisibleState, random: () => number): BotAction | null {
  return decideDominoes(visible, random);
}
