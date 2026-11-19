import type { BridgeVisibleState, Card, Seat, Suit } from '@shared/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { getNaturalBridgeBid } from './bridge-bidding';
import { analyzeAuction, distribute, humanSeats, partnerOf } from './bridge-auction';
import { shownVoids } from './bridge-sampling';
import { readPartnerSignals, signalBonus } from './bridge-signals';
import type { SeatProfile } from './bridge-auction';
import { compareCards } from '../engine/playing';
import type { BotAction } from './bot-decisions';
import { selectNearBest } from './selection';

function isPartner(a: Seat, b: Seat): boolean {
  return partnerOf(a) === b;
}

function publicCards(visible: BridgeVisibleState): Card[] {
  if (!visible.playing) return [];
  return [
    ...visible.playing.completedTricks.flatMap((trick) => Object.values(trick.cards)),
    ...Object.values(visible.playing.currentTrick),
  ];
}

function outstandingHigher(card: Card, visible: BridgeVisibleState, played: readonly Card[]): number {
  const known = [...visible.myHand, ...played];
  let count = 0;
  for (let rank = card.rank + 1; rank <= 14; rank++) {
    if (!known.some((other) => other.suit === card.suit && other.rank === rank)) count++;
  }
  return count;
}

function playedBy(visible: BridgeVisibleState, seat: Seat, suit: Suit): number {
  const playing = visible.playing;
  if (!playing) return 0;
  const cards = [...playing.completedTricks.map((trick) => trick.cards[seat]), playing.currentTrick[seat]];
  return cards.filter((card) => card?.suit === suit).length;
}

/** Splits the unseen cards of a suit across the other seats using auction lengths and shown voids. */
function remainingLengths(
  visible: BridgeVisibleState, profiles: Readonly<Record<Seat, SeatProfile>>, voids: Record<Seat, Set<Suit>>, suit: Suit, unseen: number,
): Record<Seat, number> {
  const others = SEAT_ORDER_CLOCKWISE.filter((seat) => seat !== visible.mySeat);
  const ranges = others.map((seat): readonly [number, number] => {
    if (voids[seat].has(suit)) return [0, 0];
    const played = playedBy(visible, seat, suit);
    return [Math.max(0, profiles[seat].minLength[suit] - played), Math.max(0, profiles[seat].maxLength[suit] - played)];
  });
  const split = distribute(unseen, ranges);
  const result: Record<Seat, number> = { N: 0, E: 0, S: 0, W: 0 };
  others.forEach((seat, index) => { result[seat] = split[index]; });
  return result;
}

/** Evaluate higher cards and demonstrated ruff threats without guessing hidden hands. */
function canOvertake(
  card: Card, seat: Seat, lead: Suit, visible: BridgeVisibleState, played: readonly Card[],
  voids: Record<Seat, Set<Suit>>,
): boolean {
  const trump = visible.contract!.suit;
  const known = [...visible.myHand, ...played];
  for (const suit of [lead, ...(trump !== 'nt' && trump !== lead ? [trump] : [])]) {
    if (voids[seat].has(suit) || (suit !== lead && !voids[seat].has(lead))) continue;
    for (let rank = 2; rank <= 14; rank++) {
      const candidate: Card = { suit, rank: rank as Card['rank'] };
      if (compareCards(candidate, card, lead, trump) > 0
        && !known.some((other) => other.suit === suit && other.rank === rank)) return true;
    }
  }
  return false;
}

/** Touching ranks with no missing card between them are interchangeable within this trick. */
function equivalentRank(card: Card, visible: BridgeVisibleState, played: readonly Card[]): number {
  let rank = card.rank;
  const known = [...visible.myHand, ...played];
  while (rank > 2 && known.some((other) => other.suit === card.suit && other.rank === rank - 1)) rank--;
  return rank;
}

/**
 * Heuristic scores for the cards worth considering, higher first in preference. While partner already
 * holds the trick securely only the cards that duck it are listed.
 */
