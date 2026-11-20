// Double-dummy solver: with every hand known, decides whether one side can still win a number of tricks.
// Seats are indexed clockwise (0 = N, 1 = E, 2 = S, 3 = W), suits 0-3 (clubs, diamonds, hearts, spades),
// and a holding is a 13-bit mask whose bit r is rank r + 2.
//
// Partition search: every proven bound records which cards it depended on. A trick decided by comparing
// two cards of one suit makes the winner's rank matter; cards of a run that one seat could play
// interchangeably matter together. At a trick boundary the bound is stored for the class of positions with
// the same leader and suit lengths per hand whose cards from the top of each suit down to its lowest card
// that mattered have the same owners; the lower cards only count. One table, shared by every solver in the
// thread, holds these entries for all trump suits, so results carry over between the deals, candidate
// cards, and decisions of a game.

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

const MAX_PLIES = 53;
const MAX_MOVES = 13;
const CHECK_INTERVAL = 4096;

// Transposition table. Entries of one leader, trump, and set of suit lengths ("distribution") are chained in
// chunks; a probe scans the chain of its distribution. About 20 MB in all.
const DIST_BITS = 16;
const DIST_SLOTS = 1 << DIST_BITS;
const CHUNK = 16;
const CHUNK_COUNT = 1 << 15;
/** Longest chain: a full chain replaces its entries in turn. */
const MAX_CHAIN = 8;
/** Search counter limit before ages are reset. */
const MAX_AGE = 1 << 26;

interface Table {
  /** Per distribution slot: `(trump + 1) * 4 + leader`, or -1 when free. */
  readonly distTags: Int8Array;
  /** Hand lengths, four bits per seat and suit: N and E in the low word, S and W in the high word. */
  readonly distLow: Int32Array;
  readonly distHigh: Int32Array;
  /** First chunk of the chain, or -1. */
  readonly distHeads: Int32Array;
  readonly distChunks: Uint8Array;
  /** Next entry of a full chain to replace. */
  readonly distCursors: Uint8Array;
  /** Search counter when the distribution was last used. */
  readonly distAges: Int32Array;
  readonly chunkNext: Int32Array;
  readonly chunkFill: Uint8Array;
  readonly freeChunks: Int32Array;
  /**
   * Per entry and suit: the owners of the suit's cards from the top down to the lowest card that mattered,
   * as a mask over the position's full owner sequence (two bits per card, top card highest) and the owners.
   */
  readonly masks: Int32Array;
  readonly owners: Int32Array;
  /** Bounds on the tricks N-S win from the position. */
  readonly lower: Int8Array;
  readonly upper: Int8Array;
  /** Lead that last decided the position: suit * 16 + live cards above it in that suit, plus one; 0 = none. */
  readonly leads: Uint8Array;
}

let shared: Table | null = null;
let freeCount = CHUNK_COUNT;
let clockHand = 0;
let age = 0;

function sharedTable(): Table {
  shared ??= {
    distTags: new Int8Array(DIST_SLOTS).fill(-1),
    distLow: new Int32Array(DIST_SLOTS),
    distHigh: new Int32Array(DIST_SLOTS),
    distHeads: new Int32Array(DIST_SLOTS).fill(-1),
    distChunks: new Uint8Array(DIST_SLOTS),
    distCursors: new Uint8Array(DIST_SLOTS),
    distAges: new Int32Array(DIST_SLOTS),
    chunkNext: new Int32Array(CHUNK_COUNT),
    chunkFill: new Uint8Array(CHUNK_COUNT),
    freeChunks: Int32Array.from({ length: CHUNK_COUNT }, (_, index) => index),
    masks: new Int32Array(CHUNK_COUNT * CHUNK * 4),
    owners: new Int32Array(CHUNK_COUNT * CHUNK * 4),
    lower: new Int8Array(CHUNK_COUNT * CHUNK),
    upper: new Int8Array(CHUNK_COUNT * CHUNK),
    leads: new Uint8Array(CHUNK_COUNT * CHUNK),
  };
  return shared;
}

function nextAge(table: Table): number {
  if (++age >= MAX_AGE) {
    table.distAges.fill(0);
    age = 1;
  }
  return age;
}

