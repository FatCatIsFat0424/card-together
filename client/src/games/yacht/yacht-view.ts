// ─── Yacht Dice view helpers: whose dice are on show, what the viewer may do, and cell states (no React) ───

import { YACHT_MAX_ROLLS, yachtPotentials, yachtTotals } from '@shared/rules/yacht';
import type { YachtBox, YachtScorecard } from '@shared/rules/yacht';
import type { GameSeat } from '@shared/types';
import type { YachtTurn, YachtVisibleState } from '@shared/games/yacht/types';
import type { TranslationKey } from '../../i18n';
import { isSpectator } from '../observer-view';

export const YACHT_ROUNDS_TOTAL = 13;

export const boxLabel = (box: YachtBox): TranslationKey => `yacht.box.${box}`;
export const boxShortLabel = (box: YachtBox): TranslationKey => `yacht.short.${box}`;

/** Turn mode shows the dice of the seat that rolls (or rolled last); simultaneous mode shows the viewed seat's own. */
export function diceSeat(game: YachtVisibleState): GameSeat {
  if (game.options.mode === 'simultaneous') return game.mySeat;
  return game.currentTurnSeat ?? game.log.at(-1)?.seat ?? game.mySeat;
}

/** The seat the scorecard shows potential scores for. */
export function potentialSeat(game: YachtVisibleState): GameSeat | null {
  if (game.phase !== 'playing') return null;
  return game.options.mode === 'simultaneous' ? game.mySeat : game.currentTurnSeat;
}

export interface YachtActor {
  readonly seat: GameSeat;
  readonly turn: YachtTurn;
  readonly card: YachtScorecard;
}

/** The viewer's own open turn, when they may act on it now. */
export function ownTurn(game: YachtVisibleState): YachtActor | null {
  if (game.phase !== 'playing' || isSpectator(game) || !game.seats.includes(game.mySeat)) return null;
  const turn = game.turns[game.mySeat];
  const card = game.cards[game.mySeat];
  if (!turn || !card || turn.done) return null;
  if (game.options.mode === 'turns' && game.currentTurnSeat !== game.mySeat) return null;
  return { seat: game.mySeat, turn, card };
}

export type YachtRowState = 'active' | 'rolling' | 'scored' | 'waiting';

export function rowState(game: YachtVisibleState, seat: GameSeat): YachtRowState {
  if (game.phase !== 'playing') return 'waiting';
  const turn = game.turns[seat];
  if (game.options.mode === 'turns') {
    if (game.currentTurnSeat === seat) return 'active';
    return turn?.done ? 'scored' : 'waiting';
  }
  if (turn?.done) return 'scored';
  return turn && turn.rolls > 0 ? 'rolling' : 'waiting';
}

export interface YachtCell {
  readonly box: YachtBox;
  /** The score written into the box */
  readonly score: number | null;
  /** What the current dice would score there, when the dice may go into it */
  readonly potential: number | null;
}

/** One seat's boxes in column order, with the potential scores of dice that are on the table. */
export function seatCells(game: YachtVisibleState, seat: GameSeat, boxes: readonly YachtBox[]): YachtCell[] {
  const card = game.cards[seat];
  const turn = game.turns[seat];
  const showing = potentialSeat(game) === seat && card && turn && turn.rolls > 0 && !turn.done;
  const potentials = showing ? yachtPotentials(card, turn.dice) : {};
  return boxes.map((box) => ({ box, score: card?.boxes[box] ?? null, potential: potentials[box] ?? null }));
}

export interface YachtPickerCell {
  readonly box: YachtBox;
  /** `open` boxes can take the dice, `used` ones already hold a score, `blocked` ones are ruled out by the joker rule */
  readonly state: 'open' | 'used' | 'blocked';
  /** The score written into a used box, or what the dice would score in an open one */
  readonly value: number | null;
}

/** The viewer's 13 boxes in column order for the box picker. */
export function pickerCells(
  card: YachtScorecard, potentials: Partial<Record<YachtBox, number>>, boxes: readonly YachtBox[],
): YachtPickerCell[] {
  return boxes.map((box): YachtPickerCell => {
    const score = card.boxes[box];
    if (score !== undefined) return { box, state: 'used', value: score };
    const potential = potentials[box];
    return potential === undefined ? { box, state: 'blocked', value: null } : { box, state: 'open', value: potential };
  });
}

export function seatTotals(game: YachtVisibleState, seat: GameSeat): ReturnType<typeof yachtTotals> {
  const card = game.cards[seat];
  return card ? yachtTotals(card) : { upper: 0, upperBonus: 0, lower: 0, extra: 0, total: 0 };
}

/** Rolls the viewer still has this turn. */
export function rollsLeft(turn: YachtTurn): number {
  return YACHT_MAX_ROLLS - turn.rolls;
}

/** Dice by position that rolled in the latest roll, given the mask the roll kept. */
export function rerolled(turn: YachtTurn): boolean[] {
  return turn.dice.map((_die, index) => turn.rolls === 1 || !turn.held[index]);
}

/** Entries the info rail lists, newest first. */
export function recentScores(game: Pick<YachtVisibleState, 'log'>, limit: number): YachtVisibleState['log'][number][] {
  return game.log.slice(-limit).reverse();
}
