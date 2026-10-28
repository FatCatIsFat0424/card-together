import type { Card, TenHalfAction, TenHalfVisibleState } from '@shared/types';
import { BJ_MIN_BET, bjSitsIn } from '@shared/rules/blackjack';
import {
  TH_LIMIT, TH_MAX_CARDS, TH_MULTIPLIERS, thCardHalves, thHalves, thKindOf, thStrengthOf,
} from '@shared/rules/tenhalf';
import { createDeck } from '../engine/deck';
import { blackjackBet } from './blackjack-strategy';
import type { BotAction } from './bot-decisions';

// Heuristic summary: Easy bets the minimum and draws while its hand is below 7.5 points. Hard bets like the
// Blackjack bot (a few percent of its chips, following the standings in the last two hands) and decides every
// draw from the cards it cannot see: its own hole card and every face-up card leave the deck, and each draw,
// including the hidden hole cards of opponents, comes from what remains. A player compares standing with
// drawing (and with drawing on) against the banker's likely final hand, who is assumed to draw below 7.5.
// The banker compares the chips it would win from every player's hand, whose hole card is still unknown.

/** The banker draws below this many half points (7.5). */
const BANKER_STANDS = 15;
/** Easy bots draw below this many half points (7.5). */
const EASY_STANDS = 15;

/** A hand as its half points and card count, which decide its kind, strength, and multiple. */
interface Hand {
  readonly halves: number;
  readonly count: number;
}

/** One kind of unseen card: its half points and chance of being drawn. */
interface Draw {
  readonly halves: number;
  readonly chance: number;
}

type Distribution = ReadonlyMap<string, { readonly hand: Hand; readonly chance: number }>;

const keyOf = (hand: Hand): string => `${hand.halves}:${hand.count}`;

/** Probability of the next card's half points among the cards this seat cannot see. */
export function unseenDraws(visible: TenHalfVisibleState): Draw[] {
  const seen = new Set<string>();
  const mark = (card: Card): void => { seen.add(`${card.suit}${card.rank}`); };
  const hole = visible.holes[visible.mySeat];
  if (hole) mark(hole);
  for (const seat of visible.seats) visible.ups[seat].forEach(mark);
  const counts = new Map<number, number>();
  let total = 0;
  for (const card of createDeck()) {
    if (seen.has(`${card.suit}${card.rank}`)) continue;
    counts.set(thCardHalves(card), (counts.get(thCardHalves(card)) ?? 0) + 1);
    total += 1;
  }
  return [...counts].map(([halves, count]) => ({ halves, chance: count / total }));
}

function add(distribution: Map<string, { hand: Hand; chance: number }>, hand: Hand, chance: number): void {
  const key = keyOf(hand);
  const entry = distribution.get(key);
  if (entry) entry.chance += chance;
  else distribution.set(key, { hand, chance });
}

/** Final hands of seats that draw until they hold `stand` half points, five cards, or bust. */
function finalHands(starts: Distribution, draws: readonly Draw[], stand: number): Distribution {
  const result = new Map<string, { hand: Hand; chance: number }>();
  let frontier = starts;
  while (frontier.size > 0) {
    const next = new Map<string, { hand: Hand; chance: number }>();
    for (const { hand, chance } of frontier.values()) {
      if (hand.halves >= stand || hand.count >= TH_MAX_CARDS) {
        add(result, hand, chance);
        continue;
      }
      for (const draw of draws) add(next, { halves: hand.halves + draw.halves, count: hand.count + 1 }, chance * draw.chance);
    }
    frontier = next;
  }
  return result;
}

/** Final hands once the unknown hole card is drawn on top of the visible face-up cards. */
function withHole(ups: readonly Card[], draws: readonly Draw[], stand: number): Distribution {
  const starts = new Map<string, { hand: Hand; chance: number }>();
  for (const hole of draws) add(starts, { halves: hole.halves + thHalves(ups), count: ups.length + 1 }, hole.chance);
  return finalHands(starts, draws, stand);
}

/** Chips (in bets) a player's hand wins against each possible banker hand, losing the banker's multiple. */
function playerValue(hand: Hand, banker: Distribution): number {
  const own = thStrengthOf(hand.halves, hand.count);
  const multiple = TH_MULTIPLIERS[thKindOf(hand.halves, hand.count)];
  let value = 0;
  for (const { hand: other, chance } of banker.values()) {
    const against = thStrengthOf(other.halves, other.count);
    value += chance * (own >= 0 && own > against ? multiple : -TH_MULTIPLIERS[thKindOf(other.halves, other.count)]);
  }
  return value;
}

