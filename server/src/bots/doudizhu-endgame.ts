import { countCode, rankMoves } from './doudizhu-hand';
import type { RankMove } from './doudizhu-hand';
import { applyWithUndo, sameSide, toBeat, undoMove } from './doudizhu-world';
import type { World } from './doudizhu-world';

// Exact perfect-information search of a small Dou Dizhu ending, the counterpart of Bridge's double-dummy
// solver: every hand of a sampled world is open and each side looks for a forced win. The result is which
// side wins; multipliers from bombs played inside the ending are left to the caller. A transposition table
// keyed by the three hands, the seat to act, and the play to beat can be shared by every solve of one
// decision, since the answer does not depend on who asks.

export interface EndgameLimits {
  /** Cards left in all three hands together at most. */
  readonly totalCards: number;
  /** Search nodes per solve before the solver gives up. */
  readonly nodes: number;
}

export const DEFAULT_ENDGAME: EndgameLimits = { totalCards: 24, nodes: 12_000 };

/** Solved positions: whether the landlord wins. */
export type EndgameTable = Map<string, boolean>;

/** Entries kept at most; the table starts over beyond this. */
const TABLE_LIMIT = 100_000;

class NodeLimit extends Error {}

function positionKey(world: World): string {
  const last = world.last && world.lastSeat !== world.turn
    ? `${world.lastSeat}${world.last.combo.type}${world.last.combo.power}.${world.last.combo.length}` : '-';
  return `${countCode(world.hands[0])},${countCode(world.hands[1])},${countCode(world.hands[2])},${world.turn}${last}`;
}

/** Plays for the seat to act, likeliest winners first: going out, then larger plays, then lower ones. */
function orderedMoves(world: World): (RankMove | null)[] {
  const previous = toBeat(world);
  const moves: (RankMove | null)[] = rankMoves(world.hands[world.turn], previous, 'all')
    .sort((a, b) => b.ranks.length - a.ranks.length || a.combo.power - b.combo.power);
  if (previous) {
    // Letting a partner's play stand is usually right; against an opponent, answering usually is.
    if (sameSide(world, world.lastSeat, world.turn)) moves.unshift(null);
    else moves.push(null);
  }
  return moves;
}

/**
 * Whether the landlord wins `world` with best play by everyone, or null when the ending is too large, the
 * node limit was reached, or `stop` (polled every few hundred nodes) returned true. `world` is changed
 * during the search and restored before returning.
 */
export function solveEndgame(
  world: World, table: EndgameTable, limits: EndgameLimits = DEFAULT_ENDGAME, stop: () => boolean = () => false,
): boolean | null {
  if (world.winner >= 0) return world.winner === world.landlord;
  if (world.sizes[0] + world.sizes[1] + world.sizes[2] > limits.totalCards) return null;
  if (table.size > TABLE_LIMIT) table.clear();
  let nodes = 0;
  const landlordWins = (): boolean => {
    if (world.winner >= 0) return world.winner === world.landlord;
    const key = positionKey(world);
    const known = table.get(key);
    if (known !== undefined) return known;
    if (++nodes > limits.nodes || (nodes % 256 === 0 && stop())) throw new NodeLimit();
    const mover = world.turn;
    const landlordMoves = mover === world.landlord;
    const size = world.sizes[mover];
    const moves = orderedMoves(world);
    // Going out wins at once.
    let result = !landlordMoves;
    if (moves.some((move) => move !== null && move.ranks.length === size)) result = landlordMoves;
    else {
      for (const move of moves) {
        const undo = applyWithUndo(world, move);
        let outcome: boolean;
        try {
          outcome = landlordWins();
        } finally {
          undoMove(world, undo);
        }
        if (outcome === landlordMoves) {
          result = landlordMoves;
          break;
        }
      }
    }
    table.set(key, result);
    return result;
  };
  try {
    return landlordWins();
  } catch (error) {
    if (error instanceof NodeLimit) return null;
    throw error;
  }
}
