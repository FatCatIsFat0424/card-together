import type { BidAction, BidLevel, BidSuit, Card, Seat, Suit } from '@shared/types';
import { BID_SUIT_ORDER, HIGH_CARD_POINTS, SEAT_ORDER_CLOCKWISE } from '@shared/constants';

export const BRIDGE_SUITS: readonly Suit[] = ['clubs', 'diamonds', 'hearts', 'spades'];
export type NaturalBid = Extract<BidAction, { type: 'bid' }>;
export type SuitCounts = Readonly<Record<Suit, number>>;
export type PointRange = readonly [number, number];

export interface AuctionEntry {
  readonly seat: Seat;
  readonly action: BidAction;
}

const MAX_POINTS = 37;

/**
 * HCP ranges of the bot bidding agreements. Bidding uses them to choose calls and the
 * inference reads them back, so both sides of the agreement stay in one place.
 */
export const BRIDGE_RANGES = {
  opening: [11, MAX_POINTS],
  oneNtOpening: [15, 17],
  twoNtOpening: [20, 21],
  preempt: [5, 10],
  simpleRaise: [5, 12],
  limitRaise: [10, 18],
  oneNtResponse: [6, 12],
  twoNtResponse: [13, 18],
  oneLevelResponse: [6, MAX_POINTS],
  twoLevelResponse: [10, MAX_POINTS],
  minimumRebid: [11, 18],
  reverse: [16, MAX_POINTS],
  jumpNtRebid: [18, 24],
  oneLevelOvercall: [8, 18],
  twoLevelOvercall: [10, 18],
  ntOvercall: [15, 19],
} as const satisfies Record<string, PointRange>;

export interface SeatProfile {
  readonly minPoints: number;
  readonly maxPoints: number;
  readonly minLength: SuitCounts;
  readonly maxLength: SuitCounts;
  readonly balanced: boolean;
  /** Passed before anyone opened, so it holds fewer than opening values. */
  readonly passedHand: boolean;
  readonly bidSuits: readonly Suit[];
}

/** What one call promises; omitted fields add no information. */
export interface CallMeaning {
  readonly minPoints?: number;
  readonly maxPoints?: number;
  readonly minLength?: Partial<SuitCounts>;
  readonly maxLength?: Partial<SuitCounts>;
  readonly balanced?: boolean;
  readonly passedHand?: boolean;
  /** Partner must not pass while the next opponent passes. */
  readonly forcing?: boolean;
}

export type CallRole = 'opening' | 'response' | 'openerRebid' | 'overcall' | 'advance' | 'later';

export interface CallContext {
  readonly seat: Seat;
  readonly partner: Seat;
  readonly role: CallRole;
  readonly opening: { readonly seat: Seat; readonly bid: NaturalBid; readonly index: number } | null;
  readonly highest: (NaturalBid & { readonly seat: Seat }) | null;
  readonly ownBids: readonly NaturalBid[];
  readonly partnerBids: readonly NaturalBid[];
  readonly opponentSuits: readonly Suit[];
  readonly passedHand: boolean;
  /** Opponents bid after our side opened. */
  readonly interference: boolean;
  readonly partnerForcing: boolean;
  /** Passing now would end the auction. */
  readonly balancing: boolean;
}

export interface AuctionAnalysis {
  readonly profiles: Readonly<Record<Seat, SeatProfile>>;
  readonly meanings: readonly CallMeaning[];
}

export interface HandEstimate {
  readonly points: Readonly<Record<Seat, number>>;
  readonly lengths: Readonly<Record<Seat, SuitCounts>>;
}

interface MutableProfile {
  minPoints: number;
  maxPoints: number;
  minLength: Record<Suit, number>;
  maxLength: Record<Suit, number>;
  balanced: boolean;
  passedHand: boolean;
  bidSuits: Suit[];
}

export function partnerOf(seat: Seat): Seat {
  return SEAT_ORDER_CLOCKWISE[(SEAT_ORDER_CLOCKWISE.indexOf(seat) + 2) % 4];
}

export function isMajor(suit: BidSuit): boolean {
  return suit === 'hearts' || suit === 'spades';
}

export function handPoints(hand: readonly Card[]): number {
  return hand.reduce((sum, card) => sum + HIGH_CARD_POINTS[card.rank], 0);
}

