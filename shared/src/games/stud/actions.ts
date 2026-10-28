import { parseAction as parseHoldemAction } from '../holdem/actions';
import type { StudAction } from './types';

export type { StudAction } from './types';

/** Stud betting is the Hold'em fold, check, call, and raise vocabulary. */
export function parseAction(value: unknown): StudAction | string {
  return parseHoldemAction(value);
}
