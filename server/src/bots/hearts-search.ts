import type { GameSeat, Seat } from '@shared/types';
import type { HeartsVisibleState } from '@shared/games/hearts/types';
import { HEARTS_SEATS, HEARTS_TARGET, heartsPassTarget } from '@shared/rules/hearts';
import type { BotAction } from './bot-decisions';
import { dealUnseen } from './search/card-dealer';
import { determinizedSearch } from './search/determinized';
import type { Candidate, DeterminizedGame } from './search/determinized';
import type { SearchContext } from './search/search-types';
import {
  bestHeartsPassCodes, getHeartsBotAction, heartsCardPoints, heartsLegalMasks, heartsPassPending, heartsPolicyCard,
  heartsScoredCards, heartsTableFromView, QUEEN_OF_SPADES, rankedHeartsPasses,
} from './hearts-strategy';
import type { HeartsTable } from './hearts-strategy';
import { cardCode, codeCard, FULL_SUIT, HEARTS, lowest, maskCodes, rankOf, shedDoubts, suitMasks, suitOf } from './trick-masks';

// Determinized search for Hearts: the cards the seat has not seen are dealt to the other hands (exact hand
// sizes; suits a seat has shown out of and the seat's own passed cards are hard limits), every candidate is
// played on the same deal, and the hand is played out by the heuristic policy for all four seats. A result
// counts in match terms: the chance of finishing lowest once the hand's points are added.

/** Deals examined per decision at most; late in the hand they are cheap and this cap ends the search. */
const MAX_SAMPLES = 1200;
const MIN_SAMPLES = 12;
/** Standard errors within which candidates count as equal and the heuristic decides. */
const CONFIDENCE = 1;
const RESERVE_MS = 40;

/** Cards the seat passed this hand that the receiver has not played yet. */
function passedStillHeld(view: HeartsVisibleState, played: Int32Array): { seat: number; codes: number[] } | null {
  if (view.passDirection === 'hold' || view.myPass.length === 0) return null;
  const seat = HEARTS_SEATS.indexOf(heartsPassTarget(view.mySeat, view.passDirection));
  const codes = view.myPass.map(cardCode).filter((code) => (played[suitOf(code)] & (1 << rankOf(code))) === 0);
  return { seat, codes };
}

function copyTable(table: HeartsTable): HeartsTable {
  return {
    ...table, hands: table.hands.slice(), played: table.played.slice(), voids: table.voids.slice(),
    points: table.points.slice(), trick: table.trick.slice(),
  };
}

/** Plays `code` for the seat to act and completes the trick when it is the fourth card. */
export function playHeartsCard(table: HeartsTable, code: number): void {
  const suit = suitOf(code);
  const bit = 1 << rankOf(code);
  const seat = table.turn;
  table.hands[seat * 4 + suit] &= ~bit;
  table.played[suit] |= bit;
  if (table.trickSize > 0 && suitOf(table.trick[0]) !== suit) table.voids[seat] |= 1 << suitOf(table.trick[0]);
  if (suit === HEARTS) table.broken = true;
  table.trick[table.trickSize++] = code;
  if (table.trickSize < 4) {
    table.turn = (seat + 1) % 4;
    return;
  }
  const lead = suitOf(table.trick[0]);
  let winner = 0;
  let points = 0;
  for (let index = 0; index < 4; index++) {
    const card = table.trick[index];
    points += heartsCardPoints(card);
    if (index > 0 && suitOf(card) === lead && rankOf(card) > rankOf(table.trick[winner])) winner = index;
  }
  const winnerSeat = (table.leader + winner) % 4;
  table.points[winnerSeat] += points;
  table.leader = winnerSeat;
  table.turn = winnerSeat;
  table.trickSize = 0;
  table.tricksDone++;
}

/** Points each seat adds for a finished (or abandoned) hand, with the moon rule. */
function addedPoints(points: Int32Array): number[] {
  const moon = [0, 1, 2, 3].find((seat) => points[seat] === 26);
  return moon === undefined ? [...points] : [0, 1, 2, 3].map((seat) => (seat === moon ? 0 : 26));
}

/**
 * The seat's chance of winning the match once `totals` are reached: exact when someone reached the target,
 * otherwise a softmax over the totals whose spread shrinks as the match nears its end. A sliver of the
 * points gap keeps hopeless and settled positions ordered.
 */
