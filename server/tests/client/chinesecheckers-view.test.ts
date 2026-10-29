import { describe, expect, it } from 'vitest';
import type { ChineseCheckersVisibleState } from '@shared/types';
import { NO_DRAW_OFFER } from '@shared/rules/board/match-controls';
import { CC_BOARD, CC_HOLES, CC_TRIANGLES, ccCorners, ccIndex, ccInitialHoles, ccNode } from '@shared/rules/chinesecheckers';
import type { CcHole } from '@shared/rules/chinesecheckers';
import { boardAspect } from '../../../client/src/games/board/board-view';
import {
  chineseCheckersArrived, chineseCheckersLastMove, chineseCheckersMoveCount, chineseCheckersMovable,
  chineseCheckersPassedSeat, chineseCheckersPath, chineseCheckersPieces, chineseCheckersPlaces, chineseCheckersRotation,
  chineseCheckersSeatOrder,
  chineseCheckersTargets,
} from '../../../client/src/games/chinesecheckers/chinesecheckers-view';
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

  it('places opponents by their corner: opposite on top, others to the sides', () => {
    expect(chineseCheckersPlaces(game(), 'N')).toEqual({ S: 'top' });
    const six = game({ seats: ['N', 'E', 'S', 'W', 'P5', 'P6'], corners: [...ccCorners(6)!] });
    expect(chineseCheckersPlaces(six, 'N')).toEqual({ E: 'left', S: 'left', W: 'top', P5: 'right', P6: 'right' });
    expect(chineseCheckersPlaces(six, 'W')).toEqual({ P5: 'left', P6: 'left', N: 'top', E: 'right', S: 'right' });
    const four = game({ seats: ['N', 'E', 'S', 'W'], corners: [...ccCorners(4)!] });
    expect(chineseCheckersPlaces(four, 'E')).toEqual({ S: 'left', W: 'top', N: 'right' });
    const three = game({ seats: ['N', 'E', 'S'], corners: [...ccCorners(3)!] });
    expect(chineseCheckersPlaces(three, 'N')).toEqual({ E: 'left', S: 'right' });
    // Side columns read top to bottom: the upper corner's seat comes first.
    expect(chineseCheckersSeatOrder(six, 'N')).toEqual(['N', 'W', 'S', 'E', 'P5', 'P6']);
    expect(chineseCheckersSeatOrder(six, 'W')).toEqual(['W', 'N', 'P6', 'P5', 'E', 'S']);
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
