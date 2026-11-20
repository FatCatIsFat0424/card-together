import type { DdzCombo } from '@shared/rules/doudizhu';
import {
  canBeat, isBombMove, planAfter, planHand, rankMoves, removeMove, restoreMove, TURN_COST,
} from './doudizhu-hand';
import type { Counts, RankMove } from './doudizhu-hand';

// A complete Dou Dizhu deal on rank counts, for rollouts and the endgame solver. Seats are play-order indexes
// 0-2. The rollout policy sees every hand of the sampled world (it is a guess, not the real deal), plans its
// own hand into the fewest plays, leads its weakest group, follows when it is cheap or urgent, covers its
// partner, feeds a partner about to go out, and bombs when the hand can then finish or an opponent is close.

export interface World {
  readonly hands: Counts[];
  readonly sizes: number[];
  readonly landlord: number;
  turn: number;
  last: RankMove | null;
  lastSeat: number;
  /** Passes since the last play. */
  passes: number;
  bombs: number;
  /** Plays per seat in this deal (spring and anti-spring). */
  readonly plays: number[];
  /** The seat that went out, or -1. */
  winner: number;
}

export const nextSeat = (seat: number): number => (seat + 1) % 3;

export function copyWorld(world: World): World {
  return {
    hands: world.hands.map((hand) => new Uint8Array(hand)), sizes: [...world.sizes], landlord: world.landlord,
    turn: world.turn, last: world.last, lastSeat: world.lastSeat, passes: world.passes, bombs: world.bombs,
    plays: [...world.plays], winner: world.winner,
  };
}

/** The combo the seat to act must beat, or null when it leads. */
export function toBeat(world: World): DdzCombo | null {
  return world.last && world.lastSeat !== world.turn ? world.last.combo : null;
}

export const sameSide = (world: World, a: number, b: number): boolean => (a === world.landlord) === (b === world.landlord);

/** Plays `move` (null passes) for the seat to act. */
export function applyMove(world: World, move: RankMove | null): void {
  const seat = world.turn;
  if (move === null) {
    world.passes += 1;
    if (world.passes >= 2) {
      world.turn = world.lastSeat;
      world.last = null;
      world.passes = 0;
    } else world.turn = nextSeat(seat);
    return;
  }
  removeMove(world.hands[seat], move);
  world.sizes[seat] -= move.ranks.length;
  world.plays[seat] += 1;
  if (isBombMove(move)) world.bombs += 1;
  world.last = move;
  world.lastSeat = seat;
  world.passes = 0;
  if (world.sizes[seat] === 0) world.winner = seat;
  else world.turn = nextSeat(seat);
}

export interface Undo {
  readonly seat: number;
  readonly move: RankMove | null;
  readonly turn: number;
  readonly last: RankMove | null;
  readonly lastSeat: number;
  readonly passes: number;
  readonly bombs: number;
}

export function applyWithUndo(world: World, move: RankMove | null): Undo {
  const undo: Undo = {
    seat: world.turn, move, turn: world.turn, last: world.last, lastSeat: world.lastSeat, passes: world.passes,
    bombs: world.bombs,
  };
  applyMove(world, move);
  return undo;
}

export function undoMove(world: World, undo: Undo): void {
  if (undo.move) {
    restoreMove(world.hands[undo.seat], undo.move);
    world.sizes[undo.seat] += undo.move.ranks.length;
    world.plays[undo.seat] -= 1;
    world.winner = -1;
  }
  world.turn = undo.turn;
  world.last = undo.last;
  world.lastSeat = undo.lastSeat;
  world.passes = undo.passes;
  world.bombs = undo.bombs;
}

// ─── Outcome ───

/** How a finished deal ended: whether the landlord won and the doublings from play (bombs, spring). */
export interface DealEnd {
  readonly landlordWins: boolean;
  /** Bombs and rockets plus one for a spring or anti-spring; grabs are added by the scorer. */
  readonly doublings: number;
}

export function dealEnd(world: World): DealEnd {
  const landlordWins = world.winner === world.landlord;
  const farmersPlayed = world.plays.some((count, seat) => seat !== world.landlord && count > 0);
  const spring = landlordWins && !farmersPlayed;
  const antiSpring = !landlordWins && world.plays[world.landlord] === 1;
  return { landlordWins, doublings: world.bombs + Number(spring || antiSpring) };
}

// ─── Rollout policy ───

function opponentsOf(world: World, seat: number): number[] {
  return [0, 1, 2].filter((other) => !sameSide(world, other, seat));
}

