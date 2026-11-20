// Hand-made starting weights in the pattern layout: square values along the edges and mobility. They only
// drive the first round of self-play, before any fitted weights exist.
import { FEATURE_TABLES, SCALE, STAGES, STAGE_SIZE } from '../../server/src/bots/reversi-eval';
import type { FeatureTable } from '../../server/src/bots/reversi-eval';

/** Per-edge values of the edge pattern's cells: X square, the eight edge squares, X square. */
const EDGE_VALUES = [-1, 2, -0.5, 0.4, 0.2, 0.2, 0.4, -0.5, 2, -1];
/** X squares and the C squares next to a corner count only while that corner is empty. */
const CORNER_OF = [1, -1, 1, -1, -1, -1, -1, 8, -1, 8];

export function bootstrapWeights(): Int16Array {
  const weights = new Int16Array(STAGES * STAGE_SIZE);
  const table = (name: string): FeatureTable => FEATURE_TABLES.find((entry) => entry.name === name)!;
  const edge = table('edge2x');
  for (let config = 0; config < edge.size; config++) {
    const states: number[] = [];
    for (let rest = config, k = 0; k < 10; k++, rest = Math.floor(rest / 3)) states.unshift(rest % 3);
    let value = 0;
    states.forEach((state, k) => {
      if (state === 0) return;
      const corner = CORNER_OF[k];
      if (corner >= 0 && states[corner] !== 0) return;
      value += (state === 1 ? 1 : -1) * EDGE_VALUES[k];
    });
    for (let stage = 0; stage < STAGES; stage++) weights[stage * STAGE_SIZE + edge.offset + config] = Math.round(value * SCALE);
  }
  for (const [name, sign] of [['mobility', 1], ['opponent-mobility', -1]] as const) {
    const mobility = table(name);
    for (let count = 0; count < mobility.size; count++) {
      for (let stage = 0; stage < STAGES; stage++) {
        weights[stage * STAGE_SIZE + mobility.offset + count] = Math.round(sign * count * 0.6 * SCALE);
      }
    }
  }
  return weights;
}
