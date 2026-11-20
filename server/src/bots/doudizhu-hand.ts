import type { CardOrJoker } from '@shared/types';
import { ddzBeats, ddzPower } from '@shared/rules/doudizhu';
import type { DdzCombo, DdzComboType } from '@shared/rules/doudizhu';

// Rank-count hands for the Dou Dizhu bot. Suits never matter in play, so a hand is 15 counts (3 up to the ace,
// the 2, the small and the big joker) and a move is the rank of each card it uses. Search, rollouts, and the
// endgame solver all work on counts; real cards are picked only for the move that is finally played.

/** Rank indexes: power - 3. */
export const RANKS = 15;
export const TWO = 12;
export const SMALL_JOKER = 13;
export const BIG_JOKER = 14;
/** Highest rank a chain may reach (the ace). */
const CHAIN_TOP = 11;

export type Counts = Uint8Array;

/** A play on rank counts: `ranks` holds one rank index per card. */
export interface RankMove {
  readonly combo: DdzCombo;
  readonly ranks: readonly number[];
}

/** How many kicker choices move generation lists: every distinct choice, or only the cheapest. */
export type KickerMode = 'all' | 'cheap';

export const rankOf = (card: CardOrJoker): number => ddzPower(card) - 3;

export function toCounts(cards: readonly CardOrJoker[]): Counts {
  const counts = new Uint8Array(RANKS);
  for (const card of cards) counts[rankOf(card)] += 1;
  return counts;
}

export function cardTotal(counts: Counts): number {
  let total = 0;
  for (let rank = 0; rank < RANKS; rank++) total += counts[rank];
  return total;
}

/** A unique number for a hand (base 5, below 2^53). */
export function countCode(counts: Counts): number {
  let code = 0;
  let factor = 1;
  for (let rank = 0; rank < RANKS; rank++) {
    code += counts[rank] * factor;
    factor *= 5;
  }
  return code;
}

export function removeMove(counts: Counts, move: RankMove): void {
  for (const rank of move.ranks) counts[rank] -= 1;
}

export function restoreMove(counts: Counts, move: RankMove): void {
  for (const rank of move.ranks) counts[rank] += 1;
}

export function isBombMove(move: RankMove): boolean {
  return move.combo.type === 'bomb' || move.combo.type === 'rocket';
}

/** Picks real cards from `hand` for a rank move; null when the hand lacks a rank. */
export function cardsFor(hand: readonly CardOrJoker[], move: RankMove): CardOrJoker[] | null {
  const pools = new Map<number, CardOrJoker[]>();
  for (const card of hand) {
    const rank = rankOf(card);
    const list = pools.get(rank);
    if (list) list.push(card);
    else pools.set(rank, [card]);
  }
  const picked: CardOrJoker[] = [];
  for (const rank of move.ranks) {
    const card = pools.get(rank)?.shift();
    if (!card) return null;
    picked.push(card);
  }
  return picked;
}

// ─── Move generation ───

function combo(type: DdzComboType, rank: number, length: number, size: number): DdzCombo {
  return { type, power: rank + 3, length, size };
}

/**
 * Kicker sets of `need` units (single cards, or pairs when `unit` is 2) from `rest`, as rank lists. A unit
 * rank may repeat while counts allow. Never both jokers (that is a rocket), never three or more cards of one
 * rank (that reads as another triple), never `excluded`. `cheap` keeps only the set a planner would choose:
 * loose cards before broken groups, low before high.
 */
