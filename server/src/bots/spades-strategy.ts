import type { Card } from '@shared/types';
import type { SpadesAction, SpadesVisibleState } from '@shared/games/spades/types';
import { SPADES_SEATS, spadesTeam, spadesTrickWinner } from '@shared/rules/spades';
import type { BotAction } from './bot-decisions';
import { selectNearBest } from './selection';
import {
  estimateSpadesTricks, holdsChance, nilRisk, readSpadesTable, spadesPartner, unseenAbove, unseenBelow, voidChance,
  winnerWith,
} from './spades-knowledge';
import type { SpadesTable } from './spades-knowledge';

function wrap(action: SpadesAction): BotAction { return { type: 'game-action', request: { gameType: 'spades', action } }; }
function active(view: SpadesVisibleState): boolean { return view.phase !== 'scoring' && view.currentTurnSeat === view.mySeat; }

/** A deliberately cautious count of aces, kings, queens, and long spades. */
function simpleBid(hand: readonly Card[]): number {
  let value = hand.reduce((sum, card) => sum + (card.rank === 14 ? 0.95 : card.rank === 13 ? 0.65 : card.rank === 12 ? 0.3 : 0), 0);
  value += Math.max(0, hand.filter((card) => card.suit === 'spades').length - 2) * 0.55;
  return Math.max(1, Math.min(13, Math.round(value)));
}

export function spadesFirstLegalAction(view: SpadesVisibleState): BotAction | null {
  if (!active(view)) return null;
  return view.phase === 'bidding' ? wrap({ type: 'bid', bid: simpleBid(view.myHand) })
    : view.validCards[0] ? wrap({ type: 'play', card: view.validCards[0] }) : null;
}

// ─── Bidding ───

/** Nil risk below which the hand bids Nil; the context moves it. */
const NIL_RISK = 0.85;

/** What a bid depends on besides the hand. */
export interface SpadesBidContext {
  /** Partner's bid, or null when partner bids later. */
  readonly partnerBid: number | null;
  /** Points the opponents lead by. */
  readonly behind: number;
  /** The team's carried bags. */
  readonly bags: number;
  /** The other three bids when all are known, otherwise null. */
  readonly otherBids: number | null;
}

/**
 * Tricks from the hand, shaded by the table: a bid already made by partner, bids that leave too few
 * tricks for everyone, bags near a penalty, and the match score.
 */
export function spadesBidFor(hand: readonly Card[], context: SpadesBidContext): number {
  const { partnerBid, behind } = context;
  const estimate = estimateSpadesTricks(hand);
  let nilLimit = NIL_RISK;
  if (partnerBid !== null) nilLimit += partnerBid >= 4 ? 0.2 : partnerBid <= 2 ? -0.25 : 0;
  if (behind >= 150) nilLimit += 0.25;
  if (behind <= -150) nilLimit -= 0.2;
  if (partnerBid !== 0 && estimate < 2.5 && nilRisk(hand) < nilLimit) return 0;

  // A failed contract costs twice its value while an overtrick costs one point, so the bid rounds down.
  let bid = Math.floor(estimate + (context.bags >= 7 ? 0.55 : 0.4));
  // A partner's Nil leaves the hand to win its own tricks and also to cover partner's high cards.
  if (partnerBid === 0) bid = Math.floor(estimate + 0.25);
  // Bids that already claim nearly every trick mean some estimates are too high, possibly this one.
  if (context.otherBids !== null && context.otherBids + bid > 14 && bid > 1) bid--;
  return Math.max(1, Math.min(13, bid));
}

/** The heuristic bid from the seat's own view. */
export function chooseSpadesBid(visible: SpadesVisibleState): number {
  const seat = visible.mySeat;
  const bids = visible.position.bids;
  const team = spadesTeam(seat);
  const others = SPADES_SEATS.filter((other) => other !== seat);
  return spadesBidFor(visible.myHand, {
    partnerBid: bids[spadesPartner(seat)],
    behind: visible.scores[team === 'NS' ? 'EW' : 'NS'] - visible.scores[team],
    bags: visible.bags[team],
    otherBids: others.every((other) => bids[other] !== null) ? others.reduce((sum, other) => sum + bids[other]!, 0) : null,
  });
}

// ─── Card play ───

/** Lower values are cheaper to spend: spades last, then by unseen cards of the suit beneath it. */
function cost(table: SpadesTable, card: Card): number {
  return (card.suit === 'spades' ? 14 : 0) + unseenBelow(table, card);
}

/** Ranks a card by how likely it is to take a later trick. */
function danger(table: SpadesTable, card: Card): number {
  return (card.suit === 'spades' ? 14 : 0) + 13 - unseenAbove(table, card) + card.rank / 100;
}

