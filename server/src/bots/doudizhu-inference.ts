import type { CardOrJoker, DouDizhuVisibleState, GameSeat } from '@shared/types';
import type { DdzCombo } from '@shared/rules/doudizhu';
import { cardKey } from '@shared/rules/cards';
import { dealUnseen } from './search/card-dealer';
import { BIG_JOKER, RANKS, rankMoves, rankOf, SMALL_JOKER, toCounts, TWO } from './doudizhu-hand';
import type { Counts } from './doudizhu-hand';
import { unseenCards } from './doudizhu-strategy';

// Guessing the hidden hands from the seat's own view. Hard facts (hand sizes, the landlord holding the public
// bottom cards it has not played) are always honored. Soft evidence weighs each guess by how likely the other
// seats' public actions were with those cards: bids and claims follow hand strength, and a seat that passed
// over an opponent's play it could have beaten cheaply probably could not. Several random deals are drawn and
// one is kept in proportion to that likelihood (sampling-importance-resampling), so every kept world counts
// the same in the search.

const ACE = 11;

/** Auction strength of rank counts: jokers, 2s, aces, and bombs (the scale of handStrength). */
export function countStrength(counts: Counts): number {
  let strength = 0;
  if (counts[SMALL_JOKER] && counts[BIG_JOKER]) strength += 4;
  else if (counts[BIG_JOKER]) strength += 2;
  else if (counts[SMALL_JOKER]) strength += 1.2;
  strength += counts[TWO] * 1.4 + counts[ACE] * 0.5;
  for (let rank = 0; rank <= TWO; rank++) if (counts[rank] === 4) strength += 2.5;
  return strength;
}

/** Strength a seat is assumed to need for each bid level, and for calling or grabbing. */
const BID_THRESHOLD = [0, 3.5, 5, 6.5];
const CALL_THRESHOLD = 3.5;
const GRAB_THRESHOLD = 5;
/** Width of the soft thresholds: people bid differently, so the evidence stays mild. */
const BID_WIDTH = 1.4;
/** Likelihood of a pass over an opponent's play the seat could have beaten without a 2, joker, or bomb. */
const CHEAP_PASS = 0.3;
/** The same when only a 2 or a joker (no bomb) would have beaten it. */
const COSTLY_PASS = 0.8;

const logistic = (x: number): number => 1 / (1 + Math.exp(-x));

/** One piece of public evidence about a seat other than the viewer. */
type Evidence =
  | { readonly kind: 'bid'; readonly seat: number; readonly level: number; readonly minimum: number }
  | { readonly kind: 'claim'; readonly seat: number; readonly take: boolean; readonly grab: boolean }
  | { readonly kind: 'pass'; readonly seat: number; readonly combo: DdzCombo; readonly later: Counts };

/** The current deal's log: from its `deal` entry on. */
export function dealLog(visible: DouDizhuVisibleState): DouDizhuVisibleState['log'] {
  let start = visible.log.length - 1;
  while (start >= 0 && visible.log[start].type !== 'deal') start -= 1;
  return visible.log.slice(Math.max(0, start));
}

/** Evidence from the deal's log, with each seat's cards played since then so its hand at the time is known. */
function gatherEvidence(visible: DouDizhuVisibleState): { evidence: Evidence[]; playedBy: Counts[] } {
  const seats = visible.seats;
  const index = (seat: GameSeat): number => seats.indexOf(seat);
  const me = index(visible.mySeat);
  const log = dealLog(visible);
  const playedBy = seats.map(() => new Uint8Array(RANKS));
  const pending: { evidence: Evidence; seat: number }[] = [];
  const evidence: Evidence[] = [];
  let last: { seat: number; combo: DdzCombo } | null = null;
  let landlord = -1;
  let bestScore = 0;
  let called = false;
  for (const entry of log) {
    if (entry.type === 'bid') {
      const seat = index(entry.seat);
      if (seat !== me) evidence.push({ kind: 'bid', seat, level: entry.score, minimum: bestScore + 1 });
      bestScore = Math.max(bestScore, entry.score);
    } else if (entry.type === 'claim') {
      const seat = index(entry.seat);
      if (seat !== me) evidence.push({ kind: 'claim', seat, take: entry.take, grab: called });
      called ||= entry.take;
    } else if (entry.type === 'landlord') {
      landlord = index(entry.seat);
    } else if (entry.type === 'play') {
      const seat = index(entry.seat);
      for (const card of entry.cards) {
        const rank = rankOf(card);
        playedBy[seat][rank] += 1;
        for (const item of pending) if (item.seat === seat && item.evidence.kind === 'pass') item.evidence.later[rank] += 1;
      }
      last = { seat, combo: entry.combo };
    } else if (entry.type === 'pass') {
      const seat = index(entry.seat);
      // Only a pass over an opponent says something; leaving a partner's play alone is expected.
      if (seat !== me && last && landlord >= 0 && (seat === landlord) !== (last.seat === landlord)) {
        const item: Evidence = { kind: 'pass', seat, combo: last.combo, later: new Uint8Array(RANKS) };
        pending.push({ evidence: item, seat });
        evidence.push(item);
      }
    } else if (entry.type === 'round_end') {
      last = null;
    }
  }
  return { evidence, playedBy };
}

