// ─── Go match flow shared by the server, the bots, and the browser: replaying the public log, the marking window ───

import { goPlay, goReplay, goStart, goPointOfNode } from './go';
import type { GoGame, GoHash, GoMove, GoOptions, GoSide, GoSize } from './go';
import type { NodeId } from './board/board-model';

/** Shortest and longest time both seats get to agree on the dead stones; the room timer lies in between. */
export const GO_MIN_MARK_SECONDS = 90;
export const GO_MAX_MARK_SECONDS = 180;

export function goMarkSeconds(baseSeconds: number, bankSeconds: number): number {
  return Math.min(GO_MAX_MARK_SECONDS, Math.max(GO_MIN_MARK_SECONDS, baseSeconds + bankSeconds));
}

/** Seat index 0 plays black, so the first seat in play order holds the black stones. */
export const goSideOfSeatIndex = (index: number): GoSide | null => (index === 0 ? 0 : index === 1 ? 1 : null);

/** The moves of a public log: an intersection per stone, `pass` for an entry without a point. Null on a bad node. */
export function goMovesOfLog(size: GoSize, log: readonly { readonly to?: NodeId }[]): GoMove[] | null {
  const moves: GoMove[] = [];
  for (const entry of log) {
    if (entry.to === undefined) {
      moves.push('pass');
      continue;
    }
    const point = goPointOfNode(size, entry.to);
    if (point === null) return null;
    moves.push(point);
  }
  return moves;
}

/**
 * Replays a log from the opening. `resumes` lists the log lengths at which marking was abandoned: the passes
 * before them no longer end play, so the count restarts there. Null at the first illegal move.
 */
export function goReplayLog(options: GoOptions, moves: readonly GoMove[], resumes: readonly number[] = []): GoGame | null {
  if (resumes.length === 0) return goReplay(options, moves);
  const start = goStart(options);
  let { position } = start;
  const history: GoHash[] = [...start.history];
  for (let index = 0; index <= moves.length; index++) {
    if (resumes.includes(index)) position = { ...position, passes: 0 };
    if (index === moves.length) break;
    const result = goPlay(position, moves[index], history);
    if (!result) return null;
    position = result.position;
    if (moves[index] !== 'pass') history.push(result.hash);
  }
  return { position, history };
}