export function suitLengths(hand: readonly Card[]): Record<Suit, number> {
  const lengths: Record<Suit, number> = { clubs: 0, diamonds: 0, hearts: 0, spades: 0 };
  for (const card of hand) lengths[card.suit]++;
  return lengths;
}

export function isBalancedShape(lengths: SuitCounts): boolean {
  const shape = BRIDGE_SUITS.map((suit) => lengths[suit]).sort((a, b) => b - a).join('');
  return shape === '4333' || shape === '4432' || shape === '5332';
}

/** Lowest legal level for a strain over the current highest bid, or 8 when none remains. */
export function cheapestLevel(suit: BidSuit, highest: { readonly level: BidLevel; readonly suit: BidSuit } | null): number {
  if (!highest) return 1;
  return BID_SUIT_ORDER.indexOf(suit) > BID_SUIT_ORDER.indexOf(highest.suit) ? highest.level : highest.level + 1;
}

function suitRecord(value: number): Record<Suit, number> {
  return { clubs: value, diamonds: value, hearts: value, spades: value };
}

function emptyProfile(): MutableProfile {
  return {
    minPoints: 0, maxPoints: MAX_POINTS, minLength: suitRecord(0), maxLength: suitRecord(13),
    balanced: false, passedHand: false, bidSuits: [],
  };
}

function isBid(action: BidAction): action is NaturalBid {
  return action.type === 'bid';
}

export function callContext(prior: readonly AuctionEntry[], seat: Seat, meanings: readonly CallMeaning[]): CallContext {
  const partner = partnerOf(seat);
  const openingIndex = prior.findIndex((entry) => isBid(entry.action));
  const openingEntry = openingIndex >= 0 ? prior[openingIndex] : undefined;
  const opening = openingEntry && isBid(openingEntry.action)
    ? { seat: openingEntry.seat, bid: openingEntry.action, index: openingIndex }
    : null;
  let highest: CallContext['highest'] = null;
  const ownBids: NaturalBid[] = [];
  const partnerBids: NaturalBid[] = [];
  const opponentSuits: Suit[] = [];
  let partnerFirstBidIndex = -1;
  let partnerLastBidIndex = -1;
  let interference = false;
  const ourSideOpened = opening !== null && (opening.seat === seat || opening.seat === partner);
  for (const [index, entry] of prior.entries()) {
    if (!isBid(entry.action)) continue;
    highest = { ...entry.action, seat: entry.seat };
    if (entry.seat === seat) ownBids.push(entry.action);
    else if (entry.seat === partner) {
      partnerBids.push(entry.action);
      if (partnerFirstBidIndex < 0) partnerFirstBidIndex = index;
      partnerLastBidIndex = index;
    } else {
      if (entry.action.suit !== 'nt' && !opponentSuits.includes(entry.action.suit)) opponentSuits.push(entry.action.suit);
      if (ourSideOpened) interference = true;
    }
  }
  const calledSince = (index: number): boolean => prior.slice(index + 1).some((entry) => entry.seat === seat);
  const passedHand = prior.slice(0, openingIndex < 0 ? prior.length : openingIndex).some((entry) => entry.seat === seat);
  let role: CallRole = 'later';
  if (!opening) role = 'opening';
  else if (opening.seat === partner && !calledSince(opening.index)) role = 'response';
  else if (opening.seat === seat && ownBids.length === 1 && partnerBids.length === 1 && !calledSince(partnerFirstBidIndex)) role = 'openerRebid';
  else if (!ourSideOpened && ownBids.length === 0 && partnerBids.length === 0) role = 'overcall';
  else if (!ourSideOpened && ownBids.length === 0 && partnerBids.length > 0 && !calledSince(partnerFirstBidIndex)) role = 'advance';
  const partnerForcing = partnerLastBidIndex >= 0
    && meanings[partnerLastBidIndex]?.forcing === true
    && prior.slice(partnerLastBidIndex + 1).every((entry) => !isBid(entry.action));
  let trailingPasses = 0;
  for (let index = prior.length - 1; index >= 0 && !isBid(prior[index].action); index--) trailingPasses++;
  const balancing = highest !== null && highest.seat !== partner && highest.seat !== seat && trailingPasses === 2;
  return {
    seat, partner, role, opening, highest, ownBids, partnerBids, opponentSuits,
    passedHand, interference, partnerForcing, balancing,
  };
}

