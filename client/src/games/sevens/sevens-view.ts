import { SUIT_DISPLAY_ORDER } from '@shared/constants';
import { svCardPenalty, svIsRowClosed } from '@shared/rules/sevens';
import type { Card, Rank, SevensLogEntry, SevensTable, Suit } from '@shared/types';

const ROW_LENGTH = 13;

/** `played` is on the table, `next` extends or opens the row, `empty` is not reachable yet. */
export type SevensSlotState = 'played' | 'next' | 'empty';

export interface SevensSlot {
  readonly order: number;
  readonly card: Card;
  readonly state: SevensSlotState;
  /** The local player may play this card now */
  readonly target: boolean;
}

export interface SevensRow {
  readonly suit: Suit;
  readonly open: boolean;
  readonly closed: boolean;
  readonly slots: readonly SevensSlot[];
}

/** What the local player's hand does right now. */
export type SevensHandMode = 'play' | 'cover' | 'wait';

export function sameCard(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

/** Inverse of `svOrder`: A sits at order 1. */
export function rankAtOrder(order: number): Rank {
  if (!Number.isInteger(order) || order < 1 || order > ROW_LENGTH) throw new Error('order out of range');
  return (order === 1 ? 14 : order) as Rank;
}

/** Thirteen A…K slots per suit in display order; targets mark where the player's valid cards would land. */
export function sevensRows(table: SevensTable, targets: readonly Card[], closeOnEnd = false): SevensRow[] {
  return SUIT_DISPLAY_ORDER.map((suit) => {
    const row = table[suit];
    const closed = svIsRowClosed(row, closeOnEnd);
    const slots = Array.from({ length: ROW_LENGTH }, (_, index): SevensSlot => {
      const order = index + 1;
      const card: Card = { suit, rank: rankAtOrder(order) };
      const state: SevensSlotState = row
        ? order >= row.low && order <= row.high ? 'played'
          : !closed && (order === row.low - 1 || order === row.high + 1) ? 'next' : 'empty'
        : order === 7 ? 'next' : 'empty';
      return { order, card, state, target: state === 'next' && targets.some((target) => sameCard(target, card)) };
    });
    return { suit, open: row !== null, closed, slots };
  });
}

/**
 * The server sends no valid cards when it is not the player's turn, and also when the
 * player must cover, so an empty list only means "cover" on the player's own turn.
 */
export function sevensHandMode(isMyTurn: boolean, validCards: readonly Card[], handSize: number): SevensHandMode {
  if (!isMyTurn || handSize === 0) return 'wait';
  return validCards.length > 0 ? 'play' : 'cover';
}

/** Keep a cover selection only while it is still a card in hand. */
export function coverSelection(selected: Card | null, hand: readonly Card[]): Card | null {
  return selected && hand.some((card) => sameCard(card, selected)) ? selected : null;
}

/** Penalty after covering `card`, so the confirmation shows its cost. */
export function coverCost(card: Card, covered: readonly Card[]): { penalty: number; total: number } {
  const penalty = svCardPenalty(card);
  return { penalty, total: covered.reduce((sum, item) => sum + svCardPenalty(item), penalty) };
}

/** The most recent card placed on the table, for highlighting. */
export function lastPlayedCard(log: readonly SevensLogEntry[]): Card | null {
  for (let index = log.length - 1; index >= 0; index--) {
    const entry = log[index];
    if (entry.type === 'play') return entry.card;
  }
  return null;
}

/** Newest first, limited to `limit` entries. */
export function recentMoves(log: readonly SevensLogEntry[], limit: number): SevensLogEntry[] {
  return limit > 0 ? log.slice(-limit).reverse() : [];
}

/** Dragon Slaying presentation length; must match the shared `slay` frame. */
export const SLAY_DURATION_MS = 2400;
/** The blade enters the slain row's left edge here and leaves its right edge after the sweep. */
export const SLAY_SWEEP_START_MS = 250;
export const SLAY_SWEEP_MS = 450;

/** Back to front: smoke behind, broad dark flames, bright tongues, white-hot cores, rising embers. */
export type SlayLayer = 'smoke' | 'back' | 'mid' | 'core' | 'ember';

export interface SlayParticle {
  readonly layer: SlayLayer;
  /** Position along the slash, 0 at its left end and 1 at its right end */
  readonly t: number;
  readonly scale: number;
  readonly delayMs: number;
  readonly lifeMs: number;
  /** Sideways drift in px while rising */
  readonly drift: number;
  /** Rise height as a multiple of the particle's own height */
  readonly rise: number;
}

/** When the blade passes `t`; fire along the row lights in the same left-to-right order. */
export const slayArrivalMs = (t: number): number => SLAY_SWEEP_START_MS + t * SLAY_SWEEP_MS;

/** Stable pseudo-random value in [0, 1) so every viewer sees the same fire. */
const jitter = (seed: number): number => ((seed * 9301 + 49297) % 233280) / 233280;

interface LayerSpec {
  readonly layer: SlayLayer;
  readonly count: number;
  readonly scale: readonly [number, number];
  readonly life: readonly [number, number];
  /** Extra delay after the blade passes */
  readonly lag: readonly [number, number];
  readonly drift: number;
  readonly rise: readonly [number, number];
}

const LAYERS: readonly LayerSpec[] = [
  { layer: 'smoke', count: 9, scale: [1.3, 1.9], life: [1000, 1250], lag: [260, 380], drift: 70, rise: [1.4, 2] },
  { layer: 'back', count: 12, scale: [1.3, 1.8], life: [1250, 1500], lag: [20, 80], drift: 30, rise: [0.5, 0.8] },
  { layer: 'mid', count: 18, scale: [0.85, 1.3], life: [950, 1300], lag: [0, 60], drift: 24, rise: [0.6, 1] },
  { layer: 'core', count: 22, scale: [0.4, 0.7], life: [550, 900], lag: [0, 40], drift: 10, rise: [0.3, 0.6] },
  { layer: 'ember', count: 26, scale: [0.6, 1.4], life: [700, 1100], lag: [0, 480], drift: 70, rise: [3, 6] },
];

const between = ([low, high]: readonly [number, number], random: number): number => low + (high - low) * random;

/** Every particle, back layer first; each lights only after the blade has passed its position. */
export const SLAY_PARTICLES: readonly SlayParticle[] = LAYERS.flatMap((spec, layerIndex) =>
  Array.from({ length: spec.count }, (_, index): SlayParticle => {
    const seed = layerIndex * 100 + index;
    const t = Math.min(1, Math.max(0, (index + 0.2 + jitter(seed) * 0.6) / spec.count));
    return {
      layer: spec.layer,
      t: Math.round(t * 1000) / 1000,
      scale: Math.round(between(spec.scale, jitter(seed + 17)) * 100) / 100,
      delayMs: Math.round(slayArrivalMs(t) + between(spec.lag, jitter(seed + 31))),
      lifeMs: Math.round(between(spec.life, jitter(seed + 47))),
      drift: Math.round((jitter(seed + 59) - 0.5) * 2 * spec.drift),
      rise: Math.round(between(spec.rise, jitter(seed + 71)) * 100) / 100,
    };
  }));

type Box = Pick<DOMRectReadOnly, 'left' | 'top' | 'width' | 'height'>;

export interface SlayAnchor {
  /** Slash start and vertical row centre, relative to the effect layer */
  readonly left: number;
  readonly y: number;
  readonly width: number;
  readonly rowLeft: number;
  readonly rowWidth: number;
  readonly rowHeight: number;
}

/** The blade overshoots both ends of the row slightly. */
const SLASH_OVERSHOOT = 16;

/** Lays the slash along the slain row, or across the middle of the table if the row is not rendered. */
export function slayAnchor(layer: Box, row: Box | null): SlayAnchor {
  if (!row || row.width === 0 || row.height === 0) {
    return { left: layer.width * 0.15, y: layer.height / 2, width: layer.width * 0.7,
      rowLeft: layer.width * 0.15, rowWidth: 0, rowHeight: 0 };
  }
  const rowLeft = row.left - layer.left;
  return {
    left: rowLeft - SLASH_OVERSHOOT,
    y: row.top - layer.top + row.height / 2,
    width: row.width + SLASH_OVERSHOOT * 2,
    rowLeft,
    rowWidth: row.width,
    rowHeight: row.height,
  };
}