const smallestOpponent = (world: World, seat: number): number =>
  Math.min(...opponentsOf(world, seat).map((other) => world.sizes[other]));

/** Whether any opponent of `seat` can beat `combo`. */
function opponentsBeat(world: World, seat: number, combo: DdzCombo): boolean {
  return opponentsOf(world, seat).some((other) => canBeat(world.hands[other], combo));
}

/** Whether `seat` can go out over `combo` in one play. */
function finishesOver(world: World, seat: number, combo: DdzCombo): boolean {
  if (world.sizes[seat] < combo.size) return false;
  return rankMoves(world.hands[seat], combo, 'cheap').some((move) => move.ranks.length === world.sizes[seat]);
}

/** A choice scored as certainly right. */
const DECISIVE = 1000;

/** Score of leading `move`: the plan left behind, adjusted for who can take over. */
function leadScore(world: World, seat: number, move: RankMove, turnsNow: number): number {
  const rest = planAfter(world.hands[seat], move);
  let score = rest.score;
  if (isBombMove(move) && rest.turns > 0) score -= 4;
  const minOpp = smallestOpponent(world, seat);
  // Never hand an opponent about to go out a play it can finish with.
  if (minOpp <= 4) {
    for (const other of opponentsOf(world, seat)) if (finishesOver(world, other, move.combo)) score -= 40;
  }
  // With few plays left, a play nobody can answer keeps the lead for the finish.
  if (turnsNow <= 3 && rest.turns <= 2 && !opponentsBeat(world, seat, move.combo)) score += TURN_COST + 4;
  if (seat !== world.landlord) {
    const partner = 3 - seat - world.landlord;
    if (world.sizes[partner] <= 4 && finishesOver(world, partner, move.combo)) {
      // Feed a partner who can go out over this play, unless the landlord sits in between and can take it.
      const landlordNext = nextSeat(seat) === world.landlord;
      score += !landlordNext || !canBeat(world.hands[world.landlord], move.combo) ? 60 : 6;
    }
  }
  return score;
}

/**
 * Scores for the options of the seat to act (null passes), higher is better: the rollout policy's
 * judgement, also the search's prior. Every option must be legal.
 */
export function scoreChoices(world: World, options: readonly (RankMove | null)[]): number[] {
  const seat = world.turn;
  const hand = world.hands[seat];
  const previous = toBeat(world);
  const size = world.sizes[seat];
  if (previous === null) {
    const turnsNow = planHand(hand).turns;
    return options.map((move) => (move === null ? -Infinity
      : move.ranks.length === size ? DECISIVE : leadScore(world, seat, move, turnsNow)));
  }
  const partnerLed = sameSide(world, world.lastSeat, seat);
  // Cover a partner's play only when the landlord, next, would otherwise go out over it.
  const threat = partnerLed && nextSeat(seat) === world.landlord && world.sizes[world.landlord] <= 4
    && finishesOver(world, world.landlord, previous);
  const base = planHand(hand).score;
  const minOpp = smallestOpponent(world, seat);
  const urgent = minOpp <= 4 || threat;
  const passScore = partnerLed ? (threat ? -50 : 50) : urgent ? -30 : size <= 6 ? -1.5 : 2.5;
  return options.map((move) => {
    if (move === null) return passScore;
    if (move.ranks.length === size) return DECISIVE;
    const rest = planAfter(hand, move);
    let gain = rest.score - base;
    if (isBombMove(move)) {
      // A bomb pays when the hand can then run out, or stops an opponent close to going out.
      if (rest.turns <= 1) gain += 20;
      else if (!(world.sizes[world.lastSeat] <= 4 || minOpp <= 2)) gain -= 100;
    }
    return gain;
  });
}

/** The rollout policy's play for the seat to act; null passes. */
export function policyMove(world: World): RankMove | null {
  const previous = toBeat(world);
  const options: (RankMove | null)[] = rankMoves(world.hands[world.turn], previous, 'cheap');
  for (const move of options) if (move!.ranks.length === world.sizes[world.turn]) return move;
  if (previous) {
    if (options.length === 0) return null;
    options.push(null);
  }
  const scores = scoreChoices(world, options);
  let best = 0;
  for (let index = 1; index < options.length; index++) if (scores[index] > scores[best]) best = index;
  return options[best];
}

/** Plays the world out with the policy; false when it ran too long (never in a legal deal). */
export function rolloutWorld(world: World, maxPlies = 400): boolean {
  for (let ply = 0; ply < maxPlies && world.winner < 0; ply++) applyMove(world, policyMove(world));
  return world.winner >= 0;
}