function range([minPoints, maxPoints]: PointRange): Pick<CallMeaning, 'minPoints' | 'maxPoints'> {
  return { minPoints, maxPoints };
}

function jumpOf(ctx: CallContext, bid: NaturalBid): number {
  return bid.level - cheapestLevel(bid.suit, ctx.highest);
}

function length(suit: Suit, value: number): Partial<SuitCounts> {
  return { [suit]: value };
}

function describeOpening(action: BidAction, passesBefore: number): CallMeaning {
  if (!isBid(action)) return passesBefore < 3 ? { maxPoints: BRIDGE_RANGES.opening[0], passedHand: true } : {};
  if (action.suit === 'nt') {
    if (action.level === 1) return { ...range(BRIDGE_RANGES.oneNtOpening), balanced: true };
    if (action.level === 2) return { ...range(BRIDGE_RANGES.twoNtOpening), balanced: true };
    return { minPoints: 22, balanced: true };
  }
  if (action.level === 1) {
    // Fourth-seat practice openings may be weak and name the longest suit only.
    if (passesBefore === 3) return { minPoints: 0, minLength: length(action.suit, isMajor(action.suit) ? 4 : 3) };
    return { ...range(BRIDGE_RANGES.opening), minLength: length(action.suit, isMajor(action.suit) ? 5 : 3) };
  }
  const minimum = action.level === 2 ? 6 : 7;
  return {
    ...range(BRIDGE_RANGES.preempt), minLength: length(action.suit, minimum),
    maxLength: action.level === 2 ? length(action.suit, 6) : undefined,
  };
}

function describeResponse(ctx: CallContext, action: BidAction, profiles: Readonly<Record<Seat, MutableProfile>>): CallMeaning {
  const opened = ctx.opening!.bid;
  const contested = ctx.interference;
  if (opened.level === 1 && opened.suit !== 'nt') {
    const suit = opened.suit;
    const supportDenied = profiles[ctx.partner].minLength[suit] >= 5 ? 2 : 3;
    // A contested pass may hold values when the opponents are expected to fail at a high level.
    if (!isBid(action)) return { maxPoints: contested ? ((ctx.highest?.level ?? 1) >= 3 ? 15 : 10) : 5 };
    const jump = jumpOf(ctx, action);
    if (action.suit === 'nt') {
      if (action.level === 1) {
        const denied: Partial<Record<Suit, number>> = {};
        if (!contested) {
          for (const other of BRIDGE_SUITS) {
            if (other !== suit && BID_SUIT_ORDER.indexOf(other) > BID_SUIT_ORDER.indexOf(suit)) denied[other] = 3;
          }
        }
        if (isMajor(suit)) denied[suit] = supportDenied;
        return { minPoints: contested ? 8 : 6, maxPoints: BRIDGE_RANGES.oneNtResponse[1], maxLength: denied };
      }
      return { ...range(BRIDGE_RANGES.twoNtResponse), balanced: true };
    }
    if (action.suit === suit) {
      const support = supportDenied + 1;
      if (jump === 0) return { minPoints: BRIDGE_RANGES.simpleRaise[0], maxPoints: contested ? 15 : BRIDGE_RANGES.simpleRaise[1], minLength: length(suit, isMajor(suit) ? support : 4) };
      if (jump === 1) return { ...range(BRIDGE_RANGES.limitRaise), minLength: length(suit, isMajor(suit) ? support : 4) };
      return { minPoints: 3, maxPoints: 10, minLength: length(suit, 5) };
    }
    const maxPoints = ctx.passedHand ? BRIDGE_RANGES.opening[0] : MAX_POINTS;
    if (jump > 0) return { minPoints: 6, minLength: length(action.suit, 6) };
    if (action.level === 1) {
      return { minPoints: BRIDGE_RANGES.oneLevelResponse[0], maxPoints, minLength: length(action.suit, 4), forcing: !ctx.passedHand };
    }
    // Contested responders may also compete with a long suit below two-level response values.
    if (contested) return { minPoints: BRIDGE_RANGES.oneLevelResponse[0], minLength: length(action.suit, 5) };
    const minimum = isMajor(action.suit) || action.level > 2 ? 5 : 4;
    return {
      minPoints: action.level === 2 ? BRIDGE_RANGES.twoLevelResponse[0] : 12, maxPoints,
      minLength: length(action.suit, minimum), forcing: !ctx.passedHand,
    };
  }
  if (!isBid(action)) return {};
  const opponentsHold = ctx.highest?.seat !== ctx.partner;
  if (opened.suit === 'nt') {
    if (action.suit === 'nt') return { minPoints: opened.level === 1 ? 8 : 4, balanced: true };
    if (jumpOf(ctx, action) === 0 && action.level <= 2) return { minPoints: 0, maxPoints: 15, minLength: length(action.suit, 5) };
    return opponentsHold ? describeCompetitive(ctx, action, profiles) : { minLength: length(action.suit, 6) };
  }
  if (opponentsHold) return describeCompetitive(ctx, action, profiles);
  if (action.suit === 'nt') return { minPoints: 15 };
  return { minPoints: 12, minLength: length(action.suit, 6), maxLength: length(opened.suit, 1) };
}

