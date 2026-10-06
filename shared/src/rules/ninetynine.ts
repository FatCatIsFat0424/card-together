// ─── 99 規則引擎（純函式，前後端共用） ───
// Rules: docs/games.md#ninety-nine

import type { Card } from '../types';

export const NN_HAND_SIZE = 5;
export const NN_MAX = 99;

export type NnChoice = 'plus' | 'minus';

export interface NnEffect {
  total: number;
  reverse: boolean;
  designate: boolean;
}

/** 10 與 Q 需選擇加或減 */
export function nnRequiresChoice(card: Card): boolean {
  return card.rank === 10 || card.rank === 12;
}

/** 依牌效果計算新累計點數與流程變化；10/Q 未給 choice 時拋錯 */
export function nnApply(total: number, card: Card, choice?: NnChoice): NnEffect {
  const effect: NnEffect = { total, reverse: false, designate: false };
  switch (card.rank) {
    case 14:
      effect.total = card.suit === 'spades' ? 0 : total + 1;
      break;
    case 4:
      effect.reverse = true;
      break;
    case 5:
      effect.designate = true;
      break;
    case 11:
      // J = PASS：點數不變，正常換下一位
      break;
    case 13:
      effect.total = NN_MAX;
      break;
    case 10:
    case 12: {
      if (!choice) throw new Error('choice required');
      const delta = card.rank === 10 ? 10 : 20;
      effect.total = choice === 'plus' ? total + delta : Math.max(0, total - delta);
      break;
    }
    default:
      effect.total = total + card.rank;
  }
  return effect;
}

/** 存在某個合法選擇使累計點數不超過 99 */
export function nnIsPlayable(total: number, card: Card): boolean {
  const choices: (NnChoice | undefined)[] = nnRequiresChoice(card) ? ['plus', 'minus'] : [undefined];
  return choices.some((choice) => nnApply(total, card, choice).total <= NN_MAX);
}

export function nnHasPlayable(total: number, hand: readonly Card[]): boolean {
  return hand.some((card) => nnIsPlayable(total, card));
}