function passLikelihood(hand: Counts, combo: DdzCombo): number {
  let costly = false;
  for (const move of rankMoves(hand, combo, 'cheap')) {
    if (move.combo.type === 'bomb' || move.combo.type === 'rocket') continue;
    if (move.combo.power - 3 < TWO) return CHEAP_PASS;
    costly = true;
  }
  return costly ? COSTLY_PASS : 1;
}

function bidLikelihood(strength: number, item: Extract<Evidence, { kind: 'bid' | 'claim' }>): number {
  const above = (threshold: number): number => logistic((strength - threshold) / BID_WIDTH);
  if (item.kind === 'claim') {
    const chance = above(item.grab ? GRAB_THRESHOLD : CALL_THRESHOLD);
    return item.take ? chance : 1 - chance;
  }
  if (item.level === 0) return 1 - above(BID_THRESHOLD[Math.min(3, item.minimum)]);
  const reach = above(BID_THRESHOLD[item.level]);
  return item.level >= 3 ? reach : reach * (1 - 0.6 * above(BID_THRESHOLD[item.level + 1]));
}

/** A guessed deal: rank counts per seat (play order), the bottom too while the auction runs. */
export interface GuessedDeal {
  readonly hands: Counts[];
  /** The three bottom cards; only guessed while the auction runs, null afterwards. */
  readonly bottom: Counts | null;
}

export interface DealGuesser {
  readonly guess: (random: () => number) => GuessedDeal | null;
  /** Pieces of soft evidence behind the guesses. */
  readonly evidence: number;
}

/** Card swaps proposed per guess when there is evidence to fit. */
const SWAPS = 40;

