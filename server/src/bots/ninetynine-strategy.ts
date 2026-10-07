import type { Card, NinetyNineVisibleState, Seat } from '@shared/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { NN_MAX, nnApply, nnIsPlayable, nnRequiresChoice } from '@shared/rules/ninetynine';
import type { NnChoice } from '@shared/rules/ninetynine';
import type { BotAction } from './bot-decisions';
import { selectNearBest } from './selection';

function rescueValue(card: Card): number {
  if (card.rank === 14 && card.suit === 'spades') return 8;
  if (nnRequiresChoice(card)) return card.rank === 12 ? 7 : 6;
  if (card.rank === 4 || card.rank === 5 || card.rank === 11 || card.rank === 13) return 4;
  return 0;
}

function nextOpponent(visible: NinetyNineVisibleState, reverse: boolean): Seat {
  const direction = visible.direction === 'cw' ? 1 : -1;
  const step = reverse ? -direction : direction;
  const start = SEAT_ORDER_CLOCKWISE.indexOf(visible.mySeat);
  for (let offset = 1; offset < 4; offset++) {
    const seat = SEAT_ORDER_CLOCKWISE[(start + step * offset + 4) % 4];
    if (!visible.eliminated.includes(seat)) return seat;
  }
  return visible.mySeat;
}

function scorePlay(visible: NinetyNineVisibleState, index: number, total: number, reverse: boolean, target?: Seat): number {
  const remaining = visible.myHand.filter((_, cardIndex) => cardIndex !== index);
  const reserves = remaining.reduce((sum, card) => sum + rescueValue(card), 0);
  const rescueCount = remaining.filter((card) => rescueValue(card) > 0).length;
  const playable = remaining.filter((card) => nnIsPlayable(total, card)).length;
  const aliveCount = SEAT_ORDER_CLOCKWISE.filter((seat) => !visible.eliminated.includes(seat)).length;
  const pressure = total * 0.2 + Math.max(0, total - 89) * 0.65;
  // A duel gives fewer intervening turns to relieve a high total.
  const exposed = total >= 90 && rescueCount === 0 ? 22 + (aliveCount === 2 ? 8 : 0) : 0;
  const next = target ?? nextOpponent(visible, reverse);
  const fewerOptions = Math.max(0, 5 - visible.handCounts[next]) / 5;
  const nextPressure = fewerOptions * Math.max(0, total - 80) / 19 * 2;
  return pressure + reserves * 1.3 + playable * 0.5 + nextPressure - exposed;
}

/** Balances pressure against known rescue reserves; drawn cards and opponent hands stay unknown. */
export function getNinetyNineBotAction(visible: NinetyNineVisibleState, random: () => number): BotAction | null {
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat
    || visible.eliminated.includes(visible.mySeat)) return null;
  const opponents: Seat[] = SEAT_ORDER_CLOCKWISE
    .filter((seat) => seat !== visible.mySeat && !visible.eliminated.includes(seat));
  const options: { value: BotAction; score: number }[] = [];
  visible.myHand.forEach((card, index) => {
    const choices: readonly (NnChoice | undefined)[] = nnRequiresChoice(card) ? ['plus', 'minus'] : [undefined];
    for (const choice of choices) {
      const effect = nnApply(visible.total, card, choice);
      if (effect.total > NN_MAX) continue;
      const targets: readonly (Seat | undefined)[] = effect.designate ? opponents : [undefined];
      for (const target of targets) {
        options.push({
          value: {
            type: 'ninetynine-play', card,
            ...(choice ? { choice } : {}), ...(target ? { target } : {}),
          },
          score: scorePlay(visible, index, effect.total, effect.reverse, target),
        });
      }
    }
  });
  return selectNearBest(options, random, 2.5);
}
