import { describe, expect, it } from 'vitest';
import {
  coordinateLabel, hasEdge, inZone, neighbours, nodeAt, nodeById, nodeId, offsetNode, rotatePoint, sideRotation,
  zoneNodes,
} from '@shared/rules/board/board-model';
import type { BoardModel } from '@shared/rules/board/board-model';
import {
  STAR_CORNERS, banqiBoard, gomokuBoard, jungleBoard, junqiBoard, reversiBoard, starBoard, xiangqiBoard,
} from '@shared/rules/board/boards';
import { BOARD_TIME_CONTROL, DEFAULT_TIME_CONTROL, followDefaultTimeControl } from '@shared/time-control';

function expectConsistent(board: BoardModel): void {
  const ids = new Set(board.nodes.map((node) => node.id));
  expect(ids.size).toBe(board.nodes.length);
  for (const node of board.nodes) {
    expect(node.x).toBeGreaterThanOrEqual(0);
    expect(node.x).toBeLessThanOrEqual(board.width + 1e-9);
    expect(node.y).toBeGreaterThanOrEqual(0);
    expect(node.y).toBeLessThanOrEqual(board.height + 1e-9);
  }
  for (const edge of board.edges) {
    expect(ids.has(edge.a) && ids.has(edge.b)).toBe(true);
    expect(edge.a).not.toBe(edge.b);
  }
  for (const zone of board.zones) for (const id of zone.nodes) expect(ids.has(id)).toBe(true);
}

describe('board model', () => {
  it('should build every standard board with consistent nodes, edges and zones', () => {
    const boards = [reversiBoard(), gomokuBoard(), banqiBoard(), xiangqiBoard(), jungleBoard(), junqiBoard(), starBoard()];
    expect(boards.map((board) => board.nodes.length)).toEqual([64, 225, 32, 90, 63, 60, 121]);
    boards.forEach(expectConsistent);
  });

  it('should look up nodes by id, coordinate and offset', () => {
    const board = gomokuBoard();
    expect(nodeById(board, '7,7')).toMatchObject({ col: 7, row: 7, x: 7, y: 7 });
    expect(nodeAt(board, 14, 0)?.id).toBe('14,0');
    expect(nodeAt(board, 15, 0)).toBeUndefined();
    expect(offsetNode(board, '7,7', 1, -1)).toBe('8,6');
    expect(offsetNode(board, '14,7', 1, 0)).toBeUndefined();
    expect(board.decorations.filter((item) => item.kind === 'star')).toHaveLength(5);
  });

  it('should centre cell boards inside their squares', () => {
    const board = reversiBoard();
    expect([board.width, board.height]).toEqual([8, 8]);
    expect(nodeById(board, '0,0')).toMatchObject({ x: 0.5, y: 0.5 });
    expect(neighbours(board, '0,0').sort()).toEqual(['0,1', '1,0']);
  });

  it('should join Xiangqi palace diagonals and keep files connected across the undrawn river', () => {
    const board = xiangqiBoard();
    expect(neighbours(board, '4,1', ['diagonal']).sort()).toEqual(['3,0', '3,2', '5,0', '5,2']);
    expect(neighbours(board, '3,1', ['diagonal'])).toEqual([]);
    expect(hasEdge(board, '2,4', '2,5')).toBe(true);
    const river = board.edges.filter((edge) => edge.hidden);
    expect(river.map((edge) => edge.a).sort()).toEqual(['1,4', '2,4', '3,4', '4,4', '5,4', '6,4', '7,4']);
    expect(inZone(board, '4,8', 'palace', 0)).toBe(true);
    expect(inZone(board, '4,8', 'palace', 1)).toBe(false);
    expect(inZone(board, '0,5', 'territory', 0)).toBe(true);
    expect(inZone(board, '0,4', 'territory', 0)).toBe(false);
  });

  it('should mark Jungle water, traps and dens per side', () => {
    const board = jungleBoard();
    expect(zoneNodes(board, 'water')).toHaveLength(12);
    expect(inZone(board, '1,3', 'water')).toBe(true);
    expect(inZone(board, '3,4', 'water')).toBe(false);
    expect(zoneNodes(board, 'den', 0)).toEqual(['3,8']);
    expect(zoneNodes(board, 'trap', 1).sort()).toEqual(['2,0', '3,1', '4,0']);
  });

  it('should give Land Battle Chess railways, camps, headquarters and a mountain-blocked front', () => {
    const board = junqiBoard();
    expect(zoneNodes(board, 'camp', 0).sort()).toEqual(['1,7', '1,9', '2,8', '3,7', '3,9']);
    expect(zoneNodes(board, 'hq', 1).sort()).toEqual(['1,0', '3,0']);
    // The front is crossed only on files 0, 2 and 4.
    expect(hasEdge(board, '0,5', '0,6')).toBe(true);
    expect(hasEdge(board, '2,5', '2,6', ['rail'])).toBe(true);
    expect(hasEdge(board, '1,5', '1,6')).toBe(false);
    expect(hasEdge(board, '3,5', '3,6')).toBe(false);
    // Camps reach all four diagonals; other stations only reach neighbouring camps.
    expect(neighbours(board, '2,8', ['diagonal']).sort()).toEqual(['1,7', '1,9', '3,7', '3,9']);
    expect(neighbours(board, '0,8', ['diagonal']).sort()).toEqual(['1,7', '1,9']);
    expect(neighbours(board, '2,10', ['rail']).sort()).toEqual(['1,10', '3,10']);
    expect(neighbours(board, '2,11', ['rail'])).toEqual([]);
    expect(board.decorations.filter((item) => item.kind === 'mountain')).toHaveLength(2);
  });

  it('should build the 121-hole star with six ten-hole homes and six neighbours in the middle', () => {
    const board = starBoard();
    expect(board.zones.filter((zone) => zone.kind === 'home').map((zone) => zone.nodes.length)).toEqual([10, 10, 10, 10, 10, 10]);
    expect(zoneNodes(board, 'home', STAR_CORNERS.indexOf('top'))).toContain('0,0');
    expect(zoneNodes(board, 'home', STAR_CORNERS.indexOf('bottom'))).toContain('0,16');
    expect(neighbours(board, '0,8')).toHaveLength(6);
    expect(neighbours(board, '0,0').sort()).toEqual(['-1,1', '1,1']);
    // Doubled columns make a straight jump a repeated offset.
    expect(offsetNode(board, '0,8', 2, 0)).toBe('2,8');
    expect(offsetNode(board, '0,8', 1, -1)).toBe('1,7');
  });
});

