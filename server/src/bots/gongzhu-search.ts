import type { GameSeat } from '@shared/types';
import type { GongZhuVisibleState } from '@shared/games/gongzhu/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import type { BotAction } from './bot-decisions';
import { dealUnseen } from './search/card-dealer';
import { determinizedSearch } from './search/determinized';
import type { Candidate, DeterminizedGame } from './search/determinized';
import type { SearchContext } from './search/search-types';
import {
  getGongZhuBotAction, GOAT, gongZhuLegalMasks, gongZhuMaskScore, gongZhuPolicyCard, gongZhuScoredCards,
  gongZhuTableFromView, PIG, TRANSFORMER,
} from './gongzhu-strategy';
import type { GongZhuTable } from './gongzhu-strategy';
import { cardCode, codeCard, FULL_SUIT, HEARTS, lowest, maskCodes, rankOf, shedDoubts, suitOf } from './trick-masks';

// Determinized search for Gong Zhu: the cards the seat has not seen are dealt to the other hands (exact hand
// sizes; suits a seat has shown out of are hard limits), every candidate is played on the same deal, and the
// hand is played out by the heuristic policy for all four seats. A result counts in match terms: the chance
// of finishing with the highest total once the hand's scores are added.

const MAX_SAMPLES = 1000;
const MIN_SAMPLES = 12;
const CONFIDENCE = 1;
const RESERVE_MS = 40;

function copyTable(table: GongZhuTable): GongZhuTable {
  return {
    ...table, hands: table.hands.slice(), played: table.played.slice(), voids: table.voids.slice(),
    capturedHearts: table.capturedHearts.slice(), capturedSpecial: table.capturedSpecial.slice(), trick: table.trick.slice(),
  };
}

const SPECIAL_BITS: Readonly<Record<number, number>> = { [PIG]: 1, [GOAT]: 2, [TRANSFORMER]: 4 };

/** Plays `code` for the seat to act and completes the trick when it is the fourth card. */
export function playGongZhuCard(table: GongZhuTable, code: number): void {
  const suit = suitOf(code);
  const bit = 1 << rankOf(code);
  const seat = table.turn;
  table.hands[seat * 4 + suit] &= ~bit;
  table.played[suit] |= bit;
  if (table.trickSize > 0 && suitOf(table.trick[0]) !== suit) table.voids[seat] |= 1 << suitOf(table.trick[0]);
  table.trick[table.trickSize++] = code;
  if (table.trickSize < 4) {
    table.turn = (seat + 1) % 4;
    return;
  }
  const lead = suitOf(table.trick[0]);
  let winner = 0;
  for (let index = 1; index < 4; index++) {
    const card = table.trick[index];
    if (suitOf(card) === lead && rankOf(card) > rankOf(table.trick[winner])) winner = index;
  }
  const winnerSeat = (table.leader + winner) % 4;
  for (let index = 0; index < 4; index++) {
    const card = table.trick[index];
    if (suitOf(card) === HEARTS) table.capturedHearts[winnerSeat] |= 1 << rankOf(card);
    else table.capturedSpecial[winnerSeat] |= SPECIAL_BITS[card] ?? 0;
  }
  table.leader = winnerSeat;
  table.turn = winnerSeat;
  table.trickSize = 0;
  table.tricksDone++;
}

/**
 * The seat's chance of winning the match at these totals with `handsLeft` hands to come: exact after the
 * last hand, otherwise a softmax whose spread grows with the hands left. A sliver of the points gap keeps
 * hopeless and settled positions ordered.
 */
export function gongZhuMatchValue(totals: readonly number[], seat: number, handsLeft: number): number {
  let others = 0;
  for (let other = 0; other < 4; other++) if (other !== seat) others += totals[other];
  const gap = (totals[seat] - others / 3) * 0.00002;
  const top = Math.max(...totals);
  if (handsLeft <= 0) return (totals[seat] === top ? 1 : 0) + gap;
  const spread = 75 * Math.sqrt(handsLeft);
  let sum = 0;
  for (let other = 0; other < 4; other++) sum += Math.exp((totals[other] - top) / spread);
  return Math.exp((totals[seat] - top) / spread) / sum + gap;
}

function utility(table: GongZhuTable, seat: number): number {
  const totals = [0, 1, 2, 3].map((other) => table.scores[other]
    + gongZhuMaskScore(table.capturedHearts[other], table.capturedSpecial[other]));
  return gongZhuMatchValue(totals, seat, table.handsLeft);
}

const LEGAL = new Int32Array(4);
/** Log-likelihood of holding the pig per passed-up chance to shed it; a holder sheds it about three times in four. */
const LOG_DOUBT = Math.log(0.25);
/** Hearts of equal value, by rank index; neighbours of one class play the same. */
const HEART_CLASSES = [1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 4, 5, 6];

