import { frameLogIndex } from '@shared/game-presentation';
import type { PresentationFrame } from '@shared/game-presentation';
import { LDI_WILD_FACE, ldiMinimalBid, ldiOnesWildAfter, ldiTotalDice } from '@shared/rules/liarsdice';
import { gameSeatMap } from '@shared/rules/seats';
import type { DiceFace, GameSeat, LiarsDiceBid, LiarsDiceLogEntry, LiarsDiceStandingBid, LiarsDiceVisibleState } from '@shared/types';
import { createLogViewCache } from '../log-view-cache';

/** Public table state as of one point in the log. */
export interface LiarsDiceTableView {
  readonly round: number;
  readonly bid: LiarsDiceStandingBid | null;
  readonly onesWild: boolean;
  readonly counts: Record<GameSeat, number>;
  readonly eliminated: readonly GameSeat[];
  /** The local dice were rolled by a round the presentation has not reached yet */
  readonly handHidden: boolean;
  /** Log entries already shown */
  readonly logEnd: number;
}

/** What the local player's controls do right now. */
export type LiarsDiceMode = 'bid' | 'bidOrCall' | 'wait';

/** Replays the public log before `end`. */
export function replayLiarsDice(
  log: readonly LiarsDiceLogEntry[], end: number,
): Omit<LiarsDiceTableView, 'handHidden' | 'logEnd'> {
  let round = 0;
  let bid: LiarsDiceStandingBid | null = null;
  let onesWild = true;
  let counts = gameSeatMap(() => 0);
  const eliminated: GameSeat[] = [];
  for (const entry of log.slice(0, end)) {
    if (entry.type === 'round') {
      round = entry.round;
      counts = { ...entry.counts };
      bid = null;
      onesWild = true;
    } else if (entry.type === 'bid') {
      bid = { seat: entry.seat, quantity: entry.quantity, face: entry.face };
      onesWild = ldiOnesWildAfter(onesWild, entry);
    } else {
      counts = { ...counts, [entry.loser]: Math.max(0, counts[entry.loser] - 1) };
      if (entry.eliminated) eliminated.push(entry.loser);
      bid = null;
    }
  }
  return { round, bid, onesWild, counts, eliminated };
}

const views = createLogViewCache<LiarsDiceVisibleState, LiarsDiceTableView>();

/**
 * The table as the presentation currently shows it: a challenge stays unresolved through its call and
 * reveal frames, and the next round's dice stay hidden until its roll frame.
 */
export function liarsDiceView(game: LiarsDiceVisibleState, frame: PresentationFrame | null): LiarsDiceTableView {
  const index = frame ? frameLogIndex(frame) : null;
  if (index === null) {
    return {
      round: game.round, bid: game.bid, onesWild: game.onesWild, counts: game.diceCounts, eliminated: game.eliminated,
      handHidden: false, logEnd: game.log.length,
    };
  }
  const resolving = frame?.kind === 'challenge' || frame?.kind === 'diceReveal';
  const end = resolving ? index : index + 1;
  return views.get(game, end, () => ({
    ...replayLiarsDice(game.log, end),
    handHidden: game.log.slice(end).some((entry) => entry.type === 'round'),
    logEnd: end,
  }));
}

export function liarsDiceMode(game: LiarsDiceVisibleState, bid: LiarsDiceStandingBid | null, isMyTurn: boolean): LiarsDiceMode {
  if (!isMyTurn || game.phase !== 'playing') return 'wait';
  return bid && bid.seat !== game.mySeat ? 'bidOrCall' : 'bid';
}

/** A die counts toward a bid on `face`; ones count too while they are wild. */
export function dieMatches(die: DiceFace, face: DiceFace, onesWild: boolean): boolean {
  return die === face || (onesWild && face !== LDI_WILD_FACE && die === LDI_WILD_FACE);
}

/** Dice shown high to low from the left, like every other hand. */
export function sortDice(dice: readonly DiceFace[]): DiceFace[] {
  return [...dice].sort((a, b) => b - a);
}

/** The bid the controls start from: the least raise, or the whole table's quantity when nothing can outbid. */
export function defaultBid(standing: LiarsDiceBid | null, totalDice: number): LiarsDiceBid {
  return ldiMinimalBid(standing, totalDice) ?? { quantity: Math.max(1, totalDice), face: 6 };
}

export function totalDice(counts: Readonly<Record<GameSeat, number>>): number {
  return ldiTotalDice(counts);
}

/** Newest first, limited to `limit` entries. */
export function recentLiarsDiceMoves(log: readonly LiarsDiceLogEntry[], limit: number): LiarsDiceLogEntry[] {
  return limit > 0 ? log.slice(-limit).reverse() : [];
}