function distHash(tag: number, low: number, high: number): number {
  let hash = Math.imul(tag + 1, 0x9e3779b1) ^ low;
  hash = Math.imul(hash ^ (hash >>> 15), 0x85ebca6b) ^ high;
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return hash ^ (hash >>> 16);
}

/** The slot holding the distribution, or -1; each distribution may sit in one of two slots. */
function findDist(table: Table, tag: number, low: number, high: number): number {
  const hash = distHash(tag, low, high);
  const first = hash & (DIST_SLOTS - 1);
  if (table.distTags[first] === tag && table.distLow[first] === low && table.distHigh[first] === high) return first;
  const second = (hash >>> DIST_BITS) & (DIST_SLOTS - 1);
  if (table.distTags[second] === tag && table.distLow[second] === low && table.distHigh[second] === high) return second;
  return -1;
}

function freeDist(table: Table, slot: number): void {
  for (let chunk = table.distHeads[slot]; chunk >= 0; chunk = table.chunkNext[chunk]) table.freeChunks[freeCount++] = chunk;
  table.distTags[slot] = -1;
  table.distHeads[slot] = -1;
  table.distChunks[slot] = 0;
}

/** The slot of the distribution, taking over the less recently used of its two slots when it has none. */
function claimDist(table: Table, tag: number, low: number, high: number, now: number): number {
  const found = findDist(table, tag, low, high);
  if (found >= 0) return found;
  const hash = distHash(tag, low, high);
  const first = hash & (DIST_SLOTS - 1);
  const second = (hash >>> DIST_BITS) & (DIST_SLOTS - 1);
  const slot = table.distTags[first] < 0 ? first : table.distTags[second] < 0 ? second
    : table.distAges[first] <= table.distAges[second] ? first : second;
  if (table.distTags[slot] >= 0) freeDist(table, slot);
  table.distTags[slot] = tag;
  table.distLow[slot] = low;
  table.distHigh[slot] = high;
  table.distCursors[slot] = 0;
  table.distAges[slot] = now;
  return slot;
}

/** A free chunk; when none is left, frees the chains of distributions not used by the current search first. */
function takeChunk(table: Table, keep: number, now: number): number {
  for (let pass = 0; freeCount === 0 && pass < 2; pass++) {
    for (let step = 0; step < DIST_SLOTS && freeCount === 0; step++) {
      clockHand = (clockHand + 1) & (DIST_SLOTS - 1);
      if (clockHand !== keep && table.distHeads[clockHand] >= 0 && (pass === 1 || table.distAges[clockHand] < now)) {
        freeDist(table, clockHand);
      }
    }
  }
  return table.freeChunks[--freeCount];
}

function swapEntries(table: Table, first: number, second: number): void {
  const { masks, owners, lower, upper, leads } = table;
  for (let suit = 0; suit < 4; suit++) {
    const a = first * 4 + suit;
    const b = second * 4 + suit;
    [masks[a], masks[b]] = [masks[b], masks[a]];
    [owners[a], owners[b]] = [owners[b], owners[a]];
  }
  [lower[first], lower[second]] = [lower[second], lower[first]];
  [upper[first], upper[second]] = [upper[second], upper[first]];
  [leads[first], leads[second]] = [leads[second], leads[first]];
}

/** A fresh entry in the chain of `slot`: a free place, a new chunk, or the next entry of a full chain. */
function newEntry(table: Table, slot: number, now: number): number {
  const head = table.distHeads[slot];
  if (head >= 0 && table.chunkFill[head] < CHUNK) return head * CHUNK + table.chunkFill[head]++;
  if (table.distChunks[slot] < MAX_CHAIN) {
    const chunk = takeChunk(table, slot, now);
    table.chunkNext[chunk] = table.distHeads[slot];
    table.chunkFill[chunk] = 1;
    table.distHeads[slot] = chunk;
    table.distChunks[slot]++;
    return chunk * CHUNK;
  }
  let chunk = head;
  let index = table.distCursors[slot];
  table.distCursors[slot] = (index + 1) % (MAX_CHAIN * CHUNK);
  for (; index >= CHUNK; index -= CHUNK) chunk = table.chunkNext[chunk];
  return chunk * CHUNK + index;
}

