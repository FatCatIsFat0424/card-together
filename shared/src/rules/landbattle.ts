// ─── Land Battle Chess rules: deployment, road and railway moves, battles, and the end of a match ───

import { junqiBoard } from './board/boards';
import { inZone, neighbours, nodeId } from './board/board-model';
import type { NodeId } from './board/board-model';

export const LB_COLS = 5;
export const LB_ROWS = 12;
export const LB_NODES = LB_COLS * LB_ROWS;

/** Index into the match's two seats: side 0 holds rows 6–11 (drawn at the bottom) and moves first. */
export type LbSide = 0 | 1;

/** Piece identities, strongest officer first. */
export const LB_RANKS = [
  'marshal', 'general', 'major-general', 'brigadier', 'colonel', 'major', 'captain', 'lieutenant', 'engineer',
  'mine', 'bomb', 'flag',
] as const;
export type LbRank = typeof LB_RANKS[number];

/** Pieces of each identity per side: 25 in all. */
export const LB_COUNTS: Readonly<Record<LbRank, number>> = {
  marshal: 1, general: 1, 'major-general': 2, brigadier: 2, colonel: 2, major: 2, captain: 3, lieutenant: 3,
  engineer: 3, mine: 3, bomb: 2, flag: 1,
};

export const LB_PIECES_PER_SIDE = 25;

/** Officer strength; mines, bombs and the flag follow their own battle rules. */
export const LB_POWER: Readonly<Record<LbRank, number>> = {
  marshal: 9, general: 8, 'major-general': 7, brigadier: 6, colonel: 5, major: 4, captain: 3, lieutenant: 2,
  engineer: 1, mine: 0, bomb: 0, flag: 0,
};

/** Consecutive moves without any battle after which the match is drawn. */
export const LB_QUIET_LIMIT = 60;

/** Shortest deployment window; longer room timers give longer windows (base plus reserve). */
export const LB_MIN_DEPLOY_SECONDS = 60;

export function lbDeploySeconds(baseSeconds: number, bankSeconds: number): number {
  return Math.max(LB_MIN_DEPLOY_SECONDS, baseSeconds + bankSeconds);
}

export const lbOpponent = (side: LbSide): LbSide => (side === 0 ? 1 : 0);

export const lbIndex = (col: number, row: number): number => row * LB_COLS + col;

/** Board node of a station index, matching `junqiBoard()` ids. */
export const lbNode = (index: number): NodeId => nodeId(index % LB_COLS, Math.floor(index / LB_COLS));

/** Station index of a board node id, or null when it is not a Land Battle Chess station. */
export function lbCell(node: unknown): number | null {
  if (typeof node !== 'string') return null;
  const match = /^([0-4]),(1[01]|[0-9])$/.exec(node);
  return match ? lbIndex(Number(match[1]), Number(match[2])) : null;
}

export function isLbRank(value: unknown): value is LbRank {
  return (LB_RANKS as readonly unknown[]).includes(value);
}

export const lbMobile = (rank: LbRank): boolean => rank !== 'mine' && rank !== 'flag';

// ─── Board topology, derived once from the shared board model ───

const BOARD = junqiBoard();
const indexOf = (id: NodeId): number => lbCell(id) ?? -1;

/** One-step neighbours along roads, camp diagonals and railways. */
const STEPS: readonly (readonly number[])[] = Array.from({ length: LB_NODES }, (_, index) =>
  neighbours(BOARD, lbNode(index)).map(indexOf));
/** Railway neighbours. */
const RAILS: readonly (readonly number[])[] = Array.from({ length: LB_NODES }, (_, index) =>
  neighbours(BOARD, lbNode(index), ['rail']).map(indexOf));
const CAMPS: readonly boolean[] = Array.from({ length: LB_NODES }, (_, index) => inZone(BOARD, lbNode(index), 'camp'));
const HQS: readonly boolean[] = Array.from({ length: LB_NODES }, (_, index) => inZone(BOARD, lbNode(index), 'hq'));

export const lbIsCamp = (index: number): boolean => CAMPS[index] ?? false;
export const lbIsHq = (index: number): boolean => HQS[index] ?? false;
export const lbIsRail = (index: number): boolean => (RAILS[index]?.length ?? 0) > 0;
export const lbSteps = (index: number): readonly number[] => STEPS[index] ?? [];

// ─── Deployment ───

/**
 * Deployment slots as the deploying side sees its own half: rows from the front line (0) back to the
 * headquarters row (5), columns left to right. Camps start empty, so the 25 other stations take one piece
 * each. Camps and headquarters sit symmetrically, so both sides share the same slot rules.
 */
