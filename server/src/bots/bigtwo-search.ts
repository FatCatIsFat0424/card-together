import type { BigTwoVisibleState, GameSeat } from '@shared/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { legalPlays } from '@shared/rules/bigtwo';
import type { BotAction } from './bot-decisions';
import {
  answerKind, blockingLead, byRank, cardIndex, cheapestBeat, cheapestBomb, comboOf, fastBeats, fastCombo, indexCard,
  nextSeatIndex, PAIR, rankOf, readKnowledge, seatIndex, sheddingLead, SINGLE, TWO, wholeHand,
} from './bigtwo-model';
import type { BigTwoKnowledge, FastCombo } from './bigtwo-model';
import { getBigTwoBotAction, scoreBigTwoOptions } from './bigtwo-strategy';
import type { BigTwoOption } from './bigtwo-strategy';
import { dealUnseen } from './search/card-dealer';
import { determinizedSearch } from './search/determinized';
import type { Candidate, DeterminizedGame } from './search/determinized';
import type { SearchContext } from './search/search-types';

// Determinized search: the unseen cards are dealt to the other three hands in their exact sizes, weighted by
// how well each deal explains the public passes (a seat that declined a play it could have answered cheaply
// is less likely). Every heuristic candidate is played on the same deals and the game is played out with a
// fast shedding policy for all four seats. The result is scored in match terms: winning, or else the penalty
// the rules charge for the cards left.

/** Candidates searched per decision. */
const MAX_CANDIDATES = 9;
const SEARCH_OPTIONS = { maxSamples: 1500, minSamples: 12, tolerance: 0.01, confidence: 1, maxPlies: 400 } as const;
/** Weight of one penalty point against a win, which counts 1. */
const PENALTY_WEIGHT = 0.006;
/** Likelihood of a pass by a seat that could have answered with ordinary cards, or only with a 2, a bomb, or a split. */
const PASS_WITH_ORDINARY = Math.log(0.25);
const PASS_WITH_CONTROL = Math.log(0.7);
/** Rollout seats pass rather than spend a 2 this often while they hold many cards and nobody is close to out. */
const SAVE_TWO_CHANCE = 0.6;

export interface BigTwoWorld {
  /** Hands by clockwise seat index, ascending. */
  hands: number[][];
  turn: number;
  last: FastCombo | null;
  lastSeat: number;
  /** Bitmask of seats that passed this round. */
  locked: number;
  first: boolean;
  winner: number;
}

type Move = FastCombo | null;

function advance(state: BigTwoWorld, from: number): void {
  let seat = nextSeatIndex(from);
  while (state.last && seat !== state.lastSeat && (state.locked & (1 << seat))) seat = nextSeatIndex(seat);
  if (seat === state.lastSeat) {
    state.last = null;
    state.locked = 0;
  }
  state.turn = seat;
}

export function playBigTwoMove(state: BigTwoWorld, move: Move): void {
  if (move === null) {
    state.locked |= 1 << state.turn;
    advance(state, state.turn);
    return;
  }
  const hand = state.hands[state.turn].filter((card) => !move.cards.includes(card));
  state.hands[state.turn] = hand;
  state.last = move;
  state.lastSeat = state.turn;
  state.first = false;
  if (hand.length === 0) state.winner = state.turn;
  else advance(state, state.turn);
}

/** A seat other than `seat` that may still answer this round and holds at most `cards` cards. */
function threatened(state: BigTwoWorld, seat: number, cards: number): boolean {
  for (let other = 0; other < 4; other++) {
    if (other === seat || (state.last && (state.locked & (1 << other)))) continue;
    if (state.hands[other].length <= cards) return true;
  }
  return false;
}

/** The best pair a hand holds, by comparison key, or -1. */
function topPairKey(hand: readonly number[]): number {
  for (let index = hand.length - 1; index > 0; index--) if (rankOf(hand[index - 1]) === rankOf(hand[index])) return hand[index];
  return -1;
}

/**
 * A lead that wins outright: a single or pair no other hand in this world can beat, after which the rest of the
 * hand goes in one play. Bombs are ignored for speed.
 */
function finishingLead(state: BigTwoWorld, seat: number, hand: readonly number[], ranks: readonly (readonly number[])[]): Move {
  let otherTop = -1;
  let otherPair = -1;
  for (let other = 0; other < 4; other++) {
    if (other === seat) continue;
    const cards = state.hands[other];
    otherTop = Math.max(otherTop, cards[cards.length - 1] ?? -1);
    otherPair = Math.max(otherPair, topPairKey(cards));
  }
  const top = hand[hand.length - 1];
  if (top > otherTop && wholeHand(hand.slice(0, -1))) return { type: SINGLE, key: top, cards: [top] };
  const pairKey = topPairKey(hand);
  if (pairKey > otherPair) {
    const low = ranks[rankOf(pairKey)].find((card) => card !== pairKey)!;
    const rest = hand.filter((card) => card !== pairKey && card !== low);
    if (rest.length === 0 || wholeHand(rest)) return { type: PAIR, key: pairKey, cards: [low, pairKey] };
  }
  return null;
}

