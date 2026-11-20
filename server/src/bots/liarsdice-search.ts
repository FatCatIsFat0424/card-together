import type { DiceFace, GameSeat, LiarsDiceVisibleState } from '@shared/types';
import { LDI_FACES, LDI_FACE_ORDER, LDI_WILD_FACE } from '@shared/rules/liarsdice';
import type { BotAction } from './bot-decisions';
import { cupPosterior, diceHistory, estimateSharpness, sampleCup } from './liarsdice-belief';
import type { CupPosterior, FaceCounts } from './liarsdice-belief';
import { determinizedSearch } from './search/determinized';
import type { Candidate, DeterminizedGame } from './search/determinized';
import type { SearchContext } from './search/search-types';

// Determinized search over the bid or call. Each sample fills the other cups from the belief (see
// liarsdice-belief), plays a candidate on that world, lets the other seats answer with a quick bidding policy
// until someone calls, and scores the round by the chance of winning the match from the dice counts left.
// The same worlds and policy draws judge every candidate, so a raise is weighed against the calls and
// counter-raises it invites, and a bluff pays only where the worlds show it surviving.

/** Moves: 0 is a call, otherwise `quantity * 8 + face`. */
const CALL = 0;
const FACE_STRIDE = 8;

/** Bids per face the search examines, from the lowest legal quantity up. */
const RAISES_PER_FACE = 3;
const MAX_SAMPLES = 4_000;
const MIN_SAMPLES = 24;
const CONFIDENCE = 1;
/** Chance credited to a bidder of holding at least one die of the face it named, as in the quick policy. */
const BIDDER_HOLDS_ONE = 0.5;
const UNCALLED_VALUE = 0.5;
const MIN_CALL_CHANCE = 0.05;
/** Quick-policy scores this close to the best are chosen between at random. */
const POLICY_MARGIN = 0.02;
const MAX_TOTAL_DICE = 40;
/** Each world's table calls with a value shifted by up to this much, so no single opponent style decides a bid. */
const CALL_BIAS_RANGE = 0.1;

/** The round in play with every cup known. */
interface DiceSim {
  /** Faces per seat, `seat * 7 + face`; shared by every copy because cups never change in a round */
  readonly held: Int8Array;
  readonly size: Int8Array;
  readonly faceTotal: Int8Array;
  readonly total: number;
  bidQuantity: number;
  bidFace: number;
  bidder: number;
  wild: boolean;
  turn: number;
  done: boolean;
  loser: number;
  /** How much more or less readily this world's table calls, added to the value of a call */
  readonly callBias: number;
}

const STRIDE = LDI_FACES + 1;
const tails: Float64Array[] = [];

/** Chance that at least `need` of `trials` dice match, with match chance 1/6 (`kind` 0) or 1/3 (`kind` 1). */
function tail(trials: number, kind: number, need: number): number {
  if (need <= 0) return 1;
  if (need > trials) return 0;
  let table = tails[kind];
  if (!table) {
    const chance = kind === 0 ? 1 / 6 : 1 / 3;
    table = new Float64Array((MAX_TOTAL_DICE + 1) * (MAX_TOTAL_DICE + 2));
    for (let n = 0; n <= MAX_TOTAL_DICE; n++) {
      // cell(n, k): chance of at least k matches among n dice
      let mass = (1 - chance) ** n;
      let below = 0;
      for (let hits = 0; hits <= n + 1; hits++) {
        table[n * (MAX_TOTAL_DICE + 2) + hits] = Math.min(1, Math.max(0, 1 - below));
        below += mass;
        mass *= hits < n ? ((n - hits) / (hits + 1)) * (chance / (1 - chance)) : 0;
      }
    }
    tails[kind] = table;
  }
  return table[trials * (MAX_TOTAL_DICE + 2) + need];
}

const kindOf = (face: number, wild: boolean): number => (wild && face !== LDI_WILD_FACE ? 1 : 0);

function ownMatches(state: DiceSim, seat: number, face: number, wild: boolean): number {
  const base = seat * STRIDE;
  return state.held[base + face] + (wild && face !== LDI_WILD_FACE ? state.held[base + LDI_WILD_FACE] : 0);
}

const rankOf = (face: number): number => LDI_FACE_ORDER.indexOf(face as DiceFace);

/** The lowest quantity that outbids the standing bid with `face`, or 0 when none fits the dice in play. */
function lowestQuantity(state: DiceSim, face: number): number {
  let quantity = 1;
  if (state.bidder >= 0) quantity = rankOf(face) > rankOf(state.bidFace) ? state.bidQuantity : state.bidQuantity + 1;
  return quantity <= state.total ? quantity : 0;
}

