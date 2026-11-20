import type { Card, Seat } from '@shared/types';
import type { HeartsAction, HeartsVisibleState } from '@shared/games/hearts/types';
import { HEARTS_SEATS, HEARTS_TARGET } from '@shared/rules/hearts';
import type { BotAction } from './bot-decisions';
import { selectNearBest } from './selection';
import {
  ACE, above, below, cardCode, codeCard, FULL_SUIT, HEARTS, highest, KING, lowest, maskCodes, popcount, QUEEN, rankOf,
  SPADES, suitMasks, suitOf,
} from './trick-masks';

// Hearts bot: card counting from the public record (cards played, suits each seat has shown out of, points
// taken), score-aware dumping, and moon shooting and blocking. The same policy plays every seat in the
// search's rollouts, so it reads only what its seat could know: its own hand and the public table.

/** Seat indexes follow HEARTS_SEATS (clockwise); passing left is the next index. */
export interface HeartsTable {
  /** Suit masks per seat at `seat * 4 + suit`; outside a rollout only the deciding seat's hand is filled. */
  readonly hands: Int32Array;
  /** Every card played this hand, the open trick included, per suit. */
  readonly played: Int32Array;
  /** Per seat, a bit per suit the seat is known to hold no more of. */
  readonly voids: Int32Array;
  /** Penalty points each seat captured this hand. */
  readonly points: Int32Array;
  /** The open trick's cards in play order. */
  readonly trick: Int32Array;
  trickSize: number;
  leader: number;
  turn: number;
  tricksDone: number;
  broken: boolean;
  /** Match totals before this hand. */
  readonly scores: readonly number[];
}

export const QUEEN_OF_SPADES = SPADES * 13 + QUEEN;

export function heartsCardPoints(code: number): number {
  return code === QUEEN_OF_SPADES ? 13 : suitOf(code) === HEARTS ? 1 : 0;
}

/** Legal cards for the seat to act, as suit masks written into `out`. */
export function heartsLegalMasks(table: HeartsTable, out: Int32Array): void {
  const base = table.turn * 4;
  const hand = table.hands;
  out.fill(0);
  if (table.trickSize === 0) {
    if (table.tricksDone === 0) {
      out[0] = hand[base] & 1;
      if (out[0] !== 0) return;
    }
    const nonHearts = hand[base] | hand[base + 1] | hand[base + 3];
    for (let suit = 0; suit < 4; suit++) out[suit] = hand[base + suit];
    if (!table.broken && nonHearts !== 0) out[HEARTS] = 0;
    return;
  }
  const lead = suitOf(table.trick[0]);
  if (hand[base + lead] !== 0) {
    out[lead] = hand[base + lead];
    return;
  }
  for (let suit = 0; suit < 4; suit++) out[suit] = hand[base + suit];
  if (table.tricksDone === 0) {
    // The first trick allows penalty cards only when the hand holds nothing else.
    const safeSpades = hand[base + SPADES] & ~(1 << QUEEN);
    if ((hand[base] | hand[base + 1] | safeSpades) !== 0) {
      out[HEARTS] = 0;
      out[SPADES] = safeSpades;
    }
  }
}

/** A seat that has taken every point so far and enough of them to be heading for the moon, or -1. */
export function moonThreat(table: HeartsTable): number {
  let taker = -1;
  for (let seat = 0; seat < 4; seat++) {
    if (table.points[seat] === 0) continue;
    if (taker >= 0) return -1;
    taker = seat;
  }
  if (taker < 0) return -1;
  const points = table.points[taker];
  return points >= 14 || (points >= 7 && table.tricksDone >= 7) ? taker : -1;
}

/** Cards of the seat's hand that beat every card of their suit the seat has not seen. */
function controls(table: HeartsTable, seat: number, out: Int32Array): number {
  let count = 0;
  for (let suit = 0; suit < 4; suit++) {
    const mine = table.hands[seat * 4 + suit];
    const top = highest(out[suit]);
    count += popcount(mine & (top < 0 ? FULL_SUIT : above(top)));
  }
  return count;
}

function handSize(table: HeartsTable, seat: number): number {
  const base = seat * 4;
  return popcount(table.hands[base]) + popcount(table.hands[base + 1]) + popcount(table.hands[base + 2])
    + popcount(table.hands[base + 3]);
}

/** Whether the seat to act is shooting: it holds every point so far and can win nearly every remaining trick. */
function shooting(table: HeartsTable, seat: number, out: Int32Array): boolean {
  let others = 0;
  for (let other = 0; other < 4; other++) if (other !== seat) others += table.points[other];
  if (others > 0 || table.points[seat] < 10) return false;
  return handSize(table, seat) - controls(table, seat, out) <= 1;
}

