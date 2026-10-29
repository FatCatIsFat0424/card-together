import { isJoker } from '@shared/rules/cards';
import { omRandomOrder } from '@shared/rules/oldmaid';
import type { OldMaidVisibleState } from '@shared/types';
import type { BotAction } from './bot-decisions';

// Heuristic summary: the neighbour's hand is face down and the server places every card it receives at a random
// position, so no position says anything about the card in it and the best draw is a uniformly random one.
// - Easy draws a random position and never rearranges its own hand.
// - Hard draws the same way but defends its own hand: whenever it holds the joker (known from its own cards only)
//   it shuffles before drawing, so the seat that draws from it next cannot rely on where the joker was kept.
//   Holding nothing worth hiding, it leaves its hand alone, which also keeps its shuffles from being a tell.

function myTurn(visible: OldMaidVisibleState): boolean {
  return visible.phase === 'playing' && visible.currentTurnSeat === visible.mySeat && visible.drawFrom !== null;
}

function drawAction(index: number, reorder?: readonly number[]): BotAction {
  return {
    type: 'game-action',
    request: { gameType: 'oldmaid', action: reorder ? { type: 'draw', index, reorder } : { type: 'draw', index } },
  };
}

function randomIndex(visible: OldMaidVisibleState, random: () => number): number | null {
  const count = visible.drawFrom ? visible.handCounts[visible.drawFrom] : 0;
  return count > 0 ? Math.min(count - 1, Math.floor(random() * count)) : null;
}

export function easyOldMaidAction(visible: OldMaidVisibleState, random: () => number = Math.random): BotAction | null {
  if (!myTurn(visible)) return null;
  const index = randomIndex(visible, random);
  return index === null ? null : drawAction(index);
}

export function getOldMaidBotAction(visible: OldMaidVisibleState, random: () => number): BotAction | null {
  if (!myTurn(visible)) return null;
  const index = randomIndex(visible, random);
  if (index === null) return null;
  const holdsJoker = visible.myHand.some(isJoker);
  return drawAction(index, holdsJoker && visible.myHand.length > 1 ? omRandomOrder(visible.myHand.length, random) : undefined);
}

/** A deliberately simple legal move: the neighbour's first card. */
export function oldMaidFirstLegalAction(visible: OldMaidVisibleState): BotAction | null {
  return myTurn(visible) && randomIndex(visible, () => 0) !== null ? drawAction(0) : null;
}
