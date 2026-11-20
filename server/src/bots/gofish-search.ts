import type { GoFishVisibleState } from '@shared/games/gofish/types';
import { GF_BOOK_SIZE, GF_BOOKS_PER_HAND, GF_HANDS } from '@shared/rules/gofish';
import type { BotAction } from './bot-decisions';
import { GF_RANKS, goFishKnowledge, goFishPublicKnowledge, indexRank, sampleGoFishWorld } from './gofish-knowledge';
import type { GoFishKnowledge } from './gofish-knowledge';
import { askAction, getGoFishBotAction, scoreGoFishAsks, turnChoices } from './gofish-strategy';
import { determinizedSearch } from './search/determinized';
import type { Candidate, DeterminizedGame } from './search/determinized';
import type { SearchContext } from './search/search-types';

// Determinized search over asks. Each sample deals the hidden cards so they fit everything the log shows
// (see gofish-knowledge), every candidate ask is played on that same deal, and the hand is played out by
// seats that, like real players, see only their own cards and the public record: they ask seats the record
// shows holding a rank, avoid seats it shows lacking one, and otherwise ask for their longest rank. Because
// the simulated seats read the record, an ask that reveals a rank invites the others to take it, and the
// search weighs that cost against the cards the ask may win. The result is scored as the seat's chance of
// winning the match: exactly in the last hand, by a book-difference estimate before it.

/** Asks examined per decision; the estimate ranks them first. */
const MAX_CANDIDATES = 4;
const MAX_SAMPLES = 8_000;
const MIN_SAMPLES = 24;
/** Standard errors within which two asks count as equal and the estimate decides. */
const CONFIDENCE = 2;
/** Plies a simulated hand may last before it is scored as it stands. */
const MAX_PLIES = 600;
/** Spread of the book difference per remaining hand, as the scale of the win-chance estimate. */
const HAND_SPREAD = 1.5;
/** Value of sharing the top total instead of holding it alone. */
const TIE_VALUE = 0.75;

/** The hand in play with every card placed; moves are `target * 16 + rank`. */
interface GoFishSim {
  readonly counts: Int8Array;
  readonly sizes: Int8Array;
  readonly stock: Int8Array;
  stockTop: number;
  /** Books each seat made in the hand so far */
  readonly books: Int8Array;
  booksLeft: number;
  turn: number;
  over: boolean;
  /** What the record shows: cards of a rank a seat is known to hold */
  readonly shown: Int8Array;
  /** What the record shows: 1 when a seat is known to hold none of a rank */
  readonly lacks: Int8Array;
}

const cell = (seat: number, rank: number): number => seat * GF_RANKS + rank;

/** Starts a simulated hand from a sampled deal and the public record. */
function goFishSim(
  visible: GoFishVisibleState, knowledge: GoFishKnowledge, publicView: GoFishKnowledge, counts: Int8Array, stock: Int8Array,
): GoFishSim {
  const seatCount = knowledge.seats.length;
  const sizes = new Int8Array(seatCount);
  const shown = new Int8Array(seatCount * GF_RANKS);
  const lacks = new Int8Array(seatCount * GF_RANKS);
  for (let seat = 0; seat < seatCount; seat++) {
    const hand = publicView.hands[seat];
    for (let rank = 0; rank < GF_RANKS; rank++) {
      sizes[seat] += counts[cell(seat, rank)];
      shown[cell(seat, rank)] = hand.known[rank];
      lacks[cell(seat, rank)] = hand.known[rank] === 0 && hand.unknown.every((mask) => (mask & (1 << rank)) === 0) ? 1 : 0;
    }
  }
  const books = Int8Array.from(knowledge.seats, (seat) => visible.books[seat]?.length ?? 0);
  const made = books.reduce((sum, count) => sum + count, 0);
  return {
    counts, sizes, stock, stockTop: 0, books, booksLeft: GF_BOOKS_PER_HAND - made,
    turn: knowledge.mine, over: made >= GF_BOOKS_PER_HAND, shown, lacks,
  };
}

function copySim(state: GoFishSim): GoFishSim {
  return {
    ...state, counts: state.counts.slice(), sizes: state.sizes.slice(), books: state.books.slice(),
    shown: state.shown.slice(), lacks: state.lacks.slice(),
  };
}

function canTakeTurn(state: GoFishSim, seat: number): boolean {
  if (state.sizes[seat] === 0) return false;
  for (let other = 0; other < state.sizes.length; other++) if (other !== seat && state.sizes[other] > 0) return true;
  return false;
}

