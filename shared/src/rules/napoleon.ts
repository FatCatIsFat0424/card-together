// ─── Napoleon rules engine (pure functions, shared by client and server) ───
// Rules: docs/games.md#napoleon

import type {
  BidSuit, Card, GameSeat, NapoleonBidAction, NapoleonBidLevel, NapoleonBiddingState, NapoleonCard,
  NapoleonContract, NapoleonJoker, NapoleonOptions, NapoleonSummon, NapoleonTrick, NapoleonTrickRecord, Suit,
} from '../types';
import { BID_SUIT_ORDER, RANK_ORDER_DESC, SUIT_DISPLAY_ORDER } from '../constants';

export const NAPOLEON_MIN_LEVEL: NapoleonBidLevel = 9;
export const NAPOLEON_MAX_LEVEL: NapoleonBidLevel = 16;
export const NAPOLEON_BID_LEVELS: readonly NapoleonBidLevel[] = [9, 10, 11, 12, 13, 14, 15, 16];
/** Point cards: A, K, Q, J of every suit */
export const NAPOLEON_POINT_CARDS = 16;
/** Jokers lose their strength in this many final tricks */
export const NAPOLEON_FINAL_TRICKS = 3;
/** Shared acknowledgment window for public discards, never shorter than this */
export const NAPOLEON_MIN_REVIEW_SECONDS = 15;

const SUITS: readonly Suit[] = ['clubs', 'diamonds', 'hearts', 'spades'];

/** Hand and face-down table sizes by player count. */
const DEAL_SIZES: Readonly<Record<number, { readonly hand: number; readonly kitty: number }>> = {
  4: { hand: 13, kitty: 2 },
  5: { hand: 10, kitty: 4 },
  6: { hand: 8, kitty: 6 },
};

export function napoleonDealSize(playerCount: number): { readonly hand: number; readonly kitty: number } {
  const size = DEAL_SIZES[playerCount];
  if (!size) throw new RangeError(`Napoleon needs four to six players, not ${playerCount}.`);
  return size;
}

/** With four players the discards are public. */
export function napoleonDiscardsPublic(playerCount: number): boolean {
  return playerCount === 4;
}

export function napoleonReviewSeconds(baseSeconds: number): number {
  return Math.max(NAPOLEON_MIN_REVIEW_SECONDS, baseSeconds * 2);
}

// ─── Cards ───

export function isNapoleonJoker(card: NapoleonCard): card is { readonly joker: NapoleonJoker } {
  return 'joker' in card;
}

export function napoleonJoker(joker: NapoleonJoker): NapoleonCard {
  return { joker };
}

/** Stable identity: `S14`, `H2`, `BJ` (big joker), `SJ` (small joker). */
export function napoleonCardKey(card: NapoleonCard): string {
  if (isNapoleonJoker(card)) return card.joker === 'big' ? 'BJ' : 'SJ';
  return `${card.suit[0].toUpperCase()}${card.rank}`;
}

export function sameNapoleonCard(a: NapoleonCard, b: NapoleonCard): boolean {
  return napoleonCardKey(a) === napoleonCardKey(b);
}

export function hasNapoleonCard(cards: readonly NapoleonCard[], card: NapoleonCard): boolean {
  return cards.some((candidate) => sameNapoleonCard(candidate, card));
}

export function removeNapoleonCards(cards: readonly NapoleonCard[], removed: readonly NapoleonCard[]): NapoleonCard[] {
  return cards.filter((card) => !hasNapoleonCard(removed, card));
}

/** The 54 cards: 52 suit cards then the big and small jokers. */
export function createNapoleonDeck(): NapoleonCard[] {
  const deck: NapoleonCard[] = SUITS.flatMap((suit) => RANK_ORDER_DESC.map((rank): Card => ({ suit, rank })));
  return [...deck, napoleonJoker('big'), napoleonJoker('small')];
}

export function isNapoleonCard(value: unknown): value is NapoleonCard {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 1 && keys[0] === 'joker') return record.joker === 'big' || record.joker === 'small';
  return keys.length === 2 && SUITS.includes(record.suit as Suit)
    && (RANK_ORDER_DESC as readonly unknown[]).includes(record.rank);
}

export function isNapoleonPointCard(card: NapoleonCard): boolean {
  return !isNapoleonJoker(card) && card.rank >= 11;
}

