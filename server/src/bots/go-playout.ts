// ─── Go bot playouts: MoGo-style heavy playouts with last-good-reply ───
//
// Each move tries, in order: a tactical reply around the last move (capture a chain in atari, rescue our own by
// capturing or by extending when the result is not a lost ladder, chase a two-liberty chain into a working ladder),
// the last good reply to the previous one or two moves, a MoGo 3 × 3 shape next to the last two moves, a capture or
// rescue anywhere on the board, and finally a random point that neither fills our own eye nor throws in a chain of
// several stones. Trying the board-wide captures before the local replies and shapes measured clearly weaker.

import {
  BLACK, EMPTY, PASS, chainLiberties, cloneBoard, copyBoard, inAtari, isEye, isLegal, playMove, playPass, selfAtariSize,
} from './go-board';
import type { Board, Colour } from './go-board';
import { MOGO_PATTERN, patternCode } from './go-patterns';
import { ladderAttack, libertiesAfter } from './go-tactics';

/** How often the playout policy tries each heuristic when it applies. */
export interface PlayoutPolicy {
  readonly atari: number;
  readonly pattern: number;
  readonly globalAtari: number;
  /** Rejection rates for a single-stone self-atari: heuristic moves almost always, random ones half the time. */
  readonly heuristicSelfAtariReject: number;
  readonly randomSelfAtariReject: number;
  /** Two-liberty chains up to this size are read for ladders inside playouts (0: never). */
  readonly ladderSize: number;
}

export const DEFAULT_POLICY: PlayoutPolicy = {
  atari: 0.9, pattern: 0.95, globalAtari: 0.9, heuristicSelfAtariReject: 0.9, randomSelfAtariReject: 0.5, ladderSize: 4,
};

export interface PlayoutState {
  readonly random: () => number;
  readonly policy: PlayoutPolicy;
  /** Last-good-reply tables, indexed by the replying colour and the one or two moves before; -1 for none. */
  readonly reply1: Int16Array;
  readonly reply2: Int16Array;
  readonly useReplies: boolean;
  /** Moves of the current simulation, tree part included, and the colour of each (`PASS` for passes). */
  readonly sequence: Int32Array;
  readonly sequenceColour: Uint8Array;
  length: number;
  readonly candidates: Int32Array;
  readonly libs: Int32Array;
  /** Scratch board for checking an escape against ladders. */
  readonly scratch: Board;
}

export function createPlayoutState(
  board: Board, random: () => number, useReplies: boolean, policy: PlayoutPolicy = DEFAULT_POLICY,
): PlayoutState {
  const { cells } = board.geometry;
  const maxLength = cells * 4 + 64;
  return {
    random,
    policy,
    reply1: new Int16Array(2 * cells).fill(-1),
    reply2: new Int16Array(2 * cells * cells).fill(-1),
    useReplies,
    sequence: new Int32Array(maxLength),
    sequenceColour: new Uint8Array(maxLength),
    length: 0,
    candidates: new Int32Array(64),
    libs: new Int32Array(4),
    scratch: cloneBoard(board),
  };
}

/** Appends a move to the simulation's sequence. */
export function recordMove(state: PlayoutState, point: number, colour: Colour): void {
  if (state.length >= state.sequence.length) return;
  state.sequence[state.length] = point;
  state.sequenceColour[state.length] = colour;
  state.length++;
}

/** Whether a heuristic move is sensible: legal, not our own eye, and not a self-atari the policy rejects. */
function acceptable(board: Board, point: number, state: PlayoutState, reject: number): boolean {
  if (board.colour[point] !== EMPTY || !isLegal(board, point) || isEye(board, point, board.toMove)) return false;
  const size = selfAtariSize(board, point, board.toMove);
  return size === 0 || (size === 1 && state.random() >= reject);
}

function pick(state: PlayoutState, count: number): number {
  return count === 0 ? PASS : state.candidates[Math.floor(state.random() * count)];
}

/** Adds a candidate once. */
function addCandidate(state: PlayoutState, count: number, point: number): number {
  const { candidates } = state;
  for (let index = 0; index < count; index++) if (candidates[index] === point) return count;
  if (count < candidates.length) candidates[count++] = point;
  return count;
}

