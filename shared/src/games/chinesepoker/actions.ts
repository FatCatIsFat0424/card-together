import type { ChinesePokerArrangement } from '../../types/game';
import { actionRecord, parseCards } from '../action-validation';

export type ChinesePokerAction = { type: 'arrange'; arrangement: ChinesePokerArrangement };

function parseArrangement(value: unknown): ChinesePokerArrangement | null {
  if (typeof value !== 'object' || value === null) return null;
  const { front, middle, back } = value as { front?: unknown; middle?: unknown; back?: unknown };
  const arrangement = { front: parseCards(front, 3, 3), middle: parseCards(middle, 5, 5), back: parseCards(back, 5, 5) };
  if (!arrangement.front || !arrangement.middle || !arrangement.back) return null;
  const all = [...arrangement.front, ...arrangement.middle, ...arrangement.back];
  if (new Set(all.map((card) => `${card.suit}-${card.rank}`)).size !== all.length) return null;
  return { front: arrangement.front, middle: arrangement.middle, back: arrangement.back };
}

export function parseAction(value: unknown): ChinesePokerAction | string {
  const action = actionRecord(value);
  if (action?.type !== 'arrange') return 'Invalid action.';
  const arrangement = parseArrangement(action.arrangement);
  return arrangement ? { type: 'arrange', arrangement } : 'Invalid arrangement.';
}
