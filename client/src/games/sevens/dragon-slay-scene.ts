// ─── Dragon Slaying scene: timeline, dragon pose and fire simulation (pure; drawn by dragon-slay-render) ───

import { SEVENS_SLAY_FRAME_MS } from '@shared/sevens-options';
import type { SevensSlayEffect } from '@shared/types';

/** Presentation length of the dragon effect, shared with the `slay` frame. */
export const SLAY_DURATION_MS = SEVENS_SLAY_FRAME_MS.dragon;
/** The dragon's phases were laid out for a 2.9-second frame; all of them scale with its actual length. */
const DRAGON_DESIGN_MS = 2900;
export const DRAGON_PACE = SLAY_DURATION_MS / DRAGON_DESIGN_MS;
const paced = (ms: number): number => Math.round(ms * DRAGON_PACE);
/**
 * Seen from above, the dragon rises out of the bottom-left corner, sweeps a 180-degree turn up the left side
 * of the table, and flies along the row until its snout reaches the K end.
 */
export const SLAY_FLY_START_MS = paced(150);
export const SLAY_FLY_MS = paced(1700);
/** Then a blade sweeps the row left to right, splitting the dragon lengthwise, and the halves fly apart. */
export const SLAY_STRIKE_MS = SLAY_FLY_START_MS + SLAY_FLY_MS;
export const SLAY_CUT_MS = paced(120);
export const SLAY_SPLIT_MS = paced(700);
/** Fire breath runs from here until the blade comes. */
export const SLAY_BREATH_START_MS = paced(300);
/** Fire spreads over the dragon from the neck to the tail tip between these times. */
export const SLAY_BODY_CATCH_MS = [paced(400), paced(1500)] as const;
export const SLAY_FADE_MS = paced(300);

/** Fire-only effect: a quick blade sweeps the row left to right, setting it alight as it passes. */
export const FIRE_DURATION_MS = SEVENS_SLAY_FRAME_MS.fire;
export const FIRE_STRIKE_MS = 280;
export const FIRE_CUT_MS = 300;
/** The row keeps burning this long after the sweep before the fade. */
const FIRE_BURN_AFTER_MS = 820;
const FIRE_FADE_IN_MS = 150;
const FIRE_FADE_MS = 300;

/** The moments both effects share, in ms from the start of the frame. */
export interface SlayTimeline {
  readonly duration: number;
  /** The table darkens over `fadeIn` at the start and everything but the char fades over `fade` at the end */
  readonly fadeIn: number;
  readonly fade: number;
  /** Speed of the after-cut flash, streak, wound and jolt, relative to their original lengths */
  readonly pace: number;
  /** Fire roars from `fireStart` to `fireEnd` */
  readonly fireStart: number;
  readonly fireEnd: number;
  /** The blade sweeps the row from `strike` for `cut` */
  readonly strike: number;
  readonly cut: number;
}

export function slayTimeline(effect: SevensSlayEffect): SlayTimeline {
  return effect === 'fire'
    ? { duration: FIRE_DURATION_MS, fadeIn: FIRE_FADE_IN_MS, fade: FIRE_FADE_MS, pace: 1, fireStart: FIRE_STRIKE_MS,
      fireEnd: FIRE_STRIKE_MS + FIRE_CUT_MS + FIRE_BURN_AFTER_MS, strike: FIRE_STRIKE_MS, cut: FIRE_CUT_MS }
    : { duration: SLAY_DURATION_MS, fadeIn: SLAY_FLY_START_MS, fade: SLAY_FADE_MS, pace: DRAGON_PACE,
      fireStart: SLAY_BREATH_START_MS, fireEnd: SLAY_STRIKE_MS, strike: SLAY_STRIKE_MS, cut: SLAY_CUT_MS };
}

/** Head length (snout tip to neck) and body length (neck to tail tip), in card heights. */
export const DRAGON_HEAD = 1.7;
export const DRAGON_BODY = 14;
/** Thickest body width, at the chest, in card heights. */
export const DRAGON_CHEST = 0.85;
export const SPINE_POINTS = 96;

/** Scene geometry in layer pixels; the dragon is sized from the row's card height. */
export interface SlayLayout {
  readonly width: number;
  readonly height: number;
  readonly rowLeft: number;
  readonly rowRight: number;
  /** Vertical row centre */
  readonly rowY: number;
  readonly card: number;
}

