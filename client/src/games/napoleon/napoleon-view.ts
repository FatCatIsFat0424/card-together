// ─── Napoleon table view: pure helpers for labels, notices, and controls (no React) ───

import { RANK_DISPLAY, RANK_ORDER_DESC, SUIT_DISPLAY_ORDER, SUIT_SYMBOLS } from '@shared/constants';
import { frameLogIndex } from '@shared/game-presentation';
import type { PresentationFrame } from '@shared/game-presentation';
import {
  hasNapoleonCard, isNapoleonFinalTrick, isNapoleonFreeCard, isNapoleonJoker, napoleonCardKey, napoleonDealSize,
  napoleonForcedCard, napoleonJoker, napoleonSeatPoints, napoleonSummonOptions, napoleonSummonedCard,
  napoleonPoints, napoleonSide, sameNapoleonCard, sortNapoleonHand,
} from '@shared/rules/napoleon';
import type {
  BidSuit, GameSeat, NapoleonCard, NapoleonJoker, NapoleonLogEntry, NapoleonSummon, NapoleonVisibleState, Suit,
} from '@shared/types';

/** Suit of the secretary picker; jokers are grouped as their own pseudo-suit. */
export type NapoleonPickerGroup = Suit | 'joker';

export const NAPOLEON_PICKER_GROUPS: readonly NapoleonPickerGroup[] = [...SUIT_DISPLAY_ORDER, 'joker'];
export const NAPOLEON_JOKERS: readonly NapoleonJoker[] = ['big', 'small'];

/** Cards the secretary picker offers in a group: thirteen ranks from A down, or the two jokers. */
export function napoleonPickerCards(group: NapoleonPickerGroup): NapoleonCard[] {
  if (group === 'joker') return NAPOLEON_JOKERS.map(napoleonJoker);
  return RANK_ORDER_DESC.map((rank) => ({ suit: group, rank }));
}

/** The picker group a card belongs to. */
export function napoleonPickerGroup(card: NapoleonCard): NapoleonPickerGroup {
  return isNapoleonJoker(card) ? 'joker' : card.suit;
}

/** Whether naming this card leaves the Napoleon without a secretary, and why. */
export function napoleonPickerNote(
  game: Pick<NapoleonVisibleState, 'myHand' | 'discards'>, card: NapoleonCard,
): 'hand' | 'discard' | null {
  if (hasNapoleonCard(game.myHand, card)) return 'hand';
  if (hasNapoleonCard(game.discards ?? [], card)) return 'discard';
  return null;
}

/** Plain-text card name such as `♠A` or a localized joker name. */
export function napoleonCardText(card: NapoleonCard, jokerName: (joker: NapoleonJoker) => string): string {
  return isNapoleonJoker(card) ? jokerName(card.joker) : `${SUIT_SYMBOLS[card.suit]}${RANK_DISPLAY[card.rank]}`;
}

/** Sorting key used for React lists; jokers and suit cards never collide. */
export function napoleonListKey(card: NapoleonCard, index = 0): string {
  return `${napoleonCardKey(card)}-${index}`;
}

/** Trump suit of the contract, or null before the contract and in no-trump. */
export function napoleonTrump(game: Pick<NapoleonVisibleState, 'contract'>): Suit | null {
  const suit: BidSuit | undefined = game.contract?.suit;
  return suit && suit !== 'nt' ? suit : null;
}

/** Log entries already shown: everything when no frame plays, otherwise through the current frame. */
export function napoleonPresentedEnd(log: readonly NapoleonLogEntry[], frame: PresentationFrame | null): number {
  if (!frame) return log.length;
  const index = frameLogIndex(frame);
  return index === null ? log.length : Math.min(log.length, index + 1);
}

function secretaryPlayIndex(game: Pick<NapoleonVisibleState, 'log' | 'secretaryCard'>): number {
  const card = game.secretaryCard;
  if (!card) return -1;
  return game.log.findIndex((entry) => entry.type === 'play' && sameNapoleonCard(entry.card, card));
}

/** The viewer holds a seat of their own in the match, rather than watching. */
export function napoleonParticipant(game: Pick<NapoleonVisibleState, 'observer' | 'seats' | 'mySeat'>): boolean {
  return game.observer !== 'spectator' && game.seats.includes(game.mySeat);
}