function describeOpenerRebid(ctx: CallContext, action: BidAction, profiles: Readonly<Record<Seat, MutableProfile>>): CallMeaning {
  const opened = ctx.opening!.bid;
  const response = ctx.partnerBids[0];
  if (opened.level !== 1 || opened.suit === 'nt' || !isBid(action)) return describeLater(ctx, action, profiles);
  if (ctx.highest?.seat !== ctx.partner) return describeCompetitive(ctx, action, profiles);
  const own = opened.suit;
  const jump = jumpOf(ctx, action);
  // Fourth-seat practice openers keep rebidding by shape whatever their strength.
  const floor = (points: number): number => (ctx.opening!.index === 3 ? 0 : points);
  if (response.suit === own) return { minPoints: floor(16) };
  if (response.suit !== 'nt' && action.suit === response.suit) {
    const needed = profiles[ctx.partner].minLength[response.suit] >= 5 ? 3 : 4;
    if (jump === 0) return { minPoints: floor(BRIDGE_RANGES.minimumRebid[0]), maxPoints: 19, minLength: length(response.suit, needed) };
    return { minPoints: floor(14), minLength: length(response.suit, needed) };
  }
  if (action.suit === own) {
    if (jump === 0) return { minPoints: floor(BRIDGE_RANGES.minimumRebid[0]), maxPoints: BRIDGE_RANGES.minimumRebid[1], minLength: length(own, ctx.partnerForcing ? 5 : 6) };
    return { minPoints: floor(16), minLength: length(own, 6) };
  }
  if (action.suit === 'nt') {
    if (jump > 0) return { ...range(BRIDGE_RANGES.jumpNtRebid), balanced: true };
    return response.level === 1 && response.suit === 'nt'
      ? { minPoints: floor(BRIDGE_RANGES.jumpNtRebid[0]), balanced: true }
      : { minPoints: floor(BRIDGE_RANGES.minimumRebid[0]), maxPoints: 14 };
  }
  if (jump > 0) return { minPoints: floor(19), minLength: length(action.suit, 4), forcing: true };
  if (action.level === 1) return { minPoints: floor(BRIDGE_RANGES.opening[0]), minLength: length(action.suit, 4) };
  const reverse = BID_SUIT_ORDER.indexOf(action.suit) > BID_SUIT_ORDER.indexOf(own);
  if (reverse) return { minPoints: floor(BRIDGE_RANGES.reverse[0]), minLength: { [action.suit]: 4, [own]: isMajor(own) ? 5 : 4 }, forcing: true };
  return {
    minPoints: floor(BRIDGE_RANGES.opening[0]), maxPoints: action.level === 2 ? 18 : 24,
    minLength: { [action.suit]: 4, [own]: isMajor(own) ? 5 : 4 },
  };
}

