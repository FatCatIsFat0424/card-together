import { frameLogIndex } from '@shared/game-presentation';
import type { PresentationFrame } from '@shared/game-presentation';
import { LD_HAND_SIZE, LD_MAX_PLAY, ldCanChallenge, ldIsTruth, ldMustChallenge } from '@shared/rules/liarsdeck';
import type {
  Card, LiarCard, LiarFace, LiarsDeckLastPlay, LiarsDeckLogEntry, LiarsDeckVisibleState, LiarTableFace, Seat, Suit,
} from '@shared/types';

/** Public table state as of one point in the log. */
export interface LiarsDeckTableView {
  readonly round: number;
  readonly tableFace: LiarTableFace | null;
  readonly handCounts: Record<Seat, number>;
  readonly pileCount: number;
  readonly lastPlay: LiarsDeckLastPlay | null;
  readonly shots: Record<Seat, number>;
  readonly eliminated: readonly Seat[];
  /** The local hand was dealt by a round the presentation has not reached yet */
  readonly handHidden: boolean;
  /** Log entries already shown */
  readonly logEnd: number;
}

/** What the local player's controls do right now. */
export type LiarsDeckHandMode = 'play' | 'playOrCall' | 'mustCall' | 'wait';

const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
const SUITS: readonly Suit[] = ['spades', 'hearts', 'clubs', 'diamonds'];
const FACE_RANKS: Record<Exclude<LiarFace, 'joker'>, Card['rank']> = { K: 13, Q: 12, A: 14 };

const seatCounts = (value: number): Record<Seat, number> => ({ N: value, E: value, S: value, W: value });

/** Replays the public log before `end`. */
export function replayLiarsDeck(
  log: readonly LiarsDeckLogEntry[], end: number,
): Omit<LiarsDeckTableView, 'handHidden' | 'logEnd'> {
  let round = 0;
  let tableFace: LiarTableFace | null = null;
  let handCounts = seatCounts(0);
  let pileCount = 0;
  let lastPlay: LiarsDeckLastPlay | null = null;
  const shots = seatCounts(0);
  const eliminated: Seat[] = [];
  for (const entry of log.slice(0, end)) {
    if (entry.type === 'round') {
      round = entry.round;
      tableFace = entry.tableFace;
      handCounts = seatCounts(0);
      for (const seat of SEATS) if (!eliminated.includes(seat)) handCounts[seat] = LD_HAND_SIZE;
      pileCount = 0;
      lastPlay = null;
    } else if (entry.type === 'play') {
      handCounts = { ...handCounts, [entry.seat]: Math.max(0, handCounts[entry.seat] - entry.count) };
      pileCount += entry.count;
      lastPlay = { seat: entry.seat, count: entry.count };
    } else if (entry.type === 'shot') {
      shots[entry.seat] = entry.shot;
      if (!entry.survived) eliminated.push(entry.seat);
    }
  }
  return { round, tableFace, handCounts, pileCount, lastPlay, shots, eliminated };
}

/**
 * The table as the presentation currently shows it: a trigger pull stays unresolved during its
 * suspense frame, and the next round's cards stay hidden until its deal frame.
 */
export function liarsDeckView(game: LiarsDeckVisibleState, frame: PresentationFrame | null): LiarsDeckTableView {
  const index = frame ? frameLogIndex(frame) : null;
  if (index === null) {
    return {
      round: game.round, tableFace: game.tableFace, handCounts: game.handCounts, pileCount: game.pileCount,
      lastPlay: game.lastPlay, shots: game.shots, eliminated: game.eliminated, handHidden: false,
      logEnd: game.log.length,
    };
  }
  const end = frame?.kind === 'roulette' ? index : index + 1;
  return {
    ...replayLiarsDeck(game.log, end),
    handHidden: game.log.slice(end).some((entry) => entry.type === 'round'),
    logEnd: end,
  };
}

export function liarsDeckHandMode(game: LiarsDeckVisibleState, isMyTurn: boolean): LiarsDeckHandMode {
  if (!isMyTurn || game.phase !== 'playing') return 'wait';
  if (ldMustChallenge(game.mySeat, game.handCounts, game.lastPlay)) return 'mustCall';
  return ldCanChallenge(game.mySeat, game.lastPlay) ? 'playOrCall' : 'play';
}

/** Toggles a card while keeping at most three selected cards still in hand. */
export function toggleSelection(selected: readonly number[], id: number, hand: readonly LiarCard[]): number[] {
  const kept = selected.filter((entry) => hand.some((card) => card.id === entry));
  if (kept.includes(id)) return kept.filter((entry) => entry !== id);
  return kept.length >= LD_MAX_PLAY ? kept : [...kept, id];
}

export function truthCount(cards: readonly LiarCard[], tableFace: LiarTableFace): number {
  return cards.filter((card) => ldIsTruth(card.face, tableFace)).length;
}

/** Standard card art for K/Q/A; the suit is decorative and varies with `variant`. */
export function liarFaceCard(face: Exclude<LiarFace, 'joker'>, variant: number): Card {
  return { suit: SUITS[variant % SUITS.length], rank: FACE_RANKS[face] };
}

/** Newest first, limited to `limit` entries. */
export function recentLiarsDeckMoves(log: readonly LiarsDeckLogEntry[], limit: number): LiarsDeckLogEntry[] {
  return limit > 0 ? log.slice(-limit).reverse() : [];
}
