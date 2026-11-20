import type { Card, Seat } from '@shared/types';
import type { GongZhuVisibleState } from '@shared/games/gongzhu/types';
import { GONGZHU_HANDS, gongZhuLegalCards } from '@shared/rules/gongzhu';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import type { BotAction } from './bot-decisions';
import { selectNearBest } from './selection';
import {
  above, below, CLUBS, cardCode, codeCard, DIAMONDS, FULL_SUIT, HEARTS, highest, JACK, lowest, maskCodes, popcount,
  QUEEN, rankOf, SPADES, suitMasks, suitOf,
} from './trick-masks';

// Gong Zhu bot: card counting from the public record (cards played, voids, every seat's captures), exact
// marginal scoring of each trick for its winner (the transformer and the heart sweep included), score-aware
// dumping, and sweep attempts and defence. The same policy plays every seat in the search's rollouts, so it
// reads only what its seat could know.

/** Seat indexes follow SEAT_ORDER_CLOCKWISE. */
export interface GongZhuTable {
  /** Suit masks per seat at `seat * 4 + suit`; outside a rollout only the deciding seat's hand is filled. */
  readonly hands: Int32Array;
  /** Every card played this hand, the open trick included, per suit. */
  readonly played: Int32Array;
  /** Per seat, a bit per suit the seat is known to hold no more of. */
  readonly voids: Int32Array;
  /** Hearts each seat captured this hand. */
  readonly capturedHearts: Int32Array;
  /** Per seat: PIG_BIT, GOAT_BIT, TRANSFORMER_BIT for those cards captured this hand. */
  readonly capturedSpecial: Int32Array;
  /** The open trick's cards in play order. */
  readonly trick: Int32Array;
  trickSize: number;
  leader: number;
  turn: number;
  tricksDone: number;
  /** Match totals before this hand. */
  readonly scores: readonly number[];
  /** Hands still to be dealt after this one. */
  readonly handsLeft: number;
}

export const PIG = SPADES * 13 + QUEEN;
export const GOAT = DIAMONDS * 13 + JACK;
export const TRANSFORMER = CLUBS * 13 + 8;
const PIG_BIT = 1;
const GOAT_BIT = 2;
const TRANSFORMER_BIT = 4;
/** Values of the hearts 2 to ace. */
const HEART_VALUES = [0, 0, 0, -10, -10, -10, -10, -10, -10, -20, -30, -40, -50];
/** Hearts worth points: five and up. */
const VALUED_HEARTS = FULL_SUIT & ~0b111;

/** Sum of the heart values for every mask of hearts. */
const HEART_SUMS = (() => {
  const sums = new Int16Array(FULL_SUIT + 1);
  for (let mask = 1; mask <= FULL_SUIT; mask++) sums[mask] = sums[mask & (mask - 1)] + HEART_VALUES[lowest(mask)];
  return sums;
})();

export function gongZhuMaskScore(hearts: number, special: number): number {
  const allHearts = hearts === FULL_SUIT;
  if (allHearts && special === 7) return 1000;
  let score = allHearts ? 200 : HEART_SUMS[hearts];
  if (special & PIG_BIT) score -= 100;
  if (special & GOAT_BIT) score += 100;
  if ((special & TRANSFORMER_BIT) === 0) return score;
  return (special & (PIG_BIT | GOAT_BIT)) !== 0 || (hearts & VALUED_HEARTS) !== 0 ? score * 2 : 50;
}

function specialBit(code: number): number {
  return code === PIG ? PIG_BIT : code === GOAT ? GOAT_BIT : code === TRANSFORMER ? TRANSFORMER_BIT : 0;
}

/** What capturing `codes` (`count` of them) adds to the seat's hand score. */
function gain(table: GongZhuTable, seat: number, codes: ArrayLike<number>, count: number): number {
  let hearts = table.capturedHearts[seat];
  let special = table.capturedSpecial[seat];
  for (let index = 0; index < count; index++) {
    const code = codes[index];
    if (suitOf(code) === HEARTS) hearts |= 1 << rankOf(code);
    else special |= specialBit(code);
  }
  if (hearts === table.capturedHearts[seat] && special === table.capturedSpecial[seat]) return 0;
  return gongZhuMaskScore(hearts, special) - gongZhuMaskScore(table.capturedHearts[seat], table.capturedSpecial[seat]);
}

