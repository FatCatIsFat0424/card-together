import type { Card, Seat } from '@shared/types';
import type { SpadesAction, SpadesVisibleState } from '@shared/games/spades/types';
import { spadesTeam, spadesTrickWinner } from '@shared/rules/spades';
import type { BotAction } from './bot-decisions';
import { selectNearBest } from './selection';

function wrap(action: SpadesAction): BotAction { return { type: 'game-action', request: { gameType: 'spades', action } }; }
function active(view: SpadesVisibleState): boolean { return view.phase !== 'scoring' && view.currentTurnSeat === view.mySeat; }
function estimate(hand: readonly Card[]): number {
  let value = hand.reduce((sum, card) => sum + (card.rank === 14 ? 0.95 : card.rank === 13 ? 0.65 : card.rank === 12 ? 0.3 : 0), 0);
  const trumps = hand.filter((card) => card.suit === 'spades');
  value += Math.max(0, trumps.length - 2) * 0.55;
  return Math.max(1, Math.min(13, Math.round(value)));
}
export function spadesFirstLegalAction(view: SpadesVisibleState): BotAction | null {
  if (!active(view)) return null;
  return view.phase === 'bidding' ? wrap({ type: 'bid', bid: estimate(view.myHand) })
    : view.validCards[0] ? wrap({ type: 'play', card: view.validCards[0] }) : null;
}
export function easySpadesAction(view: SpadesVisibleState, random: () => number = Math.random): BotAction | null {
  if (!active(view)) return null;
  if (view.phase === 'bidding') return wrap({ type: 'bid', bid: estimate(view.myHand) });
  const cards = view.validCards;
  return cards.length ? wrap({ type: 'play', card: cards[Math.min(cards.length - 1, Math.floor(random() * cards.length))] }) : null;
}
/** Partnership heuristics use only the player's hand, public bids, and the current trick. */
export function getSpadesBotAction(view: SpadesVisibleState, random: () => number = Math.random): BotAction | null {
  if (!active(view)) return null;
  if (view.phase === 'bidding') {
    const safeNil = view.myHand.every((card) => card.rank < 12)
      && view.myHand.filter((card) => card.suit === 'spades').every((card) => card.rank <= 8)
      && view.myHand.filter((card) => card.suit === 'spades').length <= 2;
    return wrap({ type: 'bid', bid: safeNil ? 0 : estimate(view.myHand) });
  }
  const cards = view.validCards;
  if (!cards.length) return null;
  const { position, mySeat } = view;
  const nil = position.bids[mySeat] === 0 && position.taken[mySeat] === 0;
  const winner = position.trick.length ? spadesTrickWinner(position.trick) : null;
  const partnerWinning = winner !== null && spadesTeam(winner) === spadesTeam(mySeat) && position.bids[winner] !== 0;
  const winning = cards.filter((card) => spadesTrickWinner([...position.trick, { seat: mySeat, card }]) === mySeat);
  const losing = cards.filter((card) => !winning.includes(card));
  const partner = ({ N: 'S', S: 'N', E: 'W', W: 'E' } as const)[mySeat] as Seat;
  const protectNil = winner === partner && position.bids[partner] === 0 && position.taken[partner] === 0;
  const publicCards = [...position.tricks.flatMap((trick) => trick.plays), ...position.trick].map((play) => play.card);
  const known = new Set([...view.myHand, ...publicCards].map((card) => `${card.suit}:${card.rank}`));
  const missing = (suit: Card['suit'], rank: number): boolean => !known.has(`${suit}:${rank}`);
  // Adjacent cards held together have identical strength against every unseen card.
  const cost = (card: Card): number => (card.suit === 'spades' ? 20 : 0)
    + Array.from({ length: card.rank - 2 }, (_, index) => index + 2).filter((rank) => missing(card.suit, rank)).length;
  const master = (card: Card): boolean => Array.from({ length: 14 - card.rank }, (_, index) => card.rank + index + 1)
    .every((rank) => !missing(card.suit, rank));
  let pool: readonly Card[];
  let shedHigh = false;
  if (nil) {
    pool = losing.length ? losing : cards;
    shedHigh = losing.length > 0;
  } else if (protectNil && winning.length) pool = winning;
  else if (partnerWinning) {
    const current = position.trick.find((play) => play.seat === winner)!.card;
    // Secure a vulnerable partner's winner before the last opponent can overtake it.
    const secure = position.trick.length < 3 && !master(current) ? winning.filter(master) : [];
    pool = secure.length ? secure : losing.length ? losing : cards;
  } else if (position.trick.length && winning.length) pool = winning;
  else if (position.trick.length) pool = cards;
  else {
    const cash = cards.filter((card) => card.suit !== 'spades' && master(card));
    pool = cash.length ? cash : cards;
  }
  const card = selectNearBest(pool.map((value) => ({ value, score: (shedHigh ? 1 : -1) * cost(value) })), random, 0);
  return card ? wrap({ type: 'play', card }) : null;
}
