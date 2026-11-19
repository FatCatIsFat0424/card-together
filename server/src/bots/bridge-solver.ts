// Double-dummy solver: with every hand known, decides whether one side can still win a number of tricks.
// Seats are indexed clockwise (0 = N, 1 = E, 2 = S, 3 = W), suits 0-3 (clubs, diamonds, hearts, spades),
// and a holding is a 13-bit mask whose bit r is rank r + 2.
//
// Only the relative order of the remaining cards matters, so a trick-boundary position is keyed by the
// owner of each remaining card from the top of every suit, plus the leader. Positions that differ only in
// which low cards were played share an entry, and entries stay valid across every deal solved for one
// decision (same trump and side).

export const NO_TRUMP = -1;

/** One card already in the current trick. */
export interface TrickCard {
  readonly seat: number;
  readonly suit: number;
  readonly rank: number;
}

export interface SolverPosition {
  /** `hands[seat * 4 + suit]` holds the remaining cards; not mutated by the solver. */
  readonly hands: Int32Array;
  /** Seat that led the current trick. */
  readonly leader: number;
  /** Cards of the current trick in play order. */
  readonly trick: readonly TrickCard[];
}

export interface Solver {
  /** True when the solver's side can win at least `need` of the remaining tricks, the current one included. */
  readonly canReach: (position: SolverPosition, need: number) => boolean;
  /** Nodes visited since the solver was created. */
  readonly nodes: () => number;
}

const ABORTED = 'BridgeSolverAborted';

/** True for the error thrown when the caller's deadline passes mid-search; the partial result is discarded. */
export function isSolverAborted(error: unknown): boolean {
  return error instanceof Error && error.name === ABORTED;
}

const TABLE_BITS = 20;
const TABLE_SIZE = 1 << TABLE_BITS;
const MAX_PLIES = 53;
const MAX_MOVES = 13;
const CHECK_INTERVAL = 4096;

function highestBit(mask: number): number {
  return 31 - Math.clz32(mask);
}

function bitCount(mask: number): number {
  let count = 0;
  for (let rest = mask; rest !== 0; rest &= rest - 1) count++;
  return count;
}

/**
 * @param trump suit index, or `NO_TRUMP`
 * @param side 0 for N-S, 1 for E-W: the side whose trick count `canReach` asks about
 * @param expired polled during the search; once true the search throws (see `isSolverAborted`)
 */