/** A card's value on its own, for expectations about cards not yet played. */
function cardValue(code: number): number {
  if (code === PIG) return -100;
  if (code === GOAT) return 100;
  return suitOf(code) === HEARTS ? HEART_VALUES[rankOf(code)] : 0;
}

/** Legal cards for the seat to act, as suit masks written into `out`. */
export function gongZhuLegalMasks(table: GongZhuTable, out: Int32Array): void {
  const base = table.turn * 4;
  out.fill(0);
  if (table.trickSize === 0) {
    if (table.tricksDone === 0 && (table.hands[base] & 1) !== 0) {
      out[0] = 1;
      return;
    }
    for (let suit = 0; suit < 4; suit++) out[suit] = table.hands[base + suit];
    return;
  }
  const lead = suitOf(table.trick[0]);
  if (table.hands[base + lead] !== 0) {
    out[lead] = table.hands[base + lead];
    return;
  }
  for (let suit = 0; suit < 4; suit++) out[suit] = table.hands[base + suit];
}

/**
 * How much a point change for `other` counts against the seat: about a third (one of three rivals), more
 * for the rival leading the match, and much more in the last hand for the rivals still in contention.
 */
function rivalWeight(table: GongZhuTable, seat: number, other: number): number {
  if (other === seat) return -1;
  const mine = STANDING[seat];
  let best = -Infinity;
  for (let rival = 0; rival < 4; rival++) if (rival !== seat) best = Math.max(best, STANDING[rival]);
  const theirs = STANDING[other];
  if (table.handsLeft === 0) {
    // In the last hand only the rival who decides the winner matters.
    if (theirs >= best - 60) return mine >= best - 200 ? 0.8 : 0.5;
    return 0.1;
  }
  return theirs >= best ? 0.5 : 0.3;
}

/** The seat's value of `winner` capturing the open trick plus `extra` cards. */
function outcome(table: GongZhuTable, seat: number, winner: number, extra: ArrayLike<number>, count: number): number {
  const codes = SCRATCH_CODES;
  let size = 0;
  for (let index = 0; index < table.trickSize; index++) codes[size++] = table.trick[index];
  for (let index = 0; index < count; index++) codes[size++] = extra[index];
  const value = gain(table, winner, codes, size);
  return winner === seat ? value : -rivalWeight(table, seat, winner) * value;
}

const SCRATCH_CODES = new Int32Array(8);
const ONE = new Int32Array(1);
const OUT = new Int32Array(4);
const LEGAL = new Int32Array(4);

/** Totals so far per seat: match totals plus the current value of its captures; set by `prepare`. */
const STANDING = new Float64Array(4);
/** The open trick's current winner and its rank; set by `prepare`. */
let winnerSeat = 0;
let winningRank = 0;

/** Fills the scratch state for the seat's decision: unseen cards, standings, and the open trick's winner. */
function prepare(table: GongZhuTable, seat: number): void {
  for (let suit = 0; suit < 4; suit++) OUT[suit] = FULL_SUIT & ~table.played[suit] & ~table.hands[seat * 4 + suit];
  for (let other = 0; other < 4; other++) {
    STANDING[other] = table.scores[other] + gongZhuMaskScore(table.capturedHearts[other], table.capturedSpecial[other]);
  }
  if (table.trickSize === 0) return;
  const lead = suitOf(table.trick[0]);
  winnerSeat = table.leader;
  winningRank = rankOf(table.trick[0]);
  for (let index = 1; index < table.trickSize; index++) {
    const card = table.trick[index];
    if (suitOf(card) === lead && rankOf(card) > winningRank) {
      winningRank = rankOf(card);
      winnerSeat = (table.leader + index) % 4;
    }
  }
}

const unseenHas = (code: number): boolean => (OUT[suitOf(code)] & (1 << rankOf(code))) !== 0;

function voidSeats(table: GongZhuTable, suit: number, seat: number, after: number): number {
  let count = 0;
  for (let step = 1; step <= after; step++) if ((table.voids[(seat + step) % 4] & (1 << suit)) !== 0) count++;
  return count;
}