/** Guesses the hidden cards of the current deal from `visible` alone. */
export function dealGuesser(visible: DouDizhuVisibleState): DealGuesser {
  const seats = visible.seats;
  const me = seats.indexOf(visible.mySeat);
  const landlord = visible.landlord ? seats.indexOf(visible.landlord) : -1;
  const unseen = unseenCards(visible);
  const unseenKeys = new Set(unseen.map(cardKey));
  // The landlord still holds every public bottom card it has not played.
  const fixed: CardOrJoker[] = landlord >= 0 && landlord !== me
    ? (visible.bottom ?? []).filter((card) => unseenKeys.has(cardKey(card)))
      .slice(0, visible.handCounts[seats[landlord]]) : [];
  const fixedKeys = new Set(fixed.map(cardKey));
  const free = unseen.filter((card) => !fixedKeys.has(cardKey(card)));
  const others = [0, 1, 2].filter((seat) => seat !== me);
  const auction = landlord < 0;
  const holders = others.map((seat) => ({
    size: auction ? 17 : visible.handCounts[seats[seat]],
    known: seat === landlord ? fixed : undefined,
  }));
  if (auction) holders.push({ size: 3, known: undefined });
  const { evidence, playedBy } = gatherEvidence(visible);
  const bottomCounts = toCounts(visible.bottom ?? []);
  const fixedCounts = toCounts(fixed);
  const myCounts = toCounts(visible.myHand);
  const scratch = new Uint8Array(RANKS);
  const bySeat = [0, 1, 2].map((seat) => evidence.filter((item) => item.seat === seat));

  /** Log-likelihood of one seat's evidence given its whole current hand. */
  const seatLikelihood = (seat: number, hand: Counts): number => {
    let total = 0;
    for (const item of bySeat[seat]) {
      if (item.kind === 'pass') {
        for (let rank = 0; rank < RANKS; rank++) scratch[rank] = hand[rank] + item.later[rank];
        total += Math.log(passLikelihood(scratch, item.combo));
      } else {
        // The hand at the auction: today's cards plus everything played since, without the bottom it took.
        for (let rank = 0; rank < RANKS; rank++) {
          scratch[rank] = hand[rank] + playedBy[item.seat][rank] - (item.seat === landlord ? bottomCounts[rank] : 0);
        }
        total += Math.log(Math.max(1e-6, bidLikelihood(countStrength(scratch), item)));
      }
    }
    return total;
  };

  // A consistent view leaves exactly as many unseen cards as free places; a hand-made one may leave more,
  // and the extra cards are then treated as out of play.
  const places = holders.reduce((sum, holder) => sum + holder.size, 0) - fixed.length;
  const inPlay = (random: () => number): CardOrJoker[] => {
    if (free.length === places) return free;
    const pool = [...free];
    for (let index = pool.length - 1; index > 0; index--) {
      const other = Math.floor(random() * (index + 1));
      [pool[index], pool[other]] = [pool[other], pool[index]];
    }
    return pool.slice(0, places);
  };

  /** A random card of `movable`, by rank. */
  const pickRank = (movable: Counts, total: number, random: () => number): number => {
    let ticket = Math.floor(random() * total);
    for (let rank = 0; rank < RANKS; rank++) {
      ticket -= movable[rank];
      if (ticket < 0) return rank;
    }
    return RANKS - 1;
  };
  const seatOf = (holder: number): number => (holder < others.length ? others[holder] : -1);

  /**
   * A uniform deal, then Metropolis card swaps between the hidden holders (the other hands and, during the
   * auction, the bottom), so each guess turns up in proportion to how well it explains the evidence.
   */
  const guess = (random: () => number): GuessedDeal | null => {
    if (free.length < places) return null;
    const dealt = dealUnseen({ unseen: inPlay(random), seats: holders }, random);
    if (!dealt) return null;
    const held = dealt.hands.map((cards) => toCounts(cards));
    if (evidence.length > 0) {
      // Free cards per holder: what a swap may move (never the landlord's public bottom cards).
      const movable = held.map((counts, holder) => {
        const copy = new Uint8Array(counts);
        if (seatOf(holder) === landlord) for (let rank = 0; rank < RANKS; rank++) copy[rank] -= fixedCounts[rank];
        return copy;
      });
      const sizes = movable.map((counts) => counts.reduce((sum, count) => sum + count, 0));
      const fit = held.map((counts, holder) => (seatOf(holder) >= 0 ? seatLikelihood(seatOf(holder), counts) : 0));
      const move = (from: number, to: number, out: number, back: number): void => {
        held[from][out] -= 1;
        held[from][back] += 1;
        movable[from][out] -= 1;
        movable[from][back] += 1;
        held[to][back] -= 1;
        held[to][out] += 1;
        movable[to][back] -= 1;
        movable[to][out] += 1;
      };
      for (let step = 0; step < SWAPS; step++) {
        const a = Math.floor(random() * held.length);
        const b = (a + 1 + Math.floor(random() * (held.length - 1))) % held.length;
        if (sizes[a] === 0 || sizes[b] === 0) continue;
        const ra = pickRank(movable[a], sizes[a], random);
        const rb = pickRank(movable[b], sizes[b], random);
        if (ra === rb) continue;
        // Swapping two random cards is its own reverse with the same chance, so only the fit decides.
        move(a, b, ra, rb);
        const fitA = seatOf(a) >= 0 ? seatLikelihood(seatOf(a), held[a]) : 0;
        const fitB = seatOf(b) >= 0 ? seatLikelihood(seatOf(b), held[b]) : 0;
        const ratio = fitA + fitB - fit[a] - fit[b];
        if (ratio >= 0 || random() < Math.exp(ratio)) {
          fit[a] = fitA;
          fit[b] = fitB;
        } else move(a, b, rb, ra);
      }
    }
    const hands: Counts[] = [];
    hands[me] = new Uint8Array(myCounts);
    others.forEach((seat, holder) => { hands[seat] = held[holder]; });
    return { hands, bottom: auction ? held[2] : null };
  };
  return { guess, evidence: evidence.length };
}