export function napoleonPoints(cards: readonly NapoleonCard[]): number {
  return cards.filter(isNapoleonPointCard).length;
}

/**
 * Deals a shuffled deck: each seat gets consecutive cards in seat order and the remainder stays
 * face down. Throws unless the deck has all 54 cards.
 */
export function dealNapoleon(
  seats: readonly GameSeat[], shuffled: readonly NapoleonCard[],
): { hands: Partial<Record<GameSeat, NapoleonCard[]>>; kitty: NapoleonCard[] } {
  if (shuffled.length !== 54 || new Set(shuffled.map(napoleonCardKey)).size !== 54) {
    throw new RangeError('A Napoleon deal needs the 54 distinct cards.');
  }
  const { hand } = napoleonDealSize(seats.length);
  const hands: Partial<Record<GameSeat, NapoleonCard[]>> = {};
  seats.forEach((seat, index) => { hands[seat] = shuffled.slice(index * hand, (index + 1) * hand); });
  return { hands, kitty: shuffled.slice(seats.length * hand) };
}

/** Jokers first, then suits in display order with the trump suit leading, each from A down to 2. */
export function sortNapoleonHand(hand: readonly NapoleonCard[], trump: BidSuit | null = null): NapoleonCard[] {
  const suitOrder = trump && trump !== 'nt'
    ? [trump, ...SUIT_DISPLAY_ORDER.filter((suit) => suit !== trump)]
    : [...SUIT_DISPLAY_ORDER];
  const weight = (card: NapoleonCard): number => isNapoleonJoker(card)
    ? (card.joker === 'big' ? 0 : 1)
    : 2 + suitOrder.indexOf(card.suit) * 13 + RANK_ORDER_DESC.indexOf(card.rank);
  return [...hand].sort((a, b) => weight(a) - weight(b));
}

// ─── Seats ───

/** Next participant clockwise. */
export function nextNapoleonSeat(seats: readonly GameSeat[], seat: GameSeat): GameSeat {
  return seats[(seats.indexOf(seat) + 1) % seats.length];
}

// ─── Auction ───

export function createNapoleonBidding(startSeat: GameSeat): NapoleonBiddingState {
  return { bids: [], currentBidderSeat: startSeat, highestBid: null, consecutivePassCount: 0 };
}

/** Positive when `a` outranks `b`; at equal level NT > ♠ > ♥ > ♦ > ♣. */
export function compareNapoleonBids(
  a: { readonly level: number; readonly suit: BidSuit }, b: { readonly level: number; readonly suit: BidSuit },
): number {
  return a.level - b.level || BID_SUIT_ORDER.indexOf(a.suit) - BID_SUIT_ORDER.indexOf(b.suit);
}

export function napoleonValidBids(bidding: NapoleonBiddingState): NapoleonBidAction[] {
  const bids = NAPOLEON_BID_LEVELS.flatMap((level) => BID_SUIT_ORDER.map((suit) => ({ type: 'bid' as const, level, suit })))
    .filter((bid) => !bidding.highestBid || compareNapoleonBids(bid, bidding.highestBid) > 0);
  return [{ type: 'pass' }, ...bids];
}

export function napoleonBidError(bidding: NapoleonBiddingState, seat: GameSeat, action: NapoleonBidAction): string | null {
  if (bidding.currentBidderSeat !== seat) return 'It is not your turn to bid.';
  if (action.type === 'pass') return null;
  if (!NAPOLEON_BID_LEVELS.includes(action.level) || !BID_SUIT_ORDER.includes(action.suit)) return 'Invalid bid.';
  if (bidding.highestBid && compareNapoleonBids(action, bidding.highestBid) <= 0) {
    return 'A bid must be higher than the current bid.';
  }
  return null;
}

/** Returns the next auction state; the caller validates the action first. */
export function applyNapoleonBid(
  bidding: NapoleonBiddingState, seats: readonly GameSeat[], seat: GameSeat, action: NapoleonBidAction,
): NapoleonBiddingState {
  return {
    bids: [...bidding.bids, { seat, action }],
    currentBidderSeat: nextNapoleonSeat(seats, seat),
    highestBid: action.type === 'bid' ? { level: action.level, suit: action.suit, seat } : bidding.highestBid,
    consecutivePassCount: action.type === 'pass' ? bidding.consecutivePassCount + 1 : 0,
  };
}