type Box = Pick<DOMRectReadOnly, 'left' | 'top' | 'width' | 'height'>;

/** Card height used when the row is not rendered. */
const FALLBACK_CARD = 40;

/** Locates the slain row inside the effect layer, or the middle of the table if the row is not rendered. */
export function slayLayout(layer: Box, row: Box | null): SlayLayout {
  if (!row || row.width === 0 || row.height === 0) {
    return { width: layer.width, height: layer.height, rowLeft: layer.width * 0.15, rowRight: layer.width * 0.85,
      rowY: layer.height / 2, card: FALLBACK_CARD };
  }
  const rowLeft = row.left - layer.left;
  return { width: layer.width, height: layer.height, rowLeft, rowRight: rowLeft + row.width,
    rowY: row.top - layer.top + row.height / 2, card: row.height };
}

export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const easeInOut = (value: number): number => 0.5 - Math.cos(Math.PI * clamp01(value)) / 2;
const easeOut = (value: number): number => 1 - (1 - clamp01(value)) ** 2;

/** Mostly steady speed, easing slightly in and out. */
function flightProgress(ms: number): number {
  const linear = clamp01((ms - SLAY_FLY_START_MS) / SLAY_FLY_MS);
  return linear * 0.7 + easeInOut(linear) * 0.3;
}

/**
 * The flight path: a half circle starting below the bottom edge heading left, bulging out to the left and
 * ending just before the row heading right, then a straight run along the row.
 */
export interface FlightPath {
  readonly centerX: number;
  readonly centerY: number;
  readonly radius: number;
  /** Length of the half circle, then of the whole path to the row's K end */
  readonly turn: number;
  readonly total: number;
}

export function flightPath(layout: SlayLayout): FlightPath {
  const radius = Math.max(1.5 * layout.card, (layout.height + 0.6 * layout.card - layout.rowY) / 2);
  // Swing in from near the bottom-left corner, finishing the turn before the row starts.
  const centerX = Math.min(layout.rowLeft - 0.3 * layout.card, layout.width * 0.12);
  const turn = Math.PI * radius;
  return { centerX, centerY: layout.rowY + radius, radius, turn, total: turn + layout.rowRight - centerX };
}

/** Position and unit heading at distance `d` along the path; before the start it extends back off the bottom. */
export function pathPoint(path: FlightPath, d: number): { x: number; y: number; hx: number; hy: number } {
  if (d < 0) return { x: path.centerX - d, y: path.centerY + path.radius, hx: -1, hy: 0 };
  if (d <= path.turn) {
    // Screen angles run clockwise (y down): from the bottom (pi/2) round the left (pi) to the top (3pi/2).
    const angle = Math.PI / 2 + d / path.radius;
    return { x: path.centerX + path.radius * Math.cos(angle), y: path.centerY + path.radius * Math.sin(angle),
      hx: -Math.sin(angle), hy: Math.cos(angle) };
  }
  return { x: path.centerX + d - path.turn, y: path.centerY - path.radius, hx: 1, hy: 0 };
}

/** How far the snout has travelled along the path. */
export function snoutDistance(layout: SlayLayout, ms: number): number {
  return flightPath(layout).total * flightProgress(ms);
}

export function snoutPoint(layout: SlayLayout, ms: number): { x: number; y: number; hx: number; hy: number } {
  return pathPoint(flightPath(layout), snoutDistance(layout, ms));
}

/** Flight speed along the path in px/s, used to carry the breath and leave body fire trailing behind. */
export function flightSpeed(layout: SlayLayout, ms: number): number {
  return (snoutDistance(layout, ms + 8) - snoutDistance(layout, ms - 8)) / 0.016;
}

/** Full body width at `u` (0 at the neck, 1 at the tail tip), in card heights. */
export function bodyWidth(u: number): number {
  const position = clamp01(u);
  if (position < 0.1) return DRAGON_CHEST * (0.72 + 0.28 * easeInOut(position / 0.1));
  return DRAGON_CHEST * (0.06 + 0.94 * (1 - (position - 0.1) / 0.9) ** 0.6);
}

