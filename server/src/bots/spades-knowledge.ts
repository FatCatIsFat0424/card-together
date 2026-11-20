import type { Card, Seat, Suit } from '@shared/types';
import type { SpadesTeam, SpadesVisibleState } from '@shared/games/spades/types';
import { SPADES_SEATS, spadesNext, spadesTeam, spadesTrickWinner } from '@shared/rules/spades';

// What one Spades seat can deduce from its own filtered view: unseen cards, suits other seats have shown
// out of, contract progress, and rough chances that a later seat can beat a card. Shared by the heuristic
// strategy and the determinized search (bid evidence and hard deal limits).

export const SPADES_SUITS: readonly Suit[] = ['clubs', 'diamonds', 'hearts', 'spades'];

const PARTNER: Readonly<Record<Seat, Seat>> = { N: 'S', S: 'N', E: 'W', W: 'E' };

export function spadesPartner(seat: Seat): Seat {
  return PARTNER[seat];
}

export function cardId(card: Card): string {
  return `${card.suit}:${card.rank}`;
}

/** Suits each seat has shown it lacks, from every trick of the hand so far. */
export function spadesVoids(visible: Pick<SpadesVisibleState, 'position'>): Record<Seat, Set<Suit>> {
  const voids = Object.fromEntries(SPADES_SEATS.map((seat) => [seat, new Set<Suit>()])) as Record<Seat, Set<Suit>>;
  const { position } = visible;
  let broken = false;
  const tricks = [...position.tricks.map((trick) => trick.plays), position.trick];
  for (const plays of tricks) {
    if (plays.length === 0) continue;
    const lead = plays[0];
    // Spades may be led before they are broken only from a hand of nothing but spades.
    if (lead.card.suit === 'spades' && !broken) {
      for (const suit of SPADES_SUITS) if (suit !== 'spades') voids[lead.seat].add(suit);
    }
    for (const play of plays.slice(1)) if (play.card.suit !== lead.card.suit) voids[play.seat].add(lead.card.suit);
    if (plays.some((play) => play.card.suit === 'spades')) broken = true;
  }
  return voids;
}

/** Cards played by each seat this hand, the current trick included. */
export function spadesPlayedBy(visible: Pick<SpadesVisibleState, 'position'>): Record<Seat, Card[]> {
  const played = Object.fromEntries(SPADES_SEATS.map((seat) => [seat, [] as Card[]])) as Record<Seat, Card[]>;
  for (const plays of [...visible.position.tricks.map((trick) => trick.plays), visible.position.trick]) {
    for (const play of plays) played[play.seat].push(play.card);
  }
  return played;
}

/** Bid and tricks of a team's non-Nil members: only they fulfill its contract. */
export function teamContract(
  bids: Readonly<Record<Seat, number | null>>, taken: Readonly<Record<Seat, number>>, team: SpadesTeam,
): { readonly contract: number; readonly tricks: number; readonly need: number } {
  let contract = 0;
  let tricks = 0;
  for (const seat of SPADES_SEATS) {
    if (spadesTeam(seat) !== team || !bids[seat]) continue;
    contract += bids[seat]!;
    tricks += taken[seat];
  }
  return { contract, tricks, need: Math.max(0, contract - tricks) };
}

export interface SpadesTable {
  readonly visible: SpadesVisibleState;
  readonly seat: Seat;
  readonly partner: Seat;
  readonly team: SpadesTeam;
  readonly opponents: readonly Seat[];
  readonly hand: readonly Card[];
  readonly unseen: readonly Card[];
  readonly voids: Readonly<Record<Seat, ReadonlySet<Suit>>>;
  readonly bids: Readonly<Record<Seat, number>>;
  /** Seats still to play to the current trick after this seat, in order. */
  readonly later: readonly Seat[];
  /** Tricks not yet finished, the current one included. */
  readonly tricksLeft: number;
  /** Tricks this seat's team still needs for its non-Nil contract. */
  readonly ourNeed: number;
  /** Tricks the opponents still need for theirs. */
  readonly theirNeed: number;
  /** Bid Nil and has taken no trick yet. */
  readonly nilLive: (seat: Seat) => boolean;
}