/**
 * `all_pass`: every seat passed without a bid, so the cards are redealt. `contract`: everyone else
 * passed after the highest bid, or nothing can outbid 16 NT.
 */
export function napoleonBiddingEnd(
  bidding: NapoleonBiddingState, playerCount: number,
): 'continue' | 'all_pass' | 'contract' {
  const highest = bidding.highestBid;
  if (!highest) return bidding.consecutivePassCount >= playerCount ? 'all_pass' : 'continue';
  if (highest.level === NAPOLEON_MAX_LEVEL && highest.suit === 'nt') return 'contract';
  return bidding.consecutivePassCount >= playerCount - 1 ? 'contract' : 'continue';
}

export function napoleonContract(bidding: NapoleonBiddingState): NapoleonContract | null {
  const highest = bidding.highestBid;
  return highest ? { level: highest.level, suit: highest.suit, napoleon: highest.seat } : null;
}

// ─── Exchange ───

export function napoleonDiscardError(
  hand: readonly NapoleonCard[], cards: readonly NapoleonCard[], kittySize: number,
): string | null {
  if (cards.length !== kittySize) return `Discard exactly ${kittySize} cards.`;
  if (new Set(cards.map(napoleonCardKey)).size !== cards.length) return 'Each discarded card must be different.';
  if (!cards.every((card) => hasNapoleonCard(hand, card))) return 'You can only discard cards in your hand.';
  return null;
}

// ─── Play ───

/** Public play context, satisfied by both the server state and a player's visible state. */
export interface NapoleonPlayView {
  readonly seats: readonly GameSeat[];
  readonly options: NapoleonOptions;
  readonly contract: NapoleonContract | null;
  readonly secretaryCard: NapoleonCard | null;
  readonly trick: NapoleonTrick | null;
  readonly tricks: readonly NapoleonTrickRecord[];
}

/** Zero-based index of the trick in progress, or of the next one to lead. */
export function napoleonTrickIndex(view: Pick<NapoleonPlayView, 'tricks'>): number {
  return view.tricks.length;
}

/** Whether a trick is among the final three, where jokers become the weakest cards. */
export function isNapoleonFinalTrick(trickIndex: number, playerCount: number): boolean {
  return trickIndex >= napoleonDealSize(playerCount).hand - NAPOLEON_FINAL_TRICKS;
}

export function isNapoleonSecretaryCard(view: Pick<NapoleonPlayView, 'secretaryCard'>, card: NapoleonCard): boolean {
  return view.secretaryCard !== null && sameNapoleonCard(view.secretaryCard, card);
}

/** The secretary card and jokers may be played at any time and name a suit when led. */
export function isNapoleonFreeCard(view: Pick<NapoleonPlayView, 'secretaryCard'>, card: NapoleonCard): boolean {
  return isNapoleonJoker(card) || isNapoleonSecretaryCard(view, card);
}

/** Every card already played this deal, including the trick in progress. */
export function napoleonPlayedCards(view: Pick<NapoleonPlayView, 'trick' | 'tricks'>): NapoleonCard[] {
  return [...view.tricks.flatMap((trick) => trick.plays), ...(view.trick?.plays ?? [])].map((play) => play.card);
}

export function napoleonSummonedCard(
  view: Pick<NapoleonPlayView, 'secretaryCard'>, summon: NapoleonSummon,
): NapoleonCard | null {
  if (summon === 'secretary') return view.secretaryCard;
  return napoleonJoker(summon === 'bigJoker' ? 'big' : 'small');
}

function trumpSuit(contract: NapoleonContract): Suit | null {
  return contract.suit === 'nt' ? null : contract.suit;
}

/** The joker summon a led card may make, ignoring who holds the joker. */
function jokerSummonOf(view: NapoleonPlayView, card: NapoleonCard): NapoleonSummon | null {
  if (!view.options.jokerSummon || !view.contract || isNapoleonJoker(card)) return null;
  if (card.suit !== trumpSuit(view.contract)) return null;
  return card.rank === 2 ? 'bigJoker' : card.rank === 3 ? 'smallJoker' : null;
}

/**
 * Summons available when `seat` leads `card`. `discards` are the Napoleon's own discards, known
 * only to the Napoleon, who alone may call the secretary and only while another seat holds its card.
 */