export interface SpinePoint {
  readonly x: number;
  readonly y: number;
  /** Unit tangent pointing toward the tail */
  readonly tx: number;
  readonly ty: number;
  /** Unit normal: the dragon's left side when seen from above */
  readonly nx: number;
  readonly ny: number;
  /** Half the body width in px */
  readonly half: number;
  /** Distance behind the neck in px, and as a fraction of the body */
  readonly s: number;
  readonly u: number;
}

const WAVE_LENGTH = 5;
const WAVE_HZ = 1.5;

/** Side-to-side swimming: a wave travels from the head to the tail, swinging the tail more. */
function undulation(layout: SlayLayout, s: number, u: number, ms: number): number {
  const amplitude = layout.card * (0.08 + 0.2 * u);
  return amplitude * Math.sin((2 * Math.PI * s) / (WAVE_LENGTH * layout.card) - (2 * Math.PI * WAVE_HZ * ms) / 1000);
}

/** Body centreline from the neck to the tail tip, following the flight path. */
export function dragonSpine(layout: SlayLayout, ms: number): SpinePoint[] {
  const path = flightPath(layout);
  const length = DRAGON_BODY * layout.card;
  const neck = snoutDistance(layout, ms) - DRAGON_HEAD * layout.card;
  const raw = Array.from({ length: SPINE_POINTS }, (_, index) => {
    const u = index / (SPINE_POINTS - 1);
    const s = u * length;
    const point = pathPoint(path, neck - s);
    const sway = undulation(layout, s, u, ms);
    // The heading's left normal is (hy, -hx) on screen.
    return { x: point.x + point.hy * sway, y: point.y - point.hx * sway, s, u };
  });
  return raw.map((point, index) => {
    const before = raw[Math.max(0, index - 1)];
    const after = raw[Math.min(raw.length - 1, index + 1)];
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const norm = Math.hypot(dx, dy) || 1;
    const tx = dx / norm;
    const ty = dy / norm;
    return { ...point, tx, ty, nx: -ty, ny: tx, half: (bodyWidth(point.u) * layout.card) / 2 };
  });
}

/** Head placement: the neck joint and the forward direction (opposite the spine tangent at the neck). */
export function headPose(spine: readonly SpinePoint[]): { x: number; y: number; angle: number } {
  const neck = spine[0];
  // Average a few points so the head does not wobble with every ripple.
  const ahead = spine[Math.min(4, spine.length - 1)];
  return { x: neck.x, y: neck.y, angle: Math.atan2(neck.y - ahead.y, neck.x - ahead.x) };
}

/** Local head point (card heights, x forward, y to the dragon's right) in layer px. */
export function headPoint(pose: { x: number; y: number; angle: number }, card: number, x: number, y: number): {
  x: number; y: number;
} {
  const cos = Math.cos(pose.angle);
  const sin = Math.sin(pose.angle);
  return { x: pose.x + (x * cos - y * sin) * card, y: pose.y + (x * sin + y * cos) * card };
}

/** Where the breath leaves the snout, in head units. */
export const MOUTH = { x: 1.6, y: 0 } as const;

export function breathing(ms: number): boolean {
  return ms >= SLAY_BREATH_START_MS && ms < SLAY_STRIKE_MS;
}

/** How far back from the neck the dragon is burning, in px. */
export function burnFront(layout: SlayLayout, ms: number): number {
  const [start, end] = SLAY_BODY_CATCH_MS;
  return DRAGON_BODY * layout.card * clamp01((ms - start) / (end - start));
}

/** 0 for untouched scales, 1 for fully scorched, with a soft edge behind the burn front. */
export function scorch(layout: SlayLayout, ms: number, s: number): number {
  return clamp01((burnFront(layout, ms) - s) / (0.2 * DRAGON_BODY * layout.card));
}

/** The breath reaches this far ahead of the snout. */
const BREATH_REACH = 2.2;

/** Right end of the burning part of the row; equal to `rowLeft` until the dragon turns onto the row. */
export function rowFireFront(layout: SlayLayout, ms: number): number {
  // The breath stops at the strike, so the reach is the furthest the fire got by then.
  const at = Math.min(ms, SLAY_STRIKE_MS);
  if (at < SLAY_BREATH_START_MS || snoutDistance(layout, at) < flightPath(layout).turn) return layout.rowLeft;
  const reached = snoutPoint(layout, at).x + BREATH_REACH * layout.card;
  return Math.min(layout.rowRight, Math.max(layout.rowLeft, reached));
}

