import type { BridgeVisibleState, Card, Seat } from '@shared/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import type { BotAction } from './bot-decisions';
import type { SearchContext } from './search/search-types';
import { getBridgeBotAction, scoredBridgePlays } from './bridge-strategy';
import { cardCode, dealConstraints, maskCards, sampleDeal, seatIndex, SUIT_INDEX } from './bridge-sampling';
import { readPartnerSignals } from './bridge-signals';
import { createSolver, isSolverAborted, NO_TRUMP } from './bridge-solver';
import type { TrickCard } from './bridge-solver';

// Sampling with double-dummy evaluation. The seat sees only its own filtered view: the unseen cards are
// dealt at random to the other three hands (see bridge-sampling: voids and hand sizes are exact, the auction
// and partner's signals are soft). Each
// candidate card is then solved double-dummy on every deal, and the card that makes (declarer's side) or
// defeats (defenders) the contract on the most deals is played. Candidates within sampling noise of the
// best are separated by the heuristic strategy.

/** Deals examined per decision at most; late in the play the solves are fast and this cap ends the search. */
const MAX_SAMPLES = 96;
/** Fewer deals than this are too noisy to overrule the heuristic. */
const MIN_SAMPLES = 6;
/** Fraction of the deals within which two candidates count as equal. */
const NOISE = 0.05;
/** Time kept back for returning the result; new deals stop earlier than the solver's own deadline. */
const RESERVE_MS = 60;
const NEW_SAMPLE_RESERVE_MS = 150;

/** One sampled layout of the hidden cards from the seat's view, for tests and diagnostics. */
export function sampleBridgeHands(visible: BridgeVisibleState, random: () => number): Record<Seat, Card[]> | null {
  const hands = sampleDeal(dealConstraints(visible, readPartnerSignals(visible).hints), random);
  if (!hands) return null;
  return Object.fromEntries(SEAT_ORDER_CLOCKWISE.map((seat, index) => [seat, maskCards(hands, index * 4)])) as Record<Seat, Card[]>;
}

/** Groups of the seat's legal cards that no unplayed card separates; each group plays identically. */
function candidateGroups(visible: BridgeVisibleState): Card[][] {
  const playing = visible.playing!;
  const played = new Set(playing.completedTricks.flatMap((trick) => Object.values(trick.cards)).map(cardCode));
  const mine = new Set(visible.myHand.map(cardCode));
  const groups: Card[][] = [];
  const sorted = [...visible.validCards].sort((a, b) => cardCode(a) - cardCode(b));
  for (const card of sorted) {
    const last = groups.at(-1)?.at(-1);
    let touching = last !== undefined && last.suit === card.suit;
    for (let rank = (last?.rank ?? 0) + 1; touching && rank < card.rank; rank++) {
      const key = SUIT_INDEX[card.suit] * 16 + rank - 2;
      if (!played.has(key) && !mine.has(key)) touching = false;
    }
    if (touching) groups.at(-1)!.push(card);
    else groups.push([card]);
  }
  return groups;
}

/** The chosen card, or null when the heuristic strategy should decide. */
export function chooseBridgePlay(visible: BridgeVisibleState, context: SearchContext): Card | null {
  const playing = visible.playing;
  const contract = visible.contract;
  if (!playing || !contract || playing.currentTurnSeat !== visible.mySeat || visible.validCards.length === 0) return null;
  const scored = scoredBridgePlays(visible);
  const heuristic = (card: Card): number => scored.find((option) => option.value.suit === card.suit
    && option.value.rank === card.rank)?.score ?? -Infinity;
  const groups = candidateGroups(visible).map((group) => group.reduce((best, card) => (heuristic(card) > heuristic(best) ? card : best)));
  if (groups.length === 1) return groups[0];

  const declarerSide = seatIndex(contract.declarer) & 1;
  const declarerTricks = declarerSide === 0 ? playing.trickCountNS : playing.trickCountEW;
  const need = 6 + contract.level - declarerTricks;
  const remaining = 13 - playing.completedTricks.length;
  // Once the result is settled no card changes it.
  if (need <= 0 || need > remaining) return null;

  const facts = dealConstraints(visible, readPartnerSignals(visible).hints);
  const trump = contract.suit === 'nt' ? NO_TRUMP : SUIT_INDEX[contract.suit];
  const { budget, random } = context;
  const solver = createSolver(trump, declarerSide, () => budget.timeLeftMs() < RESERVE_MS);
  const leader = seatIndex(playing.trickLeadSeat);
  const trick: TrickCard[] = [];
  for (let step = 0; step < 4; step++) {
    const card = playing.currentTrick[SEAT_ORDER_CLOCKWISE[(leader + step) % 4]];
    if (!card) break;
    trick.push({ seat: (leader + step) % 4, suit: SUIT_INDEX[card.suit], rank: card.rank - 2 });
  }
  const makes = groups.map(() => 0);
  let samples = 0;
  try {
    while (samples < MAX_SAMPLES && budget.timeLeftMs() > NEW_SAMPLE_RESERVE_MS) {
      const hands = sampleDeal(facts, random);
      if (!hands) break;
      const results = groups.map((card) => {
        const suit = SUIT_INDEX[card.suit];
        const after = new Int32Array(hands);
        after[facts.me * 4 + suit] &= ~(1 << (card.rank - 2));
        return solver.canReach({ hands: after, leader, trick: [...trick, { seat: facts.me, suit, rank: card.rank - 2 }] }, need);
      });
      results.forEach((made, index) => { if (made) makes[index]++; });
      samples++;
    }
  } catch (error) {
    if (!isSolverAborted(error)) throw error;
  }
  if (samples < MIN_SAMPLES) return null;
  const mine = (seatIndex(visible.mySeat) & 1) === declarerSide;
  const values = makes.map((count) => (mine ? count : samples - count));
  const best = Math.max(...values);
  const tolerance = Math.floor(samples * NOISE);
  return groups.filter((_, index) => values[index] >= best - tolerance)
    .reduce((chosen, card) => (heuristic(card) > heuristic(chosen) ? card : chosen));
}

/**
 * Worker-pool strategy for hard Bridge bots: card play searches; redeals, bidding, and plays the search
 * cannot separate use the heuristic strategy, which also gives defenders' attitude signals.
 */
export function bridgeSearch(visible: BridgeVisibleState, context: SearchContext): BotAction | null {
  if (visible.phase === 'playing') {
    const card = chooseBridgePlay(visible, context);
    if (card) return { type: 'bridge-play', card };
  }
  return getBridgeBotAction(visible, context.random);
}
