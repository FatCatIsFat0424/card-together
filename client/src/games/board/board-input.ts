// ─── Board input: select a piece, choose a target, and confirm on touch screens ───

import type { NodeId } from '@shared/rules/board/board-model';
import type { CardInput } from '../../components/card-hand-touch';

/** A chosen move: `from` is absent for placements (Gomoku, Reversi). */
export interface BoardChoice {
  readonly from?: NodeId;
  readonly to: NodeId;
}

export interface BoardInputState {
  readonly selected: NodeId | null;
  /** Move shown on the board and in the 「待確認」 line until the player confirms it. */
  readonly pending: BoardChoice | null;
}

export const IDLE_BOARD_INPUT: BoardInputState = { selected: null, pending: null };

export interface BoardInputRules {
  /** Pieces the player may select: own pieces with at least one legal move. */
  readonly movable: readonly NodeId[];
  /**
   * Legal destinations of a selected piece; with `null`, nodes chosen by a single tap without a selection:
   * Gomoku and Reversi placements, or flipping a covered Banqi piece.
   */
  readonly targets: (from: NodeId | null) => readonly NodeId[];
}

export interface BoardTapResult {
  readonly state: BoardInputState;
  /** A move to send now. */
  readonly submit: BoardChoice | null;
}

/**
 * Touch defaults to select-then-confirm because phone targets are smaller than a fingertip; the 「一點即走」
 * setting skips it. Mouse, pen, and keyboard are precise, so they always move on the first choice.
 */
export function confirmsMove(input: CardInput, oneTap: boolean): boolean {
  return input === 'touch' && !oneTap;
}

function choose(choice: BoardChoice, confirm: boolean, state: BoardInputState): BoardTapResult {
  const same = state.pending?.to === choice.to && state.pending.from === choice.from;
  // A second tap on the pending destination confirms it, like the second tap on a lifted card.
  if (!confirm || same) return { state: IDLE_BOARD_INPUT, submit: choice };
  return { state: { selected: choice.from ?? null, pending: choice }, submit: null };
}

/** Next input state after a tap on `node`, or on the board outside any node (`null`). */
export function tapBoard(
  state: BoardInputState, node: NodeId | null, rules: BoardInputRules, confirm: boolean,
): BoardTapResult {
  const idle = { state: IDLE_BOARD_INPUT, submit: null };
  if (node === null) return idle;
  const from = state.selected;
  if (from !== null && node !== from && rules.targets(from).includes(node)) {
    return choose({ from, to: node }, confirm, state);
  }
  if (node === from && state.pending === null) return idle;
  if (rules.movable.includes(node)) return { state: { selected: node, pending: null }, submit: null };
  if (rules.targets(null).includes(node)) return choose({ to: node }, confirm, state);
  // A stray tap drops a pending move back to its selection, and a selection back to nothing.
  return state.pending?.from ? { state: { selected: state.pending.from, pending: null }, submit: null } : idle;
}

export function confirmBoardInput(state: BoardInputState): BoardTapResult {
  return { state: IDLE_BOARD_INPUT, submit: state.pending };
}

/** Drops a selection or pending move that is no longer legal, e.g. after a new snapshot or the turn passing. */
export function validBoardInput(state: BoardInputState, rules: BoardInputRules, active: boolean): BoardInputState {
  if (!active) return state.selected === null && state.pending === null ? state : IDLE_BOARD_INPUT;
  const selected = state.selected !== null && rules.movable.includes(state.selected) ? state.selected : null;
  const from = state.pending?.from ?? null;
  const pending = state.pending && from === selected && rules.targets(from).includes(state.pending.to) ? state.pending : null;
  return selected === state.selected && pending === state.pending ? state : { selected, pending };
}
