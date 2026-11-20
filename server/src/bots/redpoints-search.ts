import type { GameSeat, RedPointsVisibleState } from '@shared/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import type { BotAction } from './bot-decisions';
import { bestCapture, bestTarget, nextSeatIndex, pairs, POINTS, readKnowledge, rpIndex, seatIndex } from './redpoints-model';
import type { RedPointsKnowledge } from './redpoints-model';
import { getRedPointsBotAction, scoreRedPointsOptions } from './redpoints-strategy';
import type { RedPointsMove } from './redpoints-strategy';
import { dealUnseen } from './search/card-dealer';
import { determinizedSearch } from './search/determinized';
import type { Candidate, DeterminizedGame } from './search/determinized';
import type { SearchContext } from './search/search-types';

// Determinized search: the unseen cards are dealt to the other hands and the stock (in a random order),
// weighted by how well each deal explains the other seats' plays (a seat that let a valuable capture go
// probably could not make it). Every legal decision is played on the same deals and the game is played out
// with a fast greedy policy. The result is scored in match terms: the highest score wins, ties included, and
// the margin to the best other score separates outcomes of equal rank.

const SEARCH_OPTIONS = { maxSamples: 20000, minSamples: 24, tolerance: 0, confidence: 0, maxPlies: 200 } as const;
/** Utility per point of margin over the best other seat; a win counts 1. */
const MARGIN_WEIGHT = 0.02;
/** Log-likelihood per point a seat's play left on the table compared with its best capture. */
const SHORTFALL_LOG_LIKELIHOOD = -0.04;
/** Share of the points another hand could take from a discard that a rollout seat weighs against discarding it. */
const ROLLOUT_EXPOSURE = 0.7;

export interface RedPointsWorld {
  hands: number[][];
  table: number[];
  stock: number[];
  /** Next stock card to flip. */
  position: number;
  scores: number[];
  turn: number;
  /** A flipped card waiting for its seat to choose among several captures, or -1. */
  pending: number;
  done: boolean;
}

function capture(state: RedPointsWorld, seat: number, card: number, target: number): void {
  state.table = state.table.filter((entry) => entry !== target);
  state.scores[seat] += POINTS[card] + POINTS[target];
}

function endTurn(state: RedPointsWorld): void {
  if (state.position >= state.stock.length && state.hands.every((hand) => hand.length === 0)) state.done = true;
  else state.turn = nextSeatIndex(state.turn);
}

export function playRedPointsMove(state: RedPointsWorld, move: RedPointsMove): void {
  const seat = state.turn;
  if (state.pending >= 0) {
    capture(state, seat, state.pending, move.target);
    state.pending = -1;
    endTurn(state);
    return;
  }
  state.hands[seat] = state.hands[seat].filter((card) => card !== move.card);
  if (move.target >= 0) capture(state, seat, move.card, move.target);
  else state.table.push(move.card);
  if (state.position < state.stock.length) {
    const flipped = state.stock[state.position++];
    let options = 0;
    let only = -1;
    for (const target of state.table) {
      if (!pairs(flipped, target)) continue;
      options++;
      only = target;
    }
    if (options >= 2) {
      state.pending = flipped;
      return;
    }
    if (options === 1) capture(state, seat, flipped, only);
    else state.table.push(flipped);
  }
  endTurn(state);
}

function legalMoves(state: RedPointsWorld): RedPointsMove[] {
  if (state.pending >= 0) {
    return state.table.filter((target) => pairs(state.pending, target)).map((target) => ({ card: -1, target }));
  }
  return state.hands[state.turn].flatMap((card) => {
    const targets = state.table.filter((target) => pairs(card, target));
    return targets.length === 0 ? [{ card, target: -1 }] : targets.map((target) => ({ card, target }));
  });
}

/** The most points another hand in this world could take by pairing `card`, or 0. */
function exposure(state: RedPointsWorld, seat: number, card: number): number {
  let worst = 0;
  for (let other = 0; other < 4; other++) {
    if (other === seat) continue;
    for (const own of state.hands[other]) if (pairs(own, card)) worst = Math.max(worst, POINTS[own] + POINTS[card] + 1);
  }
  return worst;
}

/**
 * Fast policy for every seat: take the most points; otherwise discard the card the other hands can least
 * profit from, breaking near-ties at random. Rollout seats read the sampled hands, which keeps them simple.
 */