export function heartsMatchValue(totals: readonly number[], seat: number): number {
  const top = Math.max(...totals);
  let others = 0;
  for (let other = 0; other < 4; other++) if (other !== seat) others += totals[other];
  const gap = (others / 3 - totals[seat]) * 0.001;
  if (top >= HEARTS_TARGET) return (totals[seat] === Math.min(...totals) ? 1 : 0) + gap;
  const spread = Math.max(5, 7.5 * Math.sqrt((HEARTS_TARGET - top) / 9 + 0.3));
  const low = Math.min(...totals);
  let sum = 0;
  for (let other = 0; other < 4; other++) sum += Math.exp(-(totals[other] - low) / spread);
  return Math.exp(-(totals[seat] - low) / spread) / sum + gap;
}

function utility(table: HeartsTable, seat: number): number {
  const added = addedPoints(table.points);
  return heartsMatchValue([0, 1, 2, 3].map((other) => table.scores[other] + added[other]), seat);
}

const LEGAL = new Int32Array(4);
/** Log-likelihood of holding the queen per passed-up chance to shed it; a holder sheds it about three times in four. */
const LOG_DOUBT = Math.log(0.25);

/** Per seat, chances to shed the queen of spades that it passed up this hand. */
function queenDoubts(view: HeartsVisibleState): number[] {
  const seat = (value: Seat): number => HEARTS_SEATS.indexOf(value);
  const tricks = [...view.tricks.map((trick) => trick.plays), view.trick?.plays ?? []]
    .map((plays) => plays.map((play) => ({ seat: seat(play.seat), code: cardCode(play.card) })));
  // The first trick forbids discarding the queen.
  return shedDoubts(tricks, QUEEN_OF_SPADES, (index) => index === 0);
}

export function heartsSearchGame(view: HeartsVisibleState): DeterminizedGame<HeartsTable, number> {
  const base = heartsTableFromView(view);
  const me = base.turn;
  const passed = passedStillHeld(view, base.played);
  const known = new Set(passed?.codes ?? []);
  const unseen: number[] = [];
  for (let suit = 0; suit < 4; suit++) {
    for (let bits = FULL_SUIT & ~base.played[suit] & ~base.hands[me * 4 + suit]; bits !== 0; bits &= bits - 1) {
      const code = suit * 13 + lowest(bits);
      if (!known.has(code)) unseen.push(code);
    }
  }
  const others = [1, 2, 3].map((step) => (me + step) % 4);
  const seats = others.map((seat) => ({
    size: view.handCounts[HEARTS_SEATS[seat]],
    known: passed?.seat === seat ? passed.codes : undefined,
    accepts: (code: number): boolean => (base.voids[seat] & (1 << suitOf(code))) === 0,
  }));
  const doubts = queenDoubts(view);
  const logLikelihood = doubts.some((count, index) => count > 0 && index !== me)
    ? (hands: readonly (readonly number[])[]): number => {
      const holder = hands.findIndex((hand) => hand.includes(QUEEN_OF_SPADES));
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
      heartsLegalMasks(table, LEGAL);
      return maskCodes(LEGAL);
    },
    play: playHeartsCard,
    rolloutMove: heartsPolicyCard,
    isTerminal: (table) => table.tricksDone === 13,
    utility: (table, seat) => utility(table, HEARTS_SEATS.indexOf(seat as typeof HEARTS_SEATS[number])),
  };
}