/** Tactical replies to the last move: captures, rescues, and working ladders around it. */
function atariReply(board: Board, state: PlayoutState): number {
  const { colour, head, next } = board;
  const { width } = board.geometry;
  const own = board.toMove;
  const other = 3 - own;
  const last = board.last;
  let count = 0;
  let seen0 = PASS;
  let seen1 = PASS;
  let seen2 = PASS;
  let seen3 = PASS;
  for (let k = -1; k < 8; k++) {
    const point = k < 0 ? last : last + (k === 0 ? -width - 1 : k === 1 ? -width : k === 2 ? -width + 1 : k === 3 ? -1
      : k === 4 ? 1 : k === 5 ? width - 1 : k === 6 ? width : width + 1);
    const c = colour[point];
    if (c !== own && c !== other) continue;
    const chain = head[point];
    if (chain === seen0 || chain === seen1 || chain === seen2 || chain === seen3) continue;
    if (seen0 === PASS) seen0 = chain;
    else if (seen1 === PASS) seen1 = chain;
    else if (seen2 === PASS) seen2 = chain;
    else seen3 = chain;
    if (inAtari(board, chain)) {
      const liberty = board.libSum[chain] / board.libCount[chain];
      if (c === other) {
        if (isLegal(board, liberty)) count = addCandidate(state, count, liberty);
        continue;
      }
      let stone = chain;
      do {
        for (let j = 0; j < 4; j++) {
          const near = stone + (j === 0 ? -width : j === 1 ? -1 : j === 2 ? 1 : width);
          if (colour[near] === other && inAtari(board, head[near])) {
            const take = board.libSum[head[near]] / board.libCount[head[near]];
            if (isLegal(board, take)) count = addCandidate(state, count, take);
          }
        }
        stone = next[stone];
      } while (stone !== chain);
      if (!isLegal(board, liberty)) continue;
      const after = libertiesAfter(board, liberty, own, 3);
      if (after >= 3) {
        count = addCandidate(state, count, liberty);
      } else if (after === 2) {
        copyBoard(board, state.scratch);
        playMove(state.scratch, liberty);
        if (ladderAttack(state.scratch, chain) === PASS) count = addCandidate(state, count, liberty);
      }
    } else if (c === other && board.chainSize[chain] <= state.policy.ladderSize && chainLiberties(board, chain, 3, state.libs) === 2) {
      const attack = ladderAttack(board, chain);
      if (attack !== PASS) count = addCandidate(state, count, attack);
    }
  }
  // Rescues and captures that would throw in a large chain are left to the random move.
  let kept = 0;
  for (let index = 0; index < count; index++) {
    const point = state.candidates[index];
    if (selfAtariSize(board, point, own) < 2) state.candidates[kept++] = point;
  }
  return pick(state, kept);
}

/** A MoGo shape next to the last two moves. */
function patternReply(board: Board, state: PlayoutState): number {
  const { width } = board.geometry;
  let count = 0;
  for (let which = 0; which < 2; which++) {
    const centre = which === 0 ? board.last : board.last2;
    if (centre === PASS) continue;
    for (let k = 0; k < 8; k++) {
      const point = centre + (k === 0 ? -width - 1 : k === 1 ? -width : k === 2 ? -width + 1 : k === 3 ? -1
        : k === 4 ? 1 : k === 5 ? width - 1 : k === 6 ? width : width + 1);
      if (board.colour[point] !== EMPTY || MOGO_PATTERN[patternCode(board, point)] !== 1) continue;
      if (acceptable(board, point, state, state.policy.heuristicSelfAtariReject)) count = addCandidate(state, count, point);
    }
  }
  return pick(state, count);
}

/** The last good reply to the previous two moves, else to the previous one. */
function lastGoodReply(board: Board, state: PlayoutState): number {
  const { cells } = board.geometry;
  const side = board.toMove - 1;
  if (board.last2 !== PASS) {
    const reply = state.reply2[(side * cells + board.last2) * cells + board.last];
    if (reply >= 0 && acceptable(board, reply, state, 1)) return reply;
  }
  const reply = state.reply1[side * cells + board.last];
  return reply >= 0 && acceptable(board, reply, state, 1) ? reply : PASS;
}

