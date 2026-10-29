import type { Rank } from '../../types/game';
import type { GameSeat } from '../../types/player';
import { GAME_SEAT_ORDER } from '../../constants';
import { actionRecord } from '../action-validation';

export type GoFishAction = { type: 'ask'; target: GameSeat; rank: Rank };

export function parseAction(value: unknown): GoFishAction | string {
  const action = actionRecord(value);
  if (action?.type !== 'ask') return 'Invalid action.';
  const { target, rank } = action;
  if (typeof target !== 'string' || !(GAME_SEAT_ORDER as readonly string[]).includes(target)) return 'Invalid player.';
  if (typeof rank !== 'number' || !Number.isInteger(rank) || rank < 2 || rank > 14) return 'Invalid rank.';
  return { type: 'ask', target: target as GameSeat, rank: rank as Rank };
}