function suitLength(table: SpadesTable, suit: Card['suit']): number {
  return table.hand.filter((card) => card.suit === suit).length;
}

interface Choice {
  readonly cards: readonly Card[];
  /** Larger is preferred; ties pick at random. */
  readonly score: (card: Card) => number;
}

const lowest = (table: SpadesTable, cards: readonly Card[]): Choice => ({ cards, score: (card) => -cost(table, card) });
const highest = (table: SpadesTable, cards: readonly Card[]): Choice => ({ cards, score: (card) => danger(table, card) });

/** Discards when out of the led suit: the cheapest side card, from the shortest suit to make more voids. */
function discard(table: SpadesTable, cards: readonly Card[]): Choice {
  return { cards, score: (card) => -cost(table, card) - (card.suit === 'spades' ? 0 : suitLength(table, card.suit) * 0.3) };
}

/** Whether this seat's side still wants tricks: its contract is short, or the opponents can still be set. */
function wantsTricks(table: SpadesTable): boolean {
  if (table.ourNeed > 0) return true;
  if (table.theirNeed <= 0 || table.theirNeed > table.tricksLeft) return false;
  // Tricks this side must take from here to set them; worth chasing while it is no more than half.
  const toSet = table.tricksLeft - table.theirNeed + 1;
  return toSet * 2 <= table.tricksLeft + 1;
}

function followChoice(table: SpadesTable, cards: readonly Card[]): Choice {
  const { position } = table.visible;
  const leadSuit = position.trick[0].card.suit;
  const winnerSeat = spadesTrickWinner(position.trick);
  const winners = cards.filter((card) => winnerWith(table, card) === table.seat);
  const losers = cards.filter((card) => winnerWith(table, card) !== table.seat);
  const partner = table.partner;
  const myNil = table.nilLive(table.seat);
  const partnerLater = table.later.includes(partner);

  if (myNil) {
    if (losers.length) return highest(table, losers);
    return table.later.length ? lowest(table, winners) : highest(table, winners);
  }
  // Partner's Nil: win high before partner plays, and overtake partner when it is winning.
  if (table.nilLive(partner)) {
    if (partnerLater) {
      const followers = cards.filter((card) => card.suit === leadSuit);
      if (winners.length) return { cards: winners, score: (card) => holdsChance(table, card, leadSuit) * 10 + danger(table, card) };
      return followers.length ? highest(table, followers) : discard(table, cards);
    }
    // Any card over partner's saves the Nil, whoever wins the trick in the end.
    if (winnerSeat === partner && winners.length) return lowest(table, winners);
  }
  // An opponent's live Nil: let it win, and play under it when it plays after this seat.
  const nilOpponent = table.opponents.find((seat) => table.nilLive(seat));
  if (nilOpponent && winnerSeat === nilOpponent) {
    if (losers.length) return highest(table, losers.filter((card) => card.suit === leadSuit).length
      ? losers.filter((card) => card.suit === leadSuit) : losers);
    return lowest(table, winners);
  }
  if (nilOpponent && table.later.includes(nilOpponent) && !wantsTricks(table)) {
    return lowest(table, losers.length ? losers : cards);
  }

  if (!wantsTricks(table)) {
    if (losers.length) return highest(table, losers);
    return table.later.length ? lowest(table, winners) : highest(table, winners);
  }

  if (winnerSeat === partner) {
    const partnerCard = position.trick.find((play) => play.seat === partner)!.card;
    const safe = holdsChance(table, partnerCard, leadSuit);
    if (safe >= 0.7 || winners.length === 0) return losers.length ? discardOrLow(table, losers, leadSuit) : lowest(table, cards);
    const better = winners.filter((card) => holdsChance(table, card, leadSuit) >= Math.max(0.75, safe + 0.25));
    if (better.length) return lowest(table, better);
    return losers.length ? discardOrLow(table, losers, leadSuit) : lowest(table, cards);
  }
  if (winners.length === 0) return discardOrLow(table, cards, leadSuit);
  if (table.later.length === 0) return lowest(table, winners);
  const holds = (card: Card): number => holdsChance(table, card, leadSuit);
  if (partnerLater) {
    // Second hand: partner plays last and sees everything, so only a card likely to hold is spent.
    const sure = winners.filter((card) => holds(card) >= 0.65);
    if (sure.length) return lowest(table, sure);
    return discardOrLow(table, losers.length ? losers : winners, leadSuit);
  }
  // Third hand with the opponent last: spend the cheapest card that most likely holds.
  const best = Math.max(...winners.map(holds));
  if (best < 0.2) return discardOrLow(table, losers.length ? losers : winners, leadSuit);
  return lowest(table, winners.filter((card) => holds(card) >= best - 0.1));
}