export const LB_SLOT_POSITIONS: readonly (readonly [col: number, row: number])[] = (() => {
  const slots: [number, number][] = [];
  // Side 0's own row `row` is board row 6 + row; its camps decide which slots exist.
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < LB_COLS; col++) if (!CAMPS[lbIndex(col, 6 + row)]) slots.push([col, row]);
  }
  return slots;
})();

/** Board index of a deployment slot for `side`; side 1 sees its half turned half way round. */
export function lbSlotIndex(side: LbSide, slot: number): number {
  const [col, row] = LB_SLOT_POSITIONS[slot];
  return side === 0 ? lbIndex(col, 6 + row) : lbIndex(LB_COLS - 1 - col, 5 - row);
}

/** Board indices of a side's 25 deployment slots, in slot order. */
export function lbDeploySlots(side: LbSide): number[] {
  return LB_SLOT_POSITIONS.map((_, slot) => lbSlotIndex(side, slot));
}

/** Slot number of a board index in `side`'s deployment, or -1. */
export function lbSlotOf(side: LbSide, index: number): number {
  return lbDeploySlots(side).indexOf(index);
}

/** Why `rank` may not stand in `slot`, or null when it may. */
export function lbSlotProblem(rank: LbRank, slot: number): 'flag' | 'mine' | 'bomb' | null {
  const [col, row] = LB_SLOT_POSITIONS[slot];
  if (rank === 'flag' && !(row === 5 && (col === 1 || col === 3))) return 'flag';
  if (rank === 'mine' && row < 4) return 'mine';
  if (rank === 'bomb' && row === 0) return 'bomb';
  return null;
}

/** A layout lists one rank per slot; null when it is complete and every placement is allowed. */
export function lbLayoutError(layout: unknown): string | null {
  if (!Array.isArray(layout) || layout.length !== LB_PIECES_PER_SIDE || !layout.every(isLbRank)) {
    return 'A deployment places all 25 pieces.';
  }
  const counts = new Map<LbRank, number>();
  for (const rank of layout) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  if (LB_RANKS.some((rank) => (counts.get(rank) ?? 0) !== LB_COUNTS[rank])) return 'A deployment places all 25 pieces.';
  if (layout.some((rank, slot) => lbSlotProblem(rank, slot) !== null)) {
    return 'The flag goes in a headquarters, mines in the last two rows, and bombs off the front row.';
  }
  return null;
}

/** The layout with two slots exchanged, or null when the exchange breaks a placement rule. */
export function lbSwapSlots(layout: readonly LbRank[], a: number, b: number): LbRank[] | null {
  if (a === b || a < 0 || b < 0 || a >= layout.length || b >= layout.length) return null;
  if (lbSlotProblem(layout[a], b) || lbSlotProblem(layout[b], a)) return null;
  const next = [...layout];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}

/** Mirrors a layout left to right; camps and headquarters are symmetric, so it stays valid. */
export function lbMirrorLayout(layout: readonly LbRank[]): LbRank[] {
  return LB_SLOT_POSITIONS.map(([col, row]) => {
    const slot = LB_SLOT_POSITIONS.findIndex(([c, r]) => r === row && c === LB_COLS - 1 - col);
    return layout[slot];
  });
}

const CODES: Readonly<Record<string, LbRank>> = {
  M: 'marshal', G: 'general', D: 'major-general', B: 'brigadier', C: 'colonel', J: 'major', P: 'captain',
  L: 'lieutenant', E: 'engineer', X: 'mine', Z: 'bomb', F: 'flag',
};
const preset = (rows: string): LbRank[] => rows.replace(/\s/g, '').split('').map((code) => CODES[code]);

/**
 * Preset formations, front row first (5, 3, 4, 3, 5, 5 slots per row). Codes: M marshal, G general,
 * D major-general, B brigadier, C colonel, J major, P captain, L lieutenant, E engineer, X mine, Z bomb, F flag.
 */
export const LB_PRESETS: readonly (readonly LbRank[])[] = [
  // Balanced: mixed front, bombs in reserve. Every preset rings its flag with the three mines.
  preset('DPBLC EZP MJBG LZC EXDJP XFXLE'),
  // Assault: the strongest officers lead.
  preset('GBMCD PZL EDBJ CZP LEJXP ELXFX'),
  // Fortress: weak pieces probe, officers and bombs hold the middle.
  preset('PLCLP EBE DMGD ZJZ BXCJE XFXLP'),
  // Right flank: strength on the right with the flag behind it.
  preset('BPDGL PZM LCED JZC EBJXP LEXFX'),
];

