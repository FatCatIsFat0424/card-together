import { describe, expect, it } from 'vitest';
import {
  IDLE_BOARD_INPUT, confirmBoardInput, confirmsMove, tapBoard, validBoardInput,
} from '../../../client/src/games/board/board-input';
import type { BoardInputRules, BoardInputState } from '../../../client/src/games/board/board-input';

// Two own pieces: a1 can go to a2 or capture on a3; b1 can go to b2. c3 is a covered piece flipped in place.
const moves: BoardInputRules = {
  movable: ['a1', 'b1'],
  targets: (from) => from === 'a1' ? ['a2', 'a3'] : from === 'b1' ? ['b2'] : from === null ? ['c3'] : [],
};
const placement: BoardInputRules = { movable: [], targets: (from) => from === null ? ['h8', 'h9'] : [] };

function taps(rules: BoardInputRules, confirm: boolean, nodes: readonly (string | null)[]) {
  let state: BoardInputState = IDLE_BOARD_INPUT;
  const submitted: unknown[] = [];
  for (const node of nodes) {
    const result = tapBoard(state, node, rules, confirm);
    state = result.state;
    if (result.submit) submitted.push(result.submit);
  }
  return { state, submitted };
}

describe('board select-then-confirm', () => {
  it('should confirm touch moves by default and skip confirmation with one-tap or precise input', () => {
    expect(confirmsMove('touch', false)).toBe(true);
    expect(confirmsMove('touch', true)).toBe(false);
    expect(confirmsMove('mouse', false)).toBe(false);
    expect(confirmsMove('pen', false)).toBe(false);
    expect(confirmsMove('keyboard', false)).toBe(false);
  });

  it('should select a piece, hold the chosen target as pending, and send it on confirm', () => {
    const { state, submitted } = taps(moves, true, ['a1', 'a3']);
    expect(submitted).toEqual([]);
    expect(state).toEqual({ selected: 'a1', pending: { from: 'a1', to: 'a3' } });
    expect(confirmBoardInput(state)).toEqual({ state: IDLE_BOARD_INPUT, submit: { from: 'a1', to: 'a3' } });
  });

  it('should send a pending move when its destination is tapped again', () => {
    expect(taps(moves, true, ['a1', 'a2', 'a2']).submitted).toEqual([{ from: 'a1', to: 'a2' }]);
  });

  it('should move at once without confirmation', () => {
    const { state, submitted } = taps(moves, false, ['a1', 'a2']);
    expect(submitted).toEqual([{ from: 'a1', to: 'a2' }]);
    expect(state).toEqual(IDLE_BOARD_INPUT);
  });

  it('should switch targets, switch pieces, step back, and deselect', () => {
    expect(taps(moves, true, ['a1', 'a2', 'a3']).state.pending).toEqual({ from: 'a1', to: 'a3' });
    expect(taps(moves, true, ['a1', 'a2', 'b1']).state).toEqual({ selected: 'b1', pending: null });
    // Tapping the selected piece again cancels a pending move, then the selection.
    expect(taps(moves, true, ['a1', 'a2', 'a1']).state).toEqual({ selected: 'a1', pending: null });
    expect(taps(moves, true, ['a1', 'a1']).state).toEqual(IDLE_BOARD_INPUT);
    // A stray tap steps back one level.
    expect(taps(moves, true, ['a1', 'a2', 'z9']).state).toEqual({ selected: 'a1', pending: null });
    expect(taps(moves, true, ['a1', null]).state).toEqual(IDLE_BOARD_INPUT);
    expect(taps(moves, true, ['b2']).state).toEqual(IDLE_BOARD_INPUT);
  });

  it('should place without a selection, including flips in a game that also moves pieces', () => {
    expect(taps(placement, true, ['h8']).state).toEqual({ selected: null, pending: { to: 'h8' } });
    expect(taps(placement, true, ['h8', 'h9']).state.pending).toEqual({ to: 'h9' });
    expect(taps(placement, true, ['h8', 'h8']).submitted).toEqual([{ to: 'h8' }]);
    expect(taps(placement, false, ['h9']).submitted).toEqual([{ to: 'h9' }]);
    expect(taps(placement, true, ['h8', 'a1']).state).toEqual(IDLE_BOARD_INPUT);
    expect(taps(moves, true, ['a1', 'c3']).state).toEqual({ selected: null, pending: { to: 'c3' } });
  });

  it('should drop choices that are no longer legal or when the player cannot move', () => {
    const pending: BoardInputState = { selected: 'a1', pending: { from: 'a1', to: 'a3' } };
    expect(validBoardInput(pending, moves, true)).toBe(pending);
    expect(validBoardInput(pending, { ...moves, targets: () => ['a2'] }, true)).toEqual({ selected: 'a1', pending: null });
    expect(validBoardInput(pending, { ...moves, movable: ['b1'] }, true)).toEqual(IDLE_BOARD_INPUT);
    expect(validBoardInput(pending, moves, false)).toEqual(IDLE_BOARD_INPUT);
    expect(validBoardInput(IDLE_BOARD_INPUT, moves, false)).toBe(IDLE_BOARD_INPUT);
    const placed: BoardInputState = { selected: null, pending: { to: 'h8' } };
    expect(validBoardInput(placed, placement, true)).toBe(placed);
    expect(validBoardInput(placed, { ...placement, targets: () => ['h9'] }, true)).toEqual(IDLE_BOARD_INPUT);
  });
});
