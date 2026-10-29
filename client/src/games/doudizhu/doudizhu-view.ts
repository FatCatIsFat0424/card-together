// ─── Pure Dou Dizhu view helpers (no React) ───

import { frameLogIndex } from '@shared/game-presentation';
import type { PresentationFrame } from '@shared/game-presentation';
import { ddzNextSeat } from '@shared/rules/doudizhu';
import type { DdzBidEntry } from '@shared/rules/doudizhu';
import { ddzReplay, ddzStake } from '@shared/rules/doudizhu-table';
import type { DdzTable } from '@shared/rules/doudizhu-table';
import { cardKey } from '@shared/rules/cards';
import type { CardOrJoker, DouDizhuLogEntry, DouDizhuVisibleState, GameSeat } from '@shared/types';
import type { TranslationKey } from '../../i18n';
import { createLogViewCache } from '../log-view-cache';

const views = createLogViewCache<readonly DouDizhuLogEntry[], DdzTable>();

/**
 * The public table as the presentation currently shows it. While a frame plays the table is rebuilt up to
 * that frame's entry, so the next deal, the landlord, and settled scores never appear before their frames.
 */
export function doudizhuView(game: DouDizhuVisibleState, frame: PresentationFrame | null): DdzTable {
  const index = frame ? frameLogIndex(frame) : null;
  const end = index === null ? game.log.length : Math.min(game.log.length, index + 1);
  return views.get(game.log, `${game.options.variant}:${game.seats.join('')}:${end}`,
    () => ddzReplay(game.options.variant, game.seats, game.log, end));
}

/** The hand to draw: the viewer's own, or the cards left from the deal an earlier frame still shows. */
export function shownHand(game: DouDizhuVisibleState, table: DdzTable): readonly CardOrJoker[] {
  if (table.deal === game.deal || table.deal === 0) return game.myHand;
  const ended = game.log.find((entry) => entry.type === 'deal_end' && entry.deal === table.deal);
  return ended?.type === 'deal_end' ? ended.hands[game.mySeat] ?? [] : [];
}

export interface SeatBid {
  readonly key: TranslationKey;
  readonly params?: Record<string, string>;
  readonly tone: 'bid' | 'pass';
}

/** The seat's latest word in the running auction. */
export function seatBid(table: DdzTable, seat: GameSeat): SeatBid | null {
  if (table.phase !== 'calling') return null;
  const entry = [...table.bids].reverse().find((bid: DdzBidEntry) => bid.seat === seat);
  if (!entry) return null;
  if (entry.kind === 'score') {
    return entry.score === 0 ? { key: 'doudizhu.bidPass', tone: 'pass' }
      : { key: 'doudizhu.bidScore', params: { n: String(entry.score) }, tone: 'bid' };
  }
  const position = table.bids.indexOf(entry);
  const calledBefore = table.bids.some((bid, index) => bid.kind === 'claim' && bid.take && index < position);
  if (!entry.take) return { key: calledBefore ? 'doudizhu.claimNoGrab' : 'doudizhu.claimPass', tone: 'pass' };
  return { key: calledBefore ? 'doudizhu.claimGrab' : 'doudizhu.claimCall', tone: 'bid' };
}

/** What the viewer can do in the auction right now. */
export function auctionPrompt(game: DouDizhuVisibleState, table: DdzTable): {
  readonly mode: 'score' | 'call' | 'grab'; readonly minScore: number;
} | null {
  const auction = table.auction;
  if (game.phase !== 'calling' || game.observer === 'spectator' || !auction || auction.done
    || auction.turn !== game.mySeat || table.turn !== game.mySeat) return null;
  return { mode: auction.mode, minScore: auction.minScore };
}

/** The seat that plays after the viewer; marked quietly on the table. */
export function nextSeat(game: Pick<DouDizhuVisibleState, 'seats' | 'mySeat'>): GameSeat {
  return ddzNextSeat(game.seats, game.mySeat);
}

export function stakeOf(table: DdzTable): number {
  return ddzStake(table);
}

/** Cards in hand that already sit in the selection. */
export function selectedIn(hand: readonly CardOrJoker[], selection: readonly CardOrJoker[]): CardOrJoker[] {
  const keys = new Set(hand.map(cardKey));
  return selection.filter((card) => keys.has(cardKey(card)));
}

export function toggleCard(selection: readonly CardOrJoker[], card: CardOrJoker): CardOrJoker[] {
  return selection.some((entry) => cardKey(entry) === cardKey(card))
    ? selection.filter((entry) => cardKey(entry) !== cardKey(card)) : [...selection, card];
}

export interface DealLine {
  readonly deal: number;
  readonly landlord: GameSeat;
  readonly landlordWins: boolean;
  readonly multiplier: number;
  readonly scores: Record<GameSeat, number>;
  readonly spring: boolean;
  readonly antiSpring: boolean;
  readonly bombs: number;
}

/** Settled deals up to `end`, oldest first. */
export function settledDeals(log: readonly DouDizhuLogEntry[], end: number = log.length): DealLine[] {
  return log.slice(0, end).flatMap((entry) => entry.type === 'deal_end' ? [{
    deal: entry.deal, landlord: entry.landlord, landlordWins: entry.landlordWins, multiplier: entry.multiplier,
    scores: entry.scores, spring: entry.spring, antiSpring: entry.antiSpring, bombs: entry.bombs,
  }] : []);
}

export function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}