function describeOvercall(ctx: CallContext, action: BidAction): CallMeaning {
  const relief = ctx.balancing ? 2 : 0;
  if (!isBid(action)) return ctx.highest && ctx.highest.level === 1 && !ctx.balancing ? { maxPoints: 17 } : {};
  if (ctx.balancing && action.suit !== 'nt' && action.level - cheapestLevel(action.suit, ctx.highest) === 0) {
    return action.level === 1 ? { minPoints: 6, minLength: length(action.suit, 5) } : { minLength: length(action.suit, 5) };
  }
  const jump = jumpOf(ctx, action);
  if (action.suit === 'nt') return { minPoints: BRIDGE_RANGES.ntOvercall[0] - relief * 2, maxPoints: BRIDGE_RANGES.ntOvercall[1], balanced: jump === 0 };
  if (jump === 0) {
    if (action.level === 1) return { minPoints: BRIDGE_RANGES.oneLevelOvercall[0] - relief, maxPoints: BRIDGE_RANGES.oneLevelOvercall[1], minLength: length(action.suit, 5) };
    if (action.level === 2) return { minPoints: BRIDGE_RANGES.twoLevelOvercall[0] - relief, maxPoints: BRIDGE_RANGES.twoLevelOvercall[1], minLength: length(action.suit, 5) };
    return { minPoints: 13 - relief, maxPoints: 18, minLength: length(action.suit, 6) };
  }
  return { ...range(BRIDGE_RANGES.preempt), minLength: length(action.suit, action.level <= 2 ? 6 : 7) };
}

function describeAdvance(ctx: CallContext, action: BidAction, profiles: Readonly<Record<Seat, MutableProfile>>): CallMeaning {
  const overcall = ctx.partnerBids[0];
  if (!isBid(action)) return {};
  if (ctx.highest?.seat !== ctx.partner) return describeCompetitive(ctx, action, profiles);
  const jump = jumpOf(ctx, action);
  if (overcall.suit !== 'nt' && action.suit === overcall.suit) {
    return jump === 0 ? { minPoints: 3, maxPoints: 20, minLength: length(overcall.suit, 3) } : { minPoints: 3, maxPoints: 10, minLength: length(overcall.suit, 4) };
  }
  if (action.suit === 'nt') return jump === 0 ? { minPoints: 8, maxPoints: 12 } : { minPoints: 13, maxPoints: 16 };
  if (overcall.suit === 'nt') return { minPoints: 0, maxPoints: 15, minLength: length(action.suit, 5) };
  return { minPoints: 10, maxPoints: 18, minLength: length(action.suit, 5) };
}

/** Competitive bids need a known eight-card fit or a six-card suit of one's own. */
function describeCompetitive(ctx: CallContext, action: BidAction, profiles: Readonly<Record<Seat, MutableProfile>>): CallMeaning {
  if (!isBid(action) || action.suit === 'nt') return {};
  const suit = action.suit;
  if (ctx.partnerBids.some((bid) => bid.suit === suit)) {
    return { minLength: length(suit, Math.min(5, Math.max(1, 8 - profiles[ctx.partner].minLength[suit]))) };
  }
  return { minLength: length(suit, Math.max(6, profiles[ctx.seat].minLength[suit])) };
}

/** Placement keeps partner's contract unless a natural strain is clearly better. */
function describeLater(ctx: CallContext, action: BidAction, profiles: Readonly<Record<Seat, MutableProfile>>): CallMeaning {
  if (ctx.highest?.seat !== ctx.partner) return describeCompetitive(ctx, action, profiles);
  if (!isBid(action)) return {};
  if (action.suit === 'nt') return { balanced: true };
  const suit = action.suit;
  if (ctx.partnerBids.some((bid) => bid.suit === suit)) return { minLength: length(suit, 2) };
  if (ctx.ownBids.some((bid) => bid.suit === suit)) return { minLength: length(suit, Math.max(6, profiles[ctx.seat].minLength[suit])) };
  return { minLength: length(suit, ctx.partnerForcing ? 4 : 5) };
}

function describeCall(
  ctx: CallContext, action: BidAction, passesBefore: number, profiles: Readonly<Record<Seat, MutableProfile>>,
): CallMeaning {
  switch (ctx.role) {
    case 'opening': return describeOpening(action, passesBefore);
    case 'response': return describeResponse(ctx, action, profiles);
    case 'openerRebid': return describeOpenerRebid(ctx, action, profiles);
    case 'overcall': return describeOvercall(ctx, action);
    case 'advance': return describeAdvance(ctx, action, profiles);
    default: return describeLater(ctx, action, profiles);
  }
}

