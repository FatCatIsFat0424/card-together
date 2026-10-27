import type { CSSProperties } from 'react';

/**
 * Place on the seat oval as a unit vector, applied by the seat as CSS variables. The viewer's seat
 * (`first`) sits at the bottom and the others follow clockwise, so the table reads the way it will be played.
 */
export function ovalPosition(index: number, first: number, count: number): CSSProperties {
  const angle = Math.PI / 2 + ((index - first) * 2 * Math.PI) / count;
  return { '--cx': Math.cos(angle).toFixed(3), '--cy': Math.sin(angle).toFixed(3) } as CSSProperties;
}