/**
 * A random legal layout: the flag in a headquarters, mines mostly beside it, bombs behind the front, and
 * the other pieces shuffled into the remaining slots.
 */
export function lbRandomLayout(random: () => number): LbRank[] {
  const pick = <T>(items: readonly T[]): T => items[Math.min(items.length - 1, Math.floor(random() * items.length))];
  const layout: (LbRank | null)[] = new Array<LbRank | null>(LB_PIECES_PER_SIDE).fill(null);
  const free = (filter: (slot: number) => boolean): number[] => layout.flatMap((rank, slot) => (rank === null && filter(slot) ? [slot] : []));
  const rowOf = (slot: number): number => LB_SLOT_POSITIONS[slot][1];
  const flag = pick(free((slot) => lbSlotProblem('flag', slot) === null));
  layout[flag] = 'flag';
  const [flagCol] = LB_SLOT_POSITIONS[flag];
  // The stations a flag in a headquarters touches: both sides along the back row and the one in front.
  const guards = (slot: number): boolean => {
    const [col, row] = LB_SLOT_POSITIONS[slot];
    return (row === 5 && Math.abs(col - flagCol) === 1) || (row === 4 && col === flagCol);
  };
  for (let count = 0; count < LB_COUNTS.mine; count++) {
    const back = free((slot) => rowOf(slot) >= 4);
    const near = back.filter(guards);
    layout[pick(near.length > 0 && random() < 0.8 ? near : back)] = 'mine';
  }
  for (let count = 0; count < LB_COUNTS.bomb; count++) layout[pick(free((slot) => rowOf(slot) >= 1 && rowOf(slot) <= 3))] = 'bomb';
  const rest = LB_RANKS.filter((rank) => rank !== 'flag' && rank !== 'mine' && rank !== 'bomb')
    .flatMap((rank) => new Array<LbRank>(LB_COUNTS[rank]).fill(rank));
  for (const slot of free(() => true)) {
    const index = Math.floor(random() * rest.length);
    layout[slot] = rest.splice(Math.min(rest.length - 1, index), 1)[0];
  }
  return layout as LbRank[];
}

// ─── Pieces, moves and battles ───

/** A piece as the rules see it; an unknown opponent identity is simply absent. */
export interface LbCell {
  readonly side: LbSide;
  readonly rank?: LbRank;
}

/** Stations by index (`row * 5 + col`); null is empty. */
export type LbBoard<C extends LbCell = LbCell> = readonly (C | null)[];

/** A piece with a known identity and the station it was deployed on, which never changes. */
export interface LbPiece extends LbCell {
  readonly rank: LbRank;
  readonly origin: number;
}

/** Places both sides' layouts on an empty board. */
export function lbBoardFromLayouts(layouts: readonly [readonly LbRank[], readonly LbRank[]]): (LbPiece | null)[] {
  const board: (LbPiece | null)[] = new Array<LbPiece | null>(LB_NODES).fill(null);
  for (const side of [0, 1] as const) {
    layouts[side].forEach((rank, slot) => {
      const origin = lbSlotIndex(side, slot);
      board[origin] = { side, rank, origin };
    });
  }
  return board;
}

export interface LbMove {
  readonly from: number;
  readonly to: number;
  /** Railway stations passed through, excluding `from` and `to`; empty for a single step. */
  readonly path: readonly number[];
}

/** Public outcome of a move for the attacker: no battle, won, lost, or both removed. */
export type LbOutcome = 'move' | 'win' | 'lose' | 'tie';

/** The piece at `from` may move: an own mobile piece outside both headquarters. */
function movable(cell: LbCell | null, from: number): cell is LbCell {
  return cell !== null && !HQS[from] && (cell.rank === undefined || lbMobile(cell.rank));
}

/** Whether a piece of `side` may end its move on `to`: empty, or an opponent outside a camp. */
function enterable(board: LbBoard, to: number, side: LbSide): boolean {
  const target = board[to];
  return target === null || (target.side !== side && !CAMPS[to]);
}

/**
 * Legal destinations of the piece at `from`, each with the railway stations it passes. One step along any
 * road, diagonal or railway; any distance along a straight railway; engineers also turn along railways.
 * Moves stop before own pieces and on the first opponent; camp occupants cannot be attacked.
 */