function drawCard(state: GoFishSim, seat: number): number {
  const rank = state.stock[state.stockTop++];
  state.counts[cell(seat, rank)]++;
  state.sizes[seat]++;
  return rank;
}

function forgetLacks(state: GoFishSim, seat: number): void {
  state.lacks.fill(0, cell(seat, 0), cell(seat + 1, 0));
}

function bookIfComplete(state: GoFishSim, seat: number, rank: number): void {
  if (state.counts[cell(seat, rank)] < GF_BOOK_SIZE) return;
  state.counts[cell(seat, rank)] = 0;
  state.sizes[seat] -= GF_BOOK_SIZE;
  state.books[seat]++;
  state.booksLeft--;
  for (let other = 0; other < state.sizes.length; other++) {
    state.shown[cell(other, rank)] = 0;
    state.lacks[cell(other, rank)] = 1;
  }
}

/** Applies the seat on turn's ask by the rules, with the public record updated the way every seat sees it. */
function playGoFishAsk(state: GoFishSim, move: number): void {
  const seat = state.turn;
  const target = move >> 4;
  const rank = move & 15;
  const taken = state.counts[cell(target, rank)];
  const seatCount = state.sizes.length;
  state.shown[cell(seat, rank)] = Math.max(state.shown[cell(seat, rank)], 1);
  let continues = taken > 0;
  let drawn = -1;
  if (taken > 0) {
    state.counts[cell(target, rank)] = 0;
    state.sizes[target] -= taken;
    state.counts[cell(seat, rank)] += taken;
    state.sizes[seat] += taken;
    state.shown[cell(seat, rank)] += taken;
  } else if (state.stockTop < state.stock.length) {
    drawn = drawCard(state, seat);
    if (drawn === rank) {
      continues = true;
      state.shown[cell(seat, rank)]++;
    } else forgetLacks(state, seat);
  }
  state.shown[cell(target, rank)] = 0;
  state.lacks[cell(target, rank)] = 1;
  bookIfComplete(state, seat, rank);
  if (drawn >= 0 && drawn !== rank) bookIfComplete(state, seat, drawn);
  for (let step = 0; step < seatCount; step++) {
    const other = (seat + step) % seatCount;
    if (state.sizes[other] === 0 && state.stockTop < state.stock.length) {
      drawCard(state, other);
      forgetLacks(state, other);
    }
  }
  if (state.booksLeft <= 0) {
    state.over = true;
    return;
  }
  for (let step = continues ? 0 : 1; step <= seatCount; step++) {
    const next = (seat + step) % seatCount;
    if (canTakeTurn(state, next)) {
      state.turn = next;
      return;
    }
  }
  state.over = true;
}

function goFishSimMoves(state: GoFishSim): number[] {
  const seat = state.turn;
  const moves: number[] = [];
  for (let rank = 0; rank < GF_RANKS; rank++) {
    if (state.counts[cell(seat, rank)] === 0) continue;
    for (let target = 0; target < state.sizes.length; target++) {
      if (target !== seat && state.sizes[target] > 0) moves.push(target * 16 + rank);
    }
  }
  return moves;
}

/**
 * How a seat that sees only its own cards and the record plays: ask a seat shown holding one of its ranks
 * (the most cards first); otherwise ask for its longest rank, of a seat not shown lacking it, chosen in
 * proportion to hand size, or of the only seat that can still hold it once the stock is empty.
 */
function goFishRolloutAsk(state: GoFishSim, random: () => number): number {
  const seat = state.turn;
  const seatCount = state.sizes.length;
  let best = -1;
  let bestValue = -1;
  let longest = -1;
  let longestCount = 0;
  let ties = 0;
  for (let rank = 0; rank < GF_RANKS; rank++) {
    const owned = state.counts[cell(seat, rank)];
    if (owned === 0) continue;
    if (owned > longestCount) {
      longest = rank;
      longestCount = owned;
      ties = 1;
    } else if (owned === longestCount && random() * ++ties < 1) longest = rank;
    for (let target = 0; target < seatCount; target++) {
      if (target === seat || state.sizes[target] === 0 || state.shown[cell(target, rank)] === 0) continue;
      const value = owned + state.shown[cell(target, rank)];
      if (value > bestValue) {
        best = target * 16 + rank;
        bestValue = value;
      }
    }
  }
  if (best >= 0) return best;
  let open = 0;
  let total = 0;
  let only = -1;
  for (let target = 0; target < seatCount; target++) {
    if (target === seat || state.sizes[target] === 0) continue;
    total += state.sizes[target];
    if (state.lacks[cell(target, longest)] === 0) {
      open += state.sizes[target];
      only = only === -1 ? target : -2;
    }
  }
  if (only >= 0 && state.stockTop >= state.stock.length) return only * 16 + longest;
  const restrict = open > 0;
  let pick = random() * (restrict ? open : total);
  let chosen = -1;
  for (let target = 0; target < seatCount; target++) {
    if (target === seat || state.sizes[target] === 0 || (restrict && state.lacks[cell(target, longest)] === 1)) continue;
    chosen = target;
    pick -= state.sizes[target];
    if (pick < 0) break;
  }
  return chosen * 16 + longest;
}