export interface NapoleonSeatLabels {
  readonly napoleon: GameSeat | null;
  /** Shown only once the viewer may know it and its presentation has been reached */
  readonly secretary: GameSeat | null;
}

/**
 * Napoleon is public from the contract on. The secretary sees their own label from the call, observers
 * see it at once, and everyone else only once the secretary card's play frame (or settlement) arrives.
 */
export function napoleonSeatLabels(
  game: Pick<NapoleonVisibleState, 'contract' | 'secretarySeat' | 'secretaryCard' | 'log' | 'observer' | 'mySeat' | 'seats'>,
  frame: PresentationFrame | null,
): NapoleonSeatLabels {
  const napoleon = game.contract?.napoleon ?? null;
  const seat = game.secretarySeat;
  if (!seat || seat === napoleon) return { napoleon, secretary: null };
  if (game.observer || (napoleonParticipant(game) && seat === game.mySeat)) return { napoleon, secretary: seat };
  const played = secretaryPlayIndex(game);
  const end = napoleonPresentedEnd(game.log, frame);
  const shown = played >= 0 ? end > played : frame === null;
  return { napoleon, secretary: shown ? seat : null };
}

export interface NapoleonHistoryTrick {
  /** One-based trick number */
  readonly number: number;
  readonly leadSeat: GameSeat;
  readonly cards: Readonly<Partial<Record<GameSeat, NapoleonCard>>>;
  /** Null while the trick is still being played */
  readonly winnerSeat: GameSeat | null;
  /** The suit a led joker or a led card of another suit named; null when the lead card's own suit applies */
  readonly namedSuit: Suit | null;
  readonly summon: NapoleonSummon | null;
}

/** Tricks rebuilt from the public log, including the one in progress. */
export function napoleonTrickHistory(log: readonly NapoleonLogEntry[]): NapoleonHistoryTrick[] {
  const tricks: NapoleonHistoryTrick[] = [];
  let current: { -readonly [K in keyof NapoleonHistoryTrick]: NapoleonHistoryTrick[K] } | null = null;
  for (const entry of log) {
    if (entry.type === 'play') {
      if (!current) {
        const card = entry.card;
        const named = entry.leadSuit && (isNapoleonJoker(card) || entry.leadSuit !== card.suit) ? entry.leadSuit : null;
        current = { number: tricks.length + 1, leadSeat: entry.seat, cards: {}, winnerSeat: null,
          namedSuit: named, summon: entry.summon ?? null };
        tricks.push(current);
      }
      current.cards = { ...current.cards, [entry.seat]: entry.card };
    } else if (entry.type === 'trick_end' && current) {
      current.winnerSeat = entry.winnerSeat;
      current = null;
    }
  }
  return tricks;
}

/** Point cards each participant has won in tricks already presented. */
export function napoleonPresentedPoints(
  game: Pick<NapoleonVisibleState, 'seats' | 'tricks' | 'log'>, frame: PresentationFrame | null,
): Partial<Record<GameSeat, number>> {
  const end = napoleonPresentedEnd(game.log, frame);
  const shown = game.log.slice(0, end).filter((entry) => entry.type === 'trick_end').length;
  const points = napoleonSeatPoints(game.seats, game.tricks.slice(0, shown));
  return Object.fromEntries(game.seats.map((seat) => [seat, points[seat]]));
}

export interface NapoleonSidePoints {
  readonly napoleon: number;
  readonly defenders: number;
  readonly pendingDiscards: boolean;
}

/** Public side totals follow the revealed card and completed trick frames, never private role data. */
export function napoleonPresentedSidePoints(
  game: NapoleonVisibleState, frame: PresentationFrame | null,
): NapoleonSidePoints | null {
  if (!game.contract) return null;
  if (game.result && frame === null) {
    return { napoleon: game.result.napoleonPoints, defenders: game.result.defenderPoints, pendingDiscards: false };
  }
  const end = napoleonPresentedEnd(game.log, frame);
  const reveal = game.log.slice(0, end).find((entry) => entry.type === 'play'
    && game.secretaryCard && sameNapoleonCard(entry.card, game.secretaryCard));
  if (reveal?.type !== 'play') return null;
  const side = napoleonSide(game.contract, reveal.seat);
  const points = napoleonPresentedPoints(game, frame);
  // Larger tables keep discards private even when the viewer is the Napoleon or an observer.
  const publicDiscards = game.seats.length === 4 ? game.discards : null;
  return {
    napoleon: side.reduce((total, seat) => total + (points[seat] ?? 0), 0),
    defenders: game.seats.filter((seat) => !side.includes(seat))
      .reduce((total, seat) => total + (points[seat] ?? 0), napoleonPoints(publicDiscards ?? [])),
    pendingDiscards: publicDiscards === null,
  };
}

