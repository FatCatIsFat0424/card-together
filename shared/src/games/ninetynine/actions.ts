import type { Card } from '../../types/game';
import type { GameSeat } from '../../types/player';
import { GAME_SEAT_ORDER } from '../../constants';
import { actionRecord, parseCard } from '../action-validation';

export type NinetyNineAction = { type: 'play'; card: Card; choice?: 'plus' | 'minus'; target?: GameSeat };

export function parseAction(value: unknown): NinetyNineAction | string {
  const action = actionRecord(value);
  if (action?.type !== 'play') return 'Invalid action.';
  const card = parseCard(action.card);
  if (!card) return 'Invalid card.';
  const { choice, target } = action;
  if (choice !== undefined && choice !== 'plus' && choice !== 'minus') return 'Invalid choice.';
  if (target !== undefined && !(GAME_SEAT_ORDER as readonly unknown[]).includes(target)) return 'Invalid target.';
  return { type: 'play', card, ...(choice !== undefined ? { choice } : {}),
    ...(target !== undefined ? { target: target as GameSeat } : {}) };
}
