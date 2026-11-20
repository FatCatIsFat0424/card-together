import type { BlackjackAction, BlackjackHand, BlackjackVisibleState, Card } from '@shared/types';
import { bjLegalActions, bjTotal } from '@shared/rules/blackjack';

// Composition-aware Blackjack play. The cards this seat cannot see are the full shoe minus every card on the table
// (the dealer's hole card is among them); it computes the dealer's final total from that pool, given that the
// dealer peeked and has no blackjack, and evaluates standing, hitting on, doubling, and splitting exactly over
// the draws. An action is scored by the expected `utility` of the chips won or lost this hand, so a caller that
// knows the standings can prefer variance when it trails. After the first extra card the dealer is computed from
// the pool without further depletion by the bot's own draws.

/**
 * Net chips of one hand relative to the stack before it was dealt, with the dealer's finishing class (0 to 4 for
 * 17 to 21, 5 for a bust), mapped to a utility. The class lets a utility account for the rivals' hands, which
 * face the same dealer.
 */
export type Utility = (net: number, dealer: number) => number;

export const linearUtility: Utility = (net) => net;

/** Cards by blackjack value: index 1 is the ace, 10 the ten-valued cards. */
type Counts = Int8Array;

/** Chances of outcomes, keyed by the dealer's class and the net chips of the hand. */
type Dist = ReadonlyMap<number, number>;

const CLASS_KEY = 100_000;
const NET_OFFSET = 50_000;

const encode = (dealer: number, net: number): number => dealer * CLASS_KEY + net + NET_OFFSET;

/** Dealer finishing totals 17 to 21 and bust. */
type DealerDist = Float64Array;

const BUST = 5;

function valueIndex(card: Card): number {
  return card.rank === 14 ? 1 : Math.min(card.rank, 10);
}

/** What is left of the shoe after the cards in `seen`. */
export function unseenCounts(decks: number, seen: readonly Card[]): { counts: Counts; total: number } {
  const counts = new Int8Array(11);
  for (let value = 1; value <= 9; value++) counts[value] = 4 * decks;
  counts[10] = 16 * decks;
  let total = 52 * decks;
  for (const card of seen) {
    const index = valueIndex(card);
    if (counts[index] > 0) {
      counts[index] -= 1;
      total -= 1;
    }
  }
  return { counts, total };
}

/**
 * The dealer's final total from the up card and the unseen pool. The hole card cannot give a blackjack: the dealer
 * peeks with an ace or ten up.
 */
export function dealerDistribution(up: number, counts: Counts, total: number): DealerDist {
  const result = new Float64Array(6);
  const holeBarred = up === 1 ? 10 : up === 10 ? 1 : 0;
  const walk = (hard: number, ace: boolean, weight: number, remaining: number, hole: boolean): void => {
    const best = ace && hard + 10 <= 21 ? hard + 10 : hard;
    if (!hole && best >= 17) {
      result[best > 21 ? BUST : best - 17] += weight;
      return;
    }
    const pool = hole && holeBarred ? remaining - counts[holeBarred] : remaining;
    if (pool <= 0) return;
    for (let value = 1; value <= 10; value++) {
      const count = counts[value];
      if (count === 0 || (hole && value === holeBarred)) continue;
      counts[value] -= 1;
      walk(hard + value, ace || value === 1, weight * count / pool, remaining - 1, false);
      counts[value] += 1;
    }
  };
  walk(up, up === 1, 1, total, true);
  return result;
}

function add(into: Map<number, number>, key: number, chance: number): void {
  if (chance > 0) into.set(key, (into.get(key) ?? 0) + chance);
}

/** Result of finishing on `total` (22 or more is a bust) with `stake` at risk against the dealer's totals. */
function standing(total: number, stake: number, dealer: DealerDist): Dist {
  const result = new Map<number, number>();
  for (let finish = 0; finish <= BUST; finish++) {
    const chance = dealer[finish];
    if (chance === 0) continue;
    const dealerTotal = 17 + finish;
    const net = total > 21 ? -stake : finish === BUST || total > dealerTotal ? stake : total === dealerTotal ? 0 : -stake;
    add(result, encode(finish, net), chance);
  }
  return result;
}