function kickerSets(
  rest: Counts, unit: 1 | 2, need: number, excluded: number, mode: KickerMode, limit: number,
): number[][] {
  if (mode === 'cheap') {
    const order: number[] = [];
    for (let rank = 0; rank < RANKS; rank++) {
      if (rank === excluded || rest[rank] < unit || (unit === 2 && rank >= SMALL_JOKER)) continue;
      order.push(rank);
    }
    // Loose units first (a single for a single, a pair for a pair), then the lowest rank.
    order.sort((a, b) => (rest[a] === unit ? 0 : 1) - (rest[b] === unit ? 0 : 1) || a - b);
    const taken: number[] = [];
    let units = 0;
    for (const rank of order) {
      if (units === need) break;
      if (unit === 1 && rank >= SMALL_JOKER && taken.some((other) => other >= SMALL_JOKER)) continue;
      // One card of a rank at a time; a second card of it only when nothing else is left.
      const use = Math.min(unit === 1 ? 1 : Math.floor(rest[rank] / 2), need - units);
      for (let index = 0; index < use; index++) {
        for (let card = 0; card < unit; card++) taken.push(rank);
        units += 1;
      }
    }
    if (units < need && unit === 1) {
      for (const rank of order) {
        if (units === need) break;
        if (rest[rank] >= 2 && taken.filter((other) => other === rank).length === 1 && rank < SMALL_JOKER) {
          taken.push(rank);
          units += 1;
        }
      }
    }
    return units === need ? [taken.sort((a, b) => a - b)] : [];
  }
  const result: number[][] = [];
  const chosen: number[] = [];
  const walk = (from: number, units: number): void => {
    if (result.length >= limit) return;
    if (units === need) {
      result.push([...chosen]);
      return;
    }
    for (let rank = from; rank < RANKS; rank++) {
      if (rank === excluded || (unit === 2 && rank >= SMALL_JOKER)) continue;
      const used = chosen.filter((other) => other === rank).length;
      if (rest[rank] - used < unit) continue;
      if (unit === 1 && used >= 2) continue;
      if (unit === 2 && used >= 2) continue;
      if (unit === 1 && rank === BIG_JOKER && chosen.includes(SMALL_JOKER)) continue;
      for (let card = 0; card < unit; card++) chosen.push(rank);
      walk(rank, units + 1);
      for (let card = 0; card < unit; card++) chosen.pop();
    }
  };
  walk(0, 0);
  return result;
}

/** Kicker sets listed per main group at most, so a long airplane cannot flood the candidate list. */
const KICKER_LIMIT = 48;

/**
 * Every play from `counts` that is legal after `previous` (any play when leading). With `cheap` kickers
 * each main group appears once with the kickers a planner would add; with `all` every kicker choice is
 * listed, up to a cap per main group.
 */