function bitCount(mask: number): number {
  let count = 0;
  for (let rest = mask; rest !== 0; rest &= rest - 1) count++;
  return count;
}

// Lookup tables for keys: bit counts of 13-bit masks, the bits of a mask spread to every other position, and
// the bits of a holding packed down to the positions of the live cards (split into low six and high seven ranks).
const BIT_COUNTS = Uint8Array.from({ length: 1 << 13 }, (_, mask) => bitCount(mask));
const SPREAD = Int32Array.from({ length: 1 << 13 }, (_, mask) => {
  let spread = 0;
  for (let bit = 0; bit < 13; bit++) if ((mask & (1 << bit)) !== 0) spread |= 1 << (2 * bit);
  return spread;
});
const PACK_LOW = packTable(6);
const PACK_HIGH = packTable(7);

/** `table[live << bits | holding]`: the bits of `holding` at the positions of `live`, packed together. */
function packTable(bits: number): Uint8Array {
  const table = new Uint8Array(1 << (2 * bits));
  for (let live = 0; live < 1 << bits; live++) {
    for (let holding = 0; holding < 1 << bits; holding++) {
      let packed = 0;
      let position = 0;
      for (let bit = 0; bit < bits; bit++) {
        if ((live & (1 << bit)) === 0) continue;
        if ((holding & (1 << bit)) !== 0) packed |= 1 << position;
        position++;
      }
      table[(live << bits) | holding] = packed;
    }
  }
  return table;
}

/** The bits of `holding` (a subset of `live`) packed to the positions of the live cards. */
function compress(holding: number, live: number): number {
  const liveLow = live & 63;
  return PACK_LOW[(liveLow << 6) | (holding & 63)] | (PACK_HIGH[((live >> 6) << 7) | (holding >> 6)] << BIT_COUNTS[liveLow]);
}

function highestBit(mask: number): number {
  return 31 - Math.clz32(mask);
}

function lowestBit(mask: number): number {
  return 31 - Math.clz32(mask & -mask);
}

/**
 * @param trump suit index, or `NO_TRUMP`
 * @param side 0 for N-S, 1 for E-W: the side whose trick count `canReach` asks about
 * @param expired polled during the search; once true the search throws (see `isSolverAborted`)
 */