/** The blade's leading x during the cut, or null outside it. */
export function bladeX(layout: SlayLayout, ms: number, strike = SLAY_STRIKE_MS, cut = SLAY_CUT_MS): number | null {
  if (ms < strike || ms > strike + cut) return null;
  const start = layout.rowLeft - 0.5 * layout.card;
  const end = layout.rowRight + 0.5 * layout.card;
  return start + (end - start) * clamp01((ms - strike) / cut);
}

/** Fire-only effect: the row burns up to the blade, so the fire and the cut move right together. */
export function fireSweepFront(layout: SlayLayout, ms: number): number {
  if (ms < FIRE_STRIKE_MS) return layout.rowLeft;
  const blade = bladeX(layout, ms, FIRE_STRIKE_MS, FIRE_CUT_MS) ?? layout.rowRight;
  return Math.min(layout.rowRight, Math.max(layout.rowLeft, blade));
}

export interface HalfPose {
  readonly dx: number;
  readonly dy: number;
  /** Rotation in radians about the cut point under the snout */
  readonly turn: number;
  readonly alpha: number;
}

/** The two halves after the cut: the upper flung up and back, the lower dropping; null before the cut ends. */
export function splitPose(layout: SlayLayout, ms: number): { upper: HalfPose; lower: HalfPose; flare: number } | null {
  const start = SLAY_STRIKE_MS + SLAY_CUT_MS;
  if (ms < start) return null;
  const progress = clamp01((ms - start) / SLAY_SPLIT_MS);
  const alpha = 1 - progress ** 2;
  const card = layout.card;
  return {
    upper: { dx: -0.5 * card * easeOut(progress), dy: -2.2 * card * easeOut(progress), turn: -0.08 * progress, alpha },
    lower: { dx: 0.4 * card * progress, dy: 2.8 * card * progress ** 1.5, turn: 0.1 * progress, alpha },
    flare: (1 - progress) ** 3,
  };
}

/** Everything but the charred row fades out at the end. */
export function sceneFade(ms: number, duration = SLAY_DURATION_MS, fade = SLAY_FADE_MS): number {
  return 1 - clamp01((ms - (duration - fade)) / fade);
}

export function backdropAlpha(ms: number, duration = SLAY_DURATION_MS, fade = SLAY_FADE_MS,
  fadeIn = SLAY_FLY_START_MS): number {
  return clamp01(ms / fadeIn) * sceneFade(ms, duration, fade);
}

/** Jolt offset in px just after the cut lands; `pace` shortens it with the rest of the effect. */
export function shake(layout: SlayLayout, ms: number, strike = SLAY_STRIKE_MS, cut = SLAY_CUT_MS,
  pace = DRAGON_PACE): { x: number; y: number } {
  const length = 260 * pace;
  const elapsed = ms - strike - cut;
  if (elapsed < 0 || elapsed > length) return { x: 0, y: 0 };
  const strength = layout.card * 0.12 * (1 - elapsed / length);
  return { x: Math.sin(elapsed * 0.11) * strength, y: Math.cos(elapsed * 0.17) * strength };
}

// ─── Fire simulation ───

export type ParticleKind = 'flame' | 'smoke' | 'ember' | 'spark';

export interface Particle {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  /** Size growth per second */
  grow: number;
  /** Starting temperature: 1 is white-hot; flames cool through yellow, orange and red as they age */
  heat: number;
  seed: number;
}

export interface FireSystem {
  readonly particles: Particle[];
  readonly random: () => number;
  /** Fractional spawn counts carried between frames, per emitter */
  readonly carry: Map<string, number>;
  /** Particle budget, scaled down on small screens */
  readonly cap: number;
}

/** Small deterministic generator so the effect does not depend on Math.random. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function createFireSystem(layout: Pick<SlayLayout, 'width' | 'height'>, seed = 7): FireSystem {
  const area = layout.width * layout.height;
  return {
    particles: [], random: seededRandom(seed), carry: new Map(),
    cap: Math.round(Math.min(2600, Math.max(700, area / 280))),
  };
}

/** Number of particles to spawn this frame for a rate per second, keeping the fractional remainder. */
function spawnCount(system: FireSystem, key: string, rate: number, dt: number): number {
  const total = (system.carry.get(key) ?? 0) + Math.max(0, rate) * dt;
  const count = Math.floor(total);
  system.carry.set(key, total - count);
  return Math.max(0, Math.min(count, system.cap - system.particles.length));
}