export function napoleonSummonOptions(
  view: NapoleonPlayView, seat: GameSeat, hand: readonly NapoleonCard[], card: NapoleonCard,
  discards: readonly NapoleonCard[] | null,
): NapoleonSummon[] {
  if (!view.contract || !view.secretaryCard || (view.trick?.plays.length ?? 0) > 0) return [];
  const played = napoleonPlayedCards(view);
  const options: NapoleonSummon[] = [];
  const jokerSummon = jokerSummonOf(view, card);
  if (jokerSummon) {
    const joker = napoleonSummonedCard(view, jokerSummon)!;
    if (!isNapoleonSecretaryCard(view, joker) && !hasNapoleonCard(hand, joker) && !hasNapoleonCard(played, joker)) {
      options.push(jokerSummon);
    }
  }
  const secretary = view.secretaryCard;
  if (seat === view.contract.napoleon && !jokerSummon && !hasNapoleonCard(hand, secretary)
    && !hasNapoleonCard(discards ?? [], secretary) && !hasNapoleonCard(played, secretary)) {
    options.push('secretary');
  }
  return options;
}

/** The card a seat must play because the lead summoned it, or null. */
export function napoleonForcedCard(
  view: NapoleonPlayView, hand: readonly NapoleonCard[],
): NapoleonCard | null {
  const summon = view.trick?.summon;
  if (!summon) return null;
  const card = napoleonSummonedCard(view, summon);
  return card && hasNapoleonCard(hand, card) ? card : null;
}

/**
 * Why `seat` may not make this play, or null when it is legal. The caller checks the turn.
 * `discards` follows `napoleonSummonOptions`.
 */
export function napoleonPlayError(
  view: NapoleonPlayView, seat: GameSeat, hand: readonly NapoleonCard[],
  play: { readonly card: NapoleonCard; readonly leadSuit?: Suit; readonly summon?: NapoleonSummon },
  discards: readonly NapoleonCard[] | null,
): string | null {
  if (!view.contract || !view.secretaryCard || !view.trick) return 'Cards cannot be played now.';
  if (!hasNapoleonCard(hand, play.card)) return 'That card is not in your hand.';
  const leading = view.trick.plays.length === 0;
  if (leading) {
    const free = isNapoleonFreeCard(view, play.card);
    if (free && !play.leadSuit) return 'Choose the suit to follow.';
    if (!free && play.leadSuit !== undefined) return 'Only the secretary card or a joker names a suit.';
    if (play.leadSuit !== undefined && !SUITS.includes(play.leadSuit)) return 'Invalid suit.';
    if (play.summon && !napoleonSummonOptions(view, seat, hand, play.card, discards).includes(play.summon)) {
      return 'That card cannot be summoned now.';
    }
    return null;
  }
  if (play.leadSuit !== undefined || play.summon !== undefined) return 'Only the lead names a suit or summons.';
  const forced = napoleonForcedCard(view, hand);
  if (forced) return sameNapoleonCard(forced, play.card) ? null : 'The summoned card must be played.';
  if (isNapoleonFreeCard(view, play.card)) return null;
  const leadSuit = view.trick.leadSuit;
  const follows = (card: NapoleonCard): boolean => !isNapoleonJoker(card) && card.suit === leadSuit;
  // A secretary card of the led suit is free, so it never obliges its holder to follow.
  const canFollow = hand.some((card) => !isNapoleonFreeCard(view, card) && follows(card));
  if (canFollow && !follows(play.card)) return 'You must follow the led suit.';
  return null;
}

/** Cards the seat may play now under some suit and summon choice. */
export function napoleonValidCards(
  view: NapoleonPlayView, seat: GameSeat, hand: readonly NapoleonCard[],
): NapoleonCard[] {
  if (!view.trick) return [];
  const leading = view.trick.plays.length === 0;
  return hand.filter((card) => napoleonPlayError(view, seat, hand,
    leading && isNapoleonFreeCard(view, card) ? { card, leadSuit: 'spades' } : { card }, null) === null);
}