/** Fast policy for every seat in a rollout: shed low groups, follow cheaply, save 2s early, block short hands. */
export function bigTwoRolloutMove(state: BigTwoWorld, random: () => number): Move {
  const seat = state.turn;
  const hand = state.hands[seat];
  const whole = wholeHand(hand);
  const ranks = byRank(hand);
  const last = state.last;
  if (!last) {
    if (whole) return whole;
    const finisher = hand.length <= 7 ? finishingLead(state, seat, hand, ranks) : null;
    if (finisher) return finisher;
    const cards = !state.first && threatened(state, seat, 1) ? blockingLead(hand, ranks) : sheddingLead(hand, ranks);
    return comboOf(cards);
  }
  if (whole && fastBeats(whole, last)) return whole;
  const danger = threatened(state, seat, last.cards.length === 5 ? 5 : 2);
  if (last.type === SINGLE && danger) {
    const top = hand[hand.length - 1];
    if (top > last.key) return { type: SINGLE, key: top, cards: [top] };
  }
  const beat = cheapestBeat(hand, ranks, last);
  if (!beat) {
    const bomb = danger || hand.length <= 6 ? cheapestBomb(hand, ranks, last) : null;
    return bomb ? comboOf(bomb) : null;
  }
  if (!danger && hand.length > 6 && beat.some((card) => rankOf(card) === TWO) && random() < SAVE_TWO_CHANCE) return null;
  return comboOf(beat);
}

function bigTwoPenalty(hand: readonly number[]): number {
  let twos = 0;
  for (const card of hand) if (rankOf(card) === TWO) twos++;
  return hand.length * 2 ** twos;
}

function legalMoves(state: BigTwoWorld): Move[] {
  const plays = legalPlays(state.hands[state.turn].map(indexCard), null, state.first).map(fastCombo)
    .filter((combo) => !state.last || fastBeats(combo, state.last));
  return state.last ? [...plays, null] : plays;
}

/** Log-likelihood of a deal given the public passes: what each seat held when it passed. */
function passLikelihood(knowledge: BigTwoKnowledge, order: readonly number[]): (hands: readonly (readonly number[])[]) => number {
  return (hands) => {
    let total = 0;
    for (const evidence of knowledge.passes) {
      const hand = hands[order.indexOf(evidence.seat)];
      if (!hand) continue;
      const kind = answerKind([...hand, ...evidence.playedLater], evidence.declined);
      if (kind === 2) total += PASS_WITH_ORDINARY;
      else if (kind === 1) total += PASS_WITH_CONTROL;
    }
    return total;
  };
}

/** The search plug-in for one decision of the seat; closes over its filtered view only. */
export function bigTwoGame(visible: BigTwoVisibleState): DeterminizedGame<BigTwoWorld, Move> {
  const knowledge = readKnowledge(visible);
  const me = seatIndex(visible.mySeat);
  const others = SEAT_ORDER_CLOCKWISE.filter((seat) => seat !== visible.mySeat);
  const order = others.map(seatIndex);
  const myHand = visible.myHand.map(cardIndex).sort((a, b) => a - b);
  const last = visible.lastPlay ? comboOf(visible.lastPlay.cards.map(cardIndex)) : null;
  const lastSeat = visible.lastPlay ? seatIndex(visible.lastPlay.seat) : -1;
  const locked = visible.lockedSeats.reduce((mask, seat) => mask | (1 << seatIndex(seat)), 0);
  const logLikelihood = knowledge.passes.length > 0 ? passLikelihood(knowledge, order) : undefined;
  return {
    seat: visible.mySeat as GameSeat,
    sample: (random) => {
      const deal = dealUnseen({
        unseen: knowledge.unseen, seats: others.map((seat) => ({ size: visible.handCounts[seat] })), logLikelihood,
      }, random);
      if (!deal) return null;
      const hands: number[][] = [[], [], [], []];
      hands[me] = [...myHand];
      deal.hands.forEach((hand, index) => { hands[order[index]] = hand.sort((a, b) => a - b); });
      return { state: { hands, turn: me, last, lastSeat, locked, first: visible.firstPlay, winner: -1 }, weight: deal.weight };
    },
    copy: (state) => ({ ...state, hands: state.hands.map((hand) => hand.slice()) }),
    legalMoves,
    play: playBigTwoMove,
    rolloutMove: bigTwoRolloutMove,
    isTerminal: (state) => state.winner >= 0,
    utility: (state) => {
      if (state.winner === me) return 1;
      // A rollout cut short is scored by the cards still held.
      return -PENALTY_WEIGHT * bigTwoPenalty(state.hands[me]) - (state.winner < 0 ? 0.25 : 0);
    },
  };
}

/** The heuristic's best candidates, plus the best play of each other kind and a pass when the heuristic offers one. */
function searchCandidates(options: readonly BigTwoOption[]): BigTwoOption[] {
  const ranked = [...options].sort((a, b) => b.score - a.score);
  const chosen = ranked.slice(0, MAX_CANDIDATES);
  const kinds = new Set(chosen.map((option) => option.combo?.type ?? 'pass'));
  for (const option of ranked) {
    const kind = option.combo?.type ?? 'pass';
    if (kinds.has(kind)) continue;
    kinds.add(kind);
    chosen.push(option);
  }
  return chosen;
}

/** Worker-pool strategy: searches every decision with more than one candidate; the heuristic decides the rest. */
export function bigTwoSearch(visible: BigTwoVisibleState, context: SearchContext): BotAction | null {
  const options = scoreBigTwoOptions(visible);
  if (options.length <= 1 || options.some((option) => option.score >= 1000)) return getBigTwoBotAction(visible, context.random);
  // A view whose hand sizes do not add up to the unseen cards cannot be dealt.
  const hidden = SEAT_ORDER_CLOCKWISE.reduce((sum, seat) => (seat === visible.mySeat ? sum : sum + visible.handCounts[seat]), 0);
  if (readKnowledge(visible).unseen.length !== hidden) return getBigTwoBotAction(visible, context.random);
  const chosen = searchCandidates(options);
  const candidates: Candidate<Move>[] = chosen.map((option) => ({
    move: option.combo ? fastCombo(option.combo) : null, prior: option.score,
  }));
  const result = determinizedSearch(bigTwoGame(visible), candidates, context, SEARCH_OPTIONS);
  const index = candidates.findIndex((candidate) => candidate.move === result.move);
  return chosen[index].value;
}
