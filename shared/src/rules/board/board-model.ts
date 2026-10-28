// ─── Board model: nodes with coordinates, typed edges and zones, shared by every board game ───

/** Stable node identifier; the standard builders use `col,row`. */
export type NodeId = string;

/**
 * Where pieces sit: inside square cells, on line intersections, on Land Battle Chess stations joined by
 * roads and railways, or in the holes of the Chinese checkers star.
 */
export type BoardLayout = 'cells' | 'points' | 'stations' | 'holes';

/**
 * Rule-relevant connections. `line` joins orthogonal neighbours (roads on station boards), `diagonal` the
 * palace and camp diagonals, `rail` railway segments, and `hex` the six neighbours of a star hole.
 */
export type EdgeKind = 'line' | 'diagonal' | 'rail' | 'hex';

/**
 * Named node groups. `owner` is the side index the area belongs to: `territory` is a side's own half,
 * `home` a Chinese checkers starting triangle.
 */
export type ZoneKind = 'territory' | 'palace' | 'water' | 'trap' | 'den' | 'camp' | 'hq' | 'home';

export interface BoardNode {
  readonly id: NodeId;
  /** Rule coordinates; the star board doubles its columns so that neighbours differ by (±2, 0) or (±1, ±1). */
  readonly col: number;
  readonly row: number;
  /** Drawing position in board units, with side 0 at the bottom; the view scales and turns it. */
  readonly x: number;
  readonly y: number;
}

export interface BoardEdge {
  readonly a: NodeId;
  readonly b: NodeId;
  readonly kind: EdgeKind;
  /** A connection the board does not draw, such as Xiangqi files crossing the river. */
  readonly hidden?: boolean;
}

export interface BoardZone {
  readonly kind: ZoneKind;
  readonly owner?: number;
  readonly nodes: readonly NodeId[];
}

/** Drawn-only features in board units; rules never read them. */
export type BoardDecoration =
  /** Outer border around the playing area (Xiangqi). */
  | { readonly kind: 'frame' }
  /** Star point (Gomoku, Reversi). */
  | { readonly kind: 'star'; readonly x: number; readonly y: number }
  /** Xiangqi soldier and cannon position marks; `left`/`right` say which sides get corners. */
  | { readonly kind: 'marks'; readonly x: number; readonly y: number; readonly left: boolean; readonly right: boolean }
  /** River band between two rows, labelled on each half (Xiangqi). */
  | { readonly kind: 'river'; readonly y: number; readonly x0: number; readonly x1: number }
  /** Impassable block on the Land Battle Chess front line. */
  | { readonly kind: 'mountain'; readonly x: number; readonly y: number };

export interface BoardModel {
  readonly layout: BoardLayout;
  /** Extent of the drawing positions: every node lies within [0, width] × [0, height]. */
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly BoardNode[];
  readonly edges: readonly BoardEdge[];
  readonly zones: readonly BoardZone[];
  readonly decorations: readonly BoardDecoration[];
  /**
   * Clockwise turn in degrees that brings each side's home to the bottom of the screen. Boards both players
   * see the same way (Reversi, Gomoku, Banqi) list 0 for every side.
   */
  readonly sideRotations: readonly number[];
}

export interface BoardPoint {
  readonly x: number;
  readonly y: number;
}

interface BoardIndex {
  readonly byId: ReadonlyMap<NodeId, BoardNode>;
  readonly byCoordinate: ReadonlyMap<string, BoardNode>;
  readonly adjacency: ReadonlyMap<NodeId, readonly BoardEdge[]>;
  readonly zonesByNode: ReadonlyMap<NodeId, readonly BoardZone[]>;
}

// Boards are immutable values built once per game type; the index is derived lazily and never mutates them.
const indexes = new WeakMap<BoardModel, BoardIndex>();

function boardIndex(board: BoardModel): BoardIndex {
  const cached = indexes.get(board);
  if (cached) return cached;
  const byId = new Map(board.nodes.map((node) => [node.id, node]));
  const byCoordinate = new Map(board.nodes.map((node) => [nodeId(node.col, node.row), node]));
  const adjacency = new Map<NodeId, BoardEdge[]>();
  for (const edge of board.edges) {
    for (const end of [edge.a, edge.b]) adjacency.set(end, [...adjacency.get(end) ?? [], edge]);
  }
  const zonesByNode = new Map<NodeId, BoardZone[]>();
  for (const zone of board.zones) {
    for (const id of zone.nodes) zonesByNode.set(id, [...zonesByNode.get(id) ?? [], zone]);
  }
  const index = { byId, byCoordinate, adjacency, zonesByNode };
  indexes.set(board, index);
  return index;
}