const between = (random: () => number, low: number, high: number): number => low + (high - low) * random();

/**
 * Fire on the burning part of the row, up to `front`, with smoke and embers. `intensity` scales how much fire
 * there is and how tall it burns; the fire-only effect burns hotter because nothing else is on screen.
 */
export function emitRow(system: FireSystem, layout: SlayLayout, ms: number, dt: number,
  front = rowFireFront(layout, ms), fade = sceneFade(ms), intensity = 1): void {
  const length = front - layout.rowLeft;
  if (length <= 0) return;
  const card = layout.card;
  const spans = (length / card) * fade;
  const { random } = system;
  const x = (): number => layout.rowLeft + random() * length;
  const height = Math.sqrt(intensity);
  for (let index = spawnCount(system, 'row', spans * 45 * intensity, dt); index > 0; index--) {
    system.particles.push({ kind: 'flame', x: x(), y: layout.rowY + between(random, -0.35, 0.45) * card,
      vx: between(random, -0.3, 0.3) * card, vy: -between(random, 1.2, 2.4) * card * height, age: 0,
      life: between(random, 0.55, 1), size: between(random, 0.28, 0.5) * card * height, grow: 0,
      heat: between(random, 0.8, 1), seed: random() });
  }
  for (let index = spawnCount(system, 'row-smoke', spans * 3 * intensity, dt); index > 0; index--) {
    system.particles.push({ kind: 'smoke', x: x(), y: layout.rowY - 0.5 * card, vx: between(random, -0.2, 0.2) * card,
      vy: -between(random, 0.5, 0.9) * card, age: 0, life: between(random, 1, 1.5), size: 0.7 * card,
      grow: 1.6 * card, heat: 0, seed: random() });
  }
  for (let index = spawnCount(system, 'row-ember', spans * 2.5 * intensity, dt); index > 0; index--) {
    system.particles.push({ kind: 'ember', x: x(), y: layout.rowY - 0.2 * card, vx: between(random, -0.6, 0.6) * card,
      vy: -between(random, 1.2, 2.6) * card, age: 0, life: between(random, 0.8, 1.4), size: 0.06 * card, grow: 0,
      heat: 1, seed: random() });
  }
}

/** Fire on the scorched part of the dragon, left behind as it flies so the flames trail. */
export function emitBody(system: FireSystem, layout: SlayLayout, spine: readonly SpinePoint[], ms: number,
  dt: number): void {
  const front = burnFront(layout, ms);
  // The flames stay where they are once the halves fly apart; new ones would not follow the pieces.
  if (front <= 0 || ms >= SLAY_STRIKE_MS + SLAY_CUT_MS) return;
  const card = layout.card;
  const burning = spine.filter((point) => point.s <= front);
  if (burning.length === 0) return;
  const { random } = system;
  const trail = 0.2 * flightSpeed(layout, ms);
  for (let index = spawnCount(system, 'body', (front / card) * 20 * sceneFade(ms), dt); index > 0; index--) {
    const point = burning[Math.floor(random() * burning.length)];
    const across = between(random, -0.85, 0.85) * point.half;
    const scale = Math.max(0.35, (point.half * 2) / (DRAGON_CHEST * card));
    system.particles.push({ kind: 'flame', x: point.x + point.nx * across, y: point.y + point.ny * across,
      vx: point.tx * trail + between(random, -0.3, 0.3) * card,
      vy: point.ty * trail - between(random, 0.9, 1.6) * card, age: 0,
      life: between(random, 0.35, 0.7), size: between(random, 0.22, 0.38) * card * scale, grow: 0,
      heat: between(random, 0.7, 1), seed: random() });
  }
}