function expected(dist: Dist, utility: Utility): number {
  let sum = 0;
  for (const [key, chance] of dist) {
    const finish = Math.floor(key / CLASS_KEY);
    sum += chance * utility(key - finish * CLASS_KEY - NET_OFFSET, finish);
  }
  return sum;
}

interface Table {
  readonly up: number;
  readonly counts: Counts;
  /** Cards left in the pool. */
  total: number;
  readonly utility: Utility;
  /** Chips of the stake one hand risks. */
  readonly bet: number;
  /** Doubling after a draw is affordable. */
  canDouble: boolean;
  readonly dealerCache: Map<string, DealerDist>;
}

/** Dealer totals for the pool as it stands, cached by its composition. */
function dealerFor(table: Table): DealerDist {
  const key = table.counts.join();
  const cached = table.dealerCache.get(key);
  if (cached) return cached;
  const made = dealerDistribution(table.up, table.counts, table.total);
  table.dealerCache.set(key, made);
  return made;
}

/**
 * The best result distribution for a hand that may keep drawing: it stands or hits to whichever has the higher
 * utility. Both the dealer and the cards this seat draws from are fixed to the pool after the first drawn
 * card, so a hand's value depends only on its total and `memo` can hold it.
 */
function play(
  table: Table, hard: number, ace: boolean, dealer: DealerDist, cardsHeld: number, doubling: boolean,
  mode: 'free' | 'stand', memo: Map<number, Dist>,
): Dist {
  const total = ace && hard + 10 <= 21 ? hard + 10 : hard;
  const stand = standing(total, table.bet, dealer);
  if (total >= 21 || mode === 'stand') return stand;
  const key = hard * 2 + (ace ? 1 : 0);
  const known = doubling ? undefined : memo.get(key);
  if (known) return known;
  let best = stand;
  let bestValue = expected(stand, table.utility);
  const hit = new Map<number, number>();
  for (let value = 1; value <= 10; value++) {
    const count = table.counts[value];
    if (count === 0 || table.total === 0) continue;
    const chance = count / table.total;
    for (const [outcome, share] of play(table, hard + value, ace || value === 1, dealer, cardsHeld + 1, false, 'free', memo)) {
      add(hit, outcome, chance * share);
    }
  }
  const hitValue = expected(hit, table.utility);
  if (hitValue > bestValue + 1e-12) {
    best = hit;
    bestValue = hitValue;
  }
  if (doubling && cardsHeld === 2 && table.canDouble) {
    const doubled = doubleDown(table, hard, ace);
    if (expected(doubled, table.utility) > bestValue + 1e-12) best = doubled;
  }
  if (!doubling) memo.set(key, best);
  return best;
}

/** Double the stake, take one card, and stand. */
function doubleDown(table: Table, hard: number, ace: boolean): Dist {
  const result = new Map<number, number>();
  for (let value = 1; value <= 10; value++) {
    const count = table.counts[value];
    if (count === 0 || table.total === 0) continue;
    const chance = count / table.total;
    table.counts[value] -= 1;
    table.total -= 1;
    const dealer = dealerFor(table);
    const total = ace || value === 1 ? (hard + value + 10 <= 21 ? hard + value + 10 : hard + value) : hard + value;
    for (const [key, share] of standing(total, table.bet * 2, dealer)) add(result, key, chance * share);
    table.total += 1;
    table.counts[value] += 1;
  }
  return result;
}

/** The distribution after standing now, or after drawing one card and continuing optimally. */
function afterHit(table: Table, hard: number, ace: boolean, cardsHeld: number): Dist {
  const result = new Map<number, number>();
  for (let value = 1; value <= 10; value++) {
    const count = table.counts[value];
    if (count === 0 || table.total === 0) continue;
    const chance = count / table.total;
    table.counts[value] -= 1;
    table.total -= 1;
    const dealer = dealerFor(table);
    for (const [key, share] of play(table, hard + value, ace || value === 1, dealer, cardsHeld + 1, false, 'free', new Map())) {
      add(result, key, chance * share);
    }
    table.total += 1;
    table.counts[value] += 1;
  }
  return result;
}

