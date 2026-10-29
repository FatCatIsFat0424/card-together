// ─── Pure geometry of the board view: perspective, view box, and marker shapes ───

import { nodeById, rotatePoint } from '@shared/rules/board/board-model';
import type { BoardLayout, BoardModel, BoardPoint, NodeId } from '@shared/rules/board/board-model';

/**
 * Distance in board units from the line through the star's outermost holes to its outer edge: the wood rim and,
 * on the viewer's turn, the glow round it (`StarBoard.tsx`).
 */
export const STAR_RIM = 1.1;

/** Space around the outermost nodes, in board units, so cells, tiles and pieces are not clipped. */
const PADDING: Record<BoardLayout, { readonly x: number; readonly y: number }> = {
  cells: { x: 0.65, y: 0.65 },
  points: { x: 0.55, y: 0.55 },
  stations: { x: 1.02, y: 0.56 },
  holes: { x: STAR_RIM, y: STAR_RIM },
};
/** Extra room on the bottom and left edges for coordinate labels. */
const LABEL_ROOM = 0.42;

export interface BoardGeometry {
  /** SVG view box: x, y, width, height in board units. */
  readonly viewBox: readonly [number, number, number, number];
  /** Drawing position of a node for this viewer, or undefined for an unknown id. */
  readonly point: (id: NodeId) => BoardPoint | undefined;
  /** Any board-space position turned for this viewer. */
  readonly turn: (point: BoardPoint) => BoardPoint;
  /** Outer node bounds after turning, before padding. */
  readonly bounds: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };
}

/**
 * Turns the board so the viewer's side is at the bottom. Only positions move: pieces and text are drawn upright
 * at the turned positions, so labels never rotate.
 */
export function boardGeometry(board: BoardModel, rotation: number, labels = false): BoardGeometry {
  const turn = (point: BoardPoint): BoardPoint => rotatePoint(board, point, rotation);
  const turned = new Map(board.nodes.map((node) => [node.id, turn(node)]));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of turned.values()) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const padding = PADDING[board.layout];
  const left = padding.x + (labels ? LABEL_ROOM : 0);
  const bottom = padding.y + (labels ? LABEL_ROOM : 0);
  return {
    viewBox: [minX - left, minY - padding.y, maxX - minX + left + padding.x, maxY - minY + padding.y + bottom],
    point: (id) => turned.get(id),
    turn,
    bounds: { minX, minY, maxX, maxY },
  };
}

/** Width over height of the drawn board, for laying it out before it renders. */
export function boardAspect(board: BoardModel, rotation = 0, labels = false): number {
  const [, , width, height] = boardGeometry(board, rotation, labels).viewBox;
  return width / height;
}

/** Highlight box around a node: the cell, intersection, or station tile. */
export function markerBox(layout: BoardLayout): { readonly width: number; readonly height: number } {
  if (layout === 'stations') return { width: 1.9, height: 0.92 };
  return { width: 0.94, height: 0.94 };
}

/**
 * Tap box of a node. Intersections tile the board exactly (the view draws them with square corners), so every
 * tap lands on the nearest one; cells and stations keep a small gap that matches their drawn edges.
 */
export function hitBox(layout: BoardLayout): { readonly width: number; readonly height: number } {
  return layout === 'points' ? { width: 1, height: 1 } : markerBox(layout);
}

/** Columns and rows of the nodes, for coordinate labels drawn along the bottom and left edges. */
export function axisPositions(board: BoardModel, geometry: BoardGeometry): {
  readonly files: readonly { readonly index: number; readonly x: number }[];
  readonly ranks: readonly { readonly index: number; readonly y: number }[];
} {
  let minCol = Infinity;
  let minRow = Infinity;
  for (const node of board.nodes) {
    minCol = Math.min(minCol, node.col);
    minRow = Math.min(minRow, node.row);
  }
  const files = new Map<number, number>();
  const ranks = new Map<number, number>();
  for (const node of board.nodes) {
    const point = geometry.point(node.id);
    if (!point) continue;
    files.set(node.col - minCol, point.x);
    ranks.set(node.row - minRow, point.y);
  }
  return {
    files: [...files].map(([index, x]) => ({ index, x })),
    ranks: [...ranks].map(([index, y]) => ({ index, y })),
  };
}

/** The nodes a move passes through, in order, for drawing its path. */
export function movePath(board: BoardModel, move: { readonly from?: NodeId; readonly to?: NodeId; readonly path?: readonly NodeId[] }): NodeId[] {
  return [move.from, ...move.path ?? [], move.to].filter((id): id is NodeId => id !== undefined && nodeById(board, id) !== undefined);
}
