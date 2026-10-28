// ─── Trick chip: what the persistent contract chip of Bridge and Napoleon shows, under their visibility rules ───

import type { PresentationFrame } from '@shared/game-presentation';
import { NAPOLEON_POINT_CARDS } from '@shared/rules/napoleon';
import type { BidSuit, GameSeat, NapoleonCard, NapoleonVisibleState, Seat } from '@shared/types';
import { napoleonPresentedSidePoints, napoleonSeatLabels } from './napoleon/napoleon-view';

export interface ChipBid {
  readonly level: number;
  readonly suit: BidSuit;
}

/** Tricks won by one side; a viewer without a seat sees the compass teams instead of "us" and "them". */
export interface BridgeChipSide {
  readonly team: 'ours' | 'theirs' | 'ns' | 'ew';
  readonly tricks: number;
}

export interface BridgeChip {
  /** The contract, or the highest bid while the auction runs (null before the first bid) */
  readonly bid: ChipBid | null;
  readonly bidding: boolean;
  readonly declarer: Seat | null;
  /** Empty while bidding */
  readonly sides: readonly BridgeChipSide[];
}

export interface BridgeChipInput {
  readonly phase: string | null;
  readonly contract: (ChipBid & { readonly declarer: Seat }) | null;
  readonly highestBid: ChipBid | null;
  readonly tricks: { readonly ns: number; readonly ew: number } | null;
  readonly mySeat: GameSeat | null;
}

/** Contract, declarer and each side's tricks; nothing before the deal reaches the auction. */
export function bridgeChip(input: BridgeChipInput): BridgeChip | null {
  const { contract, highestBid, tricks, mySeat } = input;
  if (!contract) {
    return input.phase === 'bidding' ? { bid: highestBid, bidding: true, declarer: null, sides: [] } : null;
  }
  const ns = tricks?.ns ?? 0;
  const ew = tricks?.ew ?? 0;
  const mine = mySeat === 'N' || mySeat === 'S' ? 'ns' : mySeat === 'E' || mySeat === 'W' ? 'ew' : null;
  const sides: readonly BridgeChipSide[] = mine === 'ns' ? [{ team: 'ours', tricks: ns }, { team: 'theirs', tricks: ew }]
    : mine === 'ew' ? [{ team: 'ours', tricks: ew }, { team: 'theirs', tricks: ns }]
      : [{ team: 'ns', tricks: ns }, { team: 'ew', tricks: ew }];
  return { bid: { level: contract.level, suit: contract.suit }, bidding: false, declarer: contract.declarer, sides };
}

export interface NapoleonChipProgress {
  /** Point cards won; null until the secretary card shows which seats form the Napoleon side */
  readonly napoleon: number | null;
  readonly defenders: number | null;
  readonly napoleonTarget: number;
  readonly defenderTarget: number;
  /** Discards count toward the defenders but stay private at larger tables */
  readonly pendingDiscards: boolean;
}

export interface NapoleonChip {
  readonly bid: ChipBid | null;
  readonly bidding: boolean;
  readonly napoleon: GameSeat | null;
  /** Only once the viewer may know the secretary */
  readonly secretary: GameSeat | null;
  /** The named card, public from the call on, shown while its holder is still unknown */
  readonly secretaryCard: NapoleonCard | null;
  readonly progress: NapoleonChipProgress | null;
}

/** Napoleon, the secretary only when public, and side progress, all following the presented frame. */
export function napoleonChip(game: NapoleonVisibleState, frame: PresentationFrame | null): NapoleonChip | null {
  const { contract } = game;
  if (!contract) {
    return game.phase === 'bidding'
      ? { bid: game.bidding?.highestBid ?? null, bidding: true, napoleon: null, secretary: null, secretaryCard: null, progress: null }
      : null;
  }
  const labels = napoleonSeatLabels(game, frame);
  const playing = game.phase === 'playing' || game.phase === 'scoring';
  const points = playing ? napoleonPresentedSidePoints(game, frame) : null;
  return {
    bid: { level: contract.level, suit: contract.suit },
    bidding: false,
    napoleon: labels.napoleon,
    secretary: labels.secretary,
    secretaryCard: game.secretaryCard,
    progress: playing ? {
      napoleon: points?.napoleon ?? null,
      defenders: points?.defenders ?? null,
      napoleonTarget: contract.level,
      defenderTarget: NAPOLEON_POINT_CARDS + 1 - contract.level,
      pendingDiscards: points?.pendingDiscards ?? false,
    } : null,
  };
}
