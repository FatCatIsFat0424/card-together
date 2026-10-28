// ─── Standard boards: one builder per board shape the board games use ───

import { nodeId } from './board-model';
import type { BoardDecoration, BoardEdge, BoardLayout, BoardModel, BoardNode, BoardZone, NodeId } from './board-model';

/** Two sides facing each other: side 0 at the bottom, side 1 turned half way round. */
const FACING_SIDES: readonly number[] = [0, 180];
/** Both players see the board the same way. */
const FIXED_SIDES: readonly number[] = [0, 0];

function rectNodes(cols: number, rows: number, position: (col: number, row: number) => { x: number; y: number }): BoardNode[] {
  const nodes: BoardNode[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) nodes.push({ id: nodeId(col, row), col, row, ...position(col, row) });
  }
  return nodes;
}

function orthogonalEdges(
  cols: number, rows: number, hidden: (a: [number, number], b: [number, number]) => boolean = () => false,
  skip: (a: [number, number], b: [number, number]) => boolean = () => false,
): BoardEdge[] {
  const edges: BoardEdge[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      for (const [c, r] of [[col + 1, row], [col, row + 1]] as const) {
        if (c >= cols || r >= rows || skip([col, row], [c, r])) continue;
        edges.push({ a: nodeId(col, row), b: nodeId(c, r), kind: 'line',
          ...hidden([col, row], [c, r]) ? { hidden: true } : {} });
      }
    }
  }
  return edges;
}

function rectZone(kind: BoardZone['kind'], owner: number | undefined, cols: readonly number[], rows: readonly number[]): BoardZone {
  return { kind, ...owner === undefined ? {} : { owner }, nodes: rows.flatMap((row) => cols.map((col) => nodeId(col, row))) };
}

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, index) => from + index);

export interface SquareBoardSpec {
  readonly cols: number;
  readonly rows: number;
  /** `cells` puts pieces inside squares, `points` on line intersections. */
  readonly layout: Extract<BoardLayout, 'cells' | 'points'>;
  readonly sideRotations?: readonly number[];
  readonly zones?: readonly BoardZone[];
  readonly decorations?: readonly BoardDecoration[];
}

/** A plain rectangular grid with orthogonal `line` edges. */
export function squareBoard(spec: SquareBoardSpec): BoardModel {
  const cells = spec.layout === 'cells';
  const offset = cells ? 0.5 : 0;
  return {
    layout: spec.layout,
    width: cells ? spec.cols : spec.cols - 1,
    height: cells ? spec.rows : spec.rows - 1,
    nodes: rectNodes(spec.cols, spec.rows, (col, row) => ({ x: col + offset, y: row + offset })),
    edges: orthogonalEdges(spec.cols, spec.rows),
    zones: spec.zones ?? [],
    decorations: spec.decorations ?? [],
    sideRotations: spec.sideRotations ?? FACING_SIDES,
  };
}

/** Reversi: 8 × 8 cells, never turned. */
export function reversiBoard(): BoardModel {
  return squareBoard({
    cols: 8, rows: 8, layout: 'cells', sideRotations: FIXED_SIDES,
    decorations: [[2, 2], [6, 2], [2, 6], [6, 6]].map(([x, y]) => ({ kind: 'star', x, y })),
  });
}

/** Gomoku: `size` × `size` intersections (15 by default) with the five star points, never turned. */
export function gomokuBoard(size = 15): BoardModel {
  const edge = Math.min(3, Math.floor((size - 1) / 4));
  const far = size - 1 - edge;
  const centre = (size - 1) / 2;
  const stars = [[edge, edge], [far, edge], [edge, far], [far, far], [centre, centre]]
    .filter(([x, y]) => Number.isInteger(x) && Number.isInteger(y));
  return squareBoard({
    cols: size, rows: size, layout: 'points', sideRotations: FIXED_SIDES,
    decorations: stars.map(([x, y]) => ({ kind: 'star', x, y })),
  });
}

/** Banqi: the 8 × 4 half board, pieces in cells; colours are decided in play, so the board never turns. */
export function banqiBoard(): BoardModel {
  return squareBoard({ cols: 8, rows: 4, layout: 'cells', sideRotations: FIXED_SIDES });
}

/**
 * Xiangqi: 9 × 10 intersections. Side 0 (red, moving first) holds rows 5–9; the river lies between rows 4
 * and 5, and the inner files are not drawn across it although pieces still cross there.
 */
