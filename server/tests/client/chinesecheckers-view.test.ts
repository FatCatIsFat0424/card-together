import { describe, expect, it } from 'vitest';
import type { ChineseCheckersVisibleState } from '@shared/types';
import { NO_DRAW_OFFER } from '@shared/rules/board/match-controls';
import { CC_BOARD, CC_HOLES, CC_TRIANGLES, ccCorners, ccIndex, ccInitialHoles, ccNode } from '@shared/rules/chinesecheckers';
import type { CcHole } from '@shared/rules/chinesecheckers';
import type { GameSeat } from '@shared/types';
import type { BoardSeatAnchor } from '../../../client/src/games/board/board-table';
import { boardAspect, boardGeometry } from '../../../client/src/games/board/board-view';
import {
  chineseCheckersAnchors, chineseCheckersArrived, chineseCheckersLastMove, chineseCheckersMoveCount,
  chineseCheckersMovable, chineseCheckersPassedSeat, chineseCheckersPath, chineseCheckersPieces, chineseCheckersRotation,
  chineseCheckersSeatOrder, chineseCheckersSlot, chineseCheckersTargets,
} from '../../../client/src/games/chinesecheckers/chinesecheckers-view';
import { DEFAULT_BOARD_THEME } from '../../../client/src/games/board/board-theme';
import { clientGame } from '../../../client/src/games/registry';

function game(overrides: Partial<ChineseCheckersVisibleState> = {}): ChineseCheckersVisibleState {
  return {
    gameType: 'chinesecheckers', phase: 'playing', mySeat: 'N', seats: ['N', 'S'], corners: [0, 3],
    holes: ccInitialHoles([0, 3]), currentTurnSeat: 'N', drawOffer: NO_DRAW_OFFER, resigned: [], log: [], result: null,
    ...overrides,
  };
}

function holes(marbles: Readonly<Record<string, number>>): CcHole[] {
  const board: CcHole[] = new Array<CcHole>(CC_HOLES).fill(null);
  for (const [node, corner] of Object.entries(marbles)) board[ccIndex(node)!] = corner;
  return board;
}