export type NapoleonNotice =
  | { readonly kind: 'secretaryCard'; readonly card: NapoleonCard; readonly self: boolean; readonly holder?: GameSeat | null }
  | { readonly kind: 'summon'; readonly summon: NapoleonSummon; readonly card: NapoleonCard | null; readonly self: boolean };

/**
 * The notice a call or summon frame shows this viewer: the secretary learns their role, observers also
 * learn the holder, and the leader who summoned sees a confirmation instead of the alert.
 */
export function napoleonNotice(
  game: Pick<NapoleonVisibleState, 'observer' | 'mySeat' | 'seats' | 'secretarySeat' | 'secretaryCard'>,
  frame: PresentationFrame,
): NapoleonNotice | null {
  const participant = napoleonParticipant(game);
  if (frame.kind === 'call') {
    const card = frame.jokerCards?.[0];
    if (!card) return null;
    const self = participant && game.secretarySeat !== null && game.secretarySeat === game.mySeat;
    return game.observer ? { kind: 'secretaryCard', card, self: false, holder: game.secretarySeat }
      : { kind: 'secretaryCard', card, self };
  }
  if (frame.kind === 'summon' && frame.summon) {
    return { kind: 'summon', summon: frame.summon, card: napoleonSummonedCard(game, frame.summon),
      self: participant && frame.seat === game.mySeat };
  }
  return null;
}

/** Identifies one deal's secretary notice so its acknowledgment survives a reload. */
export function napoleonAckKey(roomCode: string, game: Pick<NapoleonVisibleState, 'log'>): string | null {
  const call = game.log.find((entry) => entry.type === 'call');
  return call ? `${roomCode}:${call.timestamp}` : null;
}

/** The secretary must confirm their notice before acting, until they play the secretary card. */
export function napoleonNeedsAck(
  game: Pick<NapoleonVisibleState, 'phase' | 'observer' | 'mySeat' | 'seats' | 'secretarySeat' | 'secretaryCard' | 'myHand'>,
  ackKey: string | null, acknowledged: string | null,
): boolean {
  if (game.phase !== 'playing' || !napoleonParticipant(game) || !ackKey || ackKey === acknowledged) return false;
  if (game.secretarySeat !== game.mySeat || !game.secretaryCard) return false;
  return hasNapoleonCard(game.myHand, game.secretaryCard);
}

/** The seat to act; during the auction the bidder, should the snapshot leave the turn empty. */
export function napoleonTurnSeat(
  game: Pick<NapoleonVisibleState, 'phase' | 'currentTurnSeat' | 'bidding'>,
): GameSeat | null {
  return game.currentTurnSeat ?? (game.phase === 'bidding' ? game.bidding?.currentBidderSeat ?? null : null);
}

/** It is this viewer's own turn to act; spectators never act for the seat they view. */
export function napoleonOwnTurn(
  game: Pick<NapoleonVisibleState, 'observer' | 'mySeat' | 'seats' | 'currentTurnSeat' | 'phase' | 'bidding'>,
): boolean {
  return napoleonParticipant(game) && napoleonTurnSeat(game) === game.mySeat;
}

/** Whether the viewer leads the trick in progress. */
export function napoleonLeading(game: Pick<NapoleonVisibleState, 'phase' | 'trick'>): boolean {
  return game.phase === 'playing' && (game.trick?.plays.length ?? 0) === 0;
}

export interface NapoleonLeadSummon {
  readonly summon: NapoleonSummon;
  /** Playable cards that may make this summon when led */
  readonly cards: readonly NapoleonCard[];
  /** Joker summons happen whenever those cards are led; only the secretary summon is a choice */
  readonly automatic: boolean;
}

const SUMMON_ORDER: readonly NapoleonSummon[] = ['secretary', 'bigJoker', 'smallJoker'];