export function readSpadesTable(visible: SpadesVisibleState): SpadesTable {
  const seat = visible.mySeat;
  const { position } = visible;
  const partner = spadesPartner(seat);
  const team = spadesTeam(seat);
  const opponents = SPADES_SEATS.filter((other) => spadesTeam(other) !== team);
  const played = spadesPlayedBy(visible);
  const known = new Set([...visible.myHand, ...SPADES_SEATS.flatMap((other) => played[other])].map(cardId));
  const unseen: Card[] = [];
  for (const suit of SPADES_SUITS) {
    for (let rank = 2; rank <= 14; rank++) {
      const card = { suit, rank } as Card;
      if (!known.has(cardId(card))) unseen.push(card);
    }
  }
  const bids = Object.fromEntries(SPADES_SEATS.map((other) => [other, position.bids[other] ?? 0])) as Record<Seat, number>;
  const later: Seat[] = [];
  if (position.trick.length > 0) {
    for (let next = spadesNext(seat); later.length < 3 - position.trick.length; next = spadesNext(next)) later.push(next);
  }
  const opponentTeam = spadesTeam(spadesNext(seat));
  return {
    visible, seat, partner, team, opponents, hand: visible.myHand, unseen,
    voids: spadesVoids(visible),
    bids,
    later,
    tricksLeft: 13 - position.tricks.length,
    ourNeed: teamContract(position.bids, position.taken, team).need,
    theirNeed: teamContract(position.bids, position.taken, opponentTeam).need,
    nilLive: (other) => position.bids[other] === 0 && position.taken[other] === 0,
  };
}

/** Chance that `seat` holds one particular unseen card, from hand sizes and known voids. */
export function holdChance(table: SpadesTable, seat: Seat, card: Card): number {
  if (seat === table.seat || table.voids[seat].has(card.suit)) return 0;
  const counts = table.visible.handCounts;
  let room = 0;
  for (const other of SPADES_SEATS) {
    if (other !== table.seat && !table.voids[other].has(card.suit)) room += counts[other] ?? 0;
  }
  return room > 0 ? Math.min(1, (counts[seat] ?? 0) / room) : 0;
}

function anyHeld(table: SpadesTable, seat: Seat, cards: readonly Card[]): number {
  let miss = 1;
  for (const card of cards) miss *= 1 - holdChance(table, seat, card);
  return 1 - miss;
}

/** Chance that `seat` has no card of `suit` left. */
export function voidChance(table: SpadesTable, seat: Seat, suit: Suit): number {
  if (table.voids[seat].has(suit)) return 1;
  return 1 - anyHeld(table, seat, table.unseen.filter((card) => card.suit === suit));
}

/** Chance that `seat`, playing later to a trick led in `leadSuit`, can beat `card`. */
export function beatChance(table: SpadesTable, seat: Seat, card: Card, leadSuit: Suit): number {
  const higher = (other: Card): boolean => other.suit === card.suit && other.rank > card.rank;
  if (card.suit === leadSuit) {
    const follow = anyHeld(table, seat, table.unseen.filter(higher));
    if (leadSuit === 'spades') return follow;
    const ruff = voidChance(table, seat, leadSuit) * anyHeld(table, seat, table.unseen.filter((other) => other.suit === 'spades'));
    return 1 - (1 - follow) * (1 - ruff);
  }
  if (card.suit !== 'spades') return 0;
  return voidChance(table, seat, leadSuit) * anyHeld(table, seat, table.unseen.filter(higher));
}

/** Chance that `card`, now winning the trick, survives every later opponent. */
export function holdsChance(table: SpadesTable, card: Card, leadSuit: Suit, seats: readonly Seat[] = table.later): number {
  let hold = 1;
  for (const seat of seats) if (spadesTeam(seat) !== table.team) hold *= 1 - beatChance(table, seat, card, leadSuit);
  return hold;
}

/** Unseen cards of the suit ranked above `card`; equal values mean equal strength. */
export function unseenAbove(table: SpadesTable, card: Card): number {
  return table.unseen.filter((other) => other.suit === card.suit && other.rank > card.rank).length;
}

