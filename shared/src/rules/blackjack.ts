// ─── Blackjack rules engine (pure functions, shared by client and server) ───
// Rules: docs/games.md#blackjack

import type {
  BlackjackAction, BlackjackHand, BlackjackLogEntry, BlackjackOutcome, Card, Seat,
} from '../types';
import { SEAT_ORDER_CLOCKWISE } from '../constants';

export const BJ_STARTING_CHIPS = 1000;
export const BJ_MIN_BET = 10;
export const BJ_MAX_BET = 200;
export const BJ_BET_STEP = 10;
/** Hands per match */
export const BJ_HANDS = 8;
/** One split per seat */
export const BJ_MAX_SEAT_HANDS = 2;
export const BJ_MIN_BET_SECONDS = 15;
/** The dealer stands on every 17, including soft 17. */
export const BJ_DEALER_STANDS = 17;
export const BJ_ACTIONS: readonly BlackjackAction[] = ['hit', 'stand', 'double', 'split'];
export const BJ_OUTCOMES: readonly BlackjackOutcome[] = ['blackjack', 'win', 'push', 'lose', 'bust'];

/** Public table state rebuilt from the log. */
export interface BjTable {
  hand: number;
  chips: Record<Seat, number>;
  hands: Record<Seat, BlackjackHand[]>;
  dealer: Card[];
}

export interface BjSettlement {
  readonly outcomes: Record<Seat, BlackjackOutcome[]>;
  readonly net: Record<Seat, number>;
  readonly chips: Record<Seat, number>;
}

function seatMap<T>(value: (seat: Seat) => T): Record<Seat, T> {
  return { N: value('N'), E: value('E'), S: value('S'), W: value('W') };
}

/** Shared betting window: twice the turn allowance, but at least 15 seconds. */
export function bjBetSeconds(baseSeconds: number): number {
  return Math.max(BJ_MIN_BET_SECONDS, baseSeconds * 2);
}

/** A=11 (reduced to 1 by `bjTotal` when needed), J/Q/K=10. */
export function bjCardValue(card: Card): number {
  return card.rank === 14 ? 11 : Math.min(card.rank, 10);
}

/** Best total not over 21 when possible; soft while an ace still counts 11. */
export function bjTotal(cards: readonly Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    total += bjCardValue(card);
    if (card.rank === 14) aces += 1;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return { total, soft: aces > 0 };
}

export function bjIsBust(cards: readonly Card[]): boolean {
  return bjTotal(cards).total > 21;
}

/** A two-card 21 that did not come from a split. */
export function bjIsNatural(hand: { readonly cards: readonly Card[]; readonly split: boolean }): boolean {
  return !hand.split && hand.cards.length === 2 && bjTotal(hand.cards).total === 21;
}

/** A seat that cannot cover the minimum bet sits out. */
export function bjSitsIn(chips: number): boolean {
  return chips >= BJ_MIN_BET;
}

export function bjMaxBet(chips: number): number {
  return Math.min(BJ_MAX_BET, chips - (chips % BJ_BET_STEP));
}

export function bjIsValidBet(amount: number, chips: number): boolean {
  return Number.isSafeInteger(amount) && amount >= BJ_MIN_BET && amount <= bjMaxBet(chips)
    && amount % BJ_BET_STEP === 0;
}

/** Actions open to `hands[index]`; doubling and splitting stake the hand's bet again. */
export function bjLegalActions(
  hands: readonly BlackjackHand[], index: number, chips: number,
): BlackjackAction[] {
  const hand = hands[index];
  if (!hand || hand.done) return [];
  const actions: BlackjackAction[] = ['hit', 'stand'];
  const firstTwo = hand.cards.length === 2;
  if (firstTwo && chips >= hand.bet) actions.push('double');
  if (firstTwo && chips >= hand.bet && hands.length < BJ_MAX_SEAT_HANDS
    && bjCardValue(hand.cards[0]) === bjCardValue(hand.cards[1])) actions.push('split');
  return actions;
}

/** With an ace or ten-value up card the dealer checks for blackjack before anyone acts. */
export function bjDealerPeeks(upCard: Card): boolean {
  return bjCardValue(upCard) >= 10;
}

export function bjDealerHits(dealer: readonly Card[]): boolean {
  return bjTotal(dealer).total < BJ_DEALER_STANDS;
}

/** The dealer draws only while some hand is neither busted nor a natural. */
export function bjDealerMustDraw(hands: Readonly<Record<Seat, readonly BlackjackHand[]>>): boolean {
  return SEAT_ORDER_CLOCKWISE.some((seat) => hands[seat].some((hand) => !bjIsBust(hand.cards) && !bjIsNatural(hand)));
}

/** First unfinished hand in N, E, S, W order. */
export function bjNextTurn(
  hands: Readonly<Record<Seat, readonly BlackjackHand[]>>,
): { seat: Seat; handIndex: number } | null {
  for (const seat of SEAT_ORDER_CLOCKWISE) {
    const handIndex = hands[seat].findIndex((hand) => !hand.done);
    if (handIndex >= 0) return { seat, handIndex };
  }
  return null;
}

