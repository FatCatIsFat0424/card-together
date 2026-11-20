// ─── Gomoku threat-space search: continuous fours (VCF) and continuous fours and open threes (VCT) ───
//
// The attacker only plays moves the defender must answer. A four leaves one reply (or none); an open three
// leaves the cells that make a four for either side. Black under Renju plays only legal points, and a
// forbidden block is no defence for black. These searches read only the position, so a result is a forced
// win for the attacker (up to the node limit, which makes a search fail, never succeed, early).

import type { GmSide } from '@shared/rules/gomoku';
import { FOUR, OPEN_FOUR, OPEN_THREE } from './gomoku-patterns';
import { AREA, INDEX_OF } from './gomoku-position';
import type { Position } from './gomoku-position';

/** Score of a certain win; a sooner win scores higher. */
export const WIN = 1_000_000;

/** What the searches share: the position, the node count, and the stop conditions. */
export class SearchContext {
  nodes = 0;
  /** Node count at which the running threat search gives up */
  limit = Infinity;
  /** The clock or the node budget ran out: the whole search must unwind */
  stopped = false;
  /** Positions the running VCT search proved not won, by remaining depth */
  readonly failed = new Map<number, number>();

  constructor(
    readonly position: Position,
    private readonly expired: () => boolean,
    private readonly maxNodes: number,
  ) {}

  /** Counts a node of the main search; true once it must stop. */
  tick(): boolean {
    if (++this.nodes > this.maxNodes || ((this.nodes & 255) === 0 && this.expired())) this.stopped = true;
    return this.stopped;
  }

  /** Set while the root threat searches run: true once they have had their share of the time */
  threatClock: (() => boolean) | null = null;
  private threatSpent = false;

  /** Counts a node of a threat search; true once it must give up. */
  tickThreat(): boolean {
    if (this.tick() || this.nodes > this.limit) return true;
    if (this.threatClock === null) return false;
    if (!this.threatSpent && (this.nodes & 63) === 0 && this.threatClock()) this.threatSpent = true;
    return this.threatSpent;
  }
}

/** Value of a shape for ordering: what making it gains, and what taking the cell away from the opponent saves. */
const ATTACK = [0, 3, 10, 14, 90, 400, 3000, 1_000_000];
const DEFEND = [0, 2, 8, 11, 70, 300, 2000, 500_000];

const CENTRE_PENALTY = Float64Array.from({ length: 225 }, (_, index) =>
  0.3 * Math.max(Math.abs((index % 15) - 7), Math.abs(Math.floor(index / 15) - 7)));

/** How good playing the padded cell looks for `side`, from the shapes it makes and the ones it takes away. */
export function moveValue(position: Position, cell: number, side: GmSide): number {
  const other = 1 - side;
  let value = -CENTRE_PENALTY[INDEX_OF[cell]];
  let fours = 0;
  let threes = 0;
  let theirFours = 0;
  let theirThrees = 0;
  for (let axis = 0; axis < 4; axis++) {
    const mine = position.shape(side, axis, cell);
    const theirs = position.shape(other, axis, cell);
    value += ATTACK[mine] + DEFEND[theirs];
    if (mine >= FOUR) fours++;
    else if (mine === OPEN_THREE) threes++;
    if (theirs >= FOUR) theirFours++;
    else if (theirs === OPEN_THREE) theirThrees++;
  }
  if (fours >= 2 || (fours >= 1 && threes >= 1)) value += 4000;
  else if (threes >= 2) value += 1500;
  if (theirFours >= 2 || (theirFours >= 1 && theirThrees >= 1)) value += 2500;
  else if (theirThrees >= 2) value += 800;
  return value;
}

/**
 * Whether `side` would win by force were it to move: some cell makes an open four, a double four, or a four
 * with an open three. The defender must spend the move on it.
 */
export function winThreat(position: Position, side: GmSide): boolean {
  const set = position.fours[side];
  for (let i = 0; i < set.size; i++) {
    const cell = set.list[i];
    let fours = 0;
    let threes = 0;
    let open = false;
    for (let axis = 0; axis < 4; axis++) {
      const shape = position.shape(side, axis, cell);
      if (shape >= FOUR) {
        fours++;
        if (shape === OPEN_FOUR) open = true;
      } else if (shape === OPEN_THREE) threes++;
    }
    if ((open || fours >= 2 || (fours >= 1 && threes >= 1)) && position.legal(cell, side)) return true;
  }
  return false;
}