/** Best value of a hand that may keep drawing, given the value of standing on any hand. */
function bestValue(start: Hand, draws: readonly Draw[], stand: (hand: Hand) => number): { stand: number; hit: number } {
  const memo = new Map<string, number>();
  const value = (hand: Hand): number => {
    const key = keyOf(hand);
    const known = memo.get(key);
    if (known !== undefined) return known;
    let best = stand(hand);
    if (hand.halves < TH_LIMIT && hand.count < TH_MAX_CARDS) {
      best = Math.max(best, drawValue(hand));
    }
    memo.set(key, best);
    return best;
  };
  const drawValue = (hand: Hand): number => draws.reduce(
    (sum, draw) => sum + draw.chance * value({ halves: hand.halves + draw.halves, count: hand.count + 1 }), 0);
  return { stand: stand(start), hit: drawValue(start) };
}

function handOf(cards: readonly Card[]): Hand {
  return { halves: thHalves(cards), count: cards.length };
}

/** A banker who has seen the players stand: the chips it nets from every player's hand if it stands on `hand`. */
function bankerValue(visible: TenHalfVisibleState, draws: readonly Draw[]): (hand: Hand) => number {
  const players = visible.dealt.filter((seat) => seat !== visible.banker);
  // A player's final hand is its face-up cards plus the hole card the banker cannot see.
  const finals = players.map((seat) => ({
    bet: visible.bets[seat], hands: withHole(visible.ups[seat], draws, 0),
  }));
  return (hand) => {
    const banker = new Map([[keyOf(hand), { hand, chance: 1 }]]);
    return -finals.reduce((sum, { bet, hands }) => sum + bet * [...hands.values()]
      .reduce((total, entry) => total + entry.chance * playerValue(entry.hand, banker), 0), 0);
  };
}

export function tenHalfDecision(visible: TenHalfVisibleState): TenHalfAction {
  const hole = visible.holes[visible.mySeat];
  const ups = visible.ups[visible.mySeat];
  if (!hole) return 'stand';
  const mine = handOf([hole, ...ups]);
  const draws = unseenDraws(visible);
  if (visible.banker === visible.mySeat) {
    const { stand, hit } = bestValue(mine, draws, bankerValue(visible, draws));
    return hit > stand ? 'hit' : 'stand';
  }
  const banker = withHole(visible.ups[visible.banker], draws, BANKER_STANDS);
  const { stand, hit } = bestValue(mine, draws, (hand) => playerValue(hand, banker));
  return hit > stand ? 'hit' : 'stand';
}

function actionOf(action: TenHalfAction): BotAction {
  return { type: 'game-action', request: { gameType: 'tenhalf', action: { type: 'act', action } } };
}

function betOf(amount: number): BotAction {
  return { type: 'game-action', request: { gameType: 'tenhalf', action: { type: 'bet', amount } } };
}

function bettingOpen(visible: TenHalfVisibleState): boolean {
  return visible.phase === 'betting' && visible.myBet === null && visible.banker !== visible.mySeat
    && bjSitsIn(visible.chips[visible.mySeat]);
}

function myTurn(visible: TenHalfVisibleState): boolean {
  return visible.phase === 'playing' && visible.currentTurnSeat === visible.mySeat
    && visible.holes[visible.mySeat] !== null && !visible.done[visible.mySeat];
}

export function getTenHalfBotAction(visible: TenHalfVisibleState, random: () => number): BotAction | null {
  if (visible.phase === 'betting') return bettingOpen(visible) ? betOf(blackjackBet(visible, random)) : null;
  return myTurn(visible) ? actionOf(tenHalfDecision(visible)) : null;
}

export function easyTenHalfAction(visible: TenHalfVisibleState): BotAction | null {
  if (visible.phase === 'betting') return bettingOpen(visible) ? betOf(BJ_MIN_BET) : null;
  if (!myTurn(visible)) return null;
  const halves = thHalves([visible.holes[visible.mySeat] as Card, ...visible.ups[visible.mySeat]]);
  return actionOf(halves < EASY_STANDS ? 'hit' : 'stand');
}

/** Minimum bet when betting, otherwise stand: the timeout action and the last-resort legal move. */
export function tenHalfFirstLegalAction(visible: TenHalfVisibleState): BotAction | null {
  if (visible.phase === 'betting') return bettingOpen(visible) ? betOf(BJ_MIN_BET) : null;
  return myTurn(visible) ? actionOf('stand') : null;
}
