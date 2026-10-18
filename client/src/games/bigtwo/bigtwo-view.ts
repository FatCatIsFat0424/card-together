// ─── Pure Big Two view helpers (no React) ───

import { identifyCombo } from '@shared/rules/bigtwo';
import type { BigTwoCombo, BigTwoComboType } from '@shared/rules/bigtwo';
import type { BigTwoLogEntry, BigTwoPlay, Card, GameSeat } from '@shared/types';
import type { GameTranslationKey } from '../../game-i18n';
import type { HistoryRound } from '../round-history';

export function comboLabelKey(type: BigTwoComboType): GameTranslationKey {
  return `bigtwo.combo.${type}`;
}

export function sameCard(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

/** Adds the card to the selection, or removes it if already selected. */
export function toggleCard(selection: readonly Card[], card: Card): Card[] {
  return selection.some((c) => sameCard(c, card))
    ? selection.filter((c) => !sameCard(c, card)) : [...selection, card];
}

export type BigTwoRoundEntry = Extract<BigTwoLogEntry, { type: 'play' | 'pass' }>;

/** Log entries since the last round end (plays and passes of the current round). */
export function currentRoundEntries(log: readonly BigTwoLogEntry[]): BigTwoRoundEntry[] {
  let start = 0;
  log.forEach((entry, index) => { if (entry.type === 'round_end') start = index + 1; });
  return log.slice(start).filter((entry): entry is BigTwoRoundEntry =>
    entry.type === 'play' || entry.type === 'pass');
}

export function lastPlayCombo(lastPlay: BigTwoPlay | null): BigTwoCombo | null {
  return lastPlay ? identifyCombo(lastPlay.cards) : null;
}

const SUPERSCRIPTS = ['⁰', '¹', '²', '³', '⁴'];

/** Penalty formula text, e.g. `5 × 2² = 20`. */
export function penaltyFormula(cardsLeft: number, twosLeft: number, score: number): string {
  return `${cardsLeft} × 2${SUPERSCRIPTS[twosLeft] ?? `^${twosLeft}`} = ${score}`;
}

export interface BigTwoRoundSummary {
  /** Combo type of the round's opening play; rows name their own type only when a bomb changes it */
  readonly leadCombo: BigTwoComboType | null;
  /** Seat that took the lead, or won the match, when the round ended; null while it is in progress */
  readonly winnerSeat: GameSeat | null;
  /** Index in the round's actions of the play or dragon that won it, or -1 */
  readonly winningIndex: number;
}

export function summarizeBigTwoRound(round: HistoryRound): BigTwoRoundSummary {
  const leadCombo = round.actions.find((action) => action.kind === 'play')?.comboType ?? null;
  if (!round.complete) return { leadCombo, winnerSeat: null, winningIndex: -1 };
  let lastIndex = -1;
  round.actions.forEach((action, index) => {
    if (action.kind === 'play' || action.kind === 'dragon') lastIndex = index;
  });
  // A round that ends the match has no round_end entry; its last play wins it.
  const winnerSeat = round.actions.find((action) => action.kind === 'round_end')?.seat
    ?? round.actions[lastIndex]?.seat ?? null;
  return { leadCombo, winnerSeat,
    winningIndex: lastIndex >= 0 && round.actions[lastIndex].seat === winnerSeat ? lastIndex : -1 };
}
