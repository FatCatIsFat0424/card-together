import type { BlackjackHand, BlackjackVisibleState, GameSeat } from '@shared/types';
import { bjIsBust, bjIsNatural, bjSitsIn, bjTotal } from '@shared/rules/blackjack';
import type { BotAction } from './bot-decisions';
import { BLACKJACK_BY_DEALER, BLACKJACK_CLASSES, BLACKJACK_PLAYER, getBlackjackBotAction } from './blackjack-strategy';
import { blackjackPlay } from './blackjack-play';
import type { Utility } from './blackjack-play';
import { planRace, raceInput, SEARCH_RACE, SEARCH_VALUE } from './chip-race';
import type { Atom, RaceView } from './chip-race';
import type { SearchContext } from './search/search-types';

// Worker-side Blackjack bot: bets and plays for the chance of finishing first. The bet comes from the race plan
// (see chip-race). While playing, each action is scored by the chance of finishing first after this hand's
// result. With hands to come that is the plan's value at the stack the result would leave. On the last hand the
// rivals' hands are in play too, and they face the same dealer, so the chance is counted over simulated
// results of the other seats for each dealer total.

/** Samples of the other seats' results per dealer total on the last hand. */
const LAST_HAND_SAMPLES = 400;

const stakeOf = (hands: readonly BlackjackHand[]): number => hands.reduce((sum, hand) => sum + hand.bet, 0);

function sampleAtom(atoms: readonly Atom[], random: () => number): number {
  let roll = random();
  for (const atom of atoms) {
    roll -= atom.p;
    if (roll < 0) return atom.x;
  }
  return atoms[atoms.length - 1].x;
}

/** Net chips of a finished hand against a dealer who finishes in class `finish` (0 to 4 for 17 to 21, 5 for a bust). */
function handResult(hand: BlackjackHand, finish: number): number {
  if (bjIsBust(hand.cards)) return -hand.bet;
  if (bjIsNatural(hand)) return hand.bet * 1.5;
  const total = bjTotal(hand.cards).total;
  const dealer = 17 + finish;
  return finish === 5 || total > dealer ? hand.bet : total === dealer ? 0 : -hand.bet;
}

/**
 * Chips a rival nets on this hand when the dealer finishes in class `finish`: hands that are done are settled
 * exactly, hands still to be played are drawn from the results of an unseen hand against that dealer total.
 */
function rivalNet(hands: readonly BlackjackHand[], finish: number, random: () => number): number {
  if (hands.length === 0) return 0;
  if (hands.every((hand) => hand.done)) return hands.reduce((sum, hand) => sum + handResult(hand, finish), 0);
  const first = hands[0];
  return sampleAtom(BLACKJACK_BY_DEALER[finish], random) * first.bet / (first.doubled ? 2 : 1);
}

/** Chance of finishing first on the last hand, from this seat's net on it and the dealer's finishing class. */
function lastHandUtility(visible: BlackjackVisibleState, context: SearchContext): Utility {
  const me = visible.mySeat;
  const rivals = visible.seats.filter((seat) => seat !== me);
  const dealer: GameSeat | null = visible.dealerSeat;
  const before = visible.chips[me] + stakeOf(visible.hands[me]);
  // Per dealer class: the best stack among the rivals who are not the dealer, and the player dealer's stack
  // before it settles with this seat.
  const others: Float64Array[] = [];
  const bank: Float64Array[] = [];
  for (let finish = 0; finish <= 5; finish++) {
    const best = new Float64Array(LAST_HAND_SAMPLES);
    const held = new Float64Array(LAST_HAND_SAMPLES);
    for (let sample = 0; sample < LAST_HAND_SAMPLES; sample++) {
      let top = 0;
      let paid = 0;
      for (const seat of rivals) {
        if (seat === dealer) continue;
        const net = rivalNet(visible.hands[seat], finish, context.random);
        paid += net;
        top = Math.max(top, visible.chips[seat] + stakeOf(visible.hands[seat]) + net);
      }
      best[sample] = top;
      held[sample] = dealer && dealer !== me ? visible.chips[dealer] - paid : -Infinity;
    }
    others.push(best);
    bank.push(held);
  }
  return (net, finish) => {
    const mine = before + net;
    let wins = 0;
    const best = others[finish];
    const held = bank[finish];
    for (let sample = 0; sample < LAST_HAND_SAMPLES; sample++) {
      // A player dealer pays this seat's winnings out of its stack and keeps its losses.
      if (mine >= best[sample] && mine >= held[sample] - net) wins += 1;
    }
    return wins / LAST_HAND_SAMPLES;
  };
}

/** Chance of finishing first as a function of this hand's net result for the active hand. */
export function standingsUtility(visible: BlackjackVisibleState, context: SearchContext): Utility {
  const after = visible.totalHands - visible.hand;
  if (after === 0) return lastHandUtility(visible, context);
  const view: RaceView = {
    ...visible,
    chips: Object.fromEntries(visible.seats.map((seat) => [seat, visible.chips[seat] + stakeOf(visible.hands[seat])])) as RaceView['chips'],
    hand: visible.hand - 1,
  };
  const firstStakes = visible.seats.map((seat) => {
    const first = visible.hands[seat][0];
    return first ? first.bet / (first.doubled ? 2 : 1) : 0;
  });
  const input = { ...raceInput(view, visible.dealerSeat, BLACKJACK_PLAYER), firstStakes };
  const plan = planRace(input, context.random, SEARCH_VALUE);
  const before = view.chips[visible.mySeat];
  return (net) => plan.value(after, before + net);
}

export function blackjackSearch(visible: BlackjackVisibleState, context: SearchContext): BotAction | null {
  const chips = visible.chips[visible.mySeat];
  const dealing = visible.dealerSeat === visible.mySeat;
  if (visible.phase === 'betting') {
    if (visible.myBet !== null || dealing || !bjSitsIn(chips)) return null;
    const input = { ...raceInput(visible, visible.dealerSeat, BLACKJACK_PLAYER), classes: BLACKJACK_CLASSES };
    const plan = planRace(input, context.random, SEARCH_RACE);
    return plan.bet === null ? null : { type: 'blackjack-bet', amount: plan.bet };
  }
  const turn = visible.phase === 'playing' && !dealing && visible.currentTurnSeat === visible.mySeat && visible.dealer[0];
  if (turn) {
    // After a split the two hands share one result, so only a single hand is scored by the standings.
    const alone = visible.hands[visible.mySeat].length === 1;
    const action = blackjackPlay(visible, alone ? standingsUtility(visible, context) : undefined);
    if (action) return { type: 'blackjack-action', action };
  }
  return getBlackjackBotAction(visible, context.random);
}