/** Fire breath: a fast, narrow, white-hot stream from the mouth along the flight. */
export function emitBreath(system: FireSystem, layout: SlayLayout, mouth: { x: number; y: number }, angle: number,
  ms: number, dt: number): void {
  if (!breathing(ms)) return;
  const card = layout.card;
  const { random } = system;
  const carried = flightSpeed(layout, ms);
  for (let index = spawnCount(system, 'breath', 420, dt); index > 0; index--) {
    const direction = angle + between(random, -0.1, 0.1);
    const speed = between(random, 12, 16) * card;
    const vx = Math.cos(direction) * speed + Math.cos(angle) * carried;
    const vy = Math.sin(direction) * speed + Math.sin(angle) * carried;
    // Spread this frame's particles over the frame so the fast stream is continuous rather than in puffs.
    const lead = random() * dt;
    system.particles.push({ kind: 'flame', x: mouth.x + vx * lead, y: mouth.y + vy * lead, vx, vy, age: lead,
      life: between(random, 0.26, 0.42), size: 0.12 * card, grow: 2.2 * card, heat: 1, seed: random() });
  }
}

/** Fire-only effect: a white-hot surge where the blade is setting the row alight. */
export function emitSurge(system: FireSystem, layout: SlayLayout, front: number, ms: number, dt: number): void {
  if (ms < FIRE_STRIKE_MS || ms > FIRE_STRIKE_MS + FIRE_CUT_MS) return;
  const card = layout.card;
  const { random } = system;
  for (let index = spawnCount(system, 'surge', 370, dt); index > 0; index--) {
    system.particles.push({ kind: 'flame', x: front - random() * 0.8 * card,
      y: layout.rowY + between(random, -0.4, 0.4) * card, vx: between(random, 0.5, 2.5) * card,
      vy: -between(random, 1.5, 3) * card, age: 0, life: between(random, 0.35, 0.6),
      size: between(random, 0.45, 0.8) * card, grow: 0, heat: 1, seed: random() });
  }
}

/** Sparks thrown up and down off the blade as it passes. */
export function emitCut(system: FireSystem, layout: SlayLayout, ms: number, dt: number, strike = SLAY_STRIKE_MS,
  cut = SLAY_CUT_MS): void {
  const blade = bladeX(layout, ms, strike, cut);
  if (blade === null) return;
  const card = layout.card;
  const { random } = system;
  // About 60 sparks per sweep, whether the blade is fast or slow.
  for (let index = spawnCount(system, 'cut', 60000 / cut, dt); index > 0; index--) {
    const up = random() < 0.5 ? -1 : 1;
    system.particles.push({ kind: 'spark', x: blade - random() * card, y: layout.rowY,
      vx: between(random, -0.4, 1.4) * 5 * card, vy: up * between(random, 2.5, 8) * card, age: 0,
      life: between(random, 0.3, 0.6), size: 0.05 * card, grow: 0, heat: 1, seed: random() });
  }
}

/** Advances every particle: buoyant rise for fire, gravity for sparks, and curling turbulence. */
export function stepFire(system: FireSystem, card: number, ms: number, dt: number): void {
  const { particles } = system;
  let kept = 0;
  for (const particle of particles) {
    particle.age += dt;
    if (particle.age >= particle.life) continue;
    const swirl = Math.sin(particle.y / (1.1 * card) + ms * 0.006 + particle.seed * 6.3)
      + 0.6 * Math.sin(particle.x / (0.8 * card) - ms * 0.004 + particle.seed * 3.1);
    if (particle.kind === 'spark') {
      particle.vy += 6 * card * dt;
      particle.vx *= 1 - 0.8 * dt;
    } else {
      const lift = particle.kind === 'smoke' ? 1.1 : particle.kind === 'ember' ? 1.6 : 4.2;
      particle.vy -= lift * card * dt;
      particle.vx += swirl * (particle.kind === 'ember' ? 4 : 2.4) * card * dt;
      const drag = particle.kind === 'smoke' ? 0.9 : 1.6;
      particle.vx *= 1 - drag * dt;
      particle.vy *= 1 - drag * 0.5 * dt;
    }
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particles[kept++] = particle;
  }
  particles.length = kept;
}

/** Flame temperature after cooling with age: 1 white-hot, 0 dark red. */
export function flameHeat(particle: Pick<Particle, 'heat' | 'age' | 'life'>): number {
  return clamp01(particle.heat * (1 - (particle.age / particle.life) * 1.15));
}