/** Expected value, for the trick's eventual winner, of what `followers` later seats add to a trick of `suit`. */
function expectedAdds(table: GongZhuTable, seat: number, suit: number, rank: number, followers: number): number {
  if (followers <= 0) return 0;
  const count = popcount(OUT[suit]);
  const known = voidSeats(table, suit, seat, followers);
  const unknown = followers - known;
  const perSeat = Math.max(1, count / Math.max(1, 3 - known));
  const voids = known + unknown * Math.pow(2 / 3, perSeat + 1);
  // A void seat dumps its worst card on the winner: the pig when it may hold it, otherwise a high heart.
  const pigOut = unseenHas(PIG);
  let value = voids * ((pigOut ? -40 : 0) + (popcount(OUT[HEARTS] & VALUED_HEARTS) > 0 ? -20 : 0));
  if (suit === HEARTS) {
    value += (count > 0 ? HEART_SUMS[OUT[HEARTS]] / count : 0) * Math.min(followers - known, count);
  }
  if (suit === SPADES && pigOut && rank > QUEEN) value -= 100 * 0.85 * followers / 3;
  if (suit === DIAMONDS && unseenHas(GOAT) && rank > JACK) value += 100 * 0.15 * followers / 3;
  return value;
}

/** Chance that a card of `rank` led into `count` unseen cards of its suit holds the trick. */
function leadHolds(table: GongZhuTable, seat: number, suit: number, rank: number): number {
  const count = popcount(OUT[suit]);
  const higher = popcount(OUT[suit] & above(rank));
  if (higher === 0 || count === 0) return 1;
  const lower = count - higher;
  if (lower === 0) return 0;
  const active = Math.max(1, 3 - voidSeats(table, suit, seat, 3));
  const allHigh = Math.pow(higher / count, Math.max(1, count / active));
  return Math.pow(1 - allHigh, active) * Math.pow(0.85, higher);
}

function leadScore(table: GongZhuTable, seat: number, code: number): number {
  const suit = suitOf(code);
  const rank = rankOf(code);
  const hold = leadHolds(table, seat, suit, rank);
  ONE[0] = code;
  const mine = gain(table, seat, ONE, 1) + expectedAdds(table, seat, suit, rank, 3);
  // Losing the trick hands the led card to a rival.
  const lost = -0.35 * cardValue(code);
  let score = hold * mine + (1 - hold) * lost;
  const held = table.hands[seat * 4 + suit];
  if (suit === SPADES && unseenHas(PIG) && rank < QUEEN && (held & above(QUEEN)) === 0) score += 6;
  if (suit === SPADES && (held & (1 << QUEEN)) !== 0 && code !== PIG && popcount(held) <= 3) score -= 10;
  if (suit === DIAMONDS && (held & (1 << JACK)) !== 0 && code !== GOAT && rank < JACK) score -= 4;
  if (suit !== HEARTS && popcount(held) <= 2) score += 2;
  return score - rank * 0.1;
}

function followScore(table: GongZhuTable, seat: number, code: number): number {
  const suit = suitOf(code);
  const rank = rankOf(code);
  const winner = winnerSeat;
  ONE[0] = code;
  if (rank < winningRank) return outcome(table, seat, winner, ONE, 1) + rank * 0.3;
  const after = 3 - table.trickSize;
  const higher = popcount(OUT[suit] & above(rank));
  const overtake = after > 0 && higher > 0 ? Math.min(0.7, 0.2 * higher + 0.1) * (after >= 2 ? 1 : 0.7) : 0;
  const mine = outcome(table, seat, seat, ONE, 1) + expectedAdds(table, seat, suit, rank, after);
  const lost = after > 0 ? outcome(table, seat, (seat + 1) % 4, ONE, 1) : 0;
  return (1 - overtake) * mine + overtake * lost + rank * 0.3;
}

function discardScore(table: GongZhuTable, seat: number, code: number): number {
  const suit = suitOf(code);
  const rank = rankOf(code);
  const winner = winnerSeat;
  ONE[0] = code;
  let score = outcome(table, seat, winner, ONE, 1) - outcome(table, seat, winner, ONE, 0);
  const held = table.hands[seat * 4 + suit];
  // Keeping a high card in a short suit, or a spade above an unseen pig, risks taking bad tricks later.
  if (suit === SPADES && rank > QUEEN && unseenHas(PIG)) score += 25;
  else if (code !== GOAT && suit !== HEARTS) {
    score += rank * 0.8 + popcount(OUT[suit] & below(rank)) * 0.5 + (popcount(held) <= 2 ? 3 - popcount(held) : 0);
  }
  if (suit === HEARTS) score += 4 + rank * 0.5;
  if (code === PIG) score += 30;
  if (code === GOAT) score -= 30;
  return score;
}

