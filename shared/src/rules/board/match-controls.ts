// ─── Resign and draw offers: generic match-control actions that board games opt into ───

import type { GameSeat } from '../../types/player';

export type MatchControlAction =
  | { readonly type: 'resign' }
  | { readonly type: 'offer-draw' }
  | { readonly type: 'answer-draw'; readonly accept: boolean };

/** Which controls a game accepts; declared on its shared definition (`GameDefinition.matchControls`). */
export interface MatchControlRules {
  readonly resign: boolean;
  /** Draw offers; only ever available while exactly two seats play. */
  readonly draw: boolean;
}

/** Own moves an offerer must make after a rejection before offering again. */
export const DRAW_REOFFER_MOVES = 3;

/** Part of a board game's server and visible state; it holds no hidden information. */
export interface DrawOfferState {
  /** Seat whose offer awaits the opponent's answer. */
  readonly offeredBy: GameSeat | null;
  /** Own moves each seat must still make before it may offer again; absent seats may offer. */
  readonly cooldown: Readonly<Partial<Record<GameSeat, number>>>;
}

export const NO_DRAW_OFFER: DrawOfferState = { offeredBy: null, cooldown: {} };

export interface MatchControlContext {
  /** Seats still playing the match, in play order. */
  readonly seats: readonly GameSeat[];
  /** Seat to move, or null between turns. */
  readonly turnSeat: GameSeat | null;
}

/** Why a seat cannot offer a draw right now; the client disables the button with the matching hint. */
export type DrawOfferBlock = 'unavailable' | 'not-your-turn' | 'pending' | 'cooldown';

/** Applied control: a resignation or an accepted draw ends play, which the game turns into its result. */
export type MatchControlEffect =
  | { readonly kind: 'resigned'; readonly seat: GameSeat }
  | { readonly kind: 'agreed-draw' }
  | null;

/**
 * Reads a match-control action from untrusted input, or returns null when the payload is not one, so a game's
 * parser can fall back to its own actions. Controls the game did not opt into are rejected with a reason.
 */
export function parseMatchControl(value: unknown, rules: MatchControlRules | undefined): MatchControlAction | string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  // Unknown fields are dropped: the result is rebuilt from the known ones only.
  switch (record.type) {
    case 'resign':
      return rules?.resign ? { type: 'resign' } : 'This game has no resignation.';
    case 'offer-draw':
      return rules?.draw ? { type: 'offer-draw' } : 'This game has no draw offers.';
    case 'answer-draw':
      if (!rules?.draw) return 'This game has no draw offers.';
      return typeof record.accept === 'boolean' ? { type: 'answer-draw', accept: record.accept } : 'Invalid draw answer.';
    default:
      return null;
  }
}

export function isMatchControl(action: { readonly type: string }): action is MatchControlAction {
  return action.type === 'resign' || action.type === 'offer-draw' || action.type === 'answer-draw';
}

/** Null when `seat` may offer a draw now: two-player match, own turn, no open offer, no cooldown left. */
export function drawOfferBlock(
  state: DrawOfferState, seat: GameSeat, context: MatchControlContext, rules?: MatchControlRules,
): DrawOfferBlock | null {
  if ((rules && !rules.draw) || context.seats.length !== 2 || !context.seats.includes(seat)) return 'unavailable';
  if (state.offeredBy !== null) return 'pending';
  if (context.turnSeat !== seat) return 'not-your-turn';
  return (state.cooldown[seat] ?? 0) > 0 ? 'cooldown' : null;
}

const BLOCK_REASONS: Record<DrawOfferBlock, string> = {
  unavailable: 'Draw offers are only available in two-player matches.',
  'not-your-turn': 'Offer a draw on your own turn.',
  pending: 'A draw offer is already waiting for an answer.',
  cooldown: `Make ${DRAW_REOFFER_MOVES} more moves before offering a draw again.`,
};

/** Whether `seat` can answer the open offer: only the offerer's opponent can. */
export function canAnswerDraw(state: DrawOfferState, seat: GameSeat, context: MatchControlContext): boolean {
  return state.offeredBy !== null && state.offeredBy !== seat && context.seats.includes(seat);
}

function rejected(state: DrawOfferState): DrawOfferState {
  return state.offeredBy === null ? state
    : { offeredBy: null, cooldown: { ...state.cooldown, [state.offeredBy]: DRAW_REOFFER_MOVES } };
}

/**
 * Call after every committed move by `seat`. The opponent of an open offer moving instead of answering
 * rejects it; the mover's own cooldown counts down by one move.
 */
export function afterBoardMove(state: DrawOfferState, seat: GameSeat): DrawOfferState {
  const next = state.offeredBy !== null && state.offeredBy !== seat ? rejected(state) : state;
  const left = next.cooldown[seat] ?? 0;
  if (left <= 0) return next;
  const cooldown = { ...next.cooldown };
  if (left > 1) cooldown[seat] = left - 1;
  else delete cooldown[seat];
  return { ...next, cooldown };
}

/**
 * Applies a control for `seat`. Resigning is allowed at any time during play; offers follow `drawOfferBlock`
 * and answers `canAnswerDraw`. None of them move the turn or its clock, so adapters apply them without the
 * timed or presented action wrappers. Returns an English reason when the control is not allowed.
 */
export function applyMatchControl(
  state: DrawOfferState, seat: GameSeat, action: MatchControlAction, rules: MatchControlRules,
  context: MatchControlContext,
): { readonly state: DrawOfferState; readonly effect: MatchControlEffect } | string {
  if (!context.seats.includes(seat)) return 'Only players in this match can do that.';
  switch (action.type) {
    case 'resign':
      return rules.resign ? { state: { ...state, offeredBy: null }, effect: { kind: 'resigned', seat } }
        : 'This game has no resignation.';
    case 'offer-draw': {
      const block = drawOfferBlock(state, seat, context, rules);
      return block ? BLOCK_REASONS[block] : { state: { ...state, offeredBy: seat }, effect: null };
    }
    case 'answer-draw':
      if (!rules.draw || !canAnswerDraw(state, seat, context)) return 'There is no draw offer to answer.';
      return action.accept ? { state: { ...state, offeredBy: null }, effect: { kind: 'agreed-draw' } }
        : { state: rejected(state), effect: null };
  }
}

/** Shape check for persisted and restored state. */
export function isDrawOfferState(value: unknown, seats: readonly GameSeat[]): value is DrawOfferState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const cooldown = record.cooldown;
  return Object.keys(record).length === 2
    && (record.offeredBy === null || seats.includes(record.offeredBy as GameSeat))
    && typeof cooldown === 'object' && cooldown !== null && !Array.isArray(cooldown)
    && Object.entries(cooldown).every(([seat, moves]) => seats.includes(seat as GameSeat)
      && Number.isInteger(moves) && (moves as number) >= 1 && (moves as number) <= DRAW_REOFFER_MOVES);
}
