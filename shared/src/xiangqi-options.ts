import type { XiangqiOptions } from './games/xiangqi/types';
import { XQ_HANDICAPS, XQ_HANDICAP_SIDES } from './rules/xiangqi';

export const DEFAULT_XIANGQI_OPTIONS: XiangqiOptions = { handicap: 'none', handicapSide: 'red' };

export function isXiangqiOptions(value: unknown): value is XiangqiOptions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).length === 2
    && (XQ_HANDICAPS as readonly unknown[]).includes(candidate.handicap)
    && (XQ_HANDICAP_SIDES as readonly unknown[]).includes(candidate.handicapSide);
}