/** A seat that captured every heart taken so far and enough of them to threaten the sweep, or -1. */
export function sweepThreat(table: GongZhuTable): number {
  let taker = -1;
  for (let seat = 0; seat < 4; seat++) {
    if (table.capturedHearts[seat] === 0) continue;
    if (taker >= 0) return -1;
    taker = seat;
  }
  if (taker < 0) return -1;
  const count = popcount(table.capturedHearts[taker]);
  return count >= 6 || (count >= 4 && table.tricksDone >= 8) ? taker : -1;
}

function controls(table: GongZhuTable, seat: number): number {
  let count = 0;
  for (let suit = 0; suit < 4; suit++) {
    const top = highest(OUT[suit]);
    count += popcount(table.hands[seat * 4 + suit] & (top < 0 ? FULL_SUIT : above(top)));
  }
  return count;
}

function sweeping(table: GongZhuTable, seat: number): boolean {
  for (let other = 0; other < 4; other++) if (other !== seat && table.capturedHearts[other] !== 0) return false;
  if (popcount(table.capturedHearts[seat]) < 5) return false;
  let size = 0;
  for (let suit = 0; suit < 4; suit++) size += popcount(table.hands[seat * 4 + suit]);
  return size - controls(table, seat) <= 1;
}

function sweepScore(table: GongZhuTable, code: number): number {
  const suit = suitOf(code);
  const rank = rankOf(code);
  const sure = (OUT[suit] & above(rank)) === 0;
  if (table.trickSize === 0) return (sure ? 20 : 0) + (suit === HEARTS && sure ? 5 : 0) + rank;
  if (suit !== suitOf(table.trick[0])) return (suit === HEARTS ? -50 : 0) - rank - (sure ? 15 : 0) + (code === PIG ? -5 : 0);
  if (rank < winningRank) return -rank;
  return 30 + (table.trickSize === 3 ? -rank : rank);
}

function blockScore(table: GongZhuTable, seat: number, code: number, sweeper: number): number | null {
  const suit = suitOf(code);
  const rank = rankOf(code);
  if (table.trickSize === 0) {
    if (suit === HEARTS && (OUT[HEARTS] & above(rank)) === 0) return 200 + rank;
    return null;
  }
  const lead = suitOf(table.trick[0]);
  const winner = winnerSeat;
  const winning = winningRank;
  let sweeperAfter = false;
  for (let step = 1; step <= 3 - table.trickSize; step++) if ((seat + step) % 4 === sweeper) sweeperAfter = true;
  let hearts = 0;
  for (let index = 0; index < table.trickSize; index++) if (suitOf(table.trick[index]) === HEARTS) hearts++;
  if (suit === lead) {
    if ((hearts > 0 || suit === HEARTS) && (winner === sweeper || sweeperAfter) && rank > winning) return 200 + rank;
    return null;
  }
  if (suit === HEARTS) return winner === sweeper || sweeperAfter ? -200 : 150 - rank;
  return null;
}

function cardScore(table: GongZhuTable, seat: number, code: number, mode: number): number {
  if (mode === -2) return sweepScore(table, code);
  if (mode >= 0) {
    const block = blockScore(table, seat, code, mode);
    if (block !== null) return block;
  }
  if (table.trickSize === 0) return leadScore(table, seat, code);
  if (suitOf(code) === suitOf(table.trick[0])) return followScore(table, seat, code);
  return discardScore(table, seat, code);
}

function policyMode(table: GongZhuTable, seat: number): number {
  if (sweeping(table, seat)) return -2;
  const threat = sweepThreat(table);
  return threat >= 0 && threat !== seat ? threat : -1;
}

/** The policy's choice for the seat to act; used for every seat in rollouts. */
export function gongZhuPolicyCard(table: GongZhuTable): number {
  const seat = table.turn;
  prepare(table, seat);
  gongZhuLegalMasks(table, LEGAL);
  const mode = policyMode(table, seat);
  let best = -1;
  let bestScore = -Infinity;
  for (let suit = 0; suit < 4; suit++) {
    for (let bits = LEGAL[suit]; bits !== 0; bits &= bits - 1) {
      const code = suit * 13 + lowest(bits);
      const score = cardScore(table, seat, code, mode);
      if (score > bestScore) {
        bestScore = score;
        best = code;
      }
    }
  }
  return best;
}