export function redPointsRolloutMove(state: RedPointsWorld, random: () => number): RedPointsMove {
  if (state.pending >= 0) return { card: -1, target: bestTarget(state.pending, state.table) };
  let best: RedPointsMove | null = null;
  let bestScore = -Infinity;
  for (const card of state.hands[state.turn]) {
    const target = bestTarget(card, state.table);
    const score = (target >= 0 ? 1 + POINTS[card] + POINTS[target] : -POINTS[card] - ROLLOUT_EXPOSURE * exposure(state, state.turn, card))
      + random() * 0.5;
    if (score > bestScore) {
      best = { card, target };
      bestScore = score;
    }
  }
  if (!best) throw new Error('A Red Points rollout reached a turn without cards.');
  return best;
}

/** Log-likelihood of a deal given each other seat's plays: missing a much better capture is unlikely. */
function playLikelihood(knowledge: RedPointsKnowledge, order: readonly number[]): (hands: readonly (readonly number[])[]) => number {
  return (hands) => {
    let total = 0;
    for (const play of knowledge.plays) {
      const hand = hands[order.indexOf(play.seat)];
      const shortfall = bestCapture([...hand, ...play.heldSince], play.table) - play.gained;
      if (shortfall > 0) total += SHORTFALL_LOG_LIKELIHOOD * shortfall;
    }
    return total;
  };
}

function shuffle(cards: number[], random: () => number): void {
  for (let index = cards.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [cards[index], cards[other]] = [cards[other], cards[index]];
  }
}

/** The search plug-in for one decision of the seat; closes over its filtered view only. */
export function redPointsGame(visible: RedPointsVisibleState): DeterminizedGame<RedPointsWorld, RedPointsMove> {
  const knowledge = readKnowledge(visible);
  const me = seatIndex(visible.mySeat);
  const others = SEAT_ORDER_CLOCKWISE.filter((seat) => seat !== visible.mySeat);
  const order = others.map(seatIndex);
  const logLikelihood = knowledge.plays.length > 0 ? playLikelihood(knowledge, order) : undefined;
  const pending = visible.pendingFlip ? rpIndex(visible.pendingFlip) : -1;
  return {
    seat: visible.mySeat as GameSeat,
    sample: (random) => {
      const deal = dealUnseen({
        unseen: knowledge.unseen,
        seats: [...others.map((seat) => ({ size: visible.handCounts[seat] })), { size: visible.stockCount }],
        logLikelihood,
      }, random);
      if (!deal) return null;
      const hands: number[][] = [[], [], [], []];
      hands[me] = [...knowledge.hand];
      order.forEach((seat, index) => { hands[seat] = deal.hands[index]; });
      const stock = deal.hands[order.length];
      shuffle(stock, random);
      return {
        state: {
          hands, table: [...knowledge.table], stock, position: 0, scores: [...knowledge.scores], turn: me, pending, done: false,
        },
        weight: deal.weight,
      };
    },
    copy: (state) => ({
      ...state, hands: state.hands.map((hand) => hand.slice()), table: state.table.slice(), scores: state.scores.slice(),
    }),
    legalMoves,
    play: playRedPointsMove,
    rolloutMove: redPointsRolloutMove,
    isTerminal: (state) => state.done,
    utility: (state) => {
      let other = 0;
      for (let seat = 0; seat < 4; seat++) if (seat !== me) other = Math.max(other, state.scores[seat]);
      const margin = state.scores[me] - other;
      return (margin >= 0 ? 1 : 0) + MARGIN_WEIGHT * margin;
    },
  };
}

/** Worker-pool strategy: searches every decision with more than one option; the heuristic decides the rest. */
export function redPointsSearch(visible: RedPointsVisibleState, context: SearchContext): BotAction | null {
  const options = scoreRedPointsOptions(visible);
  if (options.length <= 1) return getRedPointsBotAction(visible, context.random);
  // A view whose hand and stock sizes do not add up to the unseen cards cannot be dealt.
  const hidden = SEAT_ORDER_CLOCKWISE.reduce((sum, seat) => (seat === visible.mySeat ? sum : sum + visible.handCounts[seat]), visible.stockCount);
  if (readKnowledge(visible).unseen.length !== hidden) return getRedPointsBotAction(visible, context.random);
  const candidates: Candidate<RedPointsMove>[] = options.map((option) => ({ move: option.move, prior: option.score }));
  const result = determinizedSearch(redPointsGame(visible), candidates, context, SEARCH_OPTIONS);
  return options[candidates.findIndex((candidate) => candidate.move === result.move)].value;
}
