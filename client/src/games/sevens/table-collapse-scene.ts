// ─── Table collapse: the table shatters into shards once Dragon Slaying has closed every suit (pure) ───

import { SEVENS_COLLAPSE_MS } from '@shared/sevens-options';
import { clamp01, seededRandom } from './dragon-slay-scene';

/** Shared with the `collapse` frame; afterwards the broken table holds until the result. */
export const COLLAPSE_MS = SEVENS_COLLAPSE_MS;
/** Cracks run out from the impact to the edges, then the shards part and the middle falls in. */
export const CRACK_GROW_MS = 450;
export const CRACK_OPEN_MS = [400, 1100] as const;
export const SHAKE_MS = 900;
export const FLASH_MS = 250;
/** Each crack takes this long to split from its end nearer the impact to the other. */
const EDGE_SPLIT_MS = 70;

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** One piece of the broken table. */
export interface Shard {
  readonly polygon: readonly Point[];
  readonly center: Point;
  /** 1 at the impact, 0 at the farthest corner */
  readonly depth: number;
  /** -1 to 1: how the shard tips, which sets how much light it catches */
  readonly tilt: number;
  /** Shards at the impact fall away, leaving a hole */
  readonly fallen: boolean;
}

/** A crack along the border between two shards, split from `points[0]` (nearer the impact) onward. */
export interface Crack {
  readonly points: readonly Point[];
  /** Distance along the crack at each point; the last entry is its length */
  readonly lengths: readonly number[];
  /** When the crack starts to split and how long it takes */
  readonly start: number;
  readonly grow: number;
  /** Width of the opened gap in px */
  readonly width: number;
}

export interface Shatter {
  readonly shards: readonly Shard[];
  readonly cracks: readonly Crack[];
}

const easeOut = (value: number): number => 1 - (1 - clamp01(value)) ** 2;
const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Keeps the part of `polygon` on the side of the bisector nearer `own` than `other` (Sutherland-Hodgman). */
function clipToward(polygon: readonly Point[], own: Point, other: Point): Point[] {
  const nx = other.x - own.x;
  const ny = other.y - own.y;
  const limit = (nx * (own.x + other.x) + ny * (own.y + other.y)) / 2;
  const inside = (point: Point): boolean => nx * point.x + ny * point.y <= limit;
  const result: Point[] = [];
  polygon.forEach((point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    const here = inside(point);
    if (here) result.push(point);
    if (here !== inside(next)) {
      const a = nx * point.x + ny * point.y;
      const b = nx * next.x + ny * next.y;
      const t = (limit - a) / (b - a);
      result.push({ x: point.x + (next.x - point.x) * t, y: point.y + (next.y - point.y) * t });
    }
  });
  return result;
}

/** A straight border broken into a few slightly offset segments, like a real fracture line. */
function fractured(from: Point, to: Point, random: () => number): Point[] {
  const length = distance(from, to);
  const steps = Math.max(1, Math.min(4, Math.round(length / 28)));
  const nx = -(to.y - from.y) / (length || 1);
  const ny = (to.x - from.x) / (length || 1);
  const points: Point[] = [from];
  for (let step = 1; step < steps; step++) {
    const t = step / steps;
    const jag = (random() - 0.5) * Math.min(7, length * 0.12);
    points.push({ x: from.x + (to.x - from.x) * t + nx * jag, y: from.y + (to.y - from.y) * t + ny * jag });
  }
  points.push(to);
  return points;
}

/**
 * Breaks the table into shards around the impact: many small pieces near it and fewer, larger ones toward the
 * edges, bordered by straight, jagged cracks. Deterministic for a seed so every viewer sees the same break.
 */