export function createSolver(trump: number, side: number, expired: () => boolean = () => false): Solver {
  const hands = new Int32Array(16);
  // Exact keys: one word per suit (owner sequence and length) and the leader.
  const keys = new Int32Array(TABLE_SIZE * 4);
  const leaders = new Int8Array(TABLE_SIZE).fill(-1);
  const lower = new Int8Array(TABLE_SIZE);
  const upper = new Int8Array(TABLE_SIZE);
  // Lead that last decided the position: suit * 16 + live cards above it in that suit, plus one; 0 = none.
  const bestLead = new Uint8Array(TABLE_SIZE);
  // Card that cut off the search at each ply, or -1.
  const cutoffs = new Int32Array(MAX_PLIES).fill(-1);
  const suitKey = new Int32Array(4);
  const moveCards = new Int32Array(MAX_PLIES * MAX_MOVES);
  const moveScores = new Int32Array(MAX_PLIES * MAX_MOVES);
  // Cards of each trick on the search path, four slots per trick depth, in play order.
  const trickSuit = new Int32Array(4 * 14);
  const trickRank = new Int32Array(4 * 14);
  let visited = 0;

  /** Position of the winning card among the first `count` cards of the trick stored at `base`. */
  function winnerIndex(base: number, count: number): number {
    let best = 0;
    for (let index = 1; index < count; index++) {
      const suit = trickSuit[base + index];
      const bestSuit = trickSuit[base + best];
      if (suit === bestSuit ? trickRank[base + index] > trickRank[base + best] : suit === trump) best = index;
    }
    return best;
  }

  function suitMask(suit: number): number {
    return hands[suit] | hands[4 + suit] | hands[8 + suit] | hands[12 + suit];
  }

  /** Cards still unplayed or on the table, per suit; used to merge touching cards. */
  function liveMask(suit: number, base: number, count: number): number {
    let mask = suitMask(suit);
    for (let index = 0; index < count; index++) if (trickSuit[base + index] === suit) mask |= 1 << trickRank[base + index];
    return mask;
  }

  /** Prefers leads the leader's side wins, ruffs for partner, and low cards where an opponent holds the top. */
  function leadScore(seat: number, suit: number, rank: number, top: number): number {
    const partner = 3 & (seat + 2);
    const owner = (hands[seat * 4 + suit] & (1 << top)) !== 0 ? seat : (hands[partner * 4 + suit] & (1 << top)) !== 0 ? partner : -1;
    let score: number;
    if (owner === seat) score = rank === top ? 80 : 20 - rank;
    else if (owner === partner) score = 60 - rank;
    else score = 10 - rank;
    if (trump !== NO_TRUMP && suit !== trump) {
      for (const opponent of [3 & (seat + 1), 3 & (seat + 3)]) {
        if (hands[opponent * 4 + suit] === 0 && hands[opponent * 4 + trump] !== 0) score -= 40;
      }
      if (hands[partner * 4 + suit] === 0 && hands[partner * 4 + trump] !== 0 && owner !== seat) score += 30;
    }
    return score;
  }

  /**
   * Writes one representative per group of equivalent cards (touching within the live cards) with an
   * ordering score, sorted best first; returns the number of moves.
   */
  function generate(seat: number, step: number, leader: number, trickBase: number, ply: number, hint: number): number {
    const base = ply * MAX_MOVES;
    let count = 0;
    const ledSuit = step > 0 ? trickSuit[trickBase] : -1;
    const followMask = ledSuit >= 0 ? hands[seat * 4 + ledSuit] : 0;
    const best = step > 0 ? winnerIndex(trickBase, step) : 0;
    const partnerWinning = step > 0 && ((leader + best) & 3) === ((seat + 2) & 3);
    const winSuit = step > 0 ? trickSuit[trickBase + best] : -1;
    const winRank = step > 0 ? trickRank[trickBase + best] : -1;
    for (let suit = 0; suit < 4; suit++) {
      if (followMask !== 0 && suit !== ledSuit) continue;
      const holding = hands[seat * 4 + suit];
      if (holding === 0) continue;
      const live = liveMask(suit, trickBase, step);
      const top = highestBit(live);
      let rest = holding;
      while (rest !== 0) {
        const rank = highestBit(rest);
        rest &= ~(1 << rank);
        const below = live & ((1 << rank) - 1);
        // Keep only the lowest card of a run of touching cards held by this seat.
        if (below !== 0 && (holding & (1 << highestBit(below))) !== 0) continue;
        let score: number;
        if (step === 0) {
          score = leadScore(seat, suit, rank, top);
        } else {
          const beats = suit === winSuit ? rank > winRank : suit === trump && winSuit !== trump;
          if (partnerWinning) score = -rank - (suit === trump && ledSuit !== trump ? 30 : 0);
          else if (beats) score = 50 - rank;
          else score = -rank - (suit === trump ? 20 : 0);
        }
        moveCards[base + count] = suit * 16 + rank;
        moveScores[base + count] = suit * 16 + rank === hint ? 1000 : score;
        count++;
      }
    }
    for (let i = 1; i < count; i++) {
      const card = moveCards[base + i];
      const score = moveScores[base + i];
      let j = i - 1;
      while (j >= 0 && moveScores[base + j] < score) {
        moveCards[base + j + 1] = moveCards[base + j];
        moveScores[base + j + 1] = moveScores[base + j];
        j--;
      }
      moveCards[base + j + 1] = card;
      moveScores[base + j + 1] = score;
    }
    return count;
  }

  /** Consecutive top cards of the suit held by `seat`, cashable while opponents holding trumps still follow. */
  function topWinners(seat: number, suit: number): number {
    const own = hands[seat * 4 + suit];
    if (own === 0) return 0;
    const live = suitMask(suit);
    let winners = 0;
    for (let rank = highestBit(live); rank >= 0 && (own & (1 << rank)) !== 0; rank = highestBit(live & ((1 << rank) - 1))) {
      winners++;
    }
    if (winners > 0 && trump !== NO_TRUMP && suit !== trump) {
      for (const opponent of [3 & (seat + 1), 3 & (seat + 3)]) {
        if (hands[opponent * 4 + trump] !== 0) winners = Math.min(winners, bitCount(hands[opponent * 4 + suit]));
      }
    }
    return winners;
  }

  /** Top trumps held by a single seat of `team` (0 = N-S, 1 = E-W), counted from the highest live trump. */
  function trumpWinners(team: number): number {
    const live = suitMask(trump);
    if (live === 0) return 0;
    const top = highestBit(live);
    const holder = (hands[team * 4 + trump] & (1 << top)) !== 0 ? team : (hands[(team + 2) * 4 + trump] & (1 << top)) !== 0 ? team + 2 : -1;
    if (holder < 0) return 0;
    let count = 0;
    for (let rank = top; rank >= 0 && (hands[holder * 4 + trump] & (1 << rank)) !== 0; rank = highestBit(live & ((1 << rank) - 1))) count++;
    return count;
  }

  /**
   * Tricks the leader's side can take at once: the leader cashes its own top cards, then may cross once to
   * partner's top cards in a suit where the leader has no winner of its own but still holds a card.
   */
  function quickTricks(leader: number): number {
    const partner = 3 & (leader + 2);
    let total = 0;
    let crossing = 0;
    for (let suit = 0; suit < 4; suit++) {
      const own = topWinners(leader, suit);
      total += own;
      if (own === 0 && hands[leader * 4 + suit] !== 0) crossing = Math.max(crossing, topWinners(partner, suit));
    }
    return total + crossing;
  }

  function abort(): never {
    const error = new Error('Search deadline passed.');
    error.name = ABORTED;
    throw error;
  }

  function tick(): void {
    visited++;
    if ((visited & (CHECK_INTERVAL - 1)) === 0 && expired()) abort();
  }

  /** Owner sequence of the remaining cards per suit, top down, with the suit length in the high bits. */
  function computeKey(): void {
    for (let suit = 0; suit < 4; suit++) {
      let word = 0;
      let length = 0;
      const north = hands[suit];
      const east = hands[4 + suit];
      const south = hands[8 + suit];
      let rest = north | east | south | hands[12 + suit];
      while (rest !== 0) {
        const bit = 1 << highestBit(rest);
        rest &= ~bit;
        const owner = (north & bit) !== 0 ? 0 : (east & bit) !== 0 ? 1 : (south & bit) !== 0 ? 2 : 3;
        word = (word << 2) | owner;
        length++;
      }
      suitKey[suit] = word | (length << 26);
    }
  }

  function slotOf(leader: number): number {
    let hash = Math.imul(leader + 1, 0x9e3779b1);
    for (let suit = 0; suit < 4; suit++) {
      hash = Math.imul(hash ^ suitKey[suit], 0x85ebca6b);
      hash ^= hash >>> 13;
    }
    return (hash ^ (hash >>> 16)) & (TABLE_SIZE - 1);
  }

  function matches(slot: number, leader: number): boolean {
    const at = slot * 4;
    return leaders[slot] === leader && keys[at] === suitKey[0] && keys[at + 1] === suitKey[1]
      && keys[at + 2] === suitKey[2] && keys[at + 3] === suitKey[3];
  }

  /** The leader's card stored as `suit * 16 + live cards above it`, or -1 when the leader no longer holds it. */
  function absoluteLead(leader: number, relative: number): number {
    const suit = relative >> 4;
    let above = relative & 15;
    let rest = suitMask(suit);
    while (rest !== 0) {
      const rank = highestBit(rest);
      if (above === 0) return (hands[leader * 4 + suit] & (1 << rank)) !== 0 ? suit * 16 + rank : -1;
      above--;
      rest &= ~(1 << rank);
    }
    return -1;
  }

  /** At a trick boundary: can the side win `need` of the `left` remaining tricks with `leader` on lead? */
  function boundary(leader: number, need: number, left: number, trickBase: number, ply: number): boolean {
    if (need <= 0) return true;
    if (need > left) return false;
    const quick = quickTricks(leader);
    if ((leader & 1) === side) {
      if (quick >= need) return true;
    } else if (left - quick < need) {
      return false;
    }
    // The other side's top trumps held by one seat each win a trick however the play goes.
    if (trump !== NO_TRUMP) {
      const sure = trumpWinners(1 ^ (leader & 1));
      if ((leader & 1) === side ? left - sure < need : sure >= need) return (leader & 1) !== side;
    }
    computeKey();
    let slot = slotOf(leader);
    let hint = -1;
    if (matches(slot, leader)) {
      if (lower[slot] >= need) return true;
      if (upper[slot] < need) return false;
      if (bestLead[slot] !== 0) hint = absoluteLead(leader, bestLead[slot] - 1);
    }
    const result = play(0, leader, need, left, trickBase, ply, hint);
    const cut = cutoffs[ply];
    // Deeper positions overwrote the key buffer and may have reused the slot.
    computeKey();
    slot = slotOf(leader);
    if (!matches(slot, leader)) {
      const at = slot * 4;
      keys[at] = suitKey[0];
      keys[at + 1] = suitKey[1];
      keys[at + 2] = suitKey[2];
      keys[at + 3] = suitKey[3];
      leaders[slot] = leader;
      lower[slot] = 0;
      upper[slot] = left;
      bestLead[slot] = 0;
    }
    if (cut >= 0) bestLead[slot] = (cut >> 4) * 16 + bitCount(suitMask(cut >> 4) >>> ((cut & 15) + 1)) + 1;
    if (result) lower[slot] = Math.max(lower[slot], need);
    else upper[slot] = Math.min(upper[slot], need - 1);
    return result;
  }

  /** Inside a trick: `step` cards are down; `need` counts the current trick. */
  function play(step: number, leader: number, need: number, left: number, trickBase: number, ply: number, hint = -1): boolean {
    tick();
    if (step === 4) {
      const winner = (leader + winnerIndex(trickBase, 4)) & 3;
      return boundary(winner, need - ((winner & 1) === side ? 1 : 0), left - 1, trickBase + 4, ply);
    }
    const seat = (leader + step) & 3;
    const maximizing = (seat & 1) === side;
    const count = generate(seat, step, leader, trickBase, ply, hint);
    const base = ply * MAX_MOVES;
    for (let index = 0; index < count; index++) {
      const card = moveCards[base + index];
      const suit = card >> 4;
      const rank = card & 15;
      hands[seat * 4 + suit] &= ~(1 << rank);
      trickSuit[trickBase + step] = suit;
      trickRank[trickBase + step] = rank;
      const result = play(step + 1, leader, need, left, trickBase, ply + 1);
      hands[seat * 4 + suit] |= 1 << rank;
      if (result === maximizing) {
        cutoffs[ply] = card;
        return result;
      }
    }
    cutoffs[ply] = -1;
    return !maximizing;
  }

  function canReach(position: SolverPosition, need: number): boolean {
    if (expired()) abort();
    hands.set(position.hands);
    let cards = position.trick.length;
    for (let index = 0; index < 16; index++) cards += bitCount(hands[index]);
    position.trick.forEach((card, index) => {
      trickSuit[index] = card.suit;
      trickRank[index] = card.rank;
    });
    const left = Math.ceil(cards / 4);
    if (position.trick.length === 0) return boundary(position.leader, need, left, 0, 0);
    if (need <= 0) return true;
    if (need > left) return false;
    return play(position.trick.length, position.leader, need, left, 0, 0);
  }

  return { canReach, nodes: () => visited };
}

/** Largest number of remaining tricks the solver's side can win; for tests and diagnostics. */
export function solveTricks(solver: Solver, position: SolverPosition): number {
  let cards = position.trick.length;
  for (let index = 0; index < 16; index++) cards += bitCount(position.hands[index]);
  let low = 0;
  let high = Math.ceil(cards / 4);
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (solver.canReach(position, middle)) low = middle;
    else high = middle - 1;
  }
  return low;
}