/**
 * How much the seat welcomes `points` landing on `receiver`: 1 normally, more on the match leader, and
 * strongly positive or negative when the points would end the match with the seat winning or losing.
 */
function dumpWeight(table: HeartsTable, seat: number, receiver: number, points: number): number {
  if (receiver === seat) return -1;
  const total = (other: number): number => table.scores[other] + table.points[other];
  const landed = total(receiver) + points;
  if (landed >= HEARTS_TARGET) {
    let lowestOther = landed;
    for (let other = 0; other < 4; other++) if (other !== seat && other !== receiver) lowestOther = Math.min(lowestOther, total(other));
    return total(seat) <= lowestOther ? 4 : -0.5;
  }
  for (let other = 0; other < 4; other++) if (other !== receiver && total(other) < total(receiver)) return 1;
  return 1.3;
}

/** Seats still to play after the seat to act in the open trick. */
const seatsAfter = (table: HeartsTable): number => 3 - table.trickSize;

function voidSeats(table: HeartsTable, suit: number, seat: number): number {
  let count = 0;
  for (let other = 0; other < 4; other++) if (other !== seat && (table.voids[other] & (1 << suit)) !== 0) count++;
  return count;
}

/** Expected penalty points dumped on a trick of `suit` by `followers` seats, `known` of them void already. */
function expectedDumps(suit: number, followers: number, known: number, outstanding: number, queenOut: boolean): number {
  if (followers <= 0) return 0;
  const unknown = Math.max(0, followers - known);
  const perSeat = Math.max(1, outstanding / Math.max(1, 3 - known));
  const voidChance = known + unknown * Math.pow(2 / 3, perSeat + 1);
  return suit === HEARTS ? 0 : voidChance * (queenOut ? 5 : 1.6);
}

/** Scratch masks reused across calls; the policy is synchronous and never re-entered. */
const OUT = new Int32Array(4);
const LEGAL = new Int32Array(4);

/** The open trick's current winner, its rank, and its points; set by `prepare` for one decision. */
let winnerSeat = 0;
let winningRank = 0;
let pendingPoints = 0;

/** Fills the scratch state for the seat's decision: the unseen cards and the open trick's standing. */
function prepare(table: HeartsTable, seat: number): void {
  for (let suit = 0; suit < 4; suit++) OUT[suit] = FULL_SUIT & ~table.played[suit] & ~table.hands[seat * 4 + suit];
  pendingPoints = 0;
  if (table.trickSize === 0) return;
  const lead = suitOf(table.trick[0]);
  winnerSeat = table.leader;
  winningRank = rankOf(table.trick[0]);
  for (let index = 0; index < table.trickSize; index++) {
    const card = table.trick[index];
    pendingPoints += heartsCardPoints(card);
    if (index > 0 && suitOf(card) === lead && rankOf(card) > winningRank) {
      winningRank = rankOf(card);
      winnerSeat = (table.leader + index) % 4;
    }
  }
}

/** Scores the seat's lead of `code`: larger is better. */
function leadScore(table: HeartsTable, seat: number, code: number): number {
  const suit = suitOf(code);
  const rank = rankOf(code);
  const mine = table.hands[seat * 4 + suit];
  const unseen = OUT[suit];
  const count = popcount(unseen);
  const higher = popcount(unseen & above(rank));
  const lower = count - higher;
  const known = voidSeats(table, suit, seat);
  const active = Math.max(1, 3 - known);
  const queenOut = (OUT[SPADES] & (1 << QUEEN)) !== 0;
  let win: number;
  if (higher === 0) win = 1;
  else if (count === 0) win = 1;
  else {
    // Each follower ducks when it holds a lower card; one without any must overtake.
    const each = count / active;
    const allHigh = Math.pow(higher / count, Math.max(1, each));
    win = lower === 0 ? 0 : Math.pow(1 - allHigh, active) * Math.pow(0.85, higher);
  }
  let taken = heartsCardPoints(code) + expectedDumps(suit, 3, known, count, queenOut);
  if (suit === HEARTS) taken += Math.min(active, count);
  if (suit === SPADES && queenOut && rank > QUEEN) taken += 13 * 0.85;
  let score = -win * taken;
  if (suit === SPADES && queenOut && rank < QUEEN && (mine & (above(QUEEN))) === 0) score += 1.2;
  const queenMine = (mine & (1 << QUEEN)) !== 0 && suit === SPADES;
  if (queenMine && code !== QUEEN_OF_SPADES && popcount(mine) <= 3) score -= 2;
  if (suit !== HEARTS && suit !== SPADES && popcount(mine) <= 2) score += 0.4;
  return score - rank * 0.02;
}

