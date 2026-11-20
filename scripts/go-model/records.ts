// The self-play record format shared by `selfplay.ts` and `fit.ts`.
import type { GoSize } from '@shared/rules/go';

export interface SelfPlayRecord {
  readonly size: GoSize;
  /** Row-major intersections: `.` empty, `X` black, `O` white. */
  readonly stones: string;
  /** 0 black, 1 white. */
  readonly toMove: 0 | 1;
  /** Up to the last two moves, oldest first: intersection indices, -1 for a pass. */
  readonly recent: readonly number[];
  /** The searched choice: an intersection index, or -1 for a pass. */
  readonly move: number;
}

export function isSelfPlayRecord(value: unknown): value is SelfPlayRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (record.size === 9 || record.size === 13 || record.size === 19) && typeof record.stones === 'string'
    && record.stones.length === record.size * record.size && (record.toMove === 0 || record.toMove === 1)
    && Array.isArray(record.recent) && record.recent.every((move) => Number.isInteger(move))
    && Number.isInteger(record.move);
}