/**
 * A capture of any opponent chain left in atari, else an extension that saves one of ours: read from the board's
 * list of recent ataris, dropping entries that no longer apply.
 */
function globalAtariReply(board: Board, state: PlayoutState): number {
  const { colour, head, ataris } = board;
  const own = board.toMove;
  let kept = 0;
  let escape = PASS;
  let capture = PASS;
  for (let slot = 0; slot < board.atariCount; slot++) {
    const chain = ataris[slot];
    const c = colour[chain];
    if (c === EMPTY || head[chain] !== chain || !inAtari(board, chain)) continue;
    ataris[kept++] = chain;
    const liberty = board.libSum[chain] / board.libCount[chain];
    if (c !== own) {
      if (isLegal(board, liberty)) capture = liberty;
    } else if (escape === PASS && isLegal(board, liberty) && libertiesAfter(board, liberty, own, 2) >= 2) {
      escape = liberty;
    }
  }
  board.atariCount = kept;
  const move = capture !== PASS ? capture : escape;
  return move !== PASS && acceptable(board, move, state, state.policy.heuristicSelfAtariReject) ? move : PASS;
}

/** A random point that is legal, not our own eye, and not a rejected self-atari; `PASS` when none is left. */
function randomMove(board: Board, state: PlayoutState): number {
  const count = board.emptyCount;
  if (count === 0) return PASS;
  const { empties } = board;
  const own = board.toMove;
  const start = Math.floor(state.random() * count);
  for (let step = 0; step < count; step++) {
    let slot = start + step;
    if (slot >= count) slot -= count;
    const point = empties[slot];
    if (isEye(board, point, own) || !isLegal(board, point)) continue;
    const size = selfAtariSize(board, point, own);
    if (size >= 2 || (size === 1 && state.random() < state.policy.randomSelfAtariReject)) continue;
    return point;
  }
  return PASS;
}

/** The policy's move for the side to move, or `PASS` when no sensible move is left. */
export function playoutMove(board: Board, state: PlayoutState): number {
  if (board.last !== PASS) {
    if (state.random() < state.policy.atari) {
      const move = atariReply(board, state);
      if (move !== PASS) return move;
    }
    if (state.useReplies) {
      const move = lastGoodReply(board, state);
      if (move !== PASS) return move;
    }
    if (state.random() < state.policy.pattern) {
      const move = patternReply(board, state);
      if (move !== PASS) return move;
    }
  }
  if (board.atariCount > 0 && state.random() < state.policy.globalAtari) {
    const move = globalAtariReply(board, state);
    if (move !== PASS) return move;
  }
  return randomMove(board, state);
}

/** Plays the policy until two passes or `maxMoves` moves, recording every move. */
export function runPlayout(board: Board, state: PlayoutState, maxMoves: number): void {
  for (let played = 0; played < maxMoves && board.passes < 2; played++) {
    const move = playoutMove(board, state);
    const colour = board.toMove;
    if (move === PASS) playPass(board);
    else playMove(board, move);
    recordMove(state, move, colour);
  }
}

/**
 * Updates the last-good-reply tables from a finished simulation: the winner's replies are stored, the loser's are
 * forgotten where they were stored.
 */
export function updateReplies(state: PlayoutState, cells: number, blackWins: boolean): void {
  const { sequence, sequenceColour, reply1, reply2 } = state;
  for (let index = 1; index < state.length; index++) {
    const move = sequence[index];
    const previous = sequence[index - 1];
    if (move === PASS || previous === PASS) continue;
    const colour = sequenceColour[index];
    const side = colour - 1;
    const won = (colour === BLACK) === blackWins;
    const slot1 = side * cells + previous;
    if (won) reply1[slot1] = move;
    else if (reply1[slot1] === move) reply1[slot1] = -1;
    if (index < 2 || sequence[index - 2] === PASS) continue;
    const slot2 = (side * cells + sequence[index - 2]) * cells + previous;
    if (won) reply2[slot2] = move;
    else if (reply2[slot2] === move) reply2[slot2] = -1;
  }
}
