import type { Card } from '@shared/types';
import { STUD_FINAL_STREET } from '@shared/rules/stud';
import { cardId, evaluateIds } from './holdem-evaluator';

/** An unfolded opponent as the bot sees it: the up cards on the table; the hole card is unknown. */
export interface StudOpponent {
  readonly up: readonly Card[];
}

export interface StudEquityRequest {
  /** The bot's own hole card plus every up card of its own */
  readonly own: readonly Card[];
  readonly opponents: readonly StudOpponent[];
  /** Every up card on the table, folded seats included, which the opponents' holdings cannot repeat */
  readonly visible: readonly Card[];
  readonly random: () => number;
  readonly runs?: number;
}

const DEFAULT_RUNS = 200;

/** Partial Fisher-Yates step: moves a uniformly chosen card from `pool[from..]` to `pool[from]`. */
function drawInto(pool: Int8Array, from: number, random: () => number): number {
  const pick = from + Math.floor(random() * (pool.length - from));
  const held = pool[from];
  pool[from] = pool[pick];
  pool[pick] = held;
  return pool[from];
}

/**
 * Chance of winning the pot (ties split) when every hand is dealt out to five cards. Opponents hold
 * a random hole card from the cards the bot cannot see, plus the up cards they show now.
 */
export function studEquity(request: StudEquityRequest): number {
  const { opponents, random } = request;
  if (opponents.length === 0) return 1;
  const seen = new Set([...request.own, ...request.visible].map(cardId));
  const ids: number[] = [];
  for (let id = 0; id < 52; id++) if (!seen.has(id)) ids.push(id);
  const pool = Int8Array.from(ids);
  const own = request.own.map(cardId);
  const shown = opponents.map((opponent) => opponent.up.map(cardId));
  const runs = request.runs ?? DEFAULT_RUNS;
  const mine = new Array<number>(STUD_FINAL_STREET).fill(0);
  const theirs = new Array<number>(STUD_FINAL_STREET).fill(0);
  let won = 0;
  for (let run = 0; run < runs; run++) {
    let next = 0;
    for (let index = 0; index < own.length; index++) mine[index] = own[index];
    for (let index = own.length; index < STUD_FINAL_STREET; index++) mine[index] = drawInto(pool, next++, random);
    const score = evaluateIds(mine, STUD_FINAL_STREET);
    let lost = false;
    let ties = 0;
    for (const up of shown) {
      theirs[0] = drawInto(pool, next++, random);
      for (let index = 0; index < up.length; index++) theirs[index + 1] = up[index];
      for (let index = up.length + 1; index < STUD_FINAL_STREET; index++) theirs[index] = drawInto(pool, next++, random);
      const other = evaluateIds(theirs, STUD_FINAL_STREET);
      if (other > score) lost = true;
      else if (other === score) ties += 1;
    }
    if (!lost) won += 1 / (ties + 1);
  }
  return won / runs;
}