/**
 * The seat's chance of winning the match from the hand's books. In the last hand it is exact (a shared top
 * total counts as `TIE_VALUE`); before that the totals are compared through a softmax whose scale grows
 * with the hands still to come. An unfinished simulation shares the unmade books by cards held.
 */
function goFishUtility(
  state: GoFishSim, seat: number, totals: readonly number[], handsAfter: number,
): number {
  const seatCount = state.sizes.length;
  const final = new Float64Array(seatCount);
  for (let other = 0; other < seatCount; other++) {
    final[other] = totals[other] + state.books[other];
    if (!state.over) for (let rank = 0; rank < GF_RANKS; rank++) final[other] += state.counts[cell(other, rank)] / GF_BOOK_SIZE;
  }
  if (handsAfter === 0) {
    let best = -Infinity;
    let leaders = 0;
    for (const value of final) {
      if (value > best) {
        best = value;
        leaders = 1;
      } else if (value === best) leaders++;
    }
    if (final[seat] < best) return 0;
    return leaders === 1 ? 1 : TIE_VALUE;
  }
  const scale = HAND_SPREAD * Math.sqrt(handsAfter);
  let sum = 0;
  for (const value of final) sum += Math.exp((value - final[seat]) / scale);
  return 1 / sum;
}

/** The plug-in for the determinized search; reads the view only through `knowledge` and `publicView`. */
function goFishGame(
  visible: GoFishVisibleState, knowledge: GoFishKnowledge, publicView: GoFishKnowledge,
): DeterminizedGame<GoFishSim, number> {
  const totals = knowledge.seats.map((seat) => visible.scores[seat] ?? 0);
  const handsAfter = Math.max(0, GF_HANDS - visible.hand);
  return {
    seat: visible.mySeat,
    sample: (random) => {
      const world = sampleGoFishWorld(knowledge, random);
      return world ? { state: goFishSim(visible, knowledge, publicView, world.counts, world.stock) } : null;
    },
    copy: copySim,
    legalMoves: goFishSimMoves,
    play: playGoFishAsk,
    rolloutMove: goFishRolloutAsk,
    isTerminal: (state) => state.over,
    utility: (state, seat) => goFishUtility(state, knowledge.seats.indexOf(seat), totals, handsAfter),
  };
}

/**
 * Worker entry: certain asks (the log proves the target holds the rank) go first, and the search only orders
 * them; otherwise the estimate's best asks are compared by playing the hand out on sampled deals.
 */
export function goFishSearch(visible: GoFishVisibleState, context: SearchContext): BotAction | null {
  if (!turnChoices(visible)) return null;
  const knowledge = goFishKnowledge(visible);
  const asks = scoreGoFishAsks(visible, knowledge, context.random);
  const certain = asks.filter((ask) => ask.certain);
  const pool = certain.length > 0 ? certain : asks;
  if (pool.length === 0) return getGoFishBotAction(visible, context.random);
  if (pool.length === 1) return askAction(pool[0].target, pool[0].rank);
  const candidates: Candidate<number>[] = pool.map((ask) => ({
    move: knowledge.seats.indexOf(ask.target) * 16 + (ask.rank - 2), prior: ask.score,
  }));
  const choice = determinizedSearch(goFishGame(visible, knowledge, goFishPublicKnowledge(visible)), candidates, context, {
    maxSamples: MAX_SAMPLES, minSamples: MIN_SAMPLES, maxCandidates: MAX_CANDIDATES, maxPlies: MAX_PLIES,
    confidence: CONFIDENCE,
  });
  return askAction(knowledge.seats[choice.move >> 4], indexRank(choice.move & 15));
}
