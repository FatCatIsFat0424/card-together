import { describe, expect, it, vi } from 'vitest';
import type { JungleMove, JungleVisibleState } from '@shared/types';
import { NO_DRAW_OFFER } from '@shared/rules/board/match-controls';
import { jgInitialCells } from '@shared/rules/jungle';
import {
  JUNGLE_GLYPHS, jungleAnimalKey, jungleCounts, jungleLastMove, jungleMovable, jungleNotation, junglePieces, jungleSide,
  jungleTargets,
} from '../../../client/src/games/jungle/jungle-view';
import { clientGame } from '../../../client/src/games/registry';
import { gameUi } from '../../../client/src/games/ui-registry';
import { confirmsMove, tapBoard } from '../../../client/src/games/board/board-input';

// The UI registry reaches components that read the account; the registry itself never does.
vi.mock('../../../client/src/stores/account-store', () => ({
  useAccountStore: (select: (state: { account: null }) => unknown) => select({ account: null }),
}));

function game(overrides: Partial<JungleVisibleState> = {}): JungleVisibleState {
  return {
    gameType: 'jungle', phase: 'playing', mySeat: 'N', seats: ['N', 'S'], cells: jgInitialCells(), currentTurnSeat: 'N',
    drawOffer: NO_DRAW_OFFER, log: [], result: null, ...overrides,
  };
}

const move = (overrides: Partial<JungleMove> = {}): JungleMove => ({
  seat: 'N', from: '6,6', to: '6,5', piece: 1, capture: false, timestamp: 1, ...overrides,
});

describe('Jungle view helpers', () => {
  it('draws one piece per animal and counts them by seat', () => {
    expect(junglePieces(game().cells)).toHaveLength(16);
    expect(junglePieces(game().cells).filter((piece) => piece.side === 0).map((piece) => piece.rank).sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(jungleCounts(game())).toEqual({ N: 8, S: 8 });
    expect([jungleSide(game(), 'N'), jungleSide(game(), 'S')]).toEqual([0, 1]);
  });

  it('offers moves only to the seat on turn, and only for its own pieces', () => {
    expect(jungleTargets(game(), 'N', '0,6').map((target) => target.node).sort()).toEqual(['0,5', '0,7', '1,6']);
    expect(jungleTargets(game(), 'S', '0,6')).toEqual([]);
    expect(jungleTargets(game(), 'N', '0,2')).toEqual([]);
    expect(jungleTargets(game(), null, '0,6')).toEqual([]);
    expect(jungleTargets(game({ phase: 'scoring' }), 'N', '0,6')).toEqual([]);
    expect(jungleMovable(game(), 'S')).toEqual([]);
    expect(jungleMovable(game(), 'N').length).toBeGreaterThan(0);
    expect(jungleMovable(game(), 'N')).toContain('0,6');
  });

  it('marks captures among the targets', () => {
    const cells = new Array<number>(63).fill(0);
    cells[4 * 7] = 4;
    cells[3 * 7] = 11;
    const targets = jungleTargets(game({ cells }), 'N', '0,4');
    expect(targets).toEqual([{ node: '0,3', capture: true }, { node: '0,5', capture: false }]);
  });

  it('finds the last move', () => {
    expect(jungleLastMove(game())).toBeNull();
    expect(jungleLastMove(game({ log: [move(), move({ seat: 'S', from: '0,2', to: '0,3' })] }))).toEqual({ from: '0,2', to: '0,3' });
  });

  it('names every animal and writes moves with the animal and coordinates', () => {
    expect(JUNGLE_GLYPHS['zh-TW']).toHaveLength(8);
    expect(JUNGLE_GLYPHS.en).toHaveLength(8);
    expect(new Set(JUNGLE_GLYPHS.en).size).toBe(8);
    expect(jungleAnimalKey(1)).toBe('jungle.animal.rat');
    expect(jungleAnimalKey(8)).toBe('jungle.animal.elephant');
    expect(jungleNotation(move(), 'zh-TW')).toBe('鼠g3-g4');
    expect(jungleNotation(move({ piece: 8, from: '0,6', to: '0,5', capture: true }), 'en')).toBe('El a3xa4');
  });
});

describe('Jungle client registration', () => {
  it('selects, then confirms on touch screens and sends at once with the mouse', () => {
    const rules = {
      movable: ['0,6'], targets: (from: string | null) => (from === '0,6' ? ['0,5', '1,6'] : []),
    };
    const picked = tapBoard({ selected: null, pending: null }, '0,6', rules, confirmsMove('touch', false));
    expect(picked.state.selected).toBe('0,6');
    const pending = tapBoard(picked.state, '0,5', rules, confirmsMove('touch', false));
    expect(pending.submit).toBeNull();
    expect(pending.state.pending).toEqual({ from: '0,6', to: '0,5' });
    const mouse = tapBoard(picked.state, '0,5', rules, confirmsMove('mouse', false));
    expect(mouse.submit).toEqual({ from: '0,6', to: '0,5' });
  });

  it('uses the capture sound for captures and the place sound otherwise', () => {
    const cue = gameUi('jungle').boardMoveCue!;
    expect(cue(move(), game())).toBe('place');
    expect(cue(move({ capture: true, captured: 2 }), game())).toBe('capture');
  });

  it('lists winners of a finished match and declares no rounds', () => {
    expect(clientGame('jungle').result.winners({ gameType: 'jungle', seats: ['N', 'S'], pieces: {}, moves: 3, winners: ['S'], reason: 'resign' }))
      .toEqual(['S']);
    expect(clientGame('jungle').roundHistory).toBeUndefined();
  });
});