export function bjOutcome(
  hand: { readonly cards: readonly Card[]; readonly split: boolean }, dealer: readonly Card[],
): BlackjackOutcome {
  const player = bjTotal(hand.cards).total;
  if (player > 21) return 'bust';
  const dealerNatural = bjIsNatural({ cards: dealer, split: false });
  if (bjIsNatural(hand)) return dealerNatural ? 'push' : 'blackjack';
  if (dealerNatural) return 'lose';
  const house = bjTotal(dealer).total;
  if (house > 21 || player > house) return 'win';
  return player === house ? 'push' : 'lose';
}

/** Chips returned to the player, stake included: blackjack pays 3:2 and a win 1:1. */
export function bjPayout(bet: number, outcome: BlackjackOutcome): number {
  if (outcome === 'blackjack') return bet * 5 / 2;
  if (outcome === 'win') return bet * 2;
  return outcome === 'push' ? bet : 0;
}

/** Settles every hand against the dealer's final cards. */
export function bjSettle(table: Readonly<BjTable>): BjSettlement {
  const outcomes = seatMap((seat) => table.hands[seat].map((hand) => bjOutcome(hand, table.dealer)));
  const payout = seatMap((seat) => table.hands[seat]
    .reduce((sum, hand, index) => sum + bjPayout(hand.bet, outcomes[seat][index]), 0));
  const staked = seatMap((seat) => table.hands[seat].reduce((sum, hand) => sum + hand.bet, 0));
  return {
    outcomes,
    net: seatMap((seat) => payout[seat] - staked[seat]),
    chips: seatMap((seat) => table.chips[seat] + payout[seat]),
  };
}

/** Most chips, ties included, ordered N, E, S, W. */
export function bjWinners(chips: Readonly<Record<Seat, number>>): Seat[] {
  const best = Math.max(...SEAT_ORDER_CLOCKWISE.map((seat) => chips[seat]));
  return SEAT_ORDER_CLOCKWISE.filter((seat) => chips[seat] === best);
}

function newHand(cards: readonly Card[], bet: number, split: boolean): BlackjackHand {
  const hand = { cards: [...cards], bet, doubled: false, split, done: false };
  hand.done = bjIsNatural(hand) || bjTotal(hand.cards).total >= 21;
  return hand;
}

export function bjEmptyTable(): BjTable {
  return {
    hand: 0,
    chips: seatMap(() => BJ_STARTING_CHIPS),
    hands: seatMap(() => []),
    dealer: [],
  };
}

/**
 * Applies one public log entry. A hand finishes on reaching 21, busting, standing, or doubling;
 * split aces take one card each. Entries are assumed legal; the server validates before logging.
 */
export function bjApplyEntry(table: BjTable, entry: BlackjackLogEntry): void {
  switch (entry.type) {
    case 'bet': return;
    case 'deal':
      table.hand = entry.hand;
      for (const seat of SEAT_ORDER_CLOCKWISE) table.chips[seat] -= entry.bets[seat];
      table.hands = seatMap((seat) => entry.bets[seat] > 0 ? [newHand(entry.cards[seat], entry.bets[seat], false)] : []);
      table.dealer = [entry.upCard];
      return;
    case 'hit': {
      const hand = table.hands[entry.seat][entry.handIndex];
      hand.cards.push(entry.card);
      hand.done = bjTotal(hand.cards).total >= 21;
      return;
    }
    case 'stand':
      table.hands[entry.seat][entry.handIndex].done = true;
      return;
    case 'double': {
      const hand = table.hands[entry.seat][entry.handIndex];
      table.chips[entry.seat] -= hand.bet;
      hand.bet *= 2;
      hand.doubled = true;
      hand.cards.push(entry.card);
      hand.done = true;
      return;
    }
    case 'split': {
      const hands = table.hands[entry.seat];
      const hand = hands[entry.handIndex];
      const aces = hand.cards[0].rank === 14;
      table.chips[entry.seat] -= hand.bet;
      const first = newHand([hand.cards[0], entry.cards[0]], hand.bet, true);
      const second = newHand([hand.cards[1], entry.cards[1]], hand.bet, true);
      if (aces) {
        first.done = true;
        second.done = true;
      }
      hands.splice(entry.handIndex, 1, first, second);
      return;
    }
    case 'reveal':
    case 'dealerHit':
      table.dealer.push(entry.card);
      return;
    case 'settle':
      table.chips = { ...bjSettle(table).chips };
  }
}

/** The public table after the first `end` log entries. */
export function bjReplay(log: readonly BlackjackLogEntry[], end = log.length): BjTable {
  const table = bjEmptyTable();
  for (const entry of log.slice(0, end)) bjApplyEntry(table, entry);
  return table;
}