describe('Chinese checkers view helpers', () => {
  it('draws one marble per occupied hole and turns each seat corner to the bottom', () => {
    expect(chineseCheckersPieces(game().holes)).toHaveLength(20);
    expect(chineseCheckersRotation(game(), 'N')).toBe(0);
    expect(chineseCheckersRotation(game(), 'S')).toBe(180);
    // Spectators who watch a seat outside the match see the first player's view.
    expect(chineseCheckersRotation(game(), 'W')).toBe(0);
    // The star looks the same from every corner, so its aspect never changes.
    expect(boardAspect(CC_BOARD, 60)).toBeCloseTo(boardAspect(CC_BOARD, 0), 6);
  });

  it('offers own movable marbles and their destinations only on the viewer turn', () => {
    expect(chineseCheckersMovable(game(), 'N').sort()).toEqual(['-1,13', '-2,14', '-3,13', '0,14', '1,13', '2,14', '3,13'].sort());
    expect(chineseCheckersMovable(game(), 'S')).toEqual([]);
    expect(chineseCheckersMovable(game(), null)).toEqual([]);
    expect(chineseCheckersMovable(game({ phase: 'scoring' }), 'N')).toEqual([]);
    expect(chineseCheckersTargets(game(), 'N', '-2,14').sort()).toEqual(['-4,12', '0,12']);
    expect(chineseCheckersTargets(game(), 'N', '0,0')).toEqual([]);
    expect(chineseCheckersTargets(game(), 'S', '-2,14')).toEqual([]);
  });

  it('previews the jump chain the server will find', () => {
    const chain = game({ holes: holes({ '0,12': 0, '1,11': 3, '3,9': 3, '0,0': 3 }) });
    expect(chineseCheckersPath(chain, '0,12', '4,8')).toEqual(['2,10']);
    expect(chineseCheckersPath(chain, '0,12', '2,10')).toEqual([]);
  });

  it('numbers corners clockwise from the viewer and reads plates round the star', () => {
    const six = game({ seats: ['N', 'E', 'S', 'W', 'P5', 'P6'], corners: [...ccCorners(6)!] });
    expect(six.seats.map((seat) => chineseCheckersSlot(six, 'N', seat))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(six.seats.map((seat) => chineseCheckersSlot(six, 'W', seat))).toEqual([3, 4, 5, 0, 1, 2]);
    expect(chineseCheckersSlot(game(), 'N', 'S')).toBe(3);
    // A spectator watching a seat outside the match sees the first player's view.
    expect(chineseCheckersSlot(game(), 'W', 'N')).toBe(0);
    expect(chineseCheckersSlot(game(), 'N', 'W')).toBeNull();
    // The viewer first, the opposite corner next, then each side from its upper corner down.
    expect(chineseCheckersSeatOrder(six, 'N')).toEqual(['N', 'W', 'S', 'E', 'P5', 'P6']);
    expect(chineseCheckersSeatOrder(six, 'W')).toEqual(['W', 'N', 'P6', 'P5', 'E', 'S']);
  });

  // Nominal frames and the widest plates seen in the browser: desktop 1280 × 800, a 706 × 336 phone, a 390 × 844 portrait phone.
  const LAYOUTS = [
    { key: 'wide', width: 672, height: 760, plate: { width: 200, height: 40 }, room: { x: 70, y: 0 } },
    { key: 'compact', width: 287, height: 324, plate: { width: 160, height: 40 }, room: { x: 200, y: 0 } },
    { key: 'narrow', width: 346, height: 391, plate: { width: 168, height: 40 }, room: { x: 0, y: 200 } },
  ] as const;
  const SHIFT = { start: 0, center: 0.5, end: 1 } as const;

  function plateRect(anchor: BoardSeatAnchor, layout: typeof LAYOUTS[number]): { left: number; top: number; right: number; bottom: number } {
    const { width, height } = layout.plate;
    const left = anchor.x * layout.width - SHIFT[anchor.inline] * width;
    const away = (anchor.stack ?? 0) * (height + 6) * (anchor.block === 'end' ? -1 : 1);
    const top = anchor.y * layout.height - SHIFT[anchor.block] * height + away;
    return { left, top, right: left + width, bottom: top + height };
  }

  it.each([2, 3, 4, 6])('pins %i plates beside their corners, clear of holes and of each other', (count) => {
    const seats = (['N', 'E', 'S', 'W', 'P5', 'P6'] as GameSeat[]).slice(0, count);
    const match = game({ seats, corners: [...ccCorners(count)!], holes: ccInitialHoles([...ccCorners(count)!]) });
    const [vx, vy, vw] = boardGeometry(CC_BOARD, 0).viewBox;
    for (const viewer of seats) {
      const anchors = chineseCheckersAnchors(match, viewer);
      expect(Object.keys(anchors).sort()).toEqual([...seats].sort());
      for (const layout of LAYOUTS) {
        const unit = layout.width / vw;
        const rects = seats.map((seat) => plateRect(anchors[seat]![layout.key], layout));
        rects.forEach((rect, index) => {
          const where = `${count}p ${viewer} ${layout.key} ${seats[index]}`;
          for (const node of CC_BOARD.nodes) {
            const cx = (node.x - vx) * unit;
            const cy = (node.y - vy) * unit;
            const nearX = Math.max(rect.left, Math.min(cx, rect.right));
            const nearY = Math.max(rect.top, Math.min(cy, rect.bottom));
            expect(Math.hypot(cx - nearX, cy - nearY), `${where} covers ${node.id}`).toBeGreaterThan(0.46 * unit);
          }
          expect(rect.left, where).toBeGreaterThanOrEqual(-layout.room.x);
          expect(rect.right, where).toBeLessThanOrEqual(layout.width + layout.room.x);
          expect(rect.top, where).toBeGreaterThanOrEqual(-layout.room.y);
          expect(rect.bottom, where).toBeLessThanOrEqual(layout.height + layout.room.y);
          rects.slice(index + 1).forEach((other) => {
            const apart = other.left >= rect.right || rect.left >= other.right || other.top >= rect.bottom || rect.top >= other.bottom;
            expect(apart, `${where} overlaps another plate`).toBe(true);
          });
        });
      }
      // The viewer's own corner is always the bottom one, and plates carry their corner colour.
      expect(anchors[viewer]!.wide).toEqual(chineseCheckersAnchors(game({ seats: ['N', 'S'] }), 'N').N!.wide);
      expect(anchors[viewer]!.accent).toBe(DEFAULT_BOARD_THEME.pieces.marbles[match.corners[seats.indexOf(viewer)]]);
    }
  });

  it('tracks arrivals, the last move, passes, and the move count', () => {
    const played = game({
      log: [
        { seat: 'N', from: '-3,13', to: '-4,12', timestamp: 1 },
        { seat: 'S', timestamp: 2 },
      ],
    });
    expect(chineseCheckersLastMove(played)).toMatchObject({ to: '-4,12' });
    expect(chineseCheckersPassedSeat(played)).toBe('S');
    expect(chineseCheckersMoveCount(played)).toBe(1);
    expect(chineseCheckersPassedSeat(game({ log: [{ seat: 'S', resigned: true, timestamp: 1 }] }))).toBeNull();
    expect(chineseCheckersArrived(game(), 'N')).toBe(0);
    expect(chineseCheckersArrived(game({ holes: holes({ '0,0': 0, '1,1': 0 }) }), 'N')).toBe(2);
    expect(chineseCheckersArrived(game({ resigned: ['N'] }), 'N')).toBe(0);
  });

  it('counts opposing marbles as arrived only once the target is finished', () => {
    // Every hole of North's target is taken: nine by South, one by North itself.
    const target = CC_TRIANGLES[3].map(ccNode);
    const marbles = Object.fromEntries(target.map((node) => [node, 3]));
    expect(chineseCheckersArrived(game({ holes: holes({ ...marbles, [target[0]]: 0 }) }), 'N')).toBe(10);
    expect(chineseCheckersArrived(game({ holes: holes({ ...marbles, [target[0]]: 0, [target[1]]: 0 }) }), 'N')).toBe(10);
    // With no marble of its own in the full target, North has not finished.
    expect(chineseCheckersArrived(game({ holes: holes(marbles) }), 'N')).toBe(0);
    const open = Object.fromEntries(target.slice(2).map((node) => [node, 3]));
    expect(chineseCheckersArrived(game({ holes: holes({ ...open, [target[0]]: 0 }) }), 'N')).toBe(1);
  });

  it('registers the client module with board-game defaults', () => {
    const client = clientGame('chinesecheckers');
    expect(client.restoreSnapshot(game(), { state: {} as never, retain: (_previous, next) => next }))
      .toMatchObject({ phase: 'playing', currentTurnSeat: 'N' });
    expect(client.result.sidesWin).toBe(false);
    expect(client.handSort.bySuit).toBe(false);
  });
});
