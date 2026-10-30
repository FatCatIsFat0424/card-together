// ─── Board effects: which one-shot effect a new move plays, and the limits every effect stays within ───

import type { NodeId } from '@shared/rules/board/board-model';
import type { PlayerVisibleGameState } from '@shared/types';

/**
 * One snapshot can add a few records at once (a move followed by the opponent's automatic pass); a larger jump
 * is a restore or a replay seek, which plays no sound and no effect.
 */
export const MAX_NEW_RECORDS = 3;

/** Every limit of the effect layer; effects past a limit are skipped and the result shows at once. */
export const BOARD_FX_LIMITS = {
  /** Effect groups playing at the same time; a move plays one group. */
  groups: 3,
  /** Particles in one capture burst. */
  particles: 10,
  /** Longest one-shot effect of a single piece. */
  effectMs: 700,
  /** A moved piece slides from its origin. */
  slideMs: 300,
  /** One disc or token turning over. */
  flipMs: 380,
  /** Turned discs animated one after another; the rest turn at once. */
  flips: 12,
  /** The whole sequence of turning discs. */
  flipSequenceMs: 1000,
} as const;

function logOf(game: PlayerVisibleGameState): readonly unknown[] {
  const log = (game as { readonly log?: unknown }).log;
  return Array.isArray(log) ? log : [];
}

/**
 * The log records that appeared between two snapshots of the same game, newest first, or `null` when nothing
 * new was played, the log shrank, or it jumped (first snapshot, reconnect, new match, replay seek).
 */
export function newBoardRecords(
  previous: PlayerVisibleGameState | null, next: PlayerVisibleGameState | null,
): readonly unknown[] | null {
  if (!previous || !next || previous.gameType !== next.gameType) return null;
  const before = logOf(previous);
  const after = logOf(next);
  const added = after.length - before.length;
  if (added < 1 || added > MAX_NEW_RECORDS) return null;
  return after.slice(before.length).reverse();
}

/** What one move does to the board, read from the public move record every board game extends. */
export interface BoardFxPlan {
  /** Origin of a moved piece; absent for placements and flips in place. */
  readonly from?: NodeId;
  readonly to: NodeId;
  /** The move took (or fought) a piece at `to`. */
  readonly capture: boolean;
  /** Pieces that turned over: Reversi discs, or a revealed Banqi token. */
  readonly flips: readonly NodeId[];
}

const nodeOf = (value: unknown): NodeId | undefined => (typeof value === 'string' ? value as NodeId : undefined);

/** The effect of one public move record, or `null` for passes and records that touch no node. */
export function boardFxOf(record: unknown): BoardFxPlan | null {
  if (!record || typeof record !== 'object') return null;
  const move = record as {
    readonly from?: unknown; readonly to?: unknown; readonly capture?: unknown; readonly battle?: unknown;
    readonly flips?: unknown; readonly revealed?: unknown;
  };
  const to = nodeOf(move.to);
  if (to === undefined) return null;
  const from = nodeOf(move.from);
  const turned = Array.isArray(move.flips) ? move.flips.map(nodeOf).filter((node): node is NodeId => node !== undefined) : [];
  // A Banqi flip reveals the token in place; a blind attack moves onto it instead.
  const flips = from === undefined && move.revealed !== undefined ? [to] : turned;
  return { ...from !== undefined && from !== to ? { from } : {}, to, capture: Boolean(move.capture || move.battle), flips };
}

/** The effect for the newest board-touching move between two snapshots; see `newBoardRecords` for the skips. */
export function boardFxPlan(
  previous: PlayerVisibleGameState | null, next: PlayerVisibleGameState | null,
): BoardFxPlan | null {
  for (const record of newBoardRecords(previous, next) ?? []) {
    const plan = boardFxOf(record);
    if (plan) return plan;
  }
  return null;
}

/** Start delay of each turned disc: in board order, squeezed so the whole sequence fits its limit. */
export function flipDelays(count: number): readonly number[] {
  const animated = Math.min(count, BOARD_FX_LIMITS.flips);
  if (animated === 0) return [];
  const { flipMs, flipSequenceMs } = BOARD_FX_LIMITS;
  const step = animated > 1 ? Math.min(90, (flipSequenceMs - flipMs) / (animated - 1)) : 0;
  return Array.from({ length: animated }, (_, index) => Math.round(step * index));
}