export function lbDestinations(board: LbBoard, from: number): LbMove[] {
  const piece = board[from] ?? null;
  if (!movable(piece, from)) return [];
  const side = piece.side;
  const found = new Map<number, LbMove>();
  const add = (to: number, path: readonly number[]): void => {
    if (!found.has(to)) found.set(to, { from, to, path });
  };
  for (const to of STEPS[from]) if (enterable(board, to, side)) add(to, []);
  if (RAILS[from].length === 0) return [...found.values()];

  if (piece.rank === 'engineer') {
    // Breadth-first along railways, so each destination keeps its shortest route.
    const previous = new Map<number, number>([[from, -1]]);
    const queue = [from];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of RAILS[current]) {
        if (previous.has(next)) continue;
        previous.set(next, current);
        const path: number[] = [];
        for (let step = current; step !== from; step = previous.get(step)!) path.unshift(step);
        const occupant = board[next];
        if (occupant === null) {
          add(next, path);
          queue.push(next);
        } else if (occupant.side !== side) add(next, path);
      }
    }
    return [...found.values()];
  }

  const fromCol = from % LB_COLS;
  const fromRow = Math.floor(from / LB_COLS);
  for (const first of RAILS[from]) {
    const dc = (first % LB_COLS) - fromCol;
    const dr = Math.floor(first / LB_COLS) - fromRow;
    const path: number[] = [];
    let current = first;
    for (;;) {
      const occupant = board[current];
      if (occupant !== null) {
        if (occupant.side !== side) add(current, [...path]);
        break;
      }
      add(current, [...path]);
      path.push(current);
      const col = (current % LB_COLS) + dc;
      const row = Math.floor(current / LB_COLS) + dr;
      const next = col >= 0 && col < LB_COLS && row >= 0 && row < LB_ROWS ? lbIndex(col, row) : -1;
      if (next < 0 || !RAILS[current].includes(next)) break;
      current = next;
    }
  }
  return [...found.values()];
}

/** Every legal move of `side`, ordered by origin then destination discovery. */
export function lbLegalMoves(board: LbBoard, side: LbSide): LbMove[] {
  const moves: LbMove[] = [];
  for (let from = 0; from < LB_NODES; from++) {
    if (board[from]?.side === side) moves.push(...lbDestinations(board, from));
  }
  return moves;
}

export function lbHasMove(board: LbBoard, side: LbSide): boolean {
  for (let from = 0; from < LB_NODES; from++) {
    const cell = board[from];
    if (cell?.side !== side || !movable(cell, from)) continue;
    if (STEPS[from].some((to) => enterable(board, to, side))) return true;
  }
  return false;
}

/** The attacker's outcome: the flag falls to anything; bombs remove both; only engineers clear mines. */
export function lbBattle(attacker: LbRank, defender: LbRank): Exclude<LbOutcome, 'move'> {
  if (defender === 'flag') return 'win';
  if (attacker === 'bomb' || defender === 'bomb') return 'tie';
  if (defender === 'mine') return attacker === 'engineer' ? 'win' : 'lose';
  const difference = LB_POWER[attacker] - LB_POWER[defender];
  return difference > 0 ? 'win' : difference < 0 ? 'lose' : 'tie';
}

export interface LbApplied<C extends LbCell> {
  readonly board: (C | null)[];
  readonly outcome: LbOutcome;
  /** Railway stations passed through, excluding both ends. */
  readonly path: readonly number[];
  /** Pieces the move removed, attacker first. */
  readonly removed: readonly C[];
  readonly flagCaptured: boolean;
}

/**
 * The board after a legal move with fully known ranks at both ends. Returns null when the move is not
 * legal for the piece at `from`.
 */
export function lbApplyMove<C extends LbCell>(board: LbBoard<C>, from: number, to: number): LbApplied<C> | null {
  const attacker = board[from] ?? null;
  const path = attacker && lbDestinations(board, from).find((move) => move.to === to)?.path;
  if (!attacker || !path) return null;
  const next = [...board];
  const defender = board[to];
  next[from] = null;
  if (defender === null) {
    next[to] = attacker;
    return { board: next, outcome: 'move', path, removed: [], flagCaptured: false };
  }
  if (attacker.rank === undefined || defender.rank === undefined) throw new Error('Battles need both ranks.');
  const outcome = lbBattle(attacker.rank, defender.rank);
  if (outcome === 'win') next[to] = attacker;
  else if (outcome === 'tie') next[to] = null;
  const removed = outcome === 'win' ? [defender] : outcome === 'lose' ? [attacker] : [attacker, defender];
  return { board: next, outcome, path, removed, flagCaptured: defender.rank === 'flag' };
}

/** Officers ranked for display, strongest first, then the special pieces. */
export function lbRankOrder(rank: LbRank): number {
  return LB_RANKS.indexOf(rank);
}
