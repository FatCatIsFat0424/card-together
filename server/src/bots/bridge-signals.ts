import type { BridgeVisibleState, Card, Seat, Suit } from '@shared/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { compareCards } from '../engine/playing';
import { humanSeats, partnerOf } from './bridge-auction';
import type { HonorHint } from './bridge-sampling';

// Defenders' signals, the common attitude agreement:
// - Following to a suit partner led, without trying to win the trick: a high spot card (7 or more)
//   encourages, holding the ace, king, or queen there; a low one (5 or less) discourages.
// - The first discard: a high spot card asks for that suit; a low one says the suit is not wanted.
// Bots give these signals only among cards the search rates equal, and read partner's as soft evidence:
// fully from a bot partner, with little weight from a person, who may not signal at all.

/** Spot cards at or above this rank signal "high", at or below `LOW_SIGNAL` "low"; a 6 says nothing. */
const HIGH_SIGNAL = 7;
const LOW_SIGNAL = 5;
/** Score per rank that turns the usual low-card preference into a high card when encouraging. */
const SIGNAL_PER_RANK = 1.6;
/** Mismatch weight of a signal in hand sampling. */
const BOT_SIGNAL_WEIGHT = 3;
const HUMAN_SIGNAL_WEIGHT = 1;

interface TrickView {
  readonly leadSeat: Seat;
  readonly cards: Partial<Record<Seat, Card>>;
}

export interface PartnerSignals {
  readonly wanted: readonly Suit[];
  readonly unwanted: readonly Suit[];
  readonly hints: readonly HonorHint[];
}

const NO_SIGNALS: PartnerSignals = { wanted: [], unwanted: [], hints: [] };

function defending(visible: BridgeVisibleState): boolean {
  const declarer = visible.contract?.declarer;
  return declarer !== undefined && declarer !== visible.mySeat && declarer !== partnerOf(visible.mySeat);
}

function tricksSoFar(visible: BridgeVisibleState): TrickView[] {
  const playing = visible.playing;
  if (!playing) return [];
  return [
    ...playing.completedTricks.map((trick) => ({ leadSeat: trick.leadSeat, cards: trick.cards as Partial<Record<Seat, Card>> })),
    { leadSeat: playing.trickLeadSeat, cards: playing.currentTrick },
  ];
}

/** Seats in play order from the trick's leader. */
function playOrder(leadSeat: Seat): Seat[] {
  const start = SEAT_ORDER_CLOCKWISE.indexOf(leadSeat);
  return [0, 1, 2, 3].map((step) => SEAT_ORDER_CLOCKWISE[(start + step) % 4]);
}

/** True when the seat's card beat everything played before it, so it was an attempt to win, not a signal. */
function triedToWin(trick: TrickView, seat: Seat, trump: Suit | 'nt'): boolean {
  const led = trick.cards[trick.leadSeat]!;
  const card = trick.cards[seat]!;
  for (const other of playOrder(trick.leadSeat)) {
    if (other === seat) return true;
    const earlier = trick.cards[other];
    if (earlier && compareCards(card, earlier, led.suit, trump) < 0) return false;
  }
  return true;
}

/** The trick in which the seat first discarded (neither followed nor ruffed), if any. */
function firstDiscard(tricks: readonly TrickView[], seat: Seat, trump: Suit | 'nt'): TrickView | undefined {
  return tricks.find((trick) => {
    const led = trick.cards[trick.leadSeat];
    const card = trick.cards[seat];
    return led && card && card.suit !== led.suit && card.suit !== trump;
  });
}

/** A top honor worth asking partner to lead. */
function holdsHonor(hand: readonly Card[], suit: Suit): boolean {
  return hand.some((card) => card.suit === suit && card.rank >= 13)
    || (hand.some((card) => card.suit === suit && card.rank === 12) && hand.some((card) => card.suit === suit && card.rank === 11));
}

/** Partner's attitude signals so far, read as soft evidence about partner's honors. */
export function readPartnerSignals(visible: BridgeVisibleState): PartnerSignals {
  if (!defending(visible) || !visible.playing || !visible.contract) return NO_SIGNALS;
  const partner = partnerOf(visible.mySeat);
  const trump = visible.contract.suit;
  const weight = humanSeats(visible).has(partner) ? HUMAN_SIGNAL_WEIGHT : BOT_SIGNAL_WEIGHT;
  const wanted = new Set<Suit>();
  const unwanted = new Set<Suit>();
  const read = (suit: Suit, rank: number): void => {
    if (rank > 10 || wanted.has(suit) || unwanted.has(suit)) return;
    if (rank >= HIGH_SIGNAL) wanted.add(suit);
    else if (rank <= LOW_SIGNAL) unwanted.add(suit);
  };
  const tricks = tricksSoFar(visible);
  const ledByMe = new Set<Suit>();
  for (const trick of tricks) {
    const led = trick.cards[trick.leadSeat];
    const card = trick.cards[partner];
    if (!led || !card || trick.leadSeat !== visible.mySeat || ledByMe.has(led.suit)) continue;
    ledByMe.add(led.suit);
    if (card.suit === led.suit && !triedToWin(trick, partner, trump)) read(led.suit, card.rank);
  }
  const discard = firstDiscard(tricks, partner, trump);
  if (discard) read(discard.cards[partner]!.suit, discard.cards[partner]!.rank);
  const hints: HonorHint[] = [
    ...[...wanted].map((suit) => ({ seat: partner, suit, holds: true, weight })),
    ...[...unwanted].map((suit) => ({ seat: partner, suit, holds: false, weight })),
  ];
  return { wanted: [...wanted], unwanted: [...unwanted], hints };
}

/**
 * Score added to a defender's candidate card so that, among otherwise equal cards, it gives the attitude
 * signal; 0 when the card signals nothing.
 */
export function signalBonus(visible: BridgeVisibleState, card: Card): number {
  const playing = visible.playing;
  const contract = visible.contract;
  if (!playing || !contract || !defending(visible) || card.rank > 10) return 0;
  const led = playing.currentTrick[playing.trickLeadSeat];
  if (!led) return 0;
  const partner = partnerOf(visible.mySeat);
  if (card.suit === led.suit) {
    if (playing.trickLeadSeat !== partner) return 0;
    const ledBefore = playing.completedTricks.some((trick) => trick.leadSeat === partner && trick.cards[partner]?.suit === led.suit);
    const current = { leadSeat: playing.trickLeadSeat, cards: { ...playing.currentTrick, [visible.mySeat]: card } };
    if (ledBefore || triedToWin(current, visible.mySeat, contract.suit)) return 0;
    return holdsHonor(visible.myHand, led.suit) ? card.rank * SIGNAL_PER_RANK : 0;
  }
  if (card.suit === contract.suit || firstDiscard(tricksSoFar(visible).slice(0, -1), visible.mySeat, contract.suit)) return 0;
  // First discard: high from a suit holding a top honor, otherwise low from a suit without one.
  if (holdsHonor(visible.myHand, card.suit)) return card.rank * SIGNAL_PER_RANK;
  return -card.rank * SIGNAL_PER_RANK * 0.5;
}