export function rankMoves(counts: Counts, previous: DdzCombo | null, mode: KickerMode = 'cheap'): RankMove[] {
  const moves: RankMove[] = [];
  if (previous?.type === 'rocket') return moves;
  const want = previous && previous.type !== 'bomb' ? previous.type : null;
  const allows = (type: DdzComboType): boolean => previous === null || want === type;
  const push = (next: DdzCombo, ranks: number[]): void => {
    if (previous === null || ddzBeats(next, previous)) moves.push({ combo: next, ranks });
  };
  const above = previous && want ? previous.power - 3 : -1;
  const from = previous && want ? above + 1 : 0;

  if (allows('single')) for (let rank = from; rank < RANKS; rank++) if (counts[rank] >= 1) push(combo('single', rank, 1, 1), [rank]);
  if (allows('pair')) for (let rank = from; rank < SMALL_JOKER; rank++) if (counts[rank] >= 2) push(combo('pair', rank, 1, 2), [rank, rank]);
  if (allows('triple')) for (let rank = from; rank <= TWO; rank++) if (counts[rank] >= 3) push(combo('triple', rank, 1, 3), [rank, rank, rank]);
  if (allows('tripleSingle') || allows('triplePair')) {
    for (let rank = from; rank <= TWO; rank++) {
      if (counts[rank] < 3) continue;
      counts[rank] -= 3;
      if (allows('tripleSingle')) {
        for (const kick of kickerSets(counts, 1, 1, rank, mode, KICKER_LIMIT)) {
          push(combo('tripleSingle', rank, 1, 4), [rank, rank, rank, ...kick]);
        }
      }
      if (allows('triplePair')) {
        for (const kick of kickerSets(counts, 2, 1, rank, mode, KICKER_LIMIT)) {
          push(combo('triplePair', rank, 1, 5), [rank, rank, rank, ...kick]);
        }
      }
      counts[rank] += 3;
    }
  }
  if (allows('fourSingles') || allows('fourPairs')) {
    for (let rank = from; rank <= TWO; rank++) {
      if (counts[rank] !== 4) continue;
      counts[rank] = 0;
      if (allows('fourSingles')) {
        for (const kick of kickerSets(counts, 1, 2, rank, mode, KICKER_LIMIT)) {
          push(combo('fourSingles', rank, 1, 6), [rank, rank, rank, rank, ...kick]);
        }
      }
      if (allows('fourPairs')) {
        for (const kick of kickerSets(counts, 2, 2, rank, mode, KICKER_LIMIT)) {
          push(combo('fourPairs', rank, 1, 8), [rank, rank, rank, rank, ...kick]);
        }
      }
      counts[rank] = 4;
    }
  }
  const chains = (type: DdzComboType, per: number, minimum: number): void => {
    if (!allows(type)) return;
    const fixed = want === type ? previous!.length : 0;
    for (let start = from; start <= CHAIN_TOP; start++) {
      let end = start;
      while (end <= CHAIN_TOP && counts[end] >= per) end++;
      for (let length = Math.max(minimum, fixed); length <= end - start && (fixed === 0 || length === fixed); length++) {
        const ranks: number[] = [];
        for (let rank = start; rank < start + length; rank++) for (let card = 0; card < per; card++) ranks.push(rank);
        push(combo(type, start, length, ranks.length), ranks);
      }
    }
  };
  chains('straight', 1, 5);
  chains('pairStraight', 2, 3);
  chains('airplane', 3, 2);
  for (const type of ['airplaneSingle', 'airplanePair'] as const) {
    if (!allows(type)) continue;
    const unit = type === 'airplaneSingle' ? 1 : 2;
    const fixed = want === type ? previous!.length : 0;
    for (let start = from; start <= CHAIN_TOP; start++) {
      let end = start;
      while (end <= CHAIN_TOP && counts[end] >= 3) end++;
      for (let length = Math.max(2, fixed); length <= end - start && (fixed === 0 || length === fixed); length++) {
        const body: number[] = [];
        for (let rank = start; rank < start + length; rank++) {
          counts[rank] -= 3;
          body.push(rank, rank, rank);
        }
        for (const kick of kickerSets(counts, unit, length, -1, mode, KICKER_LIMIT)) {
          push(combo(type, start, length, body.length + kick.length), [...body, ...kick]);
        }
        for (let rank = start; rank < start + length; rank++) counts[rank] += 3;
      }
    }
  }
  for (let rank = 0; rank <= TWO; rank++) if (counts[rank] === 4) push(combo('bomb', rank, 1, 4), [rank, rank, rank, rank]);
  if (counts[SMALL_JOKER] && counts[BIG_JOKER]) push(combo('rocket', SMALL_JOKER, 1, 2), [SMALL_JOKER, BIG_JOKER]);
  return moves;
}

/** Whether `counts` holds any play that beats `previous`. */
export function canBeat(counts: Counts, previous: DdzCombo): boolean {
  return rankMoves(counts, previous, 'cheap').length > 0;
}

// ─── Hand plans ───

/** Penalty per play needed to empty the hand; a play's own value ranges about -7 to +12. */
export const TURN_COST = 7;

export interface Plan {
  /** Plays needed to empty the hand. */
  readonly turns: number;
  /** Sum of the plays' values minus TURN_COST per play; higher is a better hand. */
  readonly score: number;
}

/** Value of an ordinary play whose top rank is `rank`: positive for aces and above. */
const groupValue = (rank: number): number => rank - 7;
const bombValue = (rank: number): number => 9 + rank * 0.25;
const ROCKET_VALUE = 14;

