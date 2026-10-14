import type { BidAction, BidLevel, BidSuit, BridgeVisibleState, Card, Seat, Suit } from '@shared/types';
import { BID_SUIT_ORDER, SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import {
  BRIDGE_RANGES, BRIDGE_SUITS, analyzeAuction, callContext, cheapestLevel, estimateHands, handPoints,
  isBalancedShape, isMajor, suitLengths,
} from './bridge-auction';
import type { CallContext, HandEstimate, NaturalBid, SeatProfile, SuitCounts } from './bridge-auction';

const PASS: BidAction = { type: 'pass' };
/** A descriptive bid may raise the level only while the combined minimum still makes it this often. */
const SAFE_DESCRIPTION = 0.6;
/** Required edge over letting the opponents play before competing higher. */
const COMPETE_MARGIN = 0.15;
/** Required edge before correcting partner's strain in an uncontested auction. */
const CORRECTION_MARGIN = 0.12;

interface HandInfo {
  readonly cards: readonly Card[];
  readonly points: number;
  readonly lengths: SuitCounts;
  readonly balanced: boolean;
}

interface Situation {
  readonly hand: HandInfo;
  readonly ctx: CallContext;
  readonly profiles: Readonly<Record<Seat, SeatProfile>>;
  readonly estimate: HandEstimate;
}

/**
 * Trick expectations fitted to bot-vs-bot play: tricks grow about 0.24 per combined HCP in a
 * suit and 0.29 in NT, and each trump beyond eight adds less than one trick.
 */
const FIT_TRICKS: readonly (readonly [number, number])[] = [
  [4, -4.4], [5, -3.2], [6, -2], [7, -0.9], [8, 0], [9, 0.7], [10, 1.15], [11, 1.5], [12, 1.8], [13, 2],
];

function fitAdjustment(fit: number): number {
  if (fit <= FIT_TRICKS[0][0]) return FIT_TRICKS[0][1];
  for (let index = 1; index < FIT_TRICKS.length; index++) {
    const [length, value] = FIT_TRICKS[index];
    if (fit <= length) {
      const [previousLength, previousValue] = FIT_TRICKS[index - 1];
      return previousValue + (value - previousValue) * (fit - previousLength) / (length - previousLength);
    }
  }
  return FIT_TRICKS[FIT_TRICKS.length - 1][1];
}

/** Estimated chance that a side with these combined values makes the contract. */
function makeProbability(level: number, strain: BidSuit, points: number, fit: number): number {
  const expected = strain === 'nt' ? 6.7 + 0.29 * (points - 20) : 8 + 0.24 * (points - 20) + fitAdjustment(fit);
  const spread = strain === 'nt' ? 1.6 : 1.15;
  const z = (expected - (6 + level) + 0.5) / spread;
  return 1 / (1 + Math.exp(-1.702 * z));
}

function describeHand(cards: readonly Card[]): HandInfo {
  const lengths = suitLengths(cards);
  return { cards, points: handPoints(cards), lengths, balanced: isBalancedShape(lengths) };
}

function bid(level: number, suit: BidSuit): NaturalBid {
  return { type: 'bid', level: level as BidLevel, suit };
}

function ranksIn(hand: HandInfo, suit: Suit): number[] {
  return hand.cards.filter((card) => card.suit === suit).map((card) => card.rank);
}

/** Two of the top five honors including the ace, king, or queen. */
function goodSuit(hand: HandInfo, suit: Suit): boolean {
  const ranks = ranksIn(hand, suit);
  return ranks.filter((rank) => rank >= 10).length >= 2 && ranks.some((rank) => rank >= 12);
}

function stopper(hand: HandInfo, suit: Suit): boolean {
  const ranks = ranksIn(hand, suit);
  return ranks.includes(14) || (ranks.includes(13) && ranks.length >= 2)
    || (ranks.includes(12) && ranks.length >= 3) || (ranks.includes(11) && ranks.length >= 4);
}

function stopsAll(hand: HandInfo, suits: readonly Suit[]): boolean {
  return suits.every((suit) => stopper(hand, suit));
}

/** Shortness counts once a trump fit exists; a fourth trump makes ruffing more valuable. */
function supportPoints(hand: HandInfo, trump: Suit): number {
  const trumps = hand.lengths[trump];
  return hand.points + BRIDGE_SUITS.reduce((sum, suit) => {
    if (suit === trump) return sum;
    const length = hand.lengths[suit];
    if (length === 0) return sum + (trumps >= 4 ? 5 : 3);
    if (length === 1) return sum + (trumps >= 4 ? 3 : 2);
    return sum + (length === 2 ? 1 : 0);
  }, 0);
}

function ranksAbove(suit: BidSuit, other: BidSuit): boolean {
  return BID_SUIT_ORDER.indexOf(suit) > BID_SUIT_ORDER.indexOf(other);
}

function legal(s: Situation, level: number, suit: BidSuit): NaturalBid | null {
  return level <= 7 && level >= cheapestLevel(suit, s.ctx.highest) ? bid(level, suit) : null;
}

function cheapest(s: Situation, suit: BidSuit): number {
  return cheapestLevel(suit, s.ctx.highest);
}

function partnerProfile(s: Situation): SeatProfile {
  return s.profiles[s.ctx.partner];
}

function isSafe(level: number, strain: BidSuit, points: number, fit: number): boolean {
  return makeProbability(level, strain, points, fit) >= SAFE_DESCRIPTION;
}

/** Longest suit first; equal lengths prefer the higher-ranking suit. */
function bySuitLength(hand: HandInfo, suits: readonly Suit[]): Suit[] {
  return [...suits].sort((a, b) => hand.lengths[b] - hand.lengths[a] || BRIDGE_SUITS.indexOf(b) - BRIDGE_SUITS.indexOf(a));
}

function opensAtOneLevel(hand: HandInfo): boolean {
  const [first, second] = BRIDGE_SUITS.map((suit) => hand.lengths[suit]).sort((a, b) => b - a);
  return hand.points >= 12 || (hand.points >= BRIDGE_RANGES.opening[0] && hand.points + first + second >= 20);
}

function openingSuit(hand: HandInfo): Suit {
  const [longest] = bySuitLength(hand, BRIDGE_SUITS);
  if (hand.lengths[longest] >= 5) return longest;
  // Without a five-card suit, open the longer minor; 4-4 opens diamonds and 3-3 clubs.
  const { clubs, diamonds } = hand.lengths;
  if (diamonds !== clubs) return diamonds > clubs ? 'diamonds' : 'clubs';
  return clubs >= 4 ? 'diamonds' : 'clubs';
}

function preemptLevel(hand: HandInfo, suit: Suit): number {
  const [low, high] = BRIDGE_RANGES.preempt;
  if (hand.points < low || hand.points > high || !goodSuit(hand, suit)) return 0;
  if (hand.lengths[suit] === 6) return 2;
  return hand.lengths[suit] >= 7 ? 3 : 0;
}

function openingCall(s: Situation, passesBefore: number): BidAction {
  const { hand } = s;
  const [ntLow, ntHigh] = BRIDGE_RANGES.oneNtOpening;
  if (hand.balanced && hand.points >= ntLow && hand.points <= ntHigh) return bid(1, 'nt');
  const [twoNtLow, twoNtHigh] = BRIDGE_RANGES.twoNtOpening;
  if (hand.balanced && hand.points >= twoNtLow && hand.points <= twoNtHigh) return bid(2, 'nt');
  if (opensAtOneLevel(hand)) return bid(1, openingSuit(hand));
  // A fourth-seat pass would redeal, so open the longest suit to keep practice moving.
  if (passesBefore === 3) return bid(1, bySuitLength(hand, BRIDGE_SUITS)[0]);
  for (const suit of bySuitLength(hand, BRIDGE_SUITS)) {
    const level = preemptLevel(hand, suit);
    if (level > 0) return bid(level, suit);
  }
  return PASS;
}

/** A new suit at the one level: five-card suits by length, otherwise four-card majors up the line. */
function oneLevelSuit(s: Situation, exclude: readonly BidSuit[]): Suit | null {
  const candidates = BRIDGE_SUITS.filter((suit) => !exclude.includes(suit) && !s.ctx.opponentSuits.includes(suit)
    && cheapest(s, suit) === 1 && s.hand.lengths[suit] >= 4);
  const long = candidates.filter((suit) => s.hand.lengths[suit] >= 5);
  if (long.length > 0) return bySuitLength(s.hand, long)[0];
  return candidates.find((suit) => isMajor(suit)) ?? candidates[0] ?? null;
}

function raiseNeeds(s: Situation, suit: Suit): number {
  const shown = partnerProfile(s).minLength[suit];
  if (shown >= 5) return 3;
  return isMajor(suit) || suit === 'diamonds' ? 4 : 5;
}

function respondToSuit(s: Situation, opened: Suit): BidAction {
  const { hand, ctx } = s;
  const partner = partnerProfile(s);
  const support = hand.lengths[opened];
  const needs = raiseNeeds(s, opened);
  const fit = support + partner.minLength[opened];
  const raise = cheapest(s, opened);
  const contested = ctx.interference;
  const combinedMinimum = hand.points + partner.minPoints;
  const points = support >= needs ? supportPoints(hand, opened) : hand.points;
  const lawLevel = fit - 6;
  if (hand.points < BRIDGE_RANGES.oneLevelResponse[0]) {
    // A weak hand with extra trumps still competes to the level of the combined trump count.
    if (contested && support >= needs + 1 && hand.points >= 3 && raise <= lawLevel) return bid(raise, opened);
    return PASS;
  }
  const canRaise = support >= needs && (raise <= 2 || (raise === 3 && (fit >= 9 || points >= 10)));
  if (support >= needs && hand.points >= BRIDGE_RANGES.limitRaise[0] && points >= BRIDGE_RANGES.limitRaise[0] + 1
    && raise + 1 <= 3 && isSafe(raise + 1, opened, combinedMinimum, fit)) {
    return bid(raise + 1, opened);
  }
  const newSuit = oneLevelSuit(s, [opened]);
  const twoLevel = hand.points >= BRIDGE_RANGES.twoLevelResponse[0]
    ? bySuitLength(hand, BRIDGE_SUITS.filter((suit) => suit !== opened && !ctx.opponentSuits.includes(suit)
      && cheapest(s, suit) === 2 && hand.lengths[suit] >= (contested || isMajor(suit) ? 5 : 4)))[0]
    : undefined;
  // Minimum raises come first; stronger hands with three-card support describe a suit first.
  if (canRaise && isMajor(opened) && (points <= BRIDGE_RANGES.simpleRaise[1] || (!newSuit && !twoLevel))) return bid(raise, opened);
  if (newSuit) return bid(1, newSuit);
  if (canRaise && points <= BRIDGE_RANGES.simpleRaise[1]) return bid(raise, opened);
  if (twoLevel) return bid(2, twoLevel);
  if (canRaise) return bid(raise, opened);
  const ntLevel = cheapest(s, 'nt');
  if (!contested || stopsAll(hand, ctx.opponentSuits)) {
    if (ntLevel === 1 && hand.points >= (contested ? 8 : 6) && hand.points <= BRIDGE_RANGES.oneNtResponse[1]) return bid(1, 'nt');
    if (ntLevel <= 2 && hand.balanced && hand.points >= BRIDGE_RANGES.twoNtResponse[0]) return bid(2, 'nt');
  }
  if (!contested && hand.points >= BRIDGE_RANGES.twoNtResponse[0]) {
    // Strong unbalanced hands without a natural four-card suit at two still force with their longest suit.
    const longest = bySuitLength(hand, BRIDGE_SUITS.filter((suit) => suit !== opened && cheapest(s, suit) <= 2))[0];
    if (longest) return bid(cheapest(s, longest), longest);
  }
  if (contested) return competitiveCall(s);
  return ntLevel === 1 ? bid(1, 'nt') : PASS;
}

/** Over partner's NT, any five-card suit plays better than NT in this no-dummy game. */
function signOffOverNt(s: Situation, maximumLevel: number): BidAction {
  const { hand, ctx } = s;
  const suit = bySuitLength(hand, BRIDGE_SUITS.filter((other) => !ctx.opponentSuits.includes(other)))[0];
  const level = cheapest(s, suit);
  if (hand.lengths[suit] >= 5 && level <= maximumLevel && (level <= 2 || hand.lengths[suit] >= 6)) return bid(level, suit);
  return PASS;
}

function responseCall(s: Situation): BidAction {
  const opened = s.ctx.opening!.bid;
  const opponentsHold = s.ctx.highest!.seat !== s.ctx.partner;
  if (opened.suit !== 'nt' && opened.level === 1) return respondToSuit(s, opened.suit);
  if (opened.suit === 'nt') {
    if (opponentsHold) {
      const signOff = signOffOverNt(s, 2);
      return signOff.type === 'bid' ? signOff : competitiveCall(s);
    }
    if (opened.level === 1) return signOffOverNt(s, 2);
    return s.hand.points >= 4 ? signOffOverNt(s, 3) : PASS;
  }
  if (opponentsHold) return competitiveCall(s);
  // Preempts are already at the right level unless responder holds a long suit and a misfit.
  const { hand } = s;
  const own = bySuitLength(hand, BRIDGE_SUITS.filter((suit) => suit !== opened.suit))[0];
  if (hand.lengths[opened.suit] <= 1 && hand.lengths[own] >= 6 && hand.points >= 12 && cheapest(s, own) <= opened.level + 1) {
    return bid(cheapest(s, own), own);
  }
  return PASS;
}

function rebidOverNt(s: Situation, own: Suit): BidAction {
  const { hand } = s;
  const partner = partnerProfile(s);
  if (hand.balanced) {
    return hand.points >= BRIDGE_RANGES.jumpNtRebid[0] && isSafe(2, 'nt', hand.points + partner.minPoints, 0) ? bid(2, 'nt') : PASS;
  }
  if (hand.lengths[own] >= 6) {
    const level = cheapest(s, own);
    const fit = hand.lengths[own] + partner.minLength[own];
    if (hand.points >= 16 && isSafe(level + 1, own, hand.points + partner.minPoints, fit)) return bid(level + 1, own);
    return legal(s, level, own) ?? PASS;
  }
  for (const suit of bySuitLength(hand, BRIDGE_SUITS.filter((other) => other !== own))) {
    if (hand.lengths[suit] < 4 || partner.maxLength[suit] < 4 || cheapest(s, suit) !== 2) continue;
    if (!ranksAbove(suit, own) || hand.points >= BRIDGE_RANGES.reverse[0]) return bid(2, suit);
  }
  return PASS;
}

function rebidOverNewSuit(s: Situation, own: Suit, response: Suit): BidAction {
  const { hand, ctx } = s;
  const partner = partnerProfile(s);
  const combinedMinimum = hand.points + partner.minPoints;
  if (hand.lengths[response] >= (partner.minLength[response] >= 5 ? 3 : 4)) {
    const level = cheapest(s, response);
    const fit = hand.lengths[response] + partner.minLength[response];
    if (supportPoints(hand, response) >= 16 && level + 1 <= 4 && isSafe(level + 1, response, combinedMinimum, fit)) return bid(level + 1, response);
    if (level <= 3) return bid(level, response);
  }
  const newSuit = oneLevelSuit(s, [own, response]);
  if (newSuit) return bid(1, newSuit);
  const ntLevel = cheapest(s, 'nt');
  if (hand.balanced) {
    if (hand.points >= BRIDGE_RANGES.jumpNtRebid[0] && isSafe(ntLevel + 1, 'nt', combinedMinimum, 0)) return bid(ntLevel + 1, 'nt');
    if (ntLevel <= 2 && hand.points <= 14) return bid(ntLevel, 'nt');
  }
  if (hand.lengths[own] >= 6) {
    const level = cheapest(s, own);
    const fit = hand.lengths[own] + partner.minLength[own];
    if (hand.points >= 16 && isSafe(level + 1, own, combinedMinimum, fit)) return bid(level + 1, own);
    if (level <= 3) return bid(level, own);
  }
  for (const suit of bySuitLength(hand, BRIDGE_SUITS.filter((other) => other !== own && other !== response))) {
    if (hand.lengths[suit] < 4 || cheapest(s, suit) > 2) continue;
    if (!ranksAbove(suit, own) || hand.points >= BRIDGE_RANGES.reverse[0]) return bid(cheapest(s, suit), suit);
  }
  if (!ctx.partnerForcing) return PASS;
  if (hand.lengths[own] >= 5 && cheapest(s, own) <= 3) return bid(cheapest(s, own), own);
  if (hand.lengths[response] >= 3 && cheapest(s, response) <= 3) return bid(cheapest(s, response), response);
  if (ntLevel <= 2) return bid(ntLevel, 'nt');
  return legal(s, cheapest(s, own), own) ?? PASS;
}

function openerRebidCall(s: Situation): BidAction {
  const { ctx, hand } = s;
  const opened = ctx.opening!.bid;
  if (opened.level !== 1 || opened.suit === 'nt') return laterCall(s);
  if (ctx.highest!.seat !== ctx.partner) return competitiveCall(s);
  const own = opened.suit;
  const response = ctx.partnerBids[0];
  if (response.suit === own) {
    const level = cheapest(s, own);
    const partner = partnerProfile(s);
    const fit = hand.lengths[own] + partner.minLength[own];
    return hand.points >= 16 && isSafe(level, own, hand.points + partner.minPoints, fit) ? bid(level, own) : PASS;
  }
  if (response.suit === 'nt') return response.level === 1 ? rebidOverNt(s, own) : PASS;
  return rebidOverNewSuit(s, own, response.suit);
}

function overcallCall(s: Situation): BidAction {
  const { hand, ctx } = s;
  const relief = ctx.balancing ? 2 : 0;
  const ntLevel = cheapest(s, 'nt');
  const [ntLow, ntHigh] = BRIDGE_RANGES.ntOvercall;
  if (ntLevel === 1 && hand.balanced && hand.points >= ntLow - relief * 2 && hand.points <= ntHigh && stopsAll(hand, ctx.opponentSuits)) {
    return bid(1, 'nt');
  }
  for (const suit of bySuitLength(hand, BRIDGE_SUITS.filter((other) => !ctx.opponentSuits.includes(other)))) {
    const length = hand.lengths[suit];
    if (length < 5) break;
    const level = cheapest(s, suit);
    const good = goodSuit(hand, suit) || length >= 6;
    const [weakLow, weakHigh] = BRIDGE_RANGES.preempt;
    const weak = !ctx.balancing && hand.points >= weakLow && hand.points <= weakHigh && goodSuit(hand, suit);
    if (weak && length === 6 && level === 1) return bid(2, suit);
    if (weak && length >= 7 && level <= 2) return bid(3, suit);
    if (!good) continue;
    const [oneLow, oneHigh] = BRIDGE_RANGES.oneLevelOvercall;
    const [twoLow, twoHigh] = BRIDGE_RANGES.twoLevelOvercall;
    if (level === 1 && hand.points >= oneLow - relief && hand.points <= oneHigh) return bid(1, suit);
    // Higher overcalls also need to beat the chance that the opponents fail on their own.
    if (level === 2 && hand.points >= twoLow - relief && hand.points <= twoHigh && outbids(s, 2, suit)) return bid(2, suit);
    if (level === 3 && length >= 6 && hand.points >= 13 - relief && outbids(s, 3, suit)) return bid(3, suit);
  }
  return ctx.balancing ? competitiveCall(s) : PASS;
}

function advanceCall(s: Situation): BidAction {
  const { hand, ctx } = s;
  const overcall = ctx.partnerBids[0];
  if (ctx.highest!.seat !== ctx.partner) return competitiveCall(s);
  if (overcall.suit === 'nt') return signOffOverNt(s, 2);
  const suit = overcall.suit;
  const support = hand.lengths[suit];
  const level = cheapest(s, suit);
  const total = support + partnerProfile(s).minLength[suit];
  // Partner's overcall already holds the contract, so raise only while it stays at the two level.
  if (support >= 3 && level <= Math.min(2, total - 6) && (supportPoints(hand, suit) >= 8 || (support >= 4 && hand.points >= 3))) {
    return bid(level, suit);
  }
  for (const other of bySuitLength(hand, BRIDGE_SUITS.filter((item) => item !== suit && !ctx.opponentSuits.includes(item)))) {
    if (hand.lengths[other] < 5) break;
    if (hand.points >= 10 && goodSuit(hand, other) && cheapest(s, other) <= 2) return bid(cheapest(s, other), other);
  }
  if (cheapest(s, 'nt') === 1 && hand.points >= 8 && hand.points <= 12 && stopsAll(hand, ctx.opponentSuits)) return bid(1, 'nt');
  return PASS;
}

interface Option {
  readonly bid: NaturalBid;
  readonly chance: number;
}

function bestOption(options: readonly Option[]): Option | null {
  return options.reduce<Option | null>((best, option) => (!best || option.chance > best.chance ? option : best), null);
}

function ourPoints(s: Situation): number {
  return s.hand.points + s.estimate.points[s.ctx.partner];
}

function fitWithPartner(s: Situation, suit: Suit): number {
  return s.hand.lengths[suit] + s.estimate.lengths[s.ctx.partner][suit];
}

/** Chance that the opponents make their current contract, judged from our estimated share. */
function theirChance(s: Situation): number {
  const { ctx, estimate } = s;
  const highest = ctx.highest!;
  const [left, right] = SEAT_ORDER_CLOCKWISE.filter((seat) => seat !== ctx.seat && seat !== ctx.partner);
  const theirFit = highest.suit === 'nt' ? 0 : estimate.lengths[left][highest.suit] + estimate.lengths[right][highest.suit];
  return makeProbability(highest.level, highest.suit, 40 - ourPoints(s), theirFit);
}

function outbids(s: Situation, level: number, suit: BidSuit): boolean {
  const fit = suit === 'nt' ? 0 : fitWithPartner(s, suit);
  return makeProbability(level, suit, ourPoints(s), fit) > 1 - theirChance(s) + COMPETE_MARGIN;
}

/** Compete only when our contract is clearly likelier to make than theirs is to fail. */
function competitiveCall(s: Situation): BidAction {
  const { hand, ctx } = s;
  const points = ourPoints(s);
  const options: Option[] = [];
  for (const suit of BRIDGE_SUITS) {
    if (ctx.opponentSuits.includes(suit)) continue;
    const partnerNamed = ctx.partnerBids.some((item) => item.suit === suit);
    const fit = fitWithPartner(s, suit);
    // Compete only with a fit partner has shown or a six-card suit; a guessed fit oversells.
    const shownFit = hand.lengths[suit] + (partnerNamed ? partnerProfile(s).minLength[suit] : 2);
    if (partnerNamed ? shownFit < 8 : hand.lengths[suit] < 6 || fit < 8 || hand.points < 5) continue;
    const level = cheapest(s, suit);
    // Law of Total Tricks: compete no higher than the known trump count minus six.
    if (level <= Math.min(7, shownFit - 6)) options.push({ bid: bid(level, suit), chance: makeProbability(level, suit, points, fit) });
  }
  const ntNamed = ctx.partnerBids.some((item) => item.suit === 'nt') || ctx.ownBids.some((item) => item.suit === 'nt');
  const ntLevel = cheapest(s, 'nt');
  if (ntLevel <= 7 && stopsAll(hand, ctx.opponentSuits) && (ntNamed || (hand.balanced && hand.points >= 15))) {
    options.push({ bid: bid(ntLevel, 'nt'), chance: makeProbability(ntLevel, 'nt', points, 0) });
  }
  const best = bestOption(options);
  return best && best.chance > 1 - theirChance(s) + COMPETE_MARGIN ? best.bid : PASS;
}

/** Partner holds the contract: keep it unless another natural strain is clearly better. */
function placementCall(s: Situation): BidAction {
  const { hand, ctx } = s;
  const current = ctx.highest!;
  const forced = ctx.partnerForcing;
  if (!forced && ctx.ownBids.length >= 3) return PASS;
  const points = ourPoints(s);
  const options: Option[] = [];
  for (const suit of BRIDGE_SUITS) {
    if (ctx.opponentSuits.includes(suit) || suit === current.suit) continue;
    const partnerNamed = ctx.partnerBids.some((item) => item.suit === suit);
    const ownNamed = ctx.ownBids.some((item) => item.suit === suit);
    const length = hand.lengths[suit];
    const natural = (partnerNamed && length >= 2) || (ownNamed && length >= 6)
      || (!partnerNamed && !ownNamed && length >= (forced ? 4 : 5) && ctx.ownBids.length <= 1);
    const level = cheapest(s, suit);
    if (natural && level <= 4) options.push({ bid: bid(level, suit), chance: makeProbability(level, suit, points, fitWithPartner(s, suit)) });
  }
  const ntLevel = cheapest(s, 'nt');
  if (current.suit !== 'nt' && ntLevel <= 3 && hand.balanced && stopsAll(hand, ctx.opponentSuits)
    && hand.lengths[current.suit as Suit] <= 2) {
    options.push({ bid: bid(ntLevel, 'nt'), chance: makeProbability(ntLevel, 'nt', points, 0) });
  }
  const best = bestOption(options);
  if (forced) return best?.bid ?? legal(s, ntLevel, 'nt') ?? PASS;
  const currentFit = current.suit === 'nt' ? 0 : fitWithPartner(s, current.suit);
  const currentChance = makeProbability(current.level, current.suit, points, currentFit);
  return best && best.chance >= currentChance + CORRECTION_MARGIN ? best.bid : PASS;
}

function laterCall(s: Situation): BidAction {
  const highest = s.ctx.highest;
  if (!highest) return PASS;
  if (highest.seat === s.ctx.partner) return placementCall(s);
  // Our own bid can only be highest once the auction has ended.
  if (highest.seat === s.ctx.seat) return PASS;
  return competitiveCall(s);
}

function chooseCall(s: Situation, passesBefore: number): BidAction {
  switch (s.ctx.role) {
    case 'opening': return openingCall(s, passesBefore);
    case 'response': return responseCall(s);
    case 'openerRebid': return openerRebidCall(s);
    case 'overcall': return overcallCall(s);
    case 'advance': return advanceCall(s);
    default: return laterCall(s);
  }
}

export function getNaturalBridgeBid(visible: BridgeVisibleState): BidAction {
  const bidding = visible.bidding;
  if (!bidding) return PASS;
  const analysis = analyzeAuction(bidding.bids);
  const ctx = callContext(bidding.bids, visible.mySeat, analysis.meanings);
  const situation: Situation = {
    hand: describeHand(visible.myHand), ctx, profiles: analysis.profiles,
    estimate: estimateHands(analysis.profiles, visible.mySeat, visible.myHand),
  };
  // Before any bid every call is a pass, so the pass streak counts the openers who declined.
  const call = chooseCall(situation, bidding.consecutivePassCount);
  // Guard against an illegal call from an unexpected auction shape.
  if (call.type === 'bid' && !legal(situation, call.level, call.suit)) return PASS;
  return call;
}