/** Scores following suit with `code` below or above the current winner. */
function followScore(table: HeartsTable, seat: number, code: number): number {
  const suit = suitOf(code);
  const rank = rankOf(code);
  const winning = winningRank;
  const points = pendingPoints;
  const queenOut = (OUT[SPADES] & (1 << QUEEN)) !== 0;
  if (rank < winning) {
    let score = rank * 0.05;
    if (code === QUEEN_OF_SPADES) score += 13 * dumpWeight(table, seat, winnerSeat, points + 13) * 0.4;
    else if (suit === SPADES && rank > QUEEN) score += 1;
    return score;
  }
  const after = seatsAfter(table);
  const unseen = OUT[suit];
  const count = popcount(unseen);
  const higher = popcount(unseen & above(rank));
  let overtake = 0;
  if (after > 0 && higher > 0) overtake = Math.min(0.7, 0.2 * higher + 0.1) * (after >= 2 ? 1 : 0.7);
  let taken = points + heartsCardPoints(code);
  if (after > 0) {
    let knownAfter = 0;
    for (let step = 1; step <= after; step++) if ((table.voids[(seat + step) % 4] & (1 << suit)) !== 0) knownAfter++;
    taken += expectedDumps(suit, after, knownAfter, count, queenOut);
    if (suit === HEARTS) taken += Math.min(after - knownAfter, count);
    if (suit === SPADES && queenOut && rank > QUEEN) taken += 13 * 0.8 * after / 3;
  }
  let score = -(1 - overtake) * taken;
  // A trick that is going to be won anyway is the moment to shed a high card.
  score += rank * 0.05;
  if (suit === SPADES && rank > QUEEN && queenOut && taken < 1) score += 2;
  return score;
}

/** Scores discarding `code` when void in the led suit. */
function discardScore(table: HeartsTable, seat: number, code: number): number {
  const suit = suitOf(code);
  const rank = rankOf(code);
  const receiver = winnerSeat;
  const pending = pendingPoints;
  const mine = table.hands[seat * 4 + suit];
  const penalty = heartsCardPoints(code);
  if (penalty > 0) {
    const weight = dumpWeight(table, seat, receiver, pending + penalty);
    return code === QUEEN_OF_SPADES ? 40 * weight : (10 + rank) * Math.min(1, weight) + (weight > 1 ? 4 : 0);
  }
  const queenOut = (OUT[SPADES] & (1 << QUEEN)) !== 0;
  if (suit === SPADES && rank > QUEEN && (queenOut || (mine & (1 << QUEEN)) !== 0)) return 12 + rank;
  const count = popcount(mine);
  const lowerUnseen = popcount(OUT[suit] & below(rank));
  return rank + (count <= 2 ? 3 - count : 0) + lowerUnseen * 0.3;
}

/** Shooting: win every trick, leading cards nobody can beat. */
function shootScore(table: HeartsTable, code: number): number {
  const suit = suitOf(code);
  const rank = rankOf(code);
  const unseen = OUT[suit];
  const sure = (unseen & above(rank)) === 0;
  if (table.trickSize === 0) return (sure ? 20 : 0) + (suit === HEARTS && sure ? 5 : 0) + rank;
  const lead = suitOf(table.trick[0]);
  if (suit !== lead) return -heartsCardPoints(code) * 10 - rank - (sure ? 15 : 0);
  if (rank < winningRank) return -rank;
  return 30 + (seatsAfter(table) === 0 ? -rank : rank);
}

/** Blocking another seat's moon: take a trick with points, or give points to anyone else. */
function blockScore(table: HeartsTable, seat: number, code: number, shooter: number): number | null {
  const suit = suitOf(code);
  const rank = rankOf(code);
  if (table.trickSize === 0) {
    // A heart nobody can beat takes a point away from the shooter.
    if (suit === HEARTS && (OUT[HEARTS] & above(rank)) === 0) return 50 + rank;
    return null;
  }
  const lead = suitOf(table.trick[0]);
  const winner = winnerSeat;
  const winning = winningRank;
  let shooterAfter = false;
  for (let step = 1; step <= seatsAfter(table); step++) if ((seat + step) % 4 === shooter) shooterAfter = true;
  const points = pendingPoints;
  if (suit === lead) {
    // Taking the queen to stop a moon pays only once the moon is close.
    const affordable = points < 13 || table.points[shooter] >= 20;
    if ((points > 0 || suit === HEARTS) && affordable && (winner === shooter || shooterAfter) && rank > winning) return 40 + rank;
    return null;
  }
  const penalty = heartsCardPoints(code);
  if (winner === shooter || shooterAfter) return penalty > 0 ? -penalty * 5 : rank;
  return penalty > 0 ? 40 + penalty : null;
}