/** The trick with this play added; the caller validates it first. */
export function applyNapoleonPlay(
  trick: NapoleonTrick, seat: GameSeat, play: { readonly card: NapoleonCard; readonly leadSuit?: Suit; readonly summon?: NapoleonSummon },
): NapoleonTrick {
  if (trick.plays.length > 0) return { ...trick, plays: [...trick.plays, { seat, card: play.card }] };
  const card = play.card;
  return {
    leadSeat: seat,
    plays: [{ seat, card }],
    leadSuit: play.leadSuit ?? (isNapoleonJoker(card) ? null : card.suit),
    summon: play.summon ?? null,
  };
}

/**
 * Strength of a play within its trick: the secretary card beats everything; before the final three
 * tricks the big then small joker come next, then trumps, then the led suit. In the final three,
 * jokers rank below every suit card, except that a led joker counts as rank 1 (big) or 0 (small)
 * of the suit it named. Cards that can never win score at most 0.
 */
function playStrength(
  view: NapoleonPlayView, card: NapoleonCard, led: boolean, leadSuit: Suit, finalTrick: boolean,
): number {
  if (isNapoleonSecretaryCard(view, card)) return 10_000;
  const trump = view.contract ? trumpSuit(view.contract) : null;
  const suitStrength = (suit: Suit, rank: number): number => suit === trump ? 1000 + rank : suit === leadSuit ? 100 + rank : 0;
  if (isNapoleonJoker(card)) {
    if (!finalTrick) return card.joker === 'big' ? 5000 : 4000;
    if (led) return suitStrength(leadSuit, card.joker === 'big' ? 1 : 0);
    return card.joker === 'big' ? -1 : -2;
  }
  return suitStrength(card.suit, card.rank);
}

/** The seat that wins a complete trick. */
export function napoleonTrickWinner(view: NapoleonPlayView, trick: NapoleonTrick, trickIndex: number): GameSeat {
  if (!trick.leadSuit || trick.plays.length === 0) throw new RangeError('The trick has no lead.');
  const finalTrick = isNapoleonFinalTrick(trickIndex, view.seats.length);
  let best = trick.plays[0];
  let bestStrength = playStrength(view, best.card, true, trick.leadSuit, finalTrick);
  for (const play of trick.plays.slice(1)) {
    const strength = playStrength(view, play.card, false, trick.leadSuit, finalTrick);
    if (strength > bestStrength) {
      best = play;
      bestStrength = strength;
    }
  }
  return best.seat;
}

// ─── Settlement ───

/** Point cards each participant won in tricks. */
export function napoleonSeatPoints(
  seats: readonly GameSeat[], tricks: readonly NapoleonTrickRecord[],
): Record<GameSeat, number> {
  const points = Object.fromEntries(['N', 'E', 'S', 'W', 'P5', 'P6', 'P7', 'P8'].map((seat) => [seat, 0])) as Record<GameSeat, number>;
  for (const trick of tricks) {
    if (seats.includes(trick.winnerSeat)) points[trick.winnerSeat] += napoleonPoints(trick.plays.map((play) => play.card));
  }
  return points;
}

/** The Napoleon's side: the Napoleon plus a secretary held by another seat. */
export function napoleonSide(contract: NapoleonContract, secretarySeat: GameSeat | null): GameSeat[] {
  return secretarySeat && secretarySeat !== contract.napoleon ? [contract.napoleon, secretarySeat] : [contract.napoleon];
}

export function napoleonOutcome(
  seats: readonly GameSeat[], contract: NapoleonContract, secretarySeat: GameSeat | null,
  tricks: readonly NapoleonTrickRecord[], discards: readonly NapoleonCard[],
): {
  readonly points: Record<GameSeat, number>;
  readonly discardPoints: number;
  readonly napoleonPoints: number;
  readonly defenderPoints: number;
  readonly napoleonWins: boolean;
  readonly winners: GameSeat[];
} {
  const points = napoleonSeatPoints(seats, tricks);
  const side = napoleonSide(contract, secretarySeat);
  const discardPoints = napoleonPoints(discards);
  const napoleonTotal = side.reduce((total, seat) => total + points[seat], 0);
  const defenderPoints = seats.filter((seat) => !side.includes(seat))
    .reduce((total, seat) => total + points[seat], discardPoints);
  const napoleonWins = napoleonTotal >= contract.level;
  return {
    points,
    discardPoints,
    napoleonPoints: napoleonTotal,
    defenderPoints,
    napoleonWins,
    winners: seats.filter((seat) => side.includes(seat) === napoleonWins),
  };
}