/** Intersects ranges; a contradiction (often a human's different style) trusts the newer call. */
function narrow(currentMin: number, currentMax: number, min: number | undefined, max: number | undefined): [number, number] {
  const low = Math.max(currentMin, min ?? currentMin);
  const high = Math.min(currentMax, max ?? currentMax);
  if (low <= high) return [low, high];
  return [min ?? Math.min(currentMin, high), max ?? Math.max(currentMax, low)];
}

function applyMeaning(profile: MutableProfile, meaning: CallMeaning, action: BidAction): void {
  [profile.minPoints, profile.maxPoints] = narrow(profile.minPoints, profile.maxPoints, meaning.minPoints, meaning.maxPoints);
  if (meaning.balanced) {
    profile.balanced = true;
    for (const suit of BRIDGE_SUITS) {
      [profile.minLength[suit], profile.maxLength[suit]] = narrow(profile.minLength[suit], profile.maxLength[suit], 2, 5);
    }
  }
  for (const suit of BRIDGE_SUITS) {
    [profile.minLength[suit], profile.maxLength[suit]] = narrow(
      profile.minLength[suit], profile.maxLength[suit], meaning.minLength?.[suit], meaning.maxLength?.[suit],
    );
  }
  if (meaning.passedHand) profile.passedHand = true;
  if (isBid(action) && action.suit !== 'nt' && !profile.bidSuits.includes(action.suit)) profile.bidSuits.push(action.suit);
}

/** Replays the public auction with the bot agreements; human calls become estimates. */
export function analyzeAuction(bids: readonly AuctionEntry[]): AuctionAnalysis {
  const profiles = Object.fromEntries(SEAT_ORDER_CLOCKWISE.map((seat) => [seat, emptyProfile()])) as Record<Seat, MutableProfile>;
  const meanings: CallMeaning[] = [];
  bids.forEach((entry, index) => {
    const prior = bids.slice(0, index);
    const ctx = callContext(prior, entry.seat, meanings);
    const meaning = describeCall(ctx, entry.action, prior.length, profiles);
    meanings.push(meaning);
    applyMeaning(profiles[entry.seat], meaning, entry.action);
  });
  return { profiles, meanings };
}

/**
 * Splits a total across ranges by shifting an equal share until the clamped values sum to it,
 * which keeps unconstrained seats near average instead of absorbing all the slack.
 */
export function distribute(total: number, ranges: readonly PointRange[]): number[] {
  if (ranges.length === 0) return [];
  const share = total / ranges.length;
  const valueAt = (shift: number): number[] => ranges.map(([min, max]) => Math.min(max, Math.max(min, share + shift)));
  const sum = (values: readonly number[]): number => values.reduce((acc, value) => acc + value, 0);
  let low = -total - 40;
  let high = total + 40;
  for (let step = 0; step < 40; step++) {
    const middle = (low + high) / 2;
    if (sum(valueAt(middle)) < total) low = middle;
    else high = middle;
  }
  return valueAt((low + high) / 2);
}

/** Expected points and suit lengths of the hidden hands from one seat's view. */
export function estimateHands(profiles: Readonly<Record<Seat, SeatProfile>>, mySeat: Seat, myHand: readonly Card[]): HandEstimate {
  const others = SEAT_ORDER_CLOCKWISE.filter((seat) => seat !== mySeat);
  const points: Record<Seat, number> = { N: 0, E: 0, S: 0, W: 0 };
  const lengths: Record<Seat, Record<Suit, number>> = { N: suitRecord(0), E: suitRecord(0), S: suitRecord(0), W: suitRecord(0) };
  const mine = suitLengths(myHand);
  points[mySeat] = handPoints(myHand);
  lengths[mySeat] = mine;
  const shares = distribute(40 - points[mySeat], others.map((seat) => [profiles[seat].minPoints, profiles[seat].maxPoints]));
  others.forEach((seat, index) => { points[seat] = shares[index]; });
  for (const suit of BRIDGE_SUITS) {
    const split = distribute(13 - mine[suit], others.map((seat) => [profiles[seat].minLength[suit], profiles[seat].maxLength[suit]]));
    others.forEach((seat, index) => { lengths[seat][suit] = split[index]; });
  }
  return { points, lengths };
}
