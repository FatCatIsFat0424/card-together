import { describe, expect, it } from 'vitest';
import type { LandBattleMove, LandBattleVisiblePiece, LandBattleVisibleState } from '@shared/types';
import { NO_DRAW_OFFER } from '@shared/rules/board/match-controls';
import { junqiBoard } from '@shared/rules/board/boards';
import { LB_PRESETS, lbDeploySlots, lbNode } from '@shared/rules/landbattle';
import type { LbSide } from '@shared/rules/landbattle';
import {
  draftPieces, draftSlot, landBattleMovable, landBattleNotation, landBattlePath, landBattleRemaining, landBattleSide,
  landBattleTargets, swapProblem,
} from '../../../client/src/games/landbattle/landbattle-view';
import { clientGame } from '../../../client/src/games/registry';
import { landBattleUi } from '../../../client/src/games/landbattle/landbattle-ui';

/** Both deployments on the board as the first seat sees them: own ranks, blank opponents. */
function pieces(): LandBattleVisiblePiece[] {
  return ([0, 1] as LbSide[]).flatMap((side) => lbDeploySlots(side).map((index, slot) => ({
    side, node: lbNode(index), origin: lbNode(index), ...side === 0 ? { rank: LB_PRESETS[0][slot] } : {},
  })));
}

function game(overrides: Partial<LandBattleVisibleState> = {}): LandBattleVisibleState {
  return {
    gameType: 'landbattle', phase: 'playing', mySeat: 'N', seats: ['N', 'S'], deployDeadline: 0, deployed: ['N', 'S'],
    autoDeployed: [], myLayout: LB_PRESETS[0], pieces: pieces(), flagsShown: [], currentTurnSeat: 'N',
    drawOffer: NO_DRAW_OFFER, quietMoves: 0, log: [], result: null, ...overrides,
  };
}

describe('Land Battle Chess view helpers', () => {
  it('lets only the seat on turn select pieces that can move', () => {
    const movable = landBattleMovable(game(), 'N');
    expect(movable).toContain('0,6');
    // The flag, the mines, and headquarters pieces never move.
    expect(movable).not.toContain('1,11');
    expect(movable).not.toContain('0,11');
    expect(landBattleMovable(game(), 'S')).toEqual([]);
    expect(landBattleMovable(game(), null)).toEqual([]);
    expect(landBattleMovable(game({ phase: 'scoring' }), 'N')).toEqual([]);
    expect([landBattleSide(game(), 'N'), landBattleSide(game(), 'S'), landBattleRemaining(game(), 'S')]).toEqual([0, 1, 25]);
  });

  it('marks attacks among the destinations and draws railway runs through their stations', () => {
    const targets = landBattleTargets(game(), '0,6');
    expect(targets).toContainEqual({ node: '0,5', capture: true });
    expect(targets).toContainEqual({ node: '1,7', capture: false });
    const open = game({ pieces: [{ side: 0, node: '0,6', origin: '0,6', rank: 'colonel' }, { side: 1, node: '0,2', origin: '0,2' }] });
    expect(landBattlePath(open, '0,6', '0,2')).toEqual(['0,5', '0,4', '0,3']);
  });

  it('maps deployment slots to own stations and refuses swaps that break a placement rule', () => {
    const layout = LB_PRESETS[0];
    expect(draftPieces(layout, 1)[0]).toEqual({ node: '4,5', slot: 0, rank: layout[0] });
    expect(draftSlot('4,5', 1)).toBe(0);
    expect(draftSlot('0,6', 1)).toBe(-1);
    expect(swapProblem(layout, layout.indexOf('flag'), 0)).toBe('flag');
    expect(swapProblem(layout, layout.indexOf('mine'), 0)).toBe('mine');
    expect(swapProblem(layout, layout.indexOf('bomb'), 0)).toBe('bomb');
    expect(swapProblem(layout, 0, 1)).toBeNull();
  });

  it('writes moves with coordinates and the battle outcome only', () => {
    const notation = landBattleNotation(junqiBoard());
    const move: LandBattleMove = { seat: 'N', from: '2,6', to: '2,5', capture: true, battle: 'tie', timestamp: 1 };
    expect(notation(move, 'en')).toBe('c6xc7=');
    expect(notation(move, 'zh-TW')).toBe('c6xc7 同');
    expect(notation({ seat: 'N', from: '0,6', to: '0,2', path: ['0,5', '0,4', '0,3'], timestamp: 1 }, 'en')).toBe('a6-a10');
    expect(landBattleUi.boardMoveCue?.(move, game())).toBe('capture');
  });

  it('keeps deployment out of the turn and maps the result for history', () => {
    const client = clientGame('landbattle');
    const restored = client.restoreSnapshot(game({ phase: 'deploying' }), { state: {} as never, retain: (_previous, next) => next });
    expect(restored).toMatchObject({ phase: 'playing', currentTurnSeat: null });
    expect(client.result.summary({ gameType: 'landbattle', seats: ['N', 'S'], remaining: { N: 3, S: 0 }, moves: 9,
      winners: ['N'], reason: 'flag-captured' }, 'N', (key) => key)).toMatchObject({ kind: 'winners', winners: ['N'] });
  });
});