/** Unseen cards of the suit ranked below `card`. */
export function unseenBelow(table: SpadesTable, card: Card): number {
  return table.unseen.filter((other) => other.suit === card.suit && other.rank < card.rank).length;
}

/** The seat that wins the current trick if `card` is added to it. */
export function winnerWith(table: SpadesTable, card: Card): Seat {
  return spadesTrickWinner([...table.visible.position.trick, { seat: table.seat, card }]);
}

// ─── Hand valuation for bidding and bid evidence ───

function ranksOf(hand: readonly Card[], suit: Suit): number[] {
  return hand.filter((card) => card.suit === suit).map((card) => card.rank).sort((a, b) => b - a);
}

/**
 * Expected tricks of a 13-card hand: side-suit honors discounted when short or long, spade honors and
 * length, and ruffs from short side suits paid for with spades not already counted as winners.
 */
export function estimateSpadesTricks(hand: readonly Card[]): number {
  const spades = ranksOf(hand, 'spades');
  const has = (ranks: readonly number[], rank: number): boolean => ranks.includes(rank);
  let tricks = 0;
  let shortness = 0;
  for (const suit of SPADES_SUITS) {
    if (suit === 'spades') continue;
    const ranks = ranksOf(hand, suit);
    const length = ranks.length;
    if (has(ranks, 14)) tricks += length >= 7 ? 0.75 : length >= 6 ? 0.85 : 0.95;
    if (has(ranks, 13)) tricks += length === 1 ? 0.15 : has(ranks, 14) ? (length >= 6 ? 0.5 : 0.8) : length >= 6 ? 0.35 : 0.6;
    if (has(ranks, 12) && length >= 3 && length <= 5) tricks += has(ranks, 14) || has(ranks, 13) ? 0.35 : 0.2;
    shortness += length === 0 ? 1 : length === 1 ? (has(ranks, 14) ? 0.4 : 0.6) : length === 2 ? 0.25 : 0;
  }
  const count = spades.length;
  let spadeTricks = 0;
  if (has(spades, 14)) spadeTricks += 1;
  if (has(spades, 13)) spadeTricks += count >= 2 ? 0.9 : 0.35;
  if (has(spades, 12)) spadeTricks += count >= 3 ? 0.7 : count === 2 ? 0.3 : 0.1;
  if (has(spades, 11)) spadeTricks += count >= 4 ? 0.5 : count === 3 ? 0.2 : 0;
  // Long spades win once the others are drawn.
  const lengthTricks = Math.max(0, count - 3) * 0.8;
  spadeTricks = Math.max(spadeTricks, 0) + lengthTricks;
  const spare = Math.max(0, count - Math.round(spadeTricks));
  tricks += spadeTricks + Math.min(shortness, spare * 0.75);
  return tricks;
}

/**
 * How dangerous a 13-card hand is for Nil, in rough expected forced tricks: high cards in short suits and
 * any high or numerous spades.
 */
export function nilRisk(hand: readonly Card[]): number {
  let risk = 0;
  for (const suit of SPADES_SUITS) {
    const ranks = ranksOf(hand, suit);
    const length = ranks.length;
    if (length === 0) continue;
    const low = ranks.filter((rank) => rank <= 6).length;
    if (suit === 'spades') {
      for (const rank of ranks) risk += rank >= 13 ? 1 : rank >= 11 ? 0.6 : rank >= 9 ? 0.25 : 0.05;
      risk += Math.max(0, length - 3) * 0.35;
      continue;
    }
    for (const rank of ranks) {
      if (rank < 9) continue;
      // Low cards beside a high card let it be discarded or ducked; short suits force it out early.
      const cover = Math.min(1, low / Math.max(1, 15 - rank));
      const base = rank === 14 ? 0.9 : rank === 13 ? 0.6 : rank === 12 ? 0.35 : rank === 11 ? 0.18 : 0.06;
      risk += base * (1 - 0.55 * cover) * (length <= 2 ? 1.2 : 1);
    }
  }
  return risk;
}