/** Plans packed into one number: four times the score, shifted past six bits of turns. */
const pack = (score: number, turns: number): number => Math.round(score * 4) * 64 + turns;
const packedScore = (packed: number): number => Math.floor(packed / 64) / 4;
const packedTurns = (packed: number): number => packed - Math.floor(packed / 64) * 64;

const memo = new Map<number, number>();
const MEMO_LIMIT = 300_000;

/** Plays without chains: rocket, bombs, triples (adjacent ones fly together) carrying the lowest loose groups. */
function remainder(counts: Counts): number {
  let turns = 0;
  let score = 0;
  let slots = 0;
  let run = 0;
  for (let rank = 0; rank <= TWO + 1; rank++) {
    const count = rank <= TWO ? counts[rank] : 0;
    if (count === 3 && rank <= CHAIN_TOP) {
      run += 1;
      slots += 1;
      continue;
    }
    if (run > 0) {
      // A run of triples is one airplane (or one triple) whose top rank sets its value.
      turns += 1;
      score += groupValue(rank - 1) + (run > 1 ? 1 : 0);
      run = 0;
    }
    if (count === 4) {
      turns += 1;
      score += bombValue(rank);
    } else if (count === 3) {
      turns += 1;
      slots += 1;
      score += groupValue(rank);
    }
  }
  // Loose singles and pairs ride along with triples, lowest first; a 2 or a joker is worth more on its own.
  for (let rank = 0; rank <= TWO; rank++) {
    const count = counts[rank];
    if (count !== 1 && count !== 2) continue;
    if (slots > 0 && rank < TWO) {
      slots -= 1;
      continue;
    }
    turns += 1;
    score += groupValue(rank);
  }
  if (counts[SMALL_JOKER] && counts[BIG_JOKER]) {
    turns += 1;
    score += ROCKET_VALUE;
  } else if (counts[SMALL_JOKER] || counts[BIG_JOKER]) {
    turns += 1;
    score += groupValue(counts[BIG_JOKER] ? BIG_JOKER : SMALL_JOKER);
  }
  return pack(score - TURN_COST * turns, turns);
}

/** The best plan of `counts` in which no chain starts below `start`. */
function search(counts: Counts, start: number): number {
  let rank = start;
  while (rank <= CHAIN_TOP && counts[rank] === 0) rank++;
  if (rank > CHAIN_TOP) return remainder(counts);
  // Either no chain starts at `rank`, or one does (and maybe another after it).
  let best = search(counts, rank + 1);
  let bestScore = packedScore(best);
  for (let per = 1; per <= 2; per++) {
    if (counts[rank] < per) continue;
    const minimum = per === 1 ? 5 : 3;
    let end = rank;
    while (end <= CHAIN_TOP && counts[end] >= per) end++;
    for (let length = minimum; length <= end - rank; length++) {
      for (let index = rank; index < rank + length; index++) counts[index] -= per;
      const rest = search(counts, rank);
      for (let index = rank; index < rank + length; index++) counts[index] += per;
      const score = packedScore(rest) + groupValue(rank + length - 1) + 1 - TURN_COST;
      if (score > bestScore) {
        bestScore = score;
        best = pack(score, packedTurns(rest) + 1);
      }
    }
  }
  return best;
}

/** The best way found to play out `counts`; memoized, never mutates `counts`. */
export function planHand(counts: Counts): Plan {
  const key = countCode(counts);
  let packed = memo.get(key);
  if (packed === undefined) {
    packed = key === 0 ? 0 : search(counts, 0);
    if (memo.size >= MEMO_LIMIT) memo.clear();
    memo.set(key, packed);
  }
  return { turns: packedTurns(packed), score: packedScore(packed) };
}

/** Plan of `counts` without `move`'s cards. */
export function planAfter(counts: Counts, move: RankMove): Plan {
  removeMove(counts, move);
  const plan = planHand(counts);
  restoreMove(counts, move);
  return plan;
}
