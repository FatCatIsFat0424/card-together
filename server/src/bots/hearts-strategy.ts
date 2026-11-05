import type { Card } from '@shared/types';
import type { HeartsAction, HeartsVisibleState } from '@shared/games/hearts/types';
import { heartsPenalty } from '@shared/rules/hearts';
import type { BotAction } from './bot-decisions';
const wrap = (action: HeartsAction): BotAction => ({ type: 'game-action', request: { gameType: 'hearts', action } });
function passing(view: HeartsVisibleState): boolean {
  return view.phase === 'passing' && !view.passedSeats.includes(view.mySeat);
}
export function heartsFirstLegalAction(view: HeartsVisibleState): BotAction | null {
  if (passing(view)) return wrap({ type: 'pass', cards: view.myHand.slice(0, 3) });
  return view.validCards[0] ? wrap({ type: 'play', card: view.validCards[0] }) : null;
}
export function easyHeartsAction(view: HeartsVisibleState, random: () => number = Math.random): BotAction | null {
  if (passing(view)) {
    const cards = [...view.myHand];
    const selected: Card[] = [];
    while (selected.length < 3 && cards.length) selected.push(...cards.splice(Math.min(cards.length - 1, Math.floor(random() * cards.length)), 1));
    return wrap({ type: 'pass', cards: selected });
  }
  if (view.validCards.length === 0) return null;
  return wrap({ type: 'play', card: view.validCards[Math.min(view.validCards.length - 1, Math.floor(random() * view.validCards.length))] });
}
/** Shed dangerous high cards; play below the current winner, and dump penalties when void. */
export function getHeartsBotAction(view: HeartsVisibleState, _random: () => number = Math.random): BotAction | null {
  if (passing(view)) {
    const risk = (card: Card): number => card.suit === 'spades' && card.rank >= 12 ? 50 + card.rank
      : card.rank + (card.suit === 'hearts' ? 10 : 0);
    return wrap({ type: 'pass', cards: [...view.myHand].sort((a, b) => risk(b) - risk(a)).slice(0, 3) });
  }
  if (view.validCards.length === 0) return null;
  const plays = view.trick?.plays ?? [];
  const suit = plays[0]?.card.suit;
  const highest = Math.max(0, ...plays.filter((play) => play.card.suit === suit).map((play) => play.card.rank));
  const score = (card: Card): number => {
    if (!suit) return -card.rank - heartsPenalty(card) * 3;
    if (card.suit !== suit) return heartsPenalty(card) * 20 + card.rank;
    if (card.rank < highest) return 100 + card.rank;
    // Last to play on a clean trick can safely shed a high card.
    if (plays.length === 3 && plays.every((play) => heartsPenalty(play.card) === 0) && heartsPenalty(card) === 0) return card.rank;
    return -card.rank - heartsPenalty(card) * 3;
  };
  const card = [...view.validCards].sort((a, b) => score(b) - score(a))[0];
  return wrap({ type: 'play', card });
}