function cardScore(table: HeartsTable, seat: number, code: number, mode: number): number {
  if (mode === -2) return shootScore(table, code);
  if (mode >= 0) {
    const block = blockScore(table, seat, code, mode);
    if (block !== null) return block;
  }
  if (table.trickSize === 0) return leadScore(table, seat, code);
  if (suitOf(code) === suitOf(table.trick[0])) return followScore(table, seat, code);
  return discardScore(table, seat, code);
}

/** -2 when the seat to act is shooting, a shooter's seat to block, or -1. */
function policyMode(table: HeartsTable, seat: number): number {
  if (shooting(table, seat, OUT)) return -2;
  const threat = moonThreat(table);
  return threat >= 0 && threat !== seat ? threat : -1;
}

/** The policy's choice for the seat to act; used for every seat in rollouts. */
export function heartsPolicyCard(table: HeartsTable): number {
  const seat = table.turn;
  prepare(table, seat);
  heartsLegalMasks(table, LEGAL);
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

/** Every legal card of the seat to act with the policy's score, larger is better. */
export function heartsScoredCards(table: HeartsTable): { code: number; score: number }[] {
  const seat = table.turn;
  prepare(table, seat);
  heartsLegalMasks(table, LEGAL);
  const mode = policyMode(table, seat);
  const scored: { code: number; score: number }[] = [];
  for (const code of maskCodes(LEGAL)) scored.push({ code, score: cardScore(table, seat, code, mode) });
  return scored;
}

/** The public table from the seat's filtered view; other hands stay empty. */
export function heartsTableFromView(view: HeartsVisibleState): HeartsTable {
  const seatIndex = (seat: Seat): number => HEARTS_SEATS.indexOf(seat);
  const me = seatIndex(view.mySeat);
  const hands = new Int32Array(16);
  suitMasks(view.myHand).forEach((mask, suit) => { hands[me * 4 + suit] = mask; });
  const played = new Int32Array(4);
  const voids = new Int32Array(4);
  const points = new Int32Array(4);
  let broken = false;
  const record = (plays: readonly { seat: Seat; card: Card }[]): void => {
    if (plays.length === 0) return;
    const lead = plays[0].card.suit;
    // Leading a heart before they were broken shows a hand of nothing but hearts.
    if (lead === 'hearts' && !broken) voids[seatIndex(plays[0].seat)] |= 0b1011;
    for (const play of plays) {
      const code = cardCode(play.card);
      played[suitOf(code)] |= 1 << rankOf(code);
      if (play.card.suit !== lead) voids[seatIndex(play.seat)] |= 1 << suitOf(cardCode(plays[0].card));
      if (play.card.suit === 'hearts') broken = true;
    }
  };
  for (const trick of view.tricks) {
    record(trick.plays);
    points[seatIndex(trick.winner)] += trick.plays.reduce((sum, play) => sum + heartsCardPoints(cardCode(play.card)), 0);
  }
  const plays = view.trick?.plays ?? [];
  record(plays);
  const trick = new Int32Array(4);
  plays.forEach((play, index) => { trick[index] = cardCode(play.card); });
  return {
    hands, played, voids, points, trick, trickSize: plays.length,
    leader: seatIndex(view.trick?.leadSeat ?? view.mySeat), turn: me, tricksDone: view.tricks.length,
    broken: view.heartsBroken, scores: HEARTS_SEATS.map((seat) => view.scores[seat]),
  };
}

// Passing -------------------------------------------------------------------------------------------------

/** Danger of keeping a hand (suit masks), in rough penalty points; the pass keeps the safest ten cards. */
export function heartsHandDanger(masks: readonly number[]): number {
  let danger = 0;
  const spades = masks[SPADES];
  const queen = (spades & (1 << QUEEN)) !== 0;
  const lowSpades = popcount(spades & below(QUEEN));
  if (queen) danger += lowSpades >= 4 ? 3 : lowSpades === 3 ? 9 : lowSpades === 2 ? 16 : 24;
  for (const rank of [KING, ACE]) {
    if ((spades & (1 << rank)) === 0) continue;
    // Without the queen, a high spade catches it; low spades let the seat duck spade leads.
    danger += queen ? 2 : lowSpades >= 4 ? 3 : lowSpades >= 2 ? 7 : 12;
  }
  for (let suit = 0; suit < 4; suit++) {
    const mask = masks[suit];
    const count = popcount(mask);
    if (suit !== SPADES && count === 0) danger -= suit === HEARTS ? 1 : 5;
    if (suit !== SPADES && count === 1) danger -= 1;
    const low = popcount(mask & below(5));
    for (let bits = mask; bits !== 0; bits &= bits - 1) {
      const rank = lowest(bits);
      if (suit === SPADES && rank >= QUEEN) continue;
      const exposure = Math.max(0, rank - 6);
      if (exposure === 0) continue;
      const weight = suit === HEARTS ? 0.5 : suit === SPADES ? 0.25 : 0.4;
      danger += (exposure * exposure * weight) / (1 + low);
    }
  }
  return danger;
}

/** Every three-card pass ranked by the danger of the ten cards kept, lowest first. */
export function rankedHeartsPasses(hand: readonly Card[]): { cards: Card[]; danger: number }[] {
  const masks = suitMasks(hand);
  const codes = hand.map(cardCode);
  const options: { cards: Card[]; danger: number }[] = [];
  for (let a = 0; a < codes.length; a++) {
    for (let b = a + 1; b < codes.length; b++) {
      for (let c = b + 1; c < codes.length; c++) {
        const kept = [...masks];
        for (const code of [codes[a], codes[b], codes[c]]) kept[suitOf(code)] &= ~(1 << rankOf(code));
        options.push({ cards: [hand[a], hand[b], hand[c]], danger: heartsHandDanger(kept) });
      }
    }
  }
  return options.sort((x, y) => x.danger - y.danger);
}

/** The safest three-card pass from a hand of suit masks, as card codes; for hands sampled in the search. */
export function bestHeartsPassCodes(masks: readonly number[]): number[] {
  const codes = maskCodes(masks);
  const kept = [0, 0, 0, 0];
  let best: number[] = codes.slice(0, 3);
  let bestDanger = Infinity;
  for (let a = 0; a < codes.length; a++) {
    for (let b = a + 1; b < codes.length; b++) {
      for (let c = b + 1; c < codes.length; c++) {
        for (let suit = 0; suit < 4; suit++) kept[suit] = masks[suit];
        for (const code of [codes[a], codes[b], codes[c]]) kept[suitOf(code)] &= ~(1 << rankOf(code));
        const danger = heartsHandDanger(kept);
        if (danger < bestDanger) {
          bestDanger = danger;
          best = [codes[a], codes[b], codes[c]];
        }
      }
    }
  }
  return best;
}

// Actions ------------------------------------------------------------------------------------------------

const wrap = (action: HeartsAction): BotAction => ({ type: 'game-action', request: { gameType: 'hearts', action } });

export function heartsPassPending(view: HeartsVisibleState): boolean {
  return view.phase === 'passing' && view.passDirection !== 'hold' && !view.passedSeats.includes(view.mySeat)
    && view.myHand.length >= 3;
}

export function heartsFirstLegalAction(view: HeartsVisibleState): BotAction | null {
  if (heartsPassPending(view)) return wrap({ type: 'pass', cards: view.myHand.slice(0, 3) });
  return view.validCards[0] ? wrap({ type: 'play', card: view.validCards[0] }) : null;
}

/** The pass: the three cards whose removal leaves the safest hand, varied among near-equal choices. */
export function heartsPassAction(view: HeartsVisibleState, random: () => number): BotAction {
  const ranked = rankedHeartsPasses(view.myHand).slice(0, 12);
  const cards = selectNearBest(ranked.map((option) => ({ value: option.cards, score: -option.danger })), random, 0.25)!;
  return wrap({ type: 'pass', cards });
}

/** Scores of the seat's legal cards from its own view, keyed by card code. */
export function heartsViewScores(view: HeartsVisibleState): { card: Card; score: number }[] {
  const table = heartsTableFromView(view);
  const legal = new Set(view.validCards.map(cardCode));
  return heartsScoredCards(table).filter((option) => legal.has(option.code))
    .map((option) => ({ card: codeCard(option.code), score: option.score }));
}

/**
 * Counts cards and voids from the public record, ducks under the winner, dumps the queen and high hearts
 * on others (preferring the match leader, never ending the match while behind), and shoots or blocks the moon.
 */
export function getHeartsBotAction(view: HeartsVisibleState, random: () => number = Math.random): BotAction | null {
  if (heartsPassPending(view)) return heartsPassAction(view, random);
  if (view.phase !== 'playing' || view.currentTurnSeat !== view.mySeat || view.validCards.length === 0) return null;
  const scored = heartsViewScores(view);
  const card = selectNearBest(scored.map((option) => ({ value: option.card, score: option.score })), random, 0.05);
  return card ? wrap({ type: 'play', card }) : null;
}