/** Chance the standing bid holds in the eyes of the seat that must answer it, crediting the bidder a die. */
function standingHolds(state: DiceSim, seat: number): number {
  const unknown = state.total - state.size[seat];
  const kind = kindOf(state.bidFace, state.wild);
  const need = state.bidQuantity - ownMatches(state, seat, state.bidFace, state.wild);
  return BIDDER_HOLDS_ONE * tail(Math.max(0, unknown - 1), kind, need - 1) + (1 - BIDDER_HOLDS_ONE) * tail(unknown, kind, need);
}

interface ScoredMove {
  readonly move: number;
  readonly score: number;
}

/**
 * What the quick policy thinks of each move for the seat to act, from that seat's own dice alone: a call is worth
 * the chance the bid is false, a raise the chance it holds if called plus a neutral value if the table lets it
 * stand, with the table judged to call as often as the raise looks false.
 */
function scoreMoves(state: DiceSim, seat: number, perFace: number): ScoredMove[] {
  const moves: ScoredMove[] = [];
  if (state.bidder >= 0) moves.push({ move: CALL, score: 1 - standingHolds(state, seat) + state.callBias });
  const unknown = state.total - state.size[seat];
  for (const face of LDI_FACE_ORDER) {
    const lowest = lowestQuantity(state, face);
    if (lowest === 0) continue;
    const wildAfter = state.wild && face !== LDI_WILD_FACE;
    const kind = kindOf(face, state.wild);
    for (let step = 0; step < perFace; step++) {
      const quantity = lowest + step;
      if (quantity > state.total) break;
      const called = Math.max(MIN_CALL_CHANCE, 1 - tail(state.total, kind, quantity));
      const holds = tail(unknown, kind, quantity - ownMatches(state, seat, face, wildAfter));
      moves.push({ move: quantity * FACE_STRIDE + face, score: called * holds + (1 - called) * UNCALLED_VALUE });
    }
  }
  return moves;
}

/** Near-best choice weighted like `selectNearBest`, without allocating. */
function pickNearBest(moves: readonly ScoredMove[], random: () => number): number {
  let best = -Infinity;
  for (const entry of moves) if (entry.score > best) best = entry.score;
  let sum = 0;
  for (const entry of moves) if (entry.score >= best - POLICY_MARGIN) sum += 1 / (1 + best - entry.score);
  let ticket = random() * sum;
  let last = CALL;
  for (const entry of moves) {
    if (entry.score < best - POLICY_MARGIN) continue;
    last = entry.move;
    ticket -= 1 / (1 + best - entry.score);
    if (ticket < 0) break;
  }
  return last;
}

function rolloutMove(state: DiceSim, random: () => number): number {
  const moves = scoreMoves(state, state.turn, 2);
  return moves.length === 0 ? CALL : pickNearBest(moves, random);
}

function playMove(state: DiceSim, move: number): void {
  if (move === CALL) {
    const face = state.bidFace;
    const count = state.faceTotal[face] + (state.wild && face !== LDI_WILD_FACE ? state.faceTotal[LDI_WILD_FACE] : 0);
    state.loser = count >= state.bidQuantity ? state.turn : state.bidder;
    state.done = true;
    return;
  }
  state.bidQuantity = Math.floor(move / FACE_STRIDE);
  state.bidFace = move % FACE_STRIDE;
  state.bidder = state.turn;
  state.wild = state.wild && state.bidFace !== LDI_WILD_FACE;
  state.turn = (state.turn + 1) % state.size.length;
}

function legalMoves(state: DiceSim): number[] {
  const moves: number[] = state.bidder >= 0 ? [CALL] : [];
  for (const face of LDI_FACE_ORDER) {
    for (let quantity = lowestQuantity(state, face); quantity > 0 && quantity <= state.total; quantity++) {
      moves.push(quantity * FACE_STRIDE + face);
    }
  }
  return moves;
}

const winCache = new Map<string, number[]>();

/**
 * Each seat's chance of winning from the dice counts, if every later round were lost by a seat chosen uniformly
 * among those still alive. Counts are solved as sorted multisets, so every table shares a few hundred states.
 */
export function winChances(sizes: readonly number[]): number[] {
  const seats = sizes.map((size, index) => ({ size, index })).filter((seat) => seat.size > 0)
    .sort((a, b) => b.size - a.size || a.index - b.index);
  const solved = solveSorted(seats.map((seat) => seat.size));
  const chances = sizes.map(() => 0);
  seats.forEach((seat, position) => { chances[seat.index] = solved[position]; });
  return chances;
}

function solveSorted(sorted: readonly number[]): number[] {
  if (sorted.length === 1) return [1];
  const key = sorted.join(',');
  const cached = winCache.get(key);
  if (cached) return cached;
  const result = sorted.map(() => 0);
  for (let loser = 0; loser < sorted.length; loser++) {
    const after = sorted.map((size, index) => ({ size: index === loser ? size - 1 : size, index }))
      .filter((seat) => seat.size > 0).sort((a, b) => b.size - a.size || a.index - b.index);
    const next = solveSorted(after.map((seat) => seat.size));
    after.forEach((seat, position) => { result[seat.index] += next[position] / sorted.length; });
  }
  winCache.set(key, result);
  return result;
}

