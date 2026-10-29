import { describe, expect, it } from 'vitest';
import {
  DRAW_REOFFER_MOVES, NO_DRAW_OFFER, afterBoardMove, applyMatchControl, canAnswerDraw, drawOfferBlock, isDrawOfferState,
  isMatchControl, parseMatchControl,
} from '@shared/rules/board/match-controls';
import type { DrawOfferState, MatchControlAction, MatchControlRules } from '@shared/rules/board/match-controls';
import { isBoardOutcome, resignationOutcome } from '@shared/rules/board/board-result';
import { coordinateNotation, moveRows } from '@shared/rules/board/board-move';
import type { BoardMoveRecord } from '@shared/rules/board/board-move';
import { gomokuBoard, xiangqiBoard } from '@shared/rules/board/boards';

const RULES: MatchControlRules = { resign: true, draw: true };
const SEATS = ['N', 'S'] as const;
const onTurn = (turnSeat: 'N' | 'S') => ({ seats: SEATS, turnSeat });

function apply(state: DrawOfferState, seat: 'N' | 'S', action: MatchControlAction, turnSeat: 'N' | 'S') {
  const result = applyMatchControl(state, seat, action, RULES, onTurn(turnSeat));
  if (typeof result === 'string') throw new Error(result);
  return result;
}

describe('match-control parsing', () => {
  it('should read only the controls a game opts into', () => {
    expect(parseMatchControl({ type: 'resign' }, RULES)).toEqual({ type: 'resign' });
    expect(parseMatchControl({ type: 'answer-draw', accept: false }, RULES)).toEqual({ type: 'answer-draw', accept: false });
    expect(parseMatchControl({ type: 'offer-draw' }, { resign: true, draw: false })).toMatch(/no draw/);
    expect(parseMatchControl({ type: 'resign' }, undefined)).toMatch(/no resignation/);
    expect(parseMatchControl({ type: 'answer-draw', accept: 'yes' }, RULES)).toMatch(/Invalid/);
    expect(parseMatchControl({ type: 'resign', extra: 1 }, RULES)).toEqual({ type: 'resign' });
    expect(parseMatchControl({ type: 'move', to: 'a1' }, RULES)).toBeNull();
    expect(parseMatchControl('resign', RULES)).toBeNull();
    expect(isMatchControl({ type: 'offer-draw' })).toBe(true);
    expect(isMatchControl({ type: 'move' })).toBe(false);
  });
});