const LEVELS = 64;
const SLOTS = 48;

const cellBuffer = new Int16Array(LEVELS * SLOTS);
const valueBuffer = new Float64Array(LEVELS * SLOTS);

/** Sorts the first `count` entries of a level's buffers by value, best first. */
function sortLevel(level: number, count: number): void {
  const base = level * SLOTS;
  for (let i = 1; i < count; i++) {
    const cell = cellBuffer[base + i];
    const value = valueBuffer[base + i];
    let j = i - 1;
    while (j >= 0 && valueBuffer[base + j] < value) {
      cellBuffer[base + j + 1] = cellBuffer[base + j];
      valueBuffer[base + j + 1] = valueBuffer[base + j];
      j--;
    }
    cellBuffer[base + j + 1] = cell;
    valueBuffer[base + j + 1] = value;
  }
}

/** Collects the legal cells of a set into a level's buffers, scored for `side`, best first. */
function collect(position: Position, cells: Int16Array, size: number, side: GmSide, level: number, start: number, only?: number): number {
  const base = level * SLOTS;
  let count = start;
  for (let i = 0; i < size && count < SLOTS; i++) {
    const cell = cells[i];
    if (only !== undefined && position.best[side * AREA + cell] !== only) continue;
    if (!position.legal(cell, side)) continue;
    cellBuffer[base + count] = cell;
    valueBuffer[base + count] = moveValue(position, cell, side);
    count++;
  }
  return count;
}

/**
 * Continuous fours: the first cell of a forced win for `attacker` (to move) that plays only fours, or -1.
 * `fours` caps the voluntary fours; forced blocks are free.
 */
export function vcf(context: SearchContext, attacker: GmSide, fours: number, level = 0): number {
  if (context.tickThreat() || level >= LEVELS) return -1;
  const position = context.position;
  const defender = (1 - attacker) as GmSide;
  if (position.winCells(attacker) > 0) return position.wins[0];
  const threats = position.winCells(defender);
  if (threats >= 2) return -1;
  const base = level * SLOTS;
  let count: number;
  let voluntary = 1;
  if (threats === 1) {
    const block = position.wins[0];
    if (!position.legal(block, attacker)) return -1;
    cellBuffer[base] = block;
    count = 1;
    voluntary = 0;
  } else {
    if (fours <= 0) return -1;
    const set = position.fours[attacker];
    count = collect(position, set.list, set.size, attacker, level, 0);
    sortLevel(level, count);
  }
  for (let i = 0; i < count; i++) {
    const cell = cellBuffer[base + i];
    position.makeCell(cell, attacker);
    let won = false;
    const wins = position.winCells(attacker);
    if (wins >= 2) won = true;
    else if (wins === 1) {
      const reply = position.wins[0];
      if (!position.legal(reply, defender)) won = true;
      else {
        position.makeCell(reply, defender);
        won = vcf(context, attacker, fours - voluntary, level + 1) >= 0;
        position.unmakeCell(reply, defender);
      }
    }
    position.unmakeCell(cell, attacker);
    if (won) return cell;
    if (context.stopped || context.nodes > context.limit) return -1;
  }
  return -1;
}

/** Quiet open-three moves tried per position, best first. */
const THREE_BREADTH = 6;
/** Defences tried against an open three. */
const DEFENCE_BREADTH = 14;

/** The cell that starts a forced win by fours and open threes for `attacker` (to move), or -1. */
export function vct(context: SearchContext, attacker: GmSide, threes: number): number {
  context.failed.clear();
  return attackerMoves(context, attacker, threes, 0);
}

const failKey = (position: Position, attacker: GmSide): number => (position.hashA >>> 0) * 2 + attacker;