function discardOrLow(table: SpadesTable, cards: readonly Card[], leadSuit: Card['suit']): Choice {
  return cards.some((card) => card.suit === leadSuit) ? lowest(table, cards) : discard(table, cards);
}

/** Chance that a lead of `card` is not beaten by either opponent. */
function leadHolds(table: SpadesTable, card: Card): number {
  return holdsChance(table, card, card.suit, table.opponents);
}

function leadChoice(table: SpadesTable, cards: readonly Card[]): Choice {
  const partner = table.partner;
  const sideCards = cards.filter((card) => card.suit !== 'spades');
  if (table.nilLive(table.seat)) {
    return { cards, score: (card) => -cost(table, card) + unseenAbove(table, card) * 0.2 };
  }
  if (table.nilLive(partner)) {
    // Lead winners so partner can play under them.
    return { cards, score: (card) => leadHolds(table, card) * 10 + danger(table, card) / 10 };
  }
  const nilOpponent = table.opponents.find((seat) => table.nilLive(seat));
  if (nilOpponent) {
    // Low cards in suits the Nil bidder still holds force it to play over them.
    const live = cards.filter((card) => !table.voids[nilOpponent].has(card.suit));
    const pool = live.length ? live : cards;
    return { cards: pool, score: (card) => -unseenBelow(table, card) * 2 + unseenAbove(table, card) * 0.3 - (card.suit === 'spades' ? 3 : 0) };
  }
  if (!wantsTricks(table)) {
    return { cards, score: (card) => -cost(table, card) * 2 + unseenAbove(table, card) * 0.3 };
  }

  // Cash winners the opponents are unlikely to ruff.
  const cash = cards.filter((card) => leadHolds(table, card) >= 0.72 && (card.suit !== 'spades' || unseenAbove(table, card) === 0));
  const spadesHeld = table.hand.filter((card) => card.suit === 'spades').length;
  const spadesOut = table.unseen.filter((card) => card.suit === 'spades').length;
  const topSpade = cards.find((card) => card.suit === 'spades' && unseenAbove(table, card) === 0);
  // Draw trumps with the top spade when holding as many as the others together, so side winners survive.
  if (topSpade && spadesOut > 0 && spadesHeld >= spadesOut) return { cards: [topSpade], score: () => 0 };
  if (cash.length) {
    return { cards: cash, score: (card) => leadHolds(table, card) * 4 + suitLength(table, card.suit) * 0.2 - (card.suit === 'spades' ? 1 : 0) };
  }
  // Lead a suit partner is out of while the opponents still follow it, so partner can ruff.
  const partnerRuffs = sideCards.filter((card) => table.voids[partner].has(card.suit)
    && !table.voids[partner].has('spades') && table.opponents.every((seat) => voidChance(table, seat, card.suit) < 0.4));
  if (partnerRuffs.length) return lowest(table, partnerRuffs);
  // Otherwise lead low from a long side suit, sparing suits headed by an unsupported king or queen.
  const pool = sideCards.length ? sideCards : cards;
  return {
    cards: pool,
    score: (card) => {
      const length = suitLength(table, card.suit);
      const top = Math.max(...table.hand.filter((other) => other.suit === card.suit).map((other) => unseenAbove(table, other) === 0 ? 14 : other.rank));
      const guarded = top === 13 || top === 12 ? -1.5 : 0;
      const ruffRisk = table.opponents.reduce((sum, seat) => sum + voidChance(table, seat, card.suit), 0);
      return -cost(table, card) * 0.5 + length * 0.4 + guarded - ruffRisk * 2;
    },
  };
}

/** Scores for every legal card from the seat's own view; the heuristic plays the best. */
export function scoredSpadesPlays(visible: SpadesVisibleState): { value: Card; score: number }[] {
  const cards = visible.validCards;
  if (cards.length <= 1) return cards.map((value) => ({ value, score: 0 }));
  const table = readSpadesTable(visible);
  const choice = visible.position.trick.length ? followChoice(table, cards) : leadChoice(table, cards);
  const preferred = new Set(choice.cards);
  // Cards outside the rule's pool rank below it, cheapest first, so they still order for the search.
  return cards.map((value) => ({
    value,
    score: preferred.has(value) ? 100 + choice.score(value) : -cost(table, value),
  }));
}

/** Partnership heuristics from the seat's own hand, public bids, and every trick played so far. */
export function getSpadesBotAction(view: SpadesVisibleState, random: () => number = Math.random): BotAction | null {
  if (!active(view)) return null;
  if (view.phase === 'bidding') return wrap({ type: 'bid', bid: chooseSpadesBid(view) });
  if (!view.validCards.length) return null;
  const card = selectNearBest(scoredSpadesPlays(view), random, 1e-9);
  return card ? wrap({ type: 'play', card }) : null;
}