describe('draw offers', () => {
  it('should allow an offer only on the offerer\'s own turn in a two-player match', () => {
    expect(drawOfferBlock(NO_DRAW_OFFER, 'N', onTurn('N'))).toBeNull();
    expect(drawOfferBlock(NO_DRAW_OFFER, 'N', onTurn('S'))).toBe('not-your-turn');
    expect(drawOfferBlock(NO_DRAW_OFFER, 'N', { seats: ['N', 'E', 'S'], turnSeat: 'N' })).toBe('unavailable');
    expect(drawOfferBlock(NO_DRAW_OFFER, 'E', onTurn('N'))).toBe('unavailable');
    expect(drawOfferBlock(NO_DRAW_OFFER, 'N', onTurn('N'), { resign: true, draw: false })).toBe('unavailable');
    expect(applyMatchControl(NO_DRAW_OFFER, 'N', { type: 'offer-draw' }, RULES, onTurn('S'))).toMatch(/own turn/);
  });

  it('should end the match when the opponent accepts', () => {
    const offered = apply(NO_DRAW_OFFER, 'N', { type: 'offer-draw' }, 'N');
    expect(offered).toEqual({ state: { offeredBy: 'N', cooldown: {} }, effect: null });
    expect(drawOfferBlock(offered.state, 'S', onTurn('S'))).toBe('pending');
    expect(canAnswerDraw(offered.state, 'S', onTurn('N'))).toBe(true);
    expect(canAnswerDraw(offered.state, 'N', onTurn('N'))).toBe(false);
    expect(applyMatchControl(offered.state, 'N', { type: 'answer-draw', accept: true }, RULES, onTurn('N')))
      .toMatch(/no draw offer/);
    expect(apply(offered.state, 'S', { type: 'answer-draw', accept: true }, 'N'))
      .toEqual({ state: { offeredBy: null, cooldown: {} }, effect: { kind: 'agreed-draw' } });
  });

  it('should keep the offer open while the offerer moves and treat the opponent\'s move as a rejection', () => {
    let state = apply(NO_DRAW_OFFER, 'N', { type: 'offer-draw' }, 'N').state;
    state = afterBoardMove(state, 'N');
    expect(state.offeredBy).toBe('N');
    state = afterBoardMove(state, 'S');
    expect(state).toEqual({ offeredBy: null, cooldown: { N: DRAW_REOFFER_MOVES } });
  });

  it('should require three own moves after a rejection before offering again', () => {
    let state = apply(NO_DRAW_OFFER, 'N', { type: 'offer-draw' }, 'N').state;
    state = apply(state, 'S', { type: 'answer-draw', accept: false }, 'N').state;
    expect(state).toEqual({ offeredBy: null, cooldown: { N: 3 } });
    for (let move = 1; move <= DRAW_REOFFER_MOVES; move++) {
      expect(drawOfferBlock(state, 'N', onTurn('N'))).toBe('cooldown');
      state = afterBoardMove(afterBoardMove(state, 'N'), 'S');
    }
    expect(state).toEqual(NO_DRAW_OFFER);
    expect(drawOfferBlock(state, 'N', onTurn('N'))).toBeNull();
    // The opponent was never rejected, so it could offer at any of its own turns.
    expect(drawOfferBlock({ offeredBy: null, cooldown: { N: 2 } }, 'S', onTurn('S'))).toBeNull();
  });

  it('should let either player resign at any time, closing an open offer', () => {
    const offered = apply(NO_DRAW_OFFER, 'N', { type: 'offer-draw' }, 'N').state;
    expect(apply(offered, 'S', { type: 'resign' }, 'N'))
      .toEqual({ state: { offeredBy: null, cooldown: {} }, effect: { kind: 'resigned', seat: 'S' } });
    expect(applyMatchControl(NO_DRAW_OFFER, 'E', { type: 'resign' }, RULES, onTurn('N'))).toMatch(/Only players/);
    expect(applyMatchControl(NO_DRAW_OFFER, 'N', { type: 'resign' }, { resign: false, draw: true }, onTurn('N')))
      .toMatch(/no resignation/);
    expect(resignationOutcome('S', SEATS)).toEqual({ winners: ['N'], reason: 'resign' });
  });

  it('should not mutate the state it was given', () => {
    const state: DrawOfferState = Object.freeze({ offeredBy: 'N', cooldown: Object.freeze({ S: 1 }) });
    expect(afterBoardMove(state, 'S')).toEqual({ offeredBy: null, cooldown: { N: 3 } });
    expect(state).toEqual({ offeredBy: 'N', cooldown: { S: 1 } });
  });

  it('should validate restored offer state and outcomes', () => {
    expect(isDrawOfferState({ offeredBy: null, cooldown: {} }, SEATS)).toBe(true);
    expect(isDrawOfferState({ offeredBy: 'S', cooldown: { N: 3 } }, SEATS)).toBe(true);
    expect(isDrawOfferState({ offeredBy: 'E', cooldown: {} }, SEATS)).toBe(false);
    expect(isDrawOfferState({ offeredBy: null, cooldown: { N: 4 } }, SEATS)).toBe(false);
    expect(isDrawOfferState({ offeredBy: null, cooldown: { N: 0 } }, SEATS)).toBe(false);
    expect(isDrawOfferState({ offeredBy: null }, SEATS)).toBe(false);
    expect(isBoardOutcome({ winners: [], reason: 'agreed-draw' }, SEATS)).toBe(true);
    expect(isBoardOutcome({ winners: ['N'], reason: 'checkmate' }, SEATS)).toBe(true);
    expect(isBoardOutcome({ winners: ['N', 'N'], reason: 'checkmate' }, SEATS)).toBe(false);
    expect(isBoardOutcome({ winners: ['E'], reason: 'checkmate' }, SEATS)).toBe(false);
    expect(isBoardOutcome({ winners: [], reason: 'bored' }, SEATS)).toBe(false);
  });
});

describe('move records', () => {
  it('should format coordinate notation for moves, captures, jumps, placements and passes', () => {
    const notation = coordinateNotation(gomokuBoard());
    expect(notation({ seat: 'N', to: '7,7' }, 'en')).toBe('h8');
    expect(notation({ seat: 'N' }, 'en')).toBeNull();
    const xiangqi = coordinateNotation(xiangqiBoard());
    expect(xiangqi({ seat: 'N', from: '0,9', to: '0,8' }, 'zh-TW')).toBe('a1-a2');
    expect(xiangqi({ seat: 'N', from: '0,9', to: '0,0', capture: true }, 'en')).toBe('a1xa10');
    expect(xiangqi({ seat: 'N', from: '0,9', path: ['2,9'], to: '4,9' }, 'en')).toBe('a1-c1-e1');
  });

  it('should let a game supply its own notation from public move facts', () => {
    interface PieceMove extends BoardMoveRecord { readonly piece: string }
    const notation = (move: PieceMove, locale: 'en' | 'zh-TW'): string | null =>
      locale === 'zh-TW' ? `${move.piece}${move.to}` : `${move.piece.toUpperCase()}${move.to}`;
    expect(notation({ seat: 'S', piece: 'r', to: '1,1' }, 'en')).toBe('R1,1');
  });

  it('should group moves into rows by seat and keep a column empty when the second seat starts', () => {
    const moves: BoardMoveRecord[] = [{ seat: 'S', to: 'a' }, { seat: 'N', to: 'b' }, { seat: 'S', to: 'c' }];
    expect(moveRows(moves, ['N', 'S']).map((row) => row.map((move) => move?.to ?? null)))
      .toEqual([[null, 'a'], ['b', 'c']]);
    expect(moveRows(moves, ['S', 'N']).map((row) => row.map((move) => move?.to ?? null)))
      .toEqual([['a', 'b'], ['c', null]]);
    expect(moveRows([], ['N', 'S'])).toEqual([]);
  });
});
