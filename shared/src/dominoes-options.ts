import type { DominoesOptions, DominoTarget } from './games/dominoes/types';

export const DOMINOES_TARGETS: readonly DominoTarget[] = [50, 100, 150];

export const DEFAULT_DOMINOES_OPTIONS: DominoesOptions = { targetScore: 100 };

export function isDominoesOptions(value: unknown): value is DominoesOptions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).length === 1 && DOMINOES_TARGETS.includes(candidate.targetScore as DominoTarget);
}