export function xiangqiBoard(): BoardModel {
  const palaceDiagonals = (top: number): BoardEdge[] => [
    [[3, top], [4, top + 1]], [[4, top + 1], [5, top + 2]], [[5, top], [4, top + 1]], [[4, top + 1], [3, top + 2]],
  ].map(([a, b]) => ({ a: nodeId(a[0], a[1]), b: nodeId(b[0], b[1]), kind: 'diagonal' }));
  const marks: BoardDecoration[] = [
    ...[[1, 2], [7, 2], [1, 7], [7, 7]],
    ...[0, 2, 4, 6, 8].flatMap((col) => [[col, 3], [col, 6]]),
  ].map(([x, y]) => ({ kind: 'marks', x, y, left: x > 0, right: x < 8 }));
  return {
    layout: 'points',
    width: 8,
    height: 9,
    nodes: rectNodes(9, 10, (col, row) => ({ x: col, y: row })),
    edges: [
      ...orthogonalEdges(9, 10, ([col, row], [, next]) => row === 4 && next === 5 && col > 0 && col < 8),
      ...palaceDiagonals(0), ...palaceDiagonals(7),
    ],
    zones: [
      rectZone('territory', 0, range(0, 8), range(5, 9)), rectZone('territory', 1, range(0, 8), range(0, 4)),
      rectZone('palace', 0, [3, 4, 5], [7, 8, 9]), rectZone('palace', 1, [3, 4, 5], [0, 1, 2]),
    ],
    decorations: [{ kind: 'frame' }, { kind: 'river', y: 4.5, x0: 0, x1: 8 }, ...marks],
    sideRotations: FACING_SIDES,
  };
}

/** Jungle: 7 × 9 cells with two rivers, three traps and a den per side; side 0 starts on rows 6–8. */
export function jungleBoard(): BoardModel {
  return squareBoard({
    cols: 7, rows: 9, layout: 'cells',
    zones: [
      rectZone('territory', 0, range(0, 6), range(5, 8)), rectZone('territory', 1, range(0, 6), range(0, 3)),
      rectZone('water', undefined, [1, 2], [3, 4, 5]), rectZone('water', undefined, [4, 5], [3, 4, 5]),
      { kind: 'trap', owner: 0, nodes: [nodeId(2, 8), nodeId(4, 8), nodeId(3, 7)] },
      { kind: 'trap', owner: 1, nodes: [nodeId(2, 0), nodeId(4, 0), nodeId(3, 1)] },
      { kind: 'den', owner: 0, nodes: [nodeId(3, 8)] },
      { kind: 'den', owner: 1, nodes: [nodeId(3, 0)] },
    ],
  });
}

const JUNQI_COLUMN_UNITS = 2.3;
const JUNQI_FRONT_GAP = 0.85;
/** Camps (行營) of side 1; side 0 mirrors them. */
const JUNQI_CAMPS: readonly (readonly [number, number])[] = [[1, 2], [3, 2], [2, 3], [1, 4], [3, 4]];

/**
 * Land Battle Chess: 5 × 12 stations. Side 0 holds rows 6–11. Roads (`line`, plus `diagonal` into and out of
 * camps) join neighbours; railways (`rail`) run along rows 1, 5, 6, 10 and the outer files, and cross the
 * front only on files 0, 2 and 4 — mountains block files 1 and 3.
 */