/** The standard id of the node at a rule coordinate. */
export function nodeId(col: number, row: number): NodeId {
  return `${col},${row}`;
}

export function nodeById(board: BoardModel, id: NodeId): BoardNode | undefined {
  return boardIndex(board).byId.get(id);
}

export function nodeAt(board: BoardModel, col: number, row: number): BoardNode | undefined {
  return boardIndex(board).byCoordinate.get(nodeId(col, row));
}

/** The node `dCol, dRow` away in rule coordinates, for direction rays such as Reversi flips or Gomoku lines. */
export function offsetNode(board: BoardModel, id: NodeId, dCol: number, dRow: number): NodeId | undefined {
  const node = nodeById(board, id);
  return node && nodeAt(board, node.col + dCol, node.row + dRow)?.id;
}

/** Nodes joined to `id` by an edge of one of `kinds` (all kinds when omitted), each listed once. */
export function neighbours(board: BoardModel, id: NodeId, kinds?: readonly EdgeKind[]): NodeId[] {
  const result: NodeId[] = [];
  for (const edge of boardIndex(board).adjacency.get(id) ?? []) {
    if (kinds && !kinds.includes(edge.kind)) continue;
    const other = edge.a === id ? edge.b : edge.a;
    if (!result.includes(other)) result.push(other);
  }
  return result;
}

export function hasEdge(board: BoardModel, a: NodeId, b: NodeId, kinds?: readonly EdgeKind[]): boolean {
  return neighbours(board, a, kinds).includes(b);
}

export function zonesAt(board: BoardModel, id: NodeId): readonly BoardZone[] {
  return boardIndex(board).zonesByNode.get(id) ?? [];
}

/** Whether the node lies in a zone of `kind`; with `owner`, only that side's zone counts. */
export function inZone(board: BoardModel, id: NodeId, kind: ZoneKind, owner?: number): boolean {
  return zonesAt(board, id).some((zone) => zone.kind === kind && (owner === undefined || zone.owner === owner));
}

/** Every node of the zones of `kind` (and `owner`, when given). */
export function zoneNodes(board: BoardModel, kind: ZoneKind, owner?: number): NodeId[] {
  return board.zones.filter((zone) => zone.kind === kind && (owner === undefined || zone.owner === owner))
    .flatMap((zone) => zone.nodes);
}

/** The turn that puts `side` at the bottom; unknown sides keep the board as drawn. */
export function sideRotation(board: BoardModel, side: number): number {
  return board.sideRotations[side] ?? 0;
}

/**
 * A drawing position after turning the board `degrees` clockwise about its centre. Quarter turns are exact;
 * other angles (the star board's 60° steps) are rounded to remove floating-point noise.
 */
export function rotatePoint(board: BoardModel, point: BoardPoint, degrees: number): BoardPoint {
  const turn = ((degrees % 360) + 360) % 360;
  const cx = board.width / 2;
  const cy = board.height / 2;
  if (turn === 0) return point;
  if (turn === 180) return { x: board.width - point.x, y: board.height - point.y };
  const radians = (turn * Math.PI) / 180;
  const dx = point.x - cx;
  const dy = point.y - cy;
  const round = (value: number): number => Math.round(value * 1e9) / 1e9;
  return {
    x: round(cx + dx * Math.cos(radians) - dy * Math.sin(radians)),
    y: round(cy + dx * Math.sin(radians) + dy * Math.cos(radians)),
  };
}

/**
 * Chess-style label of a node as side 0 sees it: file letter from the leftmost column, rank counted from the
 * bottom row, e.g. `a1`. Games with their own notation (Xiangqi, the star board) format moves themselves.
 */
export function coordinateLabel(board: BoardModel, id: NodeId): string {
  const node = nodeById(board, id);
  if (!node) return id;
  let minCol = Infinity;
  let maxRow = -Infinity;
  for (const other of board.nodes) {
    minCol = Math.min(minCol, other.col);
    maxRow = Math.max(maxRow, other.row);
  }
  return `${String.fromCharCode(97 + node.col - minCol)}${maxRow - node.row + 1}`;
}
