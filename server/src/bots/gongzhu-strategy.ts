import type { Card } from '@shared/types';
import type { GongZhuVisibleState } from '@shared/games/gongzhu/types';
import { gongZhuCardPoints, gongZhuLegalCards, gongZhuScore, gongZhuTrickWinner } from '@shared/rules/gongzhu';
import type { BotAction } from './bot-decisions';
import { selectNearBest } from './selection';

function legal(visible: GongZhuVisibleState): Card[] {
  return visible.phase === 'playing' && !visible.observer && visible.currentTurnSeat === visible.mySeat
    ? gongZhuLegalCards(visible.myHand, visible.trick, visible.tricks.length === 0) : [];
}
function action(card: Card | undefined): BotAction | null {
  return card ? { type: 'game-action', request: { gameType: 'gongzhu', action: { type: 'play', card } } } : null;
}
export function gongZhuFirstLegalAction(visible: GongZhuVisibleState): BotAction | null { return action(legal(visible)[0]); }
export function easyGongZhuAction(visible: GongZhuVisibleState, random: () => number): BotAction | null {
  const cards = legal(visible);
  return action(cards[Math.min(cards.length - 1, Math.floor(random() * cards.length))]);
}

/** Avoid negative tricks, seek positive ones, and shed dangerous cards when unable to win. No hidden hands are read. */
export function getGongZhuBotAction(visible: GongZhuVisibleState, random: () => number = Math.random): BotAction | null {
  const cards = legal(visible);
  const captured = visible.captures[visible.mySeat];
  const value = (card: Card): number => {
    const trick = [...visible.trick, { seat: visible.mySeat, card }];
    const wins = gongZhuTrickWinner(trick) === visible.mySeat;
    const incoming = trick.map((play) => play.card);
    const gain = gongZhuScore([...captured, ...incoming]) - gongZhuScore(captured);
    if (!wins) return -gongZhuCardPoints(card) * 3 + card.rank;
    // An unfinished trick can still acquire penalties; low winners expose less risk.
    return gain * (trick.length === 4 ? 4 : 1) - card.rank * 2;
  };
  // Two points allow one rank between winners, far below the value of a scoring card.
  return action(selectNearBest(cards.map((card) => ({ value: card, score: value(card) })), random, 2) ?? undefined);
}