export function shatterTable(width: number, height: number, impact: Point, seed = 11): Shatter {
  if (width <= 0 || height <= 0) return { shards: [], cracks: [] };
  const random = seededRandom(seed);
  const reach = Math.max(...[[0, 0], [width, 0], [0, height], [width, height]]
    .map(([x, y]) => Math.hypot(x - impact.x, y - impact.y)));
  const count = Math.round(Math.min(110, Math.max(45, (width * height) / 6000)));
  const sites: Point[] = [];
  for (let index = 0; index < count; index++) {
    // Most pieces crowd the impact; a few scatter to break up the far table.
    const radius = index < count * 0.8 ? reach * random() ** 1.8 : reach * random();
    const angle = random() * Math.PI * 2;
    sites.push({ x: impact.x + Math.cos(angle) * radius, y: impact.y + Math.sin(angle) * radius });
  }
  const pad = 30;
  const bounds: Point[] = [{ x: -pad, y: -pad }, { x: width + pad, y: -pad }, { x: width + pad, y: height + pad },
    { x: -pad, y: height + pad }];
  const holeRadius = Math.min(width, height) * 0.13;
  const shards: Shard[] = [];
  for (const site of sites) {
    let polygon: Point[] = bounds;
    for (const other of sites) {
      if (other !== site) polygon = clipToward(polygon, site, other);
      if (polygon.length === 0) break;
    }
    if (polygon.length < 3) continue;
    const center = {
      x: polygon.reduce((total, point) => total + point.x, 0) / polygon.length,
      y: polygon.reduce((total, point) => total + point.y, 0) / polygon.length,
    };
    shards.push({ polygon, center, depth: 1 - Math.min(1, distance(center, impact) / reach),
      tilt: random() * 2 - 1, fallen: distance(center, impact) < holeRadius });
  }
  // Each shared border becomes one crack, split outward from the end nearer the impact.
  const seen = new Set<string>();
  const key = (point: Point): string => `${Math.round(point.x)},${Math.round(point.y)}`;
  const cracks: Crack[] = [];
  const scale = Math.min(1.4, Math.max(0.6, Math.min(width, height) / 500));
  for (const shard of shards) {
    shard.polygon.forEach((point, index) => {
      const next = shard.polygon[(index + 1) % shard.polygon.length];
      const id = [key(point), key(next)].sort().join('|');
      if (seen.has(id) || distance(point, next) < 2) return;
      seen.add(id);
      const [near, far] = distance(point, impact) <= distance(next, impact) ? [point, next] : [next, point];
      const points = fractured(near, far, random);
      const lengths = points.map(() => 0);
      for (let step = 1; step < points.length; step++) {
        lengths[step] = lengths[step - 1] + distance(points[step - 1], points[step]);
      }
      // Borders in the padding past the corners are off the table; they still split by the end of the run.
      const along = Math.min(1, distance(near, impact) / reach);
      cracks.push({ points, lengths, start: CRACK_GROW_MS * along, grow: EDGE_SPLIT_MS,
        width: (0.9 + 3.2 * (1 - along) ** 2) * scale });
    });
  }
  return { shards, cracks };
}

/** How much of the crack has split at `ms`, in px along it. */
export function crackReach(crack: Crack, ms: number): number {
  const total = crack.lengths[crack.lengths.length - 1];
  if (ms < crack.start) return 0;
  return total * clamp01((ms - crack.start) / crack.grow);
}

/** How far the shards have parted, 0 to 1; the shading and the hole deepen with it. */
export function openProgress(ms: number): number {
  const [start, end] = CRACK_OPEN_MS;
  return easeOut((ms - start) / (end - start));
}

/** Gap width at `ms`: a hairline as the crack splits, then opened to its full width. */
export function crackWidth(crack: Crack, ms: number): number {
  return Math.max(0.8, crack.width * openProgress(ms));
}

/** The table jolts hardest at the impact and settles by `SHAKE_MS`. */
export function collapseShake(ms: number): Point {
  if (ms < 0 || ms > SHAKE_MS) return { x: 0, y: 0 };
  const strength = 7 * (1 - ms / SHAKE_MS) ** 1.5;
  return { x: Math.sin(ms * 0.09) * strength, y: Math.cos(ms * 0.13) * strength };
}

/** Darkness settling over the broken table; it stays once the collapse is over. */
export function collapseShade(ms: number): number {
  return 0.3 * openProgress(ms);
}