/** Summons the viewer may announce with their lead, each with the cards that allow it. */
export function napoleonLeadSummons(game: NapoleonVisibleState): NapoleonLeadSummon[] {
  if (!napoleonOwnTurn(game) || !napoleonLeading(game)) return [];
  const bySummon = new Map<NapoleonSummon, NapoleonCard[]>();
  for (const card of game.validCards) {
    for (const summon of napoleonSummonOptions(game, game.mySeat, game.myHand, card, game.discards)) {
      bySummon.set(summon, [...bySummon.get(summon) ?? [], card]);
    }
  }
  return SUMMON_ORDER.flatMap((summon) => {
    const cards = bySummon.get(summon);
    return cards ? [{ summon, cards, automatic: summon !== 'secretary' }] : [];
  });
}

/** Cards the viewer may play now; a chosen summon narrows the lead to the cards that allow it. */
export function napoleonPlayableCards(
  game: NapoleonVisibleState, summon: NapoleonSummon | null,
): readonly NapoleonCard[] {
  if (!napoleonOwnTurn(game) || game.phase !== 'playing') return [];
  if (!summon) return game.validCards;
  const option = napoleonLeadSummons(game).find((entry) => entry.summon === summon);
  return option ? option.cards : game.validCards;
}

/** A summon choice survives only while it is still available for this lead. */
export function napoleonActiveSummon(game: NapoleonVisibleState, summon: NapoleonSummon | null): NapoleonSummon | null {
  return summon && napoleonLeadSummons(game).some((entry) => entry.summon === summon && !entry.automatic)
    ? summon : null;
}

/** Leading the secretary card or a joker requires naming the suit to follow. */
export function napoleonNeedsLeadSuit(game: NapoleonVisibleState, card: NapoleonCard): boolean {
  return napoleonLeading(game) && isNapoleonFreeCard(game, card);
}

/** The card a lead summoned out of the viewer's hand, which is then the only legal play. */
export function napoleonForcedPlay(game: NapoleonVisibleState): NapoleonCard | null {
  if (!napoleonOwnTurn(game) || game.phase !== 'playing') return null;
  return napoleonForcedCard(game, game.myHand);
}

/** Whether the trick in progress, or the next to lead, is among the final three. */
export function napoleonFinalTricks(game: Pick<NapoleonVisibleState, 'seats' | 'tricks' | 'phase'>): boolean {
  return game.phase === 'playing' && isNapoleonFinalTrick(game.tricks.length, game.seats.length);
}

export interface NapoleonExchange {
  /** Hand and picked-up cards together, trump first */
  readonly cards: readonly NapoleonCard[];
  readonly pickedUp: readonly NapoleonCard[];
  readonly discardCount: number;
}

/** The Napoleon's exchange: every held card, the ones just picked up, and how many to discard. */
export function napoleonExchange(game: NapoleonVisibleState): NapoleonExchange | null {
  if (game.phase !== 'exchanging' || !napoleonParticipant(game) || game.contract?.napoleon !== game.mySeat) return null;
  const pickedUp = game.pickedUp ?? [];
  const merged = [...game.myHand, ...pickedUp.filter((card) => !hasNapoleonCard(game.myHand, card))];
  return {
    cards: sortNapoleonHand(merged, game.contract.suit),
    pickedUp,
    discardCount: pickedUp.length || napoleonDealSize(game.seats.length).kitty,
  };
}

/** Toggle a discard choice; a full selection ignores further additions. */
export function toggleNapoleonDiscard(
  selected: readonly NapoleonCard[], card: NapoleonCard, limit: number,
): NapoleonCard[] {
  if (hasNapoleonCard(selected, card)) return selected.filter((other) => !sameNapoleonCard(other, card));
  return selected.length >= limit ? [...selected] : [...selected, card];
}

/**
 * Four-player discard review: `review` while this seat still owes an acknowledgment, `waiting` for the
 * Napoleon, acknowledged seats, and observers, `none` outside the review.
 */
export function napoleonReviewState(
  game: Pick<NapoleonVisibleState, 'phase' | 'observer' | 'mySeat' | 'seats' | 'contract' | 'reviewed'>,
): 'review' | 'waiting' | 'none' {
  if (game.phase !== 'reviewing') return 'none';
  if (!napoleonParticipant(game) || game.contract?.napoleon === game.mySeat || game.reviewed.includes(game.mySeat)) {
    return 'waiting';
  }
  return 'review';
}

/** Auction columns: the seats taking part, in clockwise order. */
export function napoleonAuctionColumns(game: Pick<NapoleonVisibleState, 'seats'>): readonly GameSeat[] {
  return game.seats;
}