interface Setup {
  readonly seats: readonly GameSeat[];
  readonly mine: number;
  readonly posteriors: readonly (CupPosterior | null)[];
  readonly size: Int8Array;
  readonly total: number;
  /** My chance of winning if each seat loses the round's die */
  readonly afterLoss: readonly number[];
  /** My chance of winning with the dice as they stand */
  readonly standing: number;
}

function setupFor(visible: LiarsDiceVisibleState): Setup {
  const seats = visible.seats.filter((seat) => visible.diceCounts[seat] > 0);
  const history = diceHistory(visible);
  const sharpness = estimateSharpness(history, visible.mySeat);
  const mine = seats.indexOf(visible.mySeat);
  const size = Int8Array.from(seats, (seat) => visible.diceCounts[seat]);
  const posteriors = seats.map((seat) => (seat === visible.mySeat ? null
    : cupPosterior(visible.diceCounts[seat], history.current.filter((bid) => bid.seat === seat), sharpness)));
  const afterLoss = seats.map((_, loser) => winChances(Array.from(size, (count, index) => (index === loser ? count - 1 : count)))[mine]);
  return { seats, mine, posteriors, size, total: size.reduce((sum, count) => sum + count, 0), afterLoss, standing: winChances(Array.from(size))[mine] };
}

function simFor(
  visible: LiarsDiceVisibleState, setup: Setup, cups: readonly (FaceCounts | null)[], callBias: number,
): DiceSim {
  const held = new Int8Array(setup.seats.length * STRIDE);
  const faceTotal = new Int8Array(STRIDE);
  setup.seats.forEach((_, seat) => {
    const cup = cups[seat];
    for (let face = 1; face <= LDI_FACES; face++) {
      const count = cup ? cup[face] : visible.myDice.filter((die) => die === face).length;
      held[seat * STRIDE + face] = count;
      faceTotal[face] += count;
    }
  });
  const standing = visible.bid;
  return {
    held, size: setup.size, faceTotal, total: setup.total,
    bidQuantity: standing?.quantity ?? 0, bidFace: standing?.face ?? 0,
    bidder: standing ? setup.seats.indexOf(standing.seat) : -1, wild: visible.onesWild,
    turn: setup.mine, done: false, loser: -1, callBias,
  };
}

function diceGame(visible: LiarsDiceVisibleState, setup: Setup): DeterminizedGame<DiceSim, number> {
  return {
    seat: visible.mySeat,
    sample: (random) => ({
      state: simFor(
        visible, setup, setup.posteriors.map((posterior) => (posterior ? sampleCup(posterior, random) : null)),
        (random() + random() - 1) * CALL_BIAS_RANGE,
      ),
    }),
    copy: (state) => ({ ...state }),
    legalMoves,
    play: playMove,
    rolloutMove,
    isTerminal: (state) => state.done,
    utility: (state) => (state.done ? setup.afterLoss[state.loser] : setup.standing),
  };
}

function action(request: { type: 'bid'; quantity: number; face: DiceFace } | { type: 'challenge' }): BotAction {
  return { type: 'game-action', request: { gameType: 'liarsdice', action: request } };
}

export const bidMove = (quantity: number, face: DiceFace): number => quantity * FACE_STRIDE + face;

export const callAction = (): BotAction => action({ type: 'challenge' });

export function moveAction(move: number): BotAction {
  return move === CALL ? action({ type: 'challenge' })
    : action({ type: 'bid', quantity: Math.floor(move / FACE_STRIDE), face: (move % FACE_STRIDE) as DiceFace });
}

export interface DiceSearchOptions {
  readonly maxSamples?: number;
}

/** Worker entry: the bid or call that scores best across worlds drawn from the belief. */
export function liarsDiceSearch(
  visible: LiarsDiceVisibleState, context: SearchContext, options: DiceSearchOptions = {},
): BotAction | null {
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat) return null;
  const setup = setupFor(visible);
  if (setup.mine < 0) return null;
  // Candidate moves and their priors come from the quick policy applied to my own dice alone.
  const cups = setup.seats.map((_, seat) => (seat === setup.mine ? null : new Int8Array(STRIDE)));
  const root = simFor(visible, setup, cups, 0);
  const candidates: Candidate<number>[] = scoreMoves(root, setup.mine, RAISES_PER_FACE).map((entry) => ({ move: entry.move, prior: entry.score }));
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return moveAction(candidates[0].move);
  const choice = determinizedSearch(diceGame(visible, setup), candidates, context, {
    maxSamples: options.maxSamples ?? MAX_SAMPLES, minSamples: MIN_SAMPLES, confidence: CONFIDENCE,
  });
  return moveAction(choice.move);
}
