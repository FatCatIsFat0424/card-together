// ─── Pure view helpers for the Code Breaker table ───

import type { CodeBreakerGuess, CodeBreakerVisibleState, GameSeat } from '@shared/types';
import { CB_MAX_GUESSES, CB_SLOTS, cbSymbolCount } from '@shared/rules/codebreaker';
import type { CbCode, CbVariant } from '@shared/rules/codebreaker';

/** What the viewer's seat must do and has done, read from the filtered view alone. */
export interface CodeBreakerSeatView {
  readonly used: number;
  readonly solved: boolean;
  /** The seat took its last guess without cracking the code */
  readonly outOfGuesses: boolean;
  readonly submitted: boolean;
  /** The seat is in the match and still owes a guess this round */
  readonly owes: boolean;
}

export function seatView(game: CodeBreakerVisibleState, seat: GameSeat): CodeBreakerSeatView | null {
  const progress = game.progress[seat];
  if (!progress) return null;
  const outOfGuesses = !progress.solved && progress.used >= CB_MAX_GUESSES;
  return {
    used: progress.used,
    solved: progress.solved,
    outOfGuesses,
    submitted: progress.submitted,
    owes: game.phase === 'playing' && !progress.solved && !outOfGuesses && !progress.submitted,
  };
}

/** The viewer is a seated player who must still submit a guess this round. */
export function codeBreakerNeedsGuess(game: CodeBreakerVisibleState): boolean {
  return game.observer !== 'spectator' && seatView(game, game.mySeat)?.owes === true;
}

/** Seats other than the viewer's that must still guess before the round resolves. */
export function seatsStillGuessing(game: CodeBreakerVisibleState): number {
  return game.seats.filter((seat) => seatView(game, seat)?.owes).length;
}

/** A guess being built: one symbol per slot, and the slot the next symbol goes to. */
export interface CodeDraft {
  readonly slots: readonly (number | null)[];
  readonly cursor: number;
}

export const EMPTY_DRAFT: CodeDraft = { slots: Array.from({ length: CB_SLOTS }, () => null), cursor: 0 };

/** The symbols a variant offers, in pad order. */
export function padSymbols(variant: CbVariant): number[] {
  return Array.from({ length: cbSymbolCount(variant) }, (_, symbol) => symbol);
}

/** Digits may not repeat, so a digit already in another slot cannot be placed again. */
export function symbolTaken(draft: CodeDraft, symbol: number, variant: CbVariant): boolean {
  return variant === 'digits' && draft.slots.some((value, slot) => value === symbol && slot !== draft.cursor);
}

function nextEmpty(slots: readonly (number | null)[], from: number): number | null {
  for (let step = 1; step <= slots.length; step++) {
    const slot = (from + step) % slots.length;
    if (slots[slot] === null) return slot;
  }
  return null;
}

/** Puts a symbol in the selected slot and moves on to the next empty one; a repeated digit changes nothing. */
export function placeSymbol(draft: CodeDraft, symbol: number, variant: CbVariant): CodeDraft {
  if (symbolTaken(draft, symbol, variant)) return draft;
  const slots = draft.slots.map((value, slot) => (slot === draft.cursor ? symbol : value));
  return { slots, cursor: nextEmpty(slots, draft.cursor) ?? draft.cursor };
}

export function selectSlot(draft: CodeDraft, slot: number): CodeDraft {
  return slot >= 0 && slot < draft.slots.length ? { ...draft, cursor: slot } : draft;
}

/** Empties the selected slot, or the last filled one when the selected slot is already empty. */
export function backspace(draft: CodeDraft): CodeDraft {
  const target = draft.slots[draft.cursor] !== null ? draft.cursor
    : draft.slots.reduce<number>((last, value, slot) => (value !== null ? slot : last), -1);
  if (target < 0) return draft;
  return { slots: draft.slots.map((value, slot) => (slot === target ? null : value)), cursor: target };
}

/** The finished code, or null while any slot is empty. */
export function draftCode(draft: CodeDraft): CbCode | null {
  return draft.slots.every((value) => value !== null) ? draft.slots as number[] : null;
}

/** Newest guess last, as the history lists them. */
export function viewedHistory(game: CodeBreakerVisibleState, seat: GameSeat): readonly CodeBreakerGuess[] {
  return game.histories[seat] ?? [];
}