export function gongZhuSearchGame(view: GongZhuVisibleState): DeterminizedGame<GongZhuTable, number> {
  const base = gongZhuTableFromView(view);
  const me = base.turn;
  const unseen: number[] = [];
  for (let suit = 0; suit < 4; suit++) {
    for (let bits = FULL_SUIT & ~base.played[suit] & ~base.hands[me * 4 + suit]; bits !== 0; bits &= bits - 1) {
      unseen.push(suit * 13 + lowest(bits));
    }
  }
  const others = [1, 2, 3].map((step) => (me + step) % 4);
  const seats = others.map((seat) => ({
    size: view.handCounts[SEAT_ORDER_CLOCKWISE[seat]],
    accepts: (code: number): boolean => (base.voids[seat] & (1 << suitOf(code))) === 0,
  }));
  const doubts = shedDoubts([...view.tricks.map((trick) => trick.plays), view.trick]
    .map((plays) => plays.map((play) => ({ seat: SEAT_ORDER_CLOCKWISE.indexOf(play.seat), code: cardCode(play.card) }))),
  PIG, () => false);
  const logLikelihood = doubts.some((count, index) => count > 0 && index !== me)
    ? (hands: readonly (readonly number[])[]): number => {
      const holder = hands.findIndex((hand) => hand.includes(PIG));
      return holder < 0 ? 0 : Math.min(2, doubts[others[holder]]) * LOG_DOUBT;
    } : undefined;
  return {
    seat: view.mySeat as GameSeat,
    sample: (random) => {
      const deal = dealUnseen({ unseen, seats, logLikelihood }, random);
      if (!deal) return null;
      const table = copyTable(base);
      deal.hands.forEach((hand, index) => {
        for (const code of hand) table.hands[others[index] * 4 + suitOf(code)] |= 1 << rankOf(code);
      });
      return { state: table, weight: deal.weight };
    },
    copy: copyTable,
    legalMoves: (table) => {
      gongZhuLegalMasks(table, LEGAL);
      return maskCodes(LEGAL);
    },
    play: playGongZhuCard,
    rolloutMove: gongZhuPolicyCard,
    isTerminal: (table) => table.tricksDone === 13,
    utility: (table, seat) => utility(table, SEAT_ORDER_CLOCKWISE.indexOf(seat as typeof SEAT_ORDER_CLOCKWISE[number])),
  };
}

/** Legal cards grouped where no unseen card lies between them and neither is a scoring card. */
export function gongZhuCandidates(view: GongZhuVisibleState): Candidate<number>[] {
  const table = gongZhuTableFromView(view);
  const me = table.turn;
  const worth = (code: number): number => (code === PIG || code === GOAT || code === TRANSFORMER ? code + 1000
    : suitOf(code) === HEARTS ? HEART_CLASSES[rankOf(code)] : 0);
  const candidates: Candidate<number>[] = [];
  let previous = -1;
  for (const option of gongZhuScoredCards(table)) {
    const code = option.code;
    const suit = suitOf(code);
    let touching = previous >= 0 && suitOf(previous) === suit && worth(code) === worth(previous);
    for (let rank = rankOf(previous) + 1; touching && rank < rankOf(code); rank++) {
      const bit = 1 << rank;
      if ((table.played[suit] & bit) === 0 && (table.hands[me * 4 + suit] & bit) === 0) touching = false;
    }
    if (touching) {
      const last = candidates[candidates.length - 1];
      if (option.score > last.prior) candidates[candidates.length - 1] = { move: code, prior: option.score };
    } else candidates.push({ move: code, prior: option.score });
    previous = code;
  }
  return candidates;
}

/** Worker-pool strategy: searches every play with more than one distinct card. */
export function gongZhuSearch(view: GongZhuVisibleState, context: SearchContext): BotAction | null {
  if (view.phase !== 'playing' || view.observer || view.currentTurnSeat !== view.mySeat || view.validCards.length < 2) {
    return getGongZhuBotAction(view, context.random);
  }
  const candidates = gongZhuCandidates(view);
  if (candidates.length < 2) return getGongZhuBotAction(view, context.random);
  const choice = determinizedSearch(gongZhuSearchGame(view), candidates, context, {
    maxSamples: MAX_SAMPLES, minSamples: MIN_SAMPLES, confidence: CONFIDENCE, reserveMs: RESERVE_MS,
  });
  return { type: 'game-action', request: { gameType: 'gongzhu', action: { type: 'play', card: codeCard(choice.move) } } };
}