/** The sheen that crosses a turned piece once it shows its new face. */
export const GLINT_MS = 320;

/** Web Animations keyframes of one turned piece's parts: the squeezing box, its two faces, and the sheen. */
export interface FlipFrames {
  readonly flip: Keyframe[];
  readonly before: Keyframe[];
  readonly after: Keyframe[];
  readonly glint: Keyframe[];
}

/** How long a sequence of turned pieces runs, including the last sheen. */
export function flipSequenceMs(delays: readonly number[]): number {
  return delays.length ? Math.max(...delays) + BOARD_FX_LIMITS.flipMs / 2 + GLINT_MS : 0;
}

/**
 * Keyframes of a piece turning `delay` ms into a sequence of `totalMs`. Every part of every piece runs for the
 * whole sequence and waits inside its keyframes, so they all start and end together: staggered starts and ends
 * would each make Chrome render the page on the main thread for a few frames.
 */
export function flipFrames(delay: number, totalMs: number): FlipFrames {
  const at = (ms: number): number => Math.min(1, Math.max(0, ms / totalMs));
  const turn = delay + BOARD_FX_LIMITS.flipMs / 2;
  const done = delay + BOARD_FX_LIMITS.flipMs;
  const glintEnd = turn + GLINT_MS;
  const from = 'translateX(-170%) rotate(20deg)';
  const to = 'translateX(170%) rotate(20deg)';
  return {
    flip: [
      { offset: 0, transform: 'scaleX(1)' }, { offset: at(delay), transform: 'scaleX(1)', easing: 'ease-in-out' },
      { offset: at(turn), transform: 'scaleX(0.06)', easing: 'ease-in-out' }, { offset: at(done), transform: 'scaleX(1)' },
      { offset: 1, transform: 'scaleX(1)' },
    ],
    before: [{ offset: 0, opacity: 1 }, { offset: at(turn), opacity: 1 }, { offset: at(turn), opacity: 0 }, { offset: 1, opacity: 0 }],
    after: [{ offset: 0, opacity: 0 }, { offset: at(turn), opacity: 0 }, { offset: at(turn), opacity: 1 }, { offset: 1, opacity: 1 }],
    glint: [
      { offset: 0, opacity: 0, transform: from }, { offset: at(turn), opacity: 0, transform: from, easing: 'ease-out' },
      { offset: at(turn + GLINT_MS * 0.3), opacity: 1, easing: 'ease-out' },
      { offset: at(turn + GLINT_MS * 0.7), opacity: 1, easing: 'ease-out' },
      { offset: at(glintEnd), opacity: 0, transform: to }, { offset: 1, opacity: 0, transform: to },
    ],
  };
}

/** Particle angles and reach for a burst of `count`, alternating slightly so it never looks like a clock face. */
export function burstParticles(count: number, spread: number): readonly { readonly angle: number; readonly reach: number }[] {
  const total = Math.max(0, Math.min(BOARD_FX_LIMITS.particles, Math.round(count)));
  return Array.from({ length: total }, (_, index) => ({
    angle: Math.round((index * 360) / total + (index % 2 ? 14 : 0)),
    reach: Math.round(spread * (1 + (index % 3) * 0.12) * 100) / 100,
  }));
}

/** How long a move's effect group stays mounted, and how long its moving pieces stay hidden in the board. */
export function boardFxTiming(plan: BoardFxPlan): { readonly hideMs: number; readonly totalMs: number } {
  const { slideMs, flipMs, effectMs } = BOARD_FX_LIMITS;
  const delays = flipDelays(plan.flips.length);
  const flipEnd = delays.length ? delays[delays.length - 1] + flipMs : 0;
  const slide = plan.from !== undefined ? slideMs : 0;
  return { hideMs: Math.max(slide, flipEnd), totalMs: Math.max(effectMs, flipEnd) };
}