export function gongZhuScoredCards(table: GongZhuTable): { code: number; score: number }[] {
  const seat = table.turn;
  prepare(table, seat);
  gongZhuLegalMasks(table, LEGAL);
  const mode = policyMode(table, seat);
  return maskCodes(LEGAL).map((code) => ({ code, score: cardScore(table, seat, code, mode) }));
}

/** The public table from the seat's filtered view; other hands stay empty. */
export function gongZhuTableFromView(view: GongZhuVisibleState): GongZhuTable {
  const seatIndex = (seat: Seat): number => SEAT_ORDER_CLOCKWISE.indexOf(seat);
  const me = seatIndex(view.mySeat);
  const hands = new Int32Array(16);
  suitMasks(view.myHand).forEach((mask, suit) => { hands[me * 4 + suit] = mask; });
  const played = new Int32Array(4);
  const voids = new Int32Array(4);
  const record = (plays: readonly { seat: Seat; card: Card }[]): void => {
    for (const play of plays) {
      played[SUITS_INDEX[play.card.suit]] |= 1 << (play.card.rank - 2);
      if (play.card.suit !== plays[0].card.suit) voids[seatIndex(play.seat)] |= 1 << SUITS_INDEX[plays[0].card.suit];
    }
  };
  for (const trick of view.tricks) record(trick.plays);
  record(view.trick);
  const capturedHearts = new Int32Array(4);
  const capturedSpecial = new Int32Array(4);
  for (const seat of SEAT_ORDER_CLOCKWISE) {
    for (const card of view.captures[seat]) {
      const code = cardCode(card);
      if (card.suit === 'hearts') capturedHearts[seatIndex(seat)] |= 1 << rankOf(code);
      else capturedSpecial[seatIndex(seat)] |= specialBit(code);
    }
  }
  const trick = new Int32Array(4);
  view.trick.forEach((play, index) => { trick[index] = cardCode(play.card); });
  return {
    hands, played, voids, capturedHearts, capturedSpecial, trick, trickSize: view.trick.length,
    leader: seatIndex(view.trick[0]?.seat ?? view.mySeat), turn: me, tricksDone: view.tricks.length,
    scores: SEAT_ORDER_CLOCKWISE.map((seat) => view.scores[seat]), handsLeft: Math.max(0, GONGZHU_HANDS - view.hand),
  };
}

const SUITS_INDEX: Record<Card['suit'], number> = { clubs: 0, diamonds: 1, hearts: 2, spades: 3 };

function legal(visible: GongZhuVisibleState): Card[] {
  return visible.phase === 'playing' && !visible.observer && visible.currentTurnSeat === visible.mySeat
    ? gongZhuLegalCards(visible.myHand, visible.trick, visible.tricks.length === 0) : [];
}

function action(card: Card | undefined): BotAction | null {
  return card ? { type: 'game-action', request: { gameType: 'gongzhu', action: { type: 'play', card } } } : null;
}

export function gongZhuFirstLegalAction(visible: GongZhuVisibleState): BotAction | null { return action(legal(visible)[0]); }

/** The seat's legal cards scored by the policy from its own view. */
export function gongZhuViewScores(visible: GongZhuVisibleState): { card: Card; score: number }[] {
  const cards = legal(visible);
  if (cards.length === 0) return [];
  const allowed = new Set(cards.map(cardCode));
  return gongZhuScoredCards(gongZhuTableFromView(visible)).filter((option) => allowed.has(option.code))
    .map((option) => ({ card: codeCard(option.code), score: option.score }));
}

/**
 * Counts cards, voids, and every seat's captures; values each trick exactly for its winner (pig, goat,
 * hearts, transformer, sweep), dumps on the rival who matters most, and attempts or blocks the heart sweep.
 */
export function getGongZhuBotAction(visible: GongZhuVisibleState, random: () => number = Math.random): BotAction | null {
  const scored = gongZhuViewScores(visible);
  return action(selectNearBest(scored.map((option) => ({ value: option.card, score: option.score })), random, 0.5) ?? undefined);
}
