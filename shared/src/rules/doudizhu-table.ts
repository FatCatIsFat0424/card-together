// ─── Dou Dizhu replay: the public table as the log shows it ───

import type { CardOrJoker, GameSeat } from '../types';
import type { DouDizhuLogEntry, DouDizhuPlay } from '../games/doudizhu/types';
import { GAME_SEAT_ORDER } from '../constants';
import { DDZ_HAND_SIZE, ddzAuction, ddzIsBomb, ddzNextSeat } from './doudizhu';
import type { DdzAuction, DdzBidEntry, DdzVariant } from './doudizhu';

export interface DdzTable {
  /** Deals begun so far; 0 before the first */
  readonly deal: number;
  readonly redeals: number;
  /** `idle` between a voided auction and its redeal, `ended` once a deal is settled */
  readonly phase: 'idle' | 'calling' | 'playing' | 'ended';
  readonly firstCaller: GameSeat | null;
  readonly bids: readonly DdzBidEntry[];
  readonly auction: DdzAuction | null;
  readonly landlord: GameSeat | null;
  readonly base: number;
  readonly grabs: number;
  readonly bombs: number;
  readonly bottom: readonly CardOrJoker[] | null;
  readonly counts: Record<GameSeat, number>;
  readonly lastPlay: DouDizhuPlay | null;
  readonly passes: number;
  readonly plays: Record<GameSeat, number>;
  readonly turn: GameSeat | null;
  readonly totals: Record<GameSeat, number>;
  /** The settlement of the latest finished deal, until the next deal begins */
  readonly settled: Extract<DouDizhuLogEntry, { readonly type: 'deal_end' }> | null;
}

export function ddzZeros(): Record<GameSeat, number> {
  return Object.fromEntries(GAME_SEAT_ORDER.map((seat) => [seat, 0])) as Record<GameSeat, number>;
}

/** The stake: the call's base doubled by grabs and bombs. */
export function ddzStake(table: Pick<DdzTable, 'base' | 'grabs' | 'bombs'>): number {
  return Math.max(1, table.base) * 2 ** (table.grabs + table.bombs);
}

/** Replays the first `end` log entries of a match between `seats`. */
export function ddzReplay(
  variant: DdzVariant, seats: readonly GameSeat[], log: readonly DouDizhuLogEntry[], end: number = log.length,
): DdzTable {
  let table: DdzTable = {
    deal: 0, redeals: 0, phase: 'idle', firstCaller: null, bids: [], auction: null, landlord: null, base: 0, grabs: 0,
    bombs: 0, bottom: null, counts: ddzZeros(), lastPlay: null, passes: 0, plays: ddzZeros(), turn: null,
    totals: ddzZeros(), settled: null,
  };
  const withAuction = (next: DdzTable): DdzTable => {
    const auction = next.firstCaller ? ddzAuction(variant, seats, next.firstCaller, next.bids) : null;
    return { ...next, auction, turn: auction && !auction.done ? auction.turn : null };
  };
  for (const entry of log.slice(0, end)) {
    switch (entry.type) {
      case 'deal': {
        const counts = ddzZeros();
        for (const seat of seats) counts[seat] = DDZ_HAND_SIZE;
        table = withAuction({
          ...table, deal: entry.deal, redeals: entry.redeal, phase: 'calling', firstCaller: entry.firstCaller, bids: [],
          landlord: null, base: 0, grabs: 0, bombs: 0, bottom: null, lastPlay: null, passes: 0, plays: ddzZeros(),
          counts, settled: null,
        });
        break;
      }
      case 'bid':
        table = withAuction({ ...table, bids: [...table.bids, { kind: 'score', seat: entry.seat, score: entry.score }] });
        break;
      case 'claim':
        table = withAuction({ ...table, bids: [...table.bids, { kind: 'claim', seat: entry.seat, take: entry.take }] });
        break;
      case 'redeal':
        table = { ...table, phase: 'idle', auction: null, turn: null };
        break;
      case 'landlord':
        table = { ...table, phase: 'playing', landlord: entry.seat, base: entry.base, grabs: entry.grabs,
          bottom: entry.bottom, counts: { ...table.counts, [entry.seat]: table.counts[entry.seat] + entry.bottom.length },
          turn: entry.seat, auction: null };
        break;
      case 'play':
        table = { ...table, counts: { ...table.counts, [entry.seat]: table.counts[entry.seat] - entry.cards.length },
          plays: { ...table.plays, [entry.seat]: table.plays[entry.seat] + 1 },
          lastPlay: { seat: entry.seat, cards: entry.cards, combo: entry.combo }, passes: 0,
          bombs: table.bombs + Number(ddzIsBomb(entry.combo)), turn: ddzNextSeat(seats, entry.seat) };
        break;
      case 'pass':
        table = { ...table, passes: table.passes + 1, turn: ddzNextSeat(seats, entry.seat) };
        break;
      case 'round_end':
        table = { ...table, lastPlay: null, passes: 0, turn: entry.leaderSeat };
        break;
      case 'deal_end':
        table = { ...table, phase: 'ended', turn: null, totals: entry.totals, settled: entry };
        break;
    }
  }
  return table;
}
