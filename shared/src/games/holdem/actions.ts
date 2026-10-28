import type { HoldemAction } from '../../types/game';

export type { HoldemAction } from '../../types/game';

function parseHoldemAction(value: unknown): HoldemAction | null {
  if (typeof value !== 'object' || value === null) return null;
  const { type, to } = value as { type?: unknown; to?: unknown };
  if (type === 'fold' || type === 'check' || type === 'call') return { type };
  return type === 'raise' && typeof to === 'number' && Number.isSafeInteger(to) && to > 0 ? { type, to } : null;
}

export function parseAction(value: unknown): HoldemAction | string {
  return parseHoldemAction(value) ?? 'Invalid action.';
}