export function scoredBridgePlays(visible: BridgeVisibleState): { value: Card; score: number }[] {
  const playing = visible.playing;
  const contract = visible.contract;
  if (!playing || !contract || visible.validCards.length === 0) return [];
  const played = publicCards(visible);
  const lead = playing.currentTrick[playing.trickLeadSeat];
  if (!lead) {
    const profiles = analyzeAuction(visible.bidding?.bids ?? [], humanSeats(visible)).profiles;
    const signals = readPartnerSignals(visible);
    const voids = shownVoids(visible);
    const partner = partnerOf(visible.mySeat);
    const opponents = SEAT_ORDER_CLOCKWISE.filter((seat) => seat !== visible.mySeat && seat !== partner);
    const trumpSuit = contract.suit === 'nt' ? null : contract.suit;
    const unseenTrump = trumpSuit ? 13 - [...visible.myHand, ...played].filter((card) => card.suit === trumpSuit).length : 0;
    const declarerTeam = visible.mySeat === contract.declarer || isPartner(visible.mySeat, contract.declarer);
    const trumpCount = trumpSuit ? visible.myHand.filter((card) => card.suit === trumpSuit).length : 0;
    // Without a dummy, the auction tells declarer's side how many trumps partner still holds.
    const trumpSplit = trumpSuit ? remainingLengths(visible, profiles, voids, trumpSuit, unseenTrump) : null;
    const partnerTrumps = trumpSplit ? trumpSplit[partner] : 0;
    const trumpsDrawn = trumpSuit !== null && opponents.every((seat) => voids[seat].has(trumpSuit));
    const opponentTrumps = trumpsDrawn ? 0 : unseenTrump - partnerTrumps;
    const drawTrumps = declarerTeam && opponentTrumps > 0.5 && (trumpCount >= 4 || (trumpCount >= 3 && trumpCount + partnerTrumps >= 7.5));
    const openingLead = playing.completedTricks.length === 0;
    // Partner's bid suits and the suits partner's signals asked for are the natural leads.
    const partnerSuits = [...new Set([...profiles[partner].bidSuits, ...signals.wanted])].filter((suit) => suit !== trumpSuit);
    const opponentSuits = opponents.flatMap((seat) => profiles[seat].bidSuits).filter((suit) => suit !== trumpSuit);
    const options = visible.validCards.map((card) => {
      const length = visible.myHand.filter((other) => other.suit === card.suit).length;
      const higher = outstandingHigher(card, visible, played);
      const master = higher === 0;
      const trump = card.suit === trumpSuit;
      // Cash established winners; otherwise build long suits without throwing away unsupported honors.
      let score = length * 1.5 - card.rank * 0.22 + (master ? 12 : 0);
      if (trump) score += drawTrumps ? 7 : -5;
      if (!master && card.rank >= 11) score -= 3;
      if (partnerSuits.includes(card.suit)) {
        // Partner's bid suit is the natural lead; top of a short holding unblocks it.
        score += openingLead ? 6 : 2.5;
        if (length <= 2) score += card.rank * 0.5;
      }
      // Leading into an opponent's bid suit usually gives a trick to their honors.
      if (opponentSuits.includes(card.suit) && !master) score -= 3;
      if (signals.unwanted.includes(card.suit) && !partnerSuits.includes(card.suit) && !master) score -= 2;
      const knownRuff = trumpSuit !== null && !trump && unseenTrump > 0 && opponents.some((seat) => voids[seat].has(card.suit) && !voids[seat].has(trumpSuit));
      if (knownRuff) score -= 7;
      return { value: card, score };
    });
    return options;
  }

  let winnerSeat = playing.trickLeadSeat;
  let winnerCard = lead;
  for (const seat of SEAT_ORDER_CLOCKWISE) {
    const card = playing.currentTrick[seat];
    if (card && compareCards(card, winnerCard, lead.suit, contract.suit) > 0) {
      winnerSeat = seat;
      winnerCard = card;
    }
  }
  const partnerWinning = isPartner(visible.mySeat, winnerSeat);
  const cardsPlayed = Object.keys(playing.currentTrick).length;
  const voids = shownVoids(visible);
  const partner = partnerOf(visible.mySeat);
  const remainingOpponents = SEAT_ORDER_CLOCKWISE.filter((seat) => seat !== visible.mySeat && seat !== partner && !playing.currentTrick[seat]);
  const secure = (card: Card): boolean => remainingOpponents.every((seat) => !canOvertake(card, seat, lead.suit, visible, played, voids));
  const partnerSecure = partnerWinning && secure(winnerCard);
  const declarerTeam = visible.mySeat === contract.declarer || isPartner(visible.mySeat, contract.declarer);
  const target = declarerTeam ? 6 + contract.level : 8 - contract.level;
  const tricks = visible.mySeat === 'N' || visible.mySeat === 'S' ? playing.trickCountNS : playing.trickCountEW;
  const mustWin = target - tricks >= 13 - playing.completedTricks.length;
  const ducking = partnerSecure
    ? visible.validCards.filter((card) => compareCards(card, winnerCard, lead.suit, contract.suit) <= 0) : [];
  const candidates = ducking.length > 0 ? ducking : visible.validCards;
  const options = candidates.map((card) => {
    const trump = card.suit === contract.suit;
    const wins = compareCards(card, winnerCard, lead.suit, contract.suit) > 0;
    const higher = outstandingHigher(card, visible, played);
    let score = -equivalentRank(card, visible, played) * 0.8 - Number(trump) * 5;
    if (wins) {
      const secured = secure(card);
      // Cover partner only when it protects the trick from the opponent still to play.
      if (!partnerWinning || (!partnerSecure && secured)) {
        const duckHonor = cardsPlayed === 1 && !secured && !mustWin
          && card.suit === lead.suit && card.rank >= 11 && higher > 0;
        if (!duckHonor) score += secured ? 40 : 24 - higher * 0.35;
      }
    }
    score += signalBonus(visible, card);
    return { value: card, score };
  });
  return options;
}

function play(visible: BridgeVisibleState, random: () => number): Card | null {
  const options = scoredBridgePlays(visible);
  if (options.length === 0) return null;
  const leading = visible.playing?.trickLeadSeat !== undefined && !visible.playing.currentTrick[visible.playing.trickLeadSeat];
  return selectNearBest(options, random, leading ? 0.6 : 0.5);
}

export function getBridgeBotAction(visible: BridgeVisibleState, random: () => number): BotAction | null {
  // Only a weak hand (4 HCP or fewer) is offered a redeal, and a weak hand favours the opponents.
  if (visible.phase === 'redeal_pending' && visible.redealPendingSeat === visible.mySeat) {
    return { type: 'bridge-redeal', accept: true };
  }
  if (visible.phase === 'bidding' && visible.bidding?.currentBidderSeat === visible.mySeat) {
    return { type: 'bridge-bid', action: getNaturalBridgeBid(visible) };
  }
  if (visible.phase === 'playing' && visible.playing?.currentTurnSeat === visible.mySeat) {
    const card = play(visible, random);
    return card ? { type: 'bridge-play', card } : null;
  }
  return null;
}
