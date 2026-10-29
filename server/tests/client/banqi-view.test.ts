import { describe, expect, it, vi } from 'vitest';
import type { BanqiMove, BanqiVisibleState } from '@shared/games/banqi/types';
import { NO_DRAW_OFFER } from '@shared/rules/board/match-controls';
import { BQ_DOWN, bqPiece } from '@shared/rules/banqi';
import {
  banqiCells, banqiChoices, banqiColour, banqiInChain, banqiLastMove, banqiNotation, banqiRemaining,
} from '../../../client/src/games/banqi/banqi-view';
import { clientGame } from '../../../client/src/games/registry';
import { gameUi } from '../../../client/src/games/ui-registry';
import { position } from '../fixtures/banqi-position';

// The UI registry reaches components that read the account; the registry itself never does.
vi.mock('../../../client/src/stores/account-store', () => ({
  useAccountStore: (select: (state: { account: null }) => unknown) => select({ account: null }),
}));

function game(overrides: Partial<BanqiVisibleState> = {}): BanqiVisibleState {
  return {
    gameType: 'banqi', phase: 'playing', mySeat: 'N', seats: ['N', 'S'], options: { chain: false, rookDash: false },
    board: new Array(32).fill(BQ_DOWN), colours: null, currentTurnSeat: 'N', chain: null, quietMoves: 0, drawOffer: NO_DRAW_OFFER,
    log: [], result: null, ...overrides,
  };
}

describe('Banqi view helpers', () => {
  it('draws every cell face down for a seated player, with no identity attached', () => {
    const cells = banqiCells(game());
    expect(cells).toHaveLength(32);
    expect(cells.every((cell) => cell.piece === null && cell.secret === null)).toBe(true);
  });

  it('draws the secrets only when the view carries the spectator god view', () => {
    const board = position(['.#R.....', '........', '........', '........']);
    const spectator = game({ board, observer: 'spectator', observedPieces: { '1,0': 11 } });
    expect(banqiCells(spectator)).toEqual([
      { node: '1,0', piece: null, secret: 11 }, { node: '2,0', piece: bqPiece(0, 3), secret: null },
    ]);
    expect(banqiCells(game({ board }))[0]).toEqual({ node: '1,0', piece: null, secret: null });
  });

  it('offers only the flips before colours exist, and only to the seat on turn', () => {
    const choices = banqiChoices(game(), 'N');
    expect(choices.flips).toHaveLength(32);
    expect(choices.movable).toEqual([]);
    expect(banqiChoices(game(), 'S').flips).toEqual([]);
    expect(banqiChoices(game(), null).flips).toEqual([]);
    expect(banqiChoices(game({ phase: 'scoring' }), 'N').flips).toEqual([]);
  });

  it('lists own movable pieces with their steps and captures, plus the flips', () => {
    const board = position(['Rh.#....', '........', '........', '.......k']);
    const choices = banqiChoices(game({ board, colours: [0, 1] }), 'N');
    expect(choices.movable).toEqual(['0,0']);
    expect(choices.flips).toEqual(['3,0']);
    expect(choices.targets('0,0')).toEqual([{ node: '1,0', capture: true }, { node: '0,1', capture: false }]);
    expect(banqiChoices(game({ board, colours: [0, 1], currentTurnSeat: 'S', mySeat: 'S' }), 'S').movable).toEqual(['1,0', '7,3']);
  });

  it('restricts a chain to captures by the chaining piece', () => {
    const board = position(['.Rp.....', '........', '........', '.......k']);
    const choices = banqiChoices(game({ board, colours: [0, 1], chain: '1,0', options: { chain: true, rookDash: false } }), 'N');
    expect(choices.flips).toEqual([]);
    expect(choices.movable).toEqual(['1,0']);
    expect(choices.targets('1,0')).toEqual([{ node: '2,0', capture: true }]);
    expect(banqiInChain(game({ chain: '1,0' }), 'N')).toBe(true);
    expect(banqiInChain(game({ chain: '1,0' }), 'S')).toBe(false);
    expect(banqiInChain(game(), 'N')).toBe(false);
  });

  it('knows each seat colour, the pieces left per colour, and the last move', () => {
    const state = game({
      colours: [1, 0],
      log: [
        { seat: 'N', to: '0,0', revealed: bqPiece(1, 3), timestamp: 1 },
        { seat: 'S', from: '0,1', to: '0,0', piece: bqPiece(0, 3), capture: true, captured: bqPiece(1, 3), timestamp: 2 },
      ],
    });
    expect([banqiColour(state, 'N'), banqiColour(state, 'S'), banqiColour(state, 'E')]).toEqual([1, 0, null]);
    expect(banqiColour(game(), 'N')).toBeNull();
    expect(banqiRemaining(state)).toEqual([16, 15]);
    expect(banqiLastMove(state)).toEqual({ from: '0,1', to: '0,0' });
    expect(banqiLastMove(game())).toBeNull();
  });

  it('writes notation from public facts in both languages', () => {
    const flip: BanqiMove = { seat: 'N', to: '2,1', revealed: bqPiece(0, 3), timestamp: 1 };
    const step: BanqiMove = { seat: 'S', from: '0,0', to: '0,1', piece: bqPiece(1, 3), timestamp: 1 };
    const take: BanqiMove = { seat: 'N', from: '2,1', to: '3,1', piece: bqPiece(0, 3), capture: true, captured: bqPiece(1, 6), chain: true, timestamp: 1 };
    expect(banqiNotation(flip, 'zh-TW')).toBe('翻 c3 俥');
    expect(banqiNotation(flip, 'en')).toBe('Flip c3 俥');
    expect(banqiNotation(step, 'en')).toBe('車 a4-a3');
    expect(banqiNotation(take, 'zh-TW')).toBe('+俥 c3xd3');
  });

  it('registers the game with both room rules in the rules dialog context', () => {
    const client = clientGame('banqi');
    const context = client.rules.matchContext(game({ options: { chain: true, rookDash: false } }));
    expect(context).toMatchObject({ option: { label: 'banqi.chain', enabled: true }, moreOptions: [{ label: 'banqi.rookDash', enabled: false }] });
    expect(client.rules.summary(context, (key) => key)).toContain('banqi.rulesChain');
    expect(client.rules.summary(context, (key) => key)).not.toContain('banqi.rulesRookDash');
    expect(client.lobbyIcon.glyph).toBe('暗');
  });

  it('plays flip, capture, and place cues from the public move', () => {
    const cue = gameUi('banqi').boardMoveCue!;
    const state = game();
    expect(cue({ seat: 'N', to: '0,0', revealed: 1, timestamp: 1 }, state)).toBe('flip');
    expect(cue({ seat: 'N', from: '0,0', to: '1,0', piece: 3, capture: true, captured: 9, timestamp: 1 }, state)).toBe('capture');
    expect(cue({ seat: 'N', from: '0,0', to: '1,0', piece: 3, timestamp: 1 }, state)).toBe('place');
  });
});