describe('board perspective', () => {
  it('should turn two-sided boards half way and keep fixed boards as drawn', () => {
    const xiangqi = xiangqiBoard();
    expect(sideRotation(xiangqi, 0)).toBe(0);
    expect(sideRotation(xiangqi, 1)).toBe(180);
    expect(rotatePoint(xiangqi, { x: 0, y: 9 }, 180)).toEqual({ x: 8, y: 0 });
    expect(sideRotation(reversiBoard(), 1)).toBe(0);
    expect(sideRotation(gomokuBoard(), 1)).toBe(0);
    expect(sideRotation(xiangqi, 5)).toBe(0);
  });

  it('should bring each star corner to the bottom for its own side', () => {
    const board = starBoard();
    const bottom = { x: board.width / 2, y: board.height };
    STAR_CORNERS.forEach((_, side) => {
      // The corner's tip hole lands where the bottom tip is drawn.
      const tip = zoneNodes(board, 'home', side).map((id) => nodeById(board, id)!)
        .reduce((far, node) => {
          const distance = (node.x - 6) ** 2 + (node.y - board.height / 2) ** 2;
          return distance > far.distance ? { node, distance } : far;
        }, { node: board.nodes[0], distance: -1 }).node;
      const turned = rotatePoint(board, tip, sideRotation(board, side));
      expect(turned.x).toBeCloseTo(bottom.x, 6);
      expect(turned.y).toBeCloseTo(bottom.y, 6);
    });
  });

  it('should map every hole onto a hole under a 60° turn', () => {
    const board = starBoard();
    const key = (point: { x: number; y: number }): string => `${point.x.toFixed(4)}:${point.y.toFixed(4)}`;
    const holes = new Set(board.nodes.map(key));
    for (const node of board.nodes) expect(holes.has(key(rotatePoint(board, node, 60)))).toBe(true);
  });
});

describe('coordinate labels', () => {
  it('should label files from the left and ranks from side 0', () => {
    expect(coordinateLabel(reversiBoard(), nodeId(0, 7))).toBe('a1');
    expect(coordinateLabel(reversiBoard(), nodeId(7, 0))).toBe('h8');
    expect(coordinateLabel(gomokuBoard(), nodeId(7, 7))).toBe('h8');
  });
});

describe('board time control', () => {
  it('should follow the new game default unless the host changed the timer', () => {
    expect(followDefaultTimeControl(DEFAULT_TIME_CONTROL, DEFAULT_TIME_CONTROL, BOARD_TIME_CONTROL)).toEqual(BOARD_TIME_CONTROL);
    expect(followDefaultTimeControl(undefined, DEFAULT_TIME_CONTROL, BOARD_TIME_CONTROL)).toEqual(BOARD_TIME_CONTROL);
    const custom = { baseSeconds: 30, bankSeconds: 120 };
    expect(followDefaultTimeControl(custom, DEFAULT_TIME_CONTROL, BOARD_TIME_CONTROL)).toBe(custom);
    expect(BOARD_TIME_CONTROL).toEqual({ baseSeconds: 60, bankSeconds: 300 });
  });
});