/** Splitting a pair: each half takes one card and plays on its own; aces take one card only. */
function afterSplit(table: Table, pair: number, canDouble: boolean): Dist {
  const affordable = table.canDouble;
  table.canDouble = canDouble;
  const half = new Map<number, number>();
  for (let value = 1; value <= 10; value++) {
    const count = table.counts[value];
    if (count === 0 || table.total === 0) continue;
    const chance = count / table.total;
    table.counts[value] -= 1;
    table.total -= 1;
    const dealer = dealerFor(table);
    const ace = pair === 1 || value === 1;
    const hard = pair + value;
    // A split hand is never a blackjack, so 21 simply stands; split aces draw no more.
    for (const [key, share] of play(table, hard, ace, dealer, 2, true, pair === 1 ? 'stand' : 'free', new Map())) {
      add(half, key, chance * share);
    }
    table.total += 1;
    table.counts[value] += 1;
  }
  table.canDouble = affordable;
  // Both halves face the same dealer, so they combine within each dealer class.
  const chances = new Float64Array(BUST + 1);
  for (const [key, chance] of half) chances[Math.floor(key / CLASS_KEY)] += chance;
  const both = new Map<number, number>();
  for (const [first, a] of half) {
    const finish = Math.floor(first / CLASS_KEY);
    for (const [second, b] of half) {
      if (Math.floor(second / CLASS_KEY) !== finish) continue;
      const net = (first - finish * CLASS_KEY - NET_OFFSET) + (second - finish * CLASS_KEY - NET_OFFSET);
      add(both, encode(finish, net), a * b / chances[finish]);
    }
  }
  return both;
}

/** Utility of every legal action for the hand, in table order. */
export function actionValues(
  hand: Pick<BlackjackHand, 'cards' | 'bet'>, legal: readonly BlackjackAction[], up: Card,
  counts: Counts, total: number, utility: Utility, chips: number,
): Partial<Record<BlackjackAction, number>> {
  const bet = hand.bet;
  const table: Table = {
    up: valueIndex(up), counts: counts.slice(), total, utility, bet, canDouble: chips >= bet, dealerCache: new Map(),
  };
  const { total: points, soft } = bjTotal(hand.cards);
  const hard = soft ? points - 10 : points;
  const values: Partial<Record<BlackjackAction, number>> = {};
  const now = dealerFor(table);
  if (legal.includes('stand')) values.stand = expected(standing(points, bet, now), utility);
  if (legal.includes('hit')) values.hit = expected(afterHit(table, hard, soft, hand.cards.length), utility);
  if (legal.includes('double')) {
    values.double = expected(doubleDown(table, hard, soft), utility);
  }
  if (legal.includes('split')) {
    const pair = valueIndex(hand.cards[0]);
    values.split = expected(afterSplit(table, pair, chips >= bet * 2), utility);
  }
  return values;
}

const ORDER: readonly BlackjackAction[] = ['stand', 'hit', 'double', 'split'];

export function bestAction(values: Partial<Record<BlackjackAction, number>>): BlackjackAction {
  let best: BlackjackAction = 'stand';
  let bestValue = -Infinity;
  for (const action of ORDER) {
    const value = values[action];
    if (value !== undefined && value > bestValue + 1e-12) {
      best = action;
      bestValue = value;
    }
  }
  return best;
}

/** Every card on the table, the dealer's included. */
export function tableCards(visible: Pick<BlackjackVisibleState, 'hands' | 'dealer' | 'seats'>): Card[] {
  const cards = [...visible.dealer];
  for (const seat of visible.seats) for (const hand of visible.hands[seat]) cards.push(...hand.cards);
  return cards;
}

export function shoeDecks(seatCount: number): number {
  return seatCount > 4 ? 2 : 1;
}

/** The action with the best utility for the active hand of this seat's view. */
export function blackjackPlay(visible: BlackjackVisibleState, utility: Utility = linearUtility): BlackjackAction | null {
  const hands = visible.hands[visible.mySeat];
  const hand = hands[visible.activeHand];
  const upCard = visible.dealer[0];
  if (!hand || !upCard) return null;
  const chips = visible.chips[visible.mySeat];
  const legal = bjLegalActions(hands, visible.activeHand, chips);
  if (legal.length === 0) return null;
  const { counts, total } = unseenCounts(shoeDecks(visible.seats.length), tableCards(visible));
  const values = actionValues(hand, legal, upCard, counts, total, utility, chips);
  return bestAction(values);
}