/** Legal cards grouped where no unseen card lies between them; each group plays the same. */
export function heartsCandidates(view: HeartsVisibleState): Candidate<number>[] {
  const table = heartsTableFromView(view);
  const scored = heartsScoredCards(table);
  const me = table.turn;
  const candidates: Candidate<number>[] = [];
  let previous = -1;
  for (const option of scored) {
    const code = option.code;
    const suit = suitOf(code);
    let touching = previous >= 0 && suitOf(previous) === suit && code !== QUEEN_OF_SPADES && previous !== QUEEN_OF_SPADES;
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

/** A deal before the pass: every hand full, the other seats' passes already chosen by the heuristic. */
interface PassWorld {
  readonly table: HeartsTable;
  /** Per seat, the cards it passes; null once the passes were exchanged. */
  passes: readonly (readonly number[])[] | null;
}

/** Pass candidates searched; the heuristic's safest passes. */
const PASS_CANDIDATES = 10;
const MAX_PASS_SAMPLES = 300;

/**
 * The pass as a search: each candidate pass is exchanged on the same sampled deal (the other seats pass by
 * the heuristic) and the hand is played out. A move is a candidate's index before the exchange and a card
 * code after it.
 */
export function heartsPassSearchGame(view: HeartsVisibleState, options: readonly (readonly number[])[]): DeterminizedGame<PassWorld, number> {
  const me = HEARTS_SEATS.indexOf(view.mySeat);
  const mine = suitMasks(view.myHand);
  const unseen: number[] = [];
  for (let suit = 0; suit < 4; suit++) {
    for (let bits = FULL_SUIT & ~mine[suit]; bits !== 0; bits &= bits - 1) unseen.push(suit * 13 + lowest(bits));
  }
  const others = [1, 2, 3].map((step) => (me + step) % 4);
  const target = HEARTS_SEATS.indexOf(heartsPassTarget(view.mySeat, view.passDirection)) - me;
  const scores = HEARTS_SEATS.map((seat) => view.scores[seat]);
  const play = (world: PassWorld, move: number): void => {
    if (!world.passes) {
      playHeartsCard(world.table, move);
      return;
    }
    const { hands } = world.table;
    const passes = world.passes.map((pass, seat) => (seat === me ? options[move] : pass));
    for (let seat = 0; seat < 4; seat++) for (const code of passes[seat]) hands[seat * 4 + suitOf(code)] &= ~(1 << rankOf(code));
    for (let seat = 0; seat < 4; seat++) {
      const receiver = (seat + target + 4) % 4;
      for (const code of passes[seat]) hands[receiver * 4 + suitOf(code)] |= 1 << rankOf(code);
    }
    let leader = 0;
    while ((hands[leader * 4] & 1) === 0) leader++;
    world.table.leader = leader;
    world.table.turn = leader;
    world.passes = null;
  };
  return {
    seat: view.mySeat as GameSeat,
    sample: (random) => {
      const deal = dealUnseen({ unseen, seats: others.map(() => ({ size: 13 })) }, random);
      if (!deal) return null;
      const hands = new Int32Array(16);
      mine.forEach((mask, suit) => { hands[me * 4 + suit] = mask; });
      deal.hands.forEach((hand, index) => {
        for (const code of hand) hands[others[index] * 4 + suitOf(code)] |= 1 << rankOf(code);
      });
      const passes = [0, 1, 2, 3].map((seat) => (seat === me ? [] : bestHeartsPassCodes(Array.from(hands.subarray(seat * 4, seat * 4 + 4)))));
      const table: HeartsTable = {
        hands, played: new Int32Array(4), voids: new Int32Array(4), points: new Int32Array(4), trick: new Int32Array(4),
        trickSize: 0, leader: 0, turn: 0, tricksDone: 0, broken: false, scores,
      };
      return { state: { table, passes } };
    },
    copy: (world) => ({ table: copyTable(world.table), passes: world.passes }),
    legalMoves: (world) => {
      if (world.passes) return options.map((_, index) => index);
      heartsLegalMasks(world.table, LEGAL);
      return maskCodes(LEGAL);
    },
    play,
    rolloutMove: (world) => heartsPolicyCard(world.table),
    isTerminal: (world) => world.table.tricksDone === 13,
    utility: (world, seat) => utility(world.table, HEARTS_SEATS.indexOf(seat as typeof HEARTS_SEATS[number])),
  };
}

function searchPass(view: HeartsVisibleState, context: SearchContext): BotAction {
  const ranked = rankedHeartsPasses(view.myHand).slice(0, PASS_CANDIDATES);
  const options = ranked.map((option) => option.cards.map(cardCode));
  const candidates = ranked.map((option, index) => ({ move: index, prior: -option.danger }));
  const choice = determinizedSearch(heartsPassSearchGame(view, options), candidates, context, {
    maxSamples: MAX_PASS_SAMPLES, minSamples: MIN_SAMPLES, confidence: CONFIDENCE, reserveMs: RESERVE_MS,
  });
  return { type: 'game-action', request: { gameType: 'hearts', action: { type: 'pass', cards: ranked[choice.move].cards } } };
}

/** Worker-pool strategy: searches the pass and every play with more than one distinct card. */
export function heartsSearch(view: HeartsVisibleState, context: SearchContext): BotAction | null {
  if (heartsPassPending(view)) return searchPass(view, context);
  if (view.phase !== 'playing' || view.currentTurnSeat !== view.mySeat
    || view.validCards.length < 2) return getHeartsBotAction(view, context.random);
  const candidates = heartsCandidates(view);
  if (candidates.length < 2) return getHeartsBotAction(view, context.random);
  const choice = determinizedSearch(heartsSearchGame(view), candidates, context, {
    maxSamples: MAX_SAMPLES, minSamples: MIN_SAMPLES, confidence: CONFIDENCE, reserveMs: RESERVE_MS,
  });
  return { type: 'game-action', request: { gameType: 'hearts', action: { type: 'play', card: codeCard(choice.move) } } };
}