/** The attacker is to move; `threes` open threes may still be spent. */
function attackerMoves(context: SearchContext, attacker: GmSide, threes: number, level: number): number {
  if (context.tickThreat() || level >= LEVELS) return -1;
  const position = context.position;
  const defender = (1 - attacker) as GmSide;
  if (position.winCells(attacker) > 0) return position.wins[0];
  const pending = position.winCells(defender);
  if (pending >= 2) return -1;
  const base = level * SLOTS;
  let count: number;
  let forced = false;
  const key = failKey(position, attacker);
  if (pending === 1) {
    const block = position.wins[0];
    if (!position.legal(block, attacker)) return -1;
    cellBuffer[base] = block;
    count = 1;
    forced = true;
  } else {
    const seen = context.failed.get(key);
    if (seen !== undefined && seen >= threes) return -1;
    const set = position.fours[attacker];
    count = collect(position, set.list, set.size, attacker, level, 0);
    sortLevel(level, count);
    if (threes > 0) {
      const quiet = collect(position, position.threes[attacker].list, position.threes[attacker].size, attacker, level, count,
        OPEN_THREE);
      // Only the best few quiet threes are tried; they sit after the fours in the buffer.
      const kept = Math.min(quiet - count, THREE_BREADTH);
      sortTail(level, count, quiet);
      count += kept;
    }
  }
  for (let i = 0; i < count; i++) {
    const cell = cellBuffer[base + i];
    position.makeCell(cell, attacker);
    let won = false;
    const wins = position.winCells(attacker);
    if (wins >= 2) won = true;
    else if (wins === 1) {
      const reply = position.wins[0];
      if (!position.legal(reply, defender)) won = true;
      else {
        position.makeCell(reply, defender);
        won = attackerMoves(context, attacker, threes, level + 1) >= 0;
        position.unmakeCell(reply, defender);
      }
    } else if (!forced) {
      won = defenderMoves(context, attacker, threes - 1, level + 1);
    }
    position.unmakeCell(cell, attacker);
    if (won) return cell;
    if (context.stopped || context.nodes > context.limit) return -1;
  }
  if (!forced) context.failed.set(key, threes);
  return -1;
}

/** Sorts entries `from .. to` of a level, best first. */
function sortTail(level: number, from: number, to: number): void {
  const base = level * SLOTS;
  for (let i = from + 1; i < to; i++) {
    const cell = cellBuffer[base + i];
    const value = valueBuffer[base + i];
    let j = i - 1;
    while (j >= from && valueBuffer[base + j] < value) {
      cellBuffer[base + j + 1] = cellBuffer[base + j];
      valueBuffer[base + j + 1] = valueBuffer[base + j];
      j--;
    }
    cellBuffer[base + j + 1] = cell;
    valueBuffer[base + j + 1] = value;
  }
}

/**
 * The defender is to move against the attacker's fresh threat: whether the attacker wins whatever it plays.
 * Defences are the cells that make a four for either side: they cover every block of a three and every
 * counter-attack that gains a tempo.
 */
function defenderMoves(context: SearchContext, attacker: GmSide, threes: number, level: number): boolean {
  if (context.tickThreat() || level >= LEVELS) return false;
  const position = context.position;
  const defender = (1 - attacker) as GmSide;
  const mine = position.winCells(attacker);
  if (mine >= 2) return true;
  if (mine === 1) {
    const block = position.wins[0];
    if (!position.legal(block, defender)) return true;
    position.makeCell(block, defender);
    const won = attackerMoves(context, attacker, threes, level + 1) >= 0;
    position.unmakeCell(block, defender);
    return won;
  }
  if (position.winCells(defender) > 0) return false;
  // Without a win threat of its own the attacker has given the defender a free move.
  if (vcf(context, attacker, 8, level + 1) < 0) return false;
  const base = level * SLOTS;
  const own = position.fours[attacker];
  let count = collect(position, own.list, own.size, defender, level, 0);
  const theirs = position.fours[defender];
  for (let i = 0; i < theirs.size && count < SLOTS; i++) {
    const cell = theirs.list[i];
    if (position.best[attacker * AREA + cell] >= FOUR || !position.legal(cell, defender)) continue;
    cellBuffer[base + count] = cell;
    valueBuffer[base + count] = moveValue(position, cell, defender);
    count++;
  }
  sortLevel(level, count);
  count = Math.min(count, DEFENCE_BREADTH);
  for (let i = 0; i < count; i++) {
    const cell = cellBuffer[base + i];
    position.makeCell(cell, defender);
    let refuted: boolean;
    const fours = position.winCells(defender);
    if (fours >= 2) refuted = true;
    else if (fours === 1) {
      const block = position.wins[0];
      if (!position.legal(block, attacker)) refuted = true;
      else {
        position.makeCell(block, attacker);
        refuted = !defenderMoves(context, attacker, threes, level + 1);
        position.unmakeCell(block, attacker);
      }
    } else {
      refuted = attackerMoves(context, attacker, threes, level + 1) < 0;
    }
    position.unmakeCell(cell, defender);
    if (refuted) return false;
    if (context.stopped || context.nodes > context.limit) return false;
  }
  return true;
}