export function createSolver(trump: number, side: number, expired: () => boolean = () => false): Solver {
  const table = sharedTable();
  const { distAges, distHeads, chunkNext, chunkFill, masks, owners, lower, upper, leads } = table;
  const hands = new Int32Array(16);
  // Ranks each search result depended on, per ply and suit; only the lowest one of a suit is used.
  const win = new Int32Array((MAX_PLIES + 1) * 4);
  // Boundary keys per ply: owner sequence of each suit (top down), suit lengths, and hand lengths.
  const ownerWords = new Int32Array(MAX_PLIES * 4);
  const suitLengths = new Int32Array(MAX_PLIES * 4);
  const handLengths = new Int32Array(MAX_PLIES * 2);
  // Card that cut off the search at each ply, or -1.
  const cutoffs = new Int32Array(MAX_PLIES).fill(-1);
  const moveCards = new Int32Array(MAX_PLIES * MAX_MOVES);
  const moveScores = new Int32Array(MAX_PLIES * MAX_MOVES);
  // Cards of each trick on the search path, four slots per trick depth, in play order.
  const trickSuit = new Int32Array(4 * 14);
  const trickRank = new Int32Array(4 * 14);
  const trumpTag = (trump + 1) * 4;
  // Quick-trick scratch per suit: the leader's cashable winners, and the extra tricks and cards of a crossing.
  const ownWinners = new Int32Array(4);
  const crossTricks = new Int32Array(4);
  const crossRuns = new Int32Array(4);
  let visited = 0;
  let searchAge = 0;

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

  /** Cards of `seat` directly above `rank` in `live` with no other live card between: one run with it. */
  function runAbove(seat: number, suit: number, rank: number, live: number): number {
    const holding = hands[seat * 4 + suit];
    let run = 0;
    let above = live & ~((2 << rank) - 1);
    while (above !== 0) {
      const next = above & -above;
      if ((holding & next) === 0) break;
      run |= next;
      above &= ~next;
    }
    return run;
  }

  /** Records that the top `count` live cards of `suit` mattered at ply slot `at`. */
  function markTop(at: number, suit: number, count: number): void {
    let rest = suitMask(suit);
    for (let index = 1; index < count; index++) rest &= ~(1 << highestBit(rest));
    win[at + suit] |= 1 << highestBit(rest);
  }

  function clearWin(at: number): void {
    win[at] = 0;
    win[at + 1] = 0;
    win[at + 2] = 0;
    win[at + 3] = 0;
  }

  /** Prefers leads the leader's side wins, ruffs for partner, and low cards where an opponent holds the top. */
  function leadScore(seat: number, suit: number, rank: number, top: number): number {
    const partner = 3 & (seat + 2);
    const owner = (hands[seat * 4 + suit] & (1 << top)) !== 0 ? seat : (hands[partner * 4 + suit] & (1 << top)) !== 0 ? partner : -1;
    let score: number;
    if (owner === seat) score = rank === top ? 80 : 20 - rank;
    else if (owner === partner) score = 60 - rank;
    else score = 10 - rank;
    if (owner < 0) {
      const live = suitMask(suit);
      const second = highestBit(live & ~(1 << top));
      const lhoTop = (hands[(3 & (seat + 1)) * 4 + suit] & (1 << top)) !== 0;
      if (second >= 0 && (hands[partner * 4 + suit] & (1 << second)) !== 0 && lhoTop) score = 40 - rank;
      else if (second >= 0 && (hands[seat * 4 + suit] & (1 << second)) !== 0 && rank === second) score = 30;
    }
    if (trump === NO_TRUMP) score += 2 * bitCount(hands[seat * 4 + suit]);

    if (trump !== NO_TRUMP && suit !== trump) {
      const left = 4 * (3 & (seat + 1));
      const right = 4 * (3 & (seat + 3));
      if (hands[left + suit] === 0 && hands[left + trump] !== 0) score -= 40;
      if (hands[right + suit] === 0 && hands[right + trump] !== 0) score -= 40;
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
    // What the seats still to play hold: the last seat's top card of the led suit and top trump, and the
    // third seat's top card of the led suit and whether it can ruff instead.
    let lastTop = -1;
    let lastTrump = -1;
    let thirdTop = -1;
    let thirdRuffs = false;
    if (step === 1 || step === 2) {
      const last = 4 * ((leader + 3) & 3);
      lastTop = highestBit(hands[last + ledSuit]);
      if (trump !== NO_TRUMP) lastTrump = highestBit(hands[last + trump]);
      const third = 4 * ((leader + 2) & 3);
      thirdTop = highestBit(hands[third + ledSuit]);
      thirdRuffs = thirdTop < 0 && trump !== NO_TRUMP && ledSuit !== trump && hands[third + trump] !== 0;
    }
    // Partner's winning card is safe unless the last seat can still beat it.
    const lastBeats = lastTop >= 0 ? winSuit === ledSuit && lastTop > winRank
      : lastTrump >= 0 && (winSuit !== trump || lastTrump > winRank);
    const partnerSafe = partnerWinning && !(step === 2 && lastBeats);
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
          // Cheapest card that wins, preferring one the seats still to play cannot beat; otherwise the lowest
          // card, keeping trumps.
          const beats = suit === winSuit ? rank > winRank : suit === trump && winSuit !== trump;
          if (partnerSafe) score = -rank - (suit === trump && ledSuit !== trump ? 30 : 0);
          else if (!beats) score = -rank - (suit === trump ? 20 : 0);
          else if (step === 1) score = suit === ledSuit && thirdTop < rank && !thirdRuffs ? 60 - rank : 50 - rank;
          else if (step === 2 && suit === ledSuit && rank < lastTop) score = 30 - rank;
          else if (step === 2 && suit === trump && ledSuit !== trump && lastTop < 0 && lastTrump > rank) score = 20 - rank;
          else score = 50 - rank;
        }
        moveCards[base + count] = suit * 16 + rank;
        moveScores[base + count] = suit * 16 + rank === hint ? 1 << 24 : score;
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

  /** Rounds of the suit that `seat` can lead before an opponent holding trumps is void in it. */
  function roundsBeforeRuff(seat: number, suit: number): number {
    let rounds = 13;
    if (trump !== NO_TRUMP && suit !== trump) {
      const left = 3 & (seat + 1);
      const right = 3 & (seat + 3);
      if (hands[left * 4 + trump] !== 0) rounds = bitCount(hands[left * 4 + suit]);
      if (hands[right * 4 + trump] !== 0) rounds = Math.min(rounds, bitCount(hands[right * 4 + suit]));
    }
    return rounds;
  }

  /**
   * Whether the leader's side can take `goal` tricks at once. The leader cashes the top cards it holds in
   * each suit, then may finish in one suit by leading a further card to partner's top cards that follow the
   * leader's. Partner keeps those winners only while it has other cards to play on the leader's. Marks the
   * cards used at `at`.
   */
  function quickTricks(leader: number, goal: number, at: number): boolean {
    const partner = 3 & (leader + 2);
    let total = 0;
    let partnerCards = 0;
    for (let suit = 0; suit < 4; suit++) {
      const mine = hands[leader * 4 + suit];
      const theirs = hands[partner * 4 + suit];
      partnerCards += bitCount(theirs);
      ownWinners[suit] = 0;
      crossRuns[suit] = 0;
      crossTricks[suit] = 0;
      if (mine === 0) continue;
      const live = suitMask(suit);
      const cap = roundsBeforeRuff(leader, suit);
      let run = 0;
      let rank = highestBit(live);
      for (; rank >= 0 && (mine & (1 << rank)) !== 0; rank = highestBit(live & ((1 << rank) - 1))) run++;
      let follow = 0;
      for (; rank >= 0 && (theirs & (1 << rank)) !== 0; rank = highestBit(live & ((1 << rank) - 1))) follow++;
      ownWinners[suit] = Math.min(run, cap);
      total += ownWinners[suit];
      if (follow > 0 && bitCount(mine) > run) {
        // Partner plays low cards on the leader's winners; once out of them it must waste its own.
        const kept = follow - Math.max(0, run - (bitCount(theirs) - follow));
        crossRuns[suit] = run + follow;
        crossTricks[suit] = Math.min(run + kept, cap) - ownWinners[suit];
      }
    }
    if (total >= goal) {
      for (let suit = 0, marked = 0; marked < goal; suit++) {
        const used = Math.min(ownWinners[suit], goal - marked);
        if (used > 0) markTop(at, suit, used);
        marked += used;
      }
      return true;
    }
    let best = 0;
    let bestSuit = -1;
    for (let suit = 0; suit < 4; suit++) {
      if (crossTricks[suit] <= 0) continue;
      // Cards partner must play on the leader's winners in the other suits beyond its cards outside this one.
      const excess = Math.max(0, total - ownWinners[suit] - (partnerCards - bitCount(hands[partner * 4 + suit])));
      const extra = crossTricks[suit] - excess;
      if (extra > best) {
        best = extra;
        bestSuit = suit;
      }
    }
    if (total + best < goal) return false;
    for (let suit = 0; suit < 4; suit++) {
      if (suit === bestSuit) markTop(at, suit, crossRuns[suit]);
      else if (ownWinners[suit] > 0) markTop(at, suit, ownWinners[suit]);
    }
    return true;
  }

  /** Whether a single seat of `team` (0 = N-S, 1 = E-W) holds the `goal` highest live trumps; marks them. */
  function trumpWinners(team: number, goal: number, at: number): boolean {
    const live = suitMask(trump);
    if (live === 0) return false;
    const top = highestBit(live);
    const holder = (hands[team * 4 + trump] & (1 << top)) !== 0 ? team : (hands[(team + 2) * 4 + trump] & (1 << top)) !== 0 ? team + 2 : -1;
    if (holder < 0) return false;
    let count = 0;
    for (let rank = top; rank >= 0 && count < goal && (hands[holder * 4 + trump] & (1 << rank)) !== 0; rank = highestBit(live & ((1 << rank) - 1))) count++;
    if (count < goal) return false;
    markTop(at, trump, goal);
    return true;
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

  /** Owner sequence of the remaining cards per suit, top down, and the hand lengths, kept for this ply. */
  function computeKey(ply: number): void {
    const at = ply * 4;
    let low = 0;
    let high = 0;
    for (let suit = 0; suit < 4; suit++) {
      const east = hands[4 + suit];
      const south = hands[8 + suit];
      const west = hands[12 + suit];
      const live = hands[suit] | east | south | west;
      // Owner bits: the low bit marks E and W, the high bit S and W.
      ownerWords[at + suit] = SPREAD[compress(east | west, live)] | (SPREAD[compress(south | west, live)] << 1);
      suitLengths[at + suit] = BIT_COUNTS[live];
      low |= (BIT_COUNTS[hands[suit]] << (suit * 4)) | (BIT_COUNTS[east] << (16 + suit * 4));
      high |= (BIT_COUNTS[south] << (suit * 4)) | (BIT_COUNTS[west] << (16 + suit * 4));
    }
    handLengths[ply * 2] = low;
    handLengths[ply * 2 + 1] = high;
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

  /** Stores the result of the search at a boundary under the cards that mattered to it. */
  function store(leader: number, need: number, left: number, ply: number, result: boolean): void {
    const at = ply * 4;
    let m0 = 0;
    let m1 = 0;
    let m2 = 0;
    let m3 = 0;
    for (let suit = 0; suit < 4; suit++) {
      const ranks = win[at + suit];
      if (ranks === 0) continue;
      const count = bitCount(suitMask(suit) & ~((1 << lowestBit(ranks)) - 1));
      const mask = ((1 << (2 * count)) - 1) << (2 * (suitLengths[at + suit] - count));
      if (suit === 0) m0 = mask;
      else if (suit === 1) m1 = mask;
      else if (suit === 2) m2 = mask;
      else m3 = mask;
    }
    const o0 = ownerWords[at] & m0;
    const o1 = ownerWords[at + 1] & m1;
    const o2 = ownerWords[at + 2] & m2;
    const o3 = ownerWords[at + 3] & m3;
    const slot = claimDist(table, trumpTag + leader, handLengths[ply * 2], handLengths[ply * 2 + 1], searchAge);
    distAges[slot] = searchAge;
    let entry = -1;
    for (let chunk = distHeads[slot]; chunk >= 0 && entry < 0; chunk = chunkNext[chunk]) {
      for (let index = chunk * CHUNK, last = index + chunkFill[chunk]; index < last; index++) {
        const q = index * 4;
        if (masks[q] === m0 && owners[q] === o0 && masks[q + 1] === m1 && owners[q + 1] === o1
          && masks[q + 2] === m2 && owners[q + 2] === o2 && masks[q + 3] === m3 && owners[q + 3] === o3) {
          entry = index;
          break;
        }
      }
    }
    if (entry < 0) {
      entry = newEntry(table, slot, searchAge);
      const q = entry * 4;
      masks[q] = m0;
      masks[q + 1] = m1;
      masks[q + 2] = m2;
      masks[q + 3] = m3;
      owners[q] = o0;
      owners[q + 1] = o1;
      owners[q + 2] = o2;
      owners[q + 3] = o3;
      lower[entry] = 0;
      upper[entry] = left;
      leads[entry] = 0;
    }
    const cut = cutoffs[ply];
    if (cut >= 0) leads[entry] = (cut >> 4) * 16 + bitCount(suitMask(cut >> 4) >>> ((cut & 15) + 1)) + 1;
    // Bounds are kept in N-S tricks so either side's searches can use them.
    const northSouth = side === 0 ? need : left - need + 1;
    if (result === (side === 0)) lower[entry] = Math.max(lower[entry], northSouth);
    else upper[entry] = Math.min(upper[entry], northSouth - 1);
  }

  /** At a trick boundary: can the side win `need` of the `left` remaining tricks with `leader` on lead? */
  function boundary(leader: number, need: number, left: number, trickBase: number, ply: number): boolean {
    const at = ply * 4;
    clearWin(at);
    if (need <= 0) return true;
    if (need > left) return false;
    const ours = (leader & 1) === side;
    // Tricks the leader's side must take to decide the question: `need` for us, or enough to defeat it.
    const decisive = ours ? need : left - need + 1;
    if (quickTricks(leader, decisive, at)) return ours;
    clearWin(at);
    // The other side's top trumps held by one seat each win a trick however the play goes.
    if (trump !== NO_TRUMP) {
      if (trumpWinners(1 ^ (leader & 1), left - decisive + 1, at)) return !ours;
      clearWin(at);
    }
    computeKey(ply);
    const slot = findDist(table, trumpTag + leader, handLengths[ply * 2], handLengths[ply * 2 + 1]);
    let hint = -1;
    if (slot >= 0) {
      distAges[slot] = searchAge;
      // N-S tricks that decide the question either way.
      const atLeast = side === 0 ? need : -1;
      const atMost = side === 0 ? need - 1 : left - need;
      const w0 = ownerWords[at];
      const w1 = ownerWords[at + 1];
      const w2 = ownerWords[at + 2];
      const w3 = ownerWords[at + 3];
      for (let chunk = distHeads[slot]; chunk >= 0; chunk = chunkNext[chunk]) {
        const first = chunk * CHUNK;
        for (let entry = first + chunkFill[chunk] - 1; entry >= first; entry--) {
          const q = entry * 4;
          if (((w0 ^ owners[q]) & masks[q]) !== 0 || ((w1 ^ owners[q + 1]) & masks[q + 1]) !== 0
            || ((w2 ^ owners[q + 2]) & masks[q + 2]) !== 0 || ((w3 ^ owners[q + 3]) & masks[q + 3]) !== 0) continue;
          const proven = side === 0 ? (lower[entry] >= atLeast ? 1 : upper[entry] <= atMost ? 0 : -1)
            : (upper[entry] <= atMost ? 1 : lower[entry] > atMost ? 0 : -1);
          if (proven >= 0) {
            for (let suit = 0; suit < 4; suit++) {
              const mask = masks[q + suit];
              if (mask !== 0) markTop(at, suit, bitCount(mask) >> 1);
            }
            // Recently useful entries move to the front of the scan.
            const front = distHeads[slot] * CHUNK + chunkFill[distHeads[slot]] - 1;
            if (entry !== front) swapEntries(table, entry, front);
            return proven === 1;
          }
          if (hint < 0 && leads[entry] !== 0) hint = absoluteLead(leader, leads[entry] - 1);
        }
      }
    }
    const result = play(0, leader, need, left, trickBase, ply, hint);
    store(leader, need, left, ply, result);
    return result;
  }

  /** Inside a trick: `step` cards are down; `need` counts the current trick. */
  function play(step: number, leader: number, need: number, left: number, trickBase: number, ply: number, hint = -1): boolean {
    tick();
    const at = ply * 4;
    if (step === 4) {
      const best = winnerIndex(trickBase, 4);
      const winner = (leader + best) & 3;
      const result = boundary(winner, need - ((winner & 1) === side ? 1 : 0), left - 1, trickBase + 4, ply);
      // A trick won by outranking a card of the same suit depends on the winning card's rank.
      const suit = trickSuit[trickBase + best];
      for (let index = 0; index < 4; index++) {
        if (index !== best && trickSuit[trickBase + index] === suit) {
          win[at + suit] |= 1 << trickRank[trickBase + best];
          break;
        }
      }
      return result;
    }
    const seat = (leader + step) & 3;
    const maximizing = (seat & 1) === side;
    const count = generate(seat, step, leader, trickBase, ply, hint);
    const base = ply * MAX_MOVES;
    const child = at + 4;
    clearWin(at);
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
        win[at] = win[child];
        win[at + 1] = win[child + 1];
        win[at + 2] = win[child + 2];
        win[at + 3] = win[child + 3];
        cutoffs[ply] = card;
        return result;
      }
      win[at] |= win[child];
      win[at + 1] |= win[child + 1];
      win[at + 2] |= win[child + 2];
      win[at + 3] |= win[child + 3];
      // The other cards of this card's run were not searched; they stand for it only while they all
      // count as exact cards, so a result that depended on one of them depends on the whole run.
      if (win[child + suit] >>> (rank + 1) !== 0
        && (win[child + suit] & runAbove(seat, suit, rank, liveMask(suit, trickBase, step))) !== 0) win[at + suit] |= 1 << rank;
    }
    cutoffs[ply] = -1;
    return !maximizing;
  }

  function canReach(position: SolverPosition, need: number): boolean {
    if (expired()) abort();
    searchAge = nextAge(table);
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