export function junqiBoard(): BoardModel {
  const camps = [...JUNQI_CAMPS, ...JUNQI_CAMPS.map(([col, row]) => [col, 11 - row] as const)];
  const front = (a: [number, number], b: [number, number]): boolean => a[1] === 5 && b[1] === 6 && (a[0] === 1 || a[0] === 3);
  const diagonals: BoardEdge[] = [];
  for (const [col, row] of camps) {
    for (const [dc, dr] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const c = col + dc;
      const r = row + dr;
      // Diagonals never cross the front line.
      if (c < 0 || c > 4 || r < 0 || r > 11 || (row <= 5) !== (r <= 5)) continue;
      const a = nodeId(col, row);
      const b = nodeId(c, r);
      if (!diagonals.some((edge) => (edge.a === b && edge.b === a))) diagonals.push({ a, b, kind: 'diagonal' });
    }
  }
  const rails: BoardEdge[] = [];
  const rail = (a: [number, number], b: [number, number]): void => {
    rails.push({ a: nodeId(a[0], a[1]), b: nodeId(b[0], b[1]), kind: 'rail' });
  };
  for (const row of [1, 5, 6, 10]) for (let col = 0; col < 4; col++) rail([col, row], [col + 1, row]);
  for (const col of [0, 4]) for (let row = 1; row < 10; row++) rail([col, row], [col, row + 1]);
  rail([2, 5], [2, 6]);
  const camp = (owner: number): BoardZone => ({ kind: 'camp', owner,
    nodes: JUNQI_CAMPS.map(([col, row]) => nodeId(col, owner === 0 ? 11 - row : row)) });
  const frontY = 5 + JUNQI_FRONT_GAP / 2 + 0.5;
  return {
    layout: 'stations',
    width: 4 * JUNQI_COLUMN_UNITS,
    height: 11 + JUNQI_FRONT_GAP,
    nodes: rectNodes(5, 12, (col, row) => ({ x: col * JUNQI_COLUMN_UNITS, y: row + (row >= 6 ? JUNQI_FRONT_GAP : 0) })),
    edges: [...orthogonalEdges(5, 12, undefined, front), ...diagonals, ...rails],
    zones: [
      rectZone('territory', 0, range(0, 4), range(6, 11)), rectZone('territory', 1, range(0, 4), range(0, 5)),
      camp(0), camp(1),
      { kind: 'hq', owner: 0, nodes: [nodeId(1, 11), nodeId(3, 11)] },
      { kind: 'hq', owner: 1, nodes: [nodeId(1, 0), nodeId(3, 0)] },
    ],
    decorations: [1, 3].map((col) => ({ kind: 'mountain', x: col * JUNQI_COLUMN_UNITS, y: frontY })),
    sideRotations: FACING_SIDES,
  };
}

/** Holes per row of the star, top to bottom. */
const STAR_ROWS: readonly number[] = [1, 2, 3, 4, 13, 12, 11, 10, 9, 10, 11, 12, 13, 4, 3, 2, 1];
const ROW_HEIGHT = Math.sqrt(3) / 2;
/** Home triangles in clockwise order from the bottom; each points at the triangle three steps away. */
export const STAR_CORNERS = ['bottom', 'lowerLeft', 'upperLeft', 'top', 'upperRight', 'lowerRight'] as const;
export type StarCorner = typeof STAR_CORNERS[number];

function starCorner(col: number, row: number): number | null {
  if (row <= 3) return STAR_CORNERS.indexOf('top');
  if (row >= 13) return STAR_CORNERS.indexOf('bottom');
  const halfWidth = 8 - Math.abs(row - 8);
  if (col < -halfWidth) return STAR_CORNERS.indexOf(row < 8 ? 'upperLeft' : 'lowerLeft');
  if (col > halfWidth) return STAR_CORNERS.indexOf(row < 8 ? 'upperRight' : 'lowerRight');
  return null;
}

/**
 * Chinese checkers: the 121-hole star. Columns are doubled (−12…12) so the six neighbours of a hole are
 * (±2, 0) and (±1, ±1); a jump continues in the same direction. `home` zone `k` is corner `STAR_CORNERS[k]`,
 * and side `k` turns its corner to the bottom.
 */
export function starBoard(): BoardModel {
  const nodes: BoardNode[] = [];
  STAR_ROWS.forEach((count, row) => {
    for (let index = 0; index < count; index++) {
      const col = 2 * index - (count - 1);
      nodes.push({ id: nodeId(col, row), col, row, x: (col + 12) / 2, y: row * ROW_HEIGHT });
    }
  });
  const ids = new Set(nodes.map((node) => node.id));
  const edges: BoardEdge[] = [];
  for (const node of nodes) {
    for (const [dc, dr] of [[2, 0], [1, 1], [-1, 1]]) {
      const other = nodeId(node.col + dc, node.row + dr);
      if (ids.has(other)) edges.push({ a: node.id, b: other, kind: 'hex' });
    }
  }
  const homes = STAR_CORNERS.map((): NodeId[] => []);
  for (const node of nodes) {
    const corner = starCorner(node.col, node.row);
    if (corner !== null) homes[corner].push(node.id);
  }
  return {
    layout: 'holes',
    width: 12,
    height: 16 * ROW_HEIGHT,
    nodes,
    edges,
    zones: homes.map((home, owner) => ({ kind: 'home', owner, nodes: home })),
    decorations: [],
    sideRotations: STAR_CORNERS.map((_, side) => (360 - side * 60) % 360),
  };
}
