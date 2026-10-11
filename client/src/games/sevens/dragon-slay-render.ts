// ─── Dragon Slaying renderer: paints dragon-slay-scene onto a 2D canvas every animation frame ───

import type { SevensSlayEffect } from '@shared/types';
import {
  bladeX, backdropAlpha, breathing, burnFront, clamp01, createFireSystem, dragonSpine, emitBody, emitBreath, emitCut,
  emitRow, emitSurge, fireSweepFront, flameHeat, headPoint, headPose, MOUTH, rowFireFront, sceneFade, scorch, shake,
  SLAY_BODY_CATCH_MS, slayTimeline, splitPose, stepFire,
} from './dragon-slay-scene';
import type { FireSystem, HalfPose, Particle, SlayLayout, SlayTimeline, SpinePoint } from './dragon-slay-scene';

type Context = CanvasRenderingContext2D;

/** The fire-only effect has nothing but fire on screen, so the row burns denser and taller. */
const FIRE_ONLY_INTENSITY = 1.5;
type Point = { x: number; y: number };
type Stops = readonly (readonly [number, string])[];

export interface SlayRenderer {
  /** `ms` is the time since the slay frame started; `dt` the seconds since the previous call. */
  draw: (layout: SlayLayout, ms: number, dt: number, still: boolean, effect: SevensSlayEffect) => void;
}

// Body shading across its width seen from above: lightest along the rounded back, darkening to both flanks.
const BODY_STOPS: Stops = [
  [0, '#0b2a17'], [0.16, '#1a5030'], [0.36, '#3f9a55'], [0.5, '#5cb871'], [0.64, '#3f9a55'], [0.84, '#1a5030'],
  [1, '#0b2a17'],
];

const FLAME_STOPS: readonly Stops[] = [
  [[0, 'rgba(255,255,240,1)'], [0.25, 'rgba(255,240,180,0.8)'], [0.6, 'rgba(255,190,80,0.25)'], [1, 'rgba(255,150,40,0)']],
  [[0, 'rgba(255,236,150,1)'], [0.3, 'rgba(255,200,70,0.7)'], [0.65, 'rgba(255,130,20,0.2)'], [1, 'rgba(255,100,0,0)']],
  [[0, 'rgba(255,170,60,0.95)'], [0.35, 'rgba(255,110,20,0.6)'], [0.7, 'rgba(220,60,0,0.18)'], [1, 'rgba(180,30,0,0)']],
  [[0, 'rgba(240,90,20,0.85)'], [0.4, 'rgba(200,40,0,0.45)'], [1, 'rgba(120,10,0,0)']],
  [[0, 'rgba(160,30,5,0.35)'], [0.5, 'rgba(100,10,0,0.12)'], [1, 'rgba(60,0,0,0)']],
];
const SMOKE_STOPS: Stops = [[0, 'rgba(55,46,42,0.85)'], [0.5, 'rgba(40,34,30,0.4)'], [1, 'rgba(30,25,22,0)']];
const EMBER_STOPS: Stops = [[0, 'rgba(255,250,220,1)'], [0.3, 'rgba(255,200,90,0.9)'], [1, 'rgba(255,120,0,0)']];

function gradientSprite(stops: Stops): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return canvas;
}

function linear(context: Context, from: Point, to: Point, stops: Stops): CanvasGradient {
  const gradient = context.createLinearGradient(from.x, from.y, to.x, to.y);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  return gradient;
}

function radial(context: Context, at: Point, radius: number, stops: Stops): CanvasGradient {
  // Radii can be in head units (one per card height), so only guard against zero.
  const gradient = context.createRadialGradient(at.x, at.y, 0, at.x, at.y, Math.max(1e-3, radius));
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  return gradient;
}

/** A filled stroke that narrows from `start` to `end` width along the points. */
function taper(context: Context, points: readonly Point[], start: number, end: number): void {
  if (points.length < 2) return;
  const left: Point[] = [];
  const right: Point[] = [];
  points.forEach((point, index) => {
    const before = points[Math.max(0, index - 1)];
    const after = points[Math.min(points.length - 1, index + 1)];
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const norm = Math.hypot(dx, dy) || 1;
    const half = (start + (end - start) * (index / (points.length - 1))) / 2;
    left.push({ x: point.x - (dy / norm) * half, y: point.y + (dx / norm) * half });
    right.push({ x: point.x + (dy / norm) * half, y: point.y - (dx / norm) * half });
  });
  context.beginPath();
  context.moveTo(left[0].x, left[0].y);
  for (const point of left.slice(1)) context.lineTo(point.x, point.y);
  for (const point of right.reverse()) context.lineTo(point.x, point.y);
  context.closePath();
  context.fill();
}

function bezier(p0: Point, p1: Point, p2: Point, p3: Point, steps = 18): Point[] {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    const u = 1 - t;
    return {
      x: u ** 3 * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t ** 3 * p3.x,
      y: u ** 3 * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t ** 3 * p3.y,
    };
  });
}

const offset = (point: SpinePoint, across: number, along = 0): Point => ({
  x: point.x + point.nx * across + point.tx * along, y: point.y + point.ny * across + point.ty * along,
});

/** Strands trailing back from both sides, waving as the dragon swims. */
function strands(context: Context, from: Point, back: Point, side: Point, length: number, spread: number,
  wave: number, width: number): void {
  const points = Array.from({ length: 10 }, (_, step) => {
    const f = step / 9;
    const out = f * spread + Math.sin(f * 4.5 - wave) * 0.12 * length * f;
    return { x: from.x + back.x * f * length + side.x * out, y: from.y + back.y * f * length + side.y * out };
  });
  taper(context, points, width, width * 0.06);
}

/**
 * The body seen from above: shaded strips darkening toward both flanks, overlapping scale rows that curve
 * with the body, a ridge of spines down the middle, and scorching where the fire has reached.
 */
function drawBody(context: Context, layout: SlayLayout, spine: readonly SpinePoint[], ms: number): void {
  const card = layout.card;
  for (let index = 0; index < spine.length - 1; index++) {
    const a = spine[index];
    const b = spine[index + 1];
    // Overlap the next strip slightly so no seams show between them.
    const reach = { x: b.x + (b.x - a.x) * 0.35, y: b.y + (b.y - a.y) * 0.35 };
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    context.fillStyle = linear(context, { x: middle.x + a.nx * a.half, y: middle.y + a.ny * a.half },
      { x: middle.x - a.nx * a.half, y: middle.y - a.ny * a.half }, BODY_STOPS);
    context.beginPath();
    context.moveTo(a.x + a.nx * a.half, a.y + a.ny * a.half);
    context.lineTo(reach.x + b.nx * b.half, reach.y + b.ny * b.half);
    context.lineTo(reach.x - b.nx * b.half, reach.y - b.ny * b.half);
    context.lineTo(a.x - a.nx * a.half, a.y - a.ny * a.half);
    context.closePath();
    context.fill();
  }

  // Scale rows: each scale's rounded free edge faces the tail.
  context.lineWidth = Math.max(0.8, card * 0.022);
  for (let index = 1; index < spine.length - 2; index += 2) {
    const point = spine[index];
    const radius = Math.max(1.5, point.half * 0.32);
    const tail = Math.atan2(point.ty, point.tx);
    const rows = point.half > card * 0.15 ? [-0.66, -0.22, 0.22, 0.66] : [-0.3, 0.3];
    const stagger = index % 4 === 1 ? 0 : 0.22;
    for (const across of rows) {
      const center = offset(point, (across + (across > 0 ? -stagger : stagger) * 0.5) * point.half);
      context.strokeStyle = 'rgba(0,22,8,0.5)';
      context.beginPath();
      context.arc(center.x, center.y, radius, tail - Math.PI / 2, tail + Math.PI / 2);
      context.stroke();
      context.strokeStyle = 'rgba(190,255,200,0.14)';
      context.beginPath();
      context.arc(center.x - point.tx * radius * 0.25, center.y - point.ty * radius * 0.25, radius * 0.7,
        tail - Math.PI / 3, tail + Math.PI / 3);
      context.stroke();
    }
  }

  // Charred where the fire has spread.
  for (let index = 0; index < spine.length - 1; index++) {
    const a = spine[index];
    const amount = scorch(layout, ms, a.s);
    if (amount <= 0) break;
    const b = spine[index + 1];
    context.fillStyle = `rgba(28,12,0,${0.32 * amount})`;
    context.beginPath();
    context.moveTo(a.x + a.nx * a.half, a.y + a.ny * a.half);
    context.lineTo(b.x + b.nx * b.half, b.y + b.ny * b.half);
    context.lineTo(b.x - b.nx * b.half, b.y - b.ny * b.half);
    context.lineTo(a.x - a.nx * a.half, a.y - a.ny * a.half);
    context.closePath();
    context.fill();
  }

  // Ridge down the spine, with raked spines that shrink toward the tail.
  context.strokeStyle = 'rgba(6,26,12,0.7)';
  context.lineWidth = Math.max(1, card * 0.04);
  context.beginPath();
  context.moveTo(spine[0].x, spine[0].y);
  for (const point of spine.slice(1, -4)) context.lineTo(point.x, point.y);
  context.stroke();
  for (let index = 1; index < spine.length - 6; index += 3) {
    const point = spine[index];
    const length = point.half * (1.1 - point.u * 0.6);
    const width = point.half * 0.3;
    const front = offset(point, 0, -length * 0.3);
    const tip = offset(point, 0, length);
    context.fillStyle = linear(context, front, tip, [[0, '#0d2b18'], [0.55, '#2f6a3f'], [1, '#d8cba0']]);
    context.beginPath();
    context.moveTo(front.x, front.y);
    const left = offset(point, width);
    const right = offset(point, -width);
    context.quadraticCurveTo(left.x, left.y, tip.x, tip.y);
    context.quadraticCurveTo(right.x, right.y, front.x, front.y);
    context.closePath();
    context.fill();
  }
}

/** Mane spilling from the back of the neck to both sides. */
function drawMane(context: Context, spine: readonly SpinePoint[], card: number, ms: number): void {
  const wave = ms * 0.009;
  const neckEnd = Math.round(spine.length * 0.1);
  for (let index = 0; index < neckEnd; index++) {
    const point = spine[index];
    for (const side of [1, -1]) {
      context.fillStyle = index % 2 === 0 ? '#5e5420' : '#8a7a2e';
      const normal = { x: point.nx * side, y: point.ny * side };
      strands(context, offset(point, point.half * 0.55 * side), { x: point.tx, y: point.ty }, normal,
        (1 - index * 0.06) * card, (0.28 + index * 0.02) * card, wave + index + side, 0.06 * card);
    }
  }
}

/** Tuft fanning from the tail tip. */
function drawTuft(context: Context, spine: readonly SpinePoint[], card: number, ms: number): void {
  const wave = ms * 0.009;
  const tip = spine[spine.length - 1];
  context.fillStyle = '#8a7a2e';
  for (const spread of [-0.5, -0.25, 0, 0.25, 0.5]) {
    strands(context, tip, { x: tip.tx, y: tip.ty }, { x: tip.nx, y: tip.ny }, 1 * card, spread * card,
      wave + spread * 4, 0.1 * card);
  }
}

/** Upper half of the head outline seen from above (x toward the snout, y to the dragon's left), in card heights. */
const HEAD_OUTLINE: readonly Point[] = [
  { x: 0, y: -0.3 }, { x: 0.12, y: -0.4 }, { x: 0.32, y: -0.47 }, { x: 0.5, y: -0.46 }, { x: 0.66, y: -0.4 },
  { x: 0.84, y: -0.3 }, { x: 1.05, y: -0.24 }, { x: 1.3, y: -0.2 }, { x: 1.48, y: -0.17 }, { x: 1.58, y: -0.11 },
  { x: 1.63, y: 0 },
];

function headPath(context: Context): void {
  const outline = [...HEAD_OUTLINE, ...[...HEAD_OUTLINE].reverse().slice(1).map((point) => ({ x: point.x, y: -point.y }))];
  context.beginPath();
  context.moveTo(outline[0].x, outline[0].y);
  // Smooth curve through the outline, using each point as a control and the midpoints as anchors.
  for (let index = 1; index < outline.length - 1; index++) {
    const next = outline[index + 1];
    context.quadraticCurveTo(outline[index].x, outline[index].y, (outline[index].x + next.x) / 2,
      (outline[index].y + next.y) / 2);
  }
  context.lineTo(outline[outline.length - 1].x, outline[outline.length - 1].y);
  context.closePath();
}

/** The head from above, in its own units: x toward the snout, y across, origin at the neck joint. */
function drawHead(context: Context, ms: number, burnt: number, breath: boolean): void {
  const wave = ms * 0.008;
  for (const side of [1, -1]) {
    // Mane from the back of the skull, under the head.
    for (let strand = 0; strand < 4; strand++) {
      context.fillStyle = strand % 2 === 0 ? '#5e5420' : '#8a7a2e';
      strands(context, { x: 0.12 + strand * 0.07, y: (0.22 + strand * 0.05) * side }, { x: -1, y: 0 },
        { x: 0, y: side }, 1.1, 0.28, wave + strand + side, 0.06);
    }
  }
  context.fillStyle = linear(context, { x: 0, y: -0.48 }, { x: 0, y: 0.48 },
    [[0, '#0b2a17'], [0.22, '#2c7a42'], [0.5, '#5cb871'], [0.78, '#2c7a42'], [1, '#0b2a17']]);
  headPath(context);
  context.fill();
  // Domed skull highlight and a lighter ridge down the snout.
  context.fillStyle = radial(context, { x: 0.42, y: 0 }, 0.42, [[0, 'rgba(200,255,200,0.2)'], [1, 'rgba(200,255,200,0)']]);
  headPath(context);
  context.fill();
  context.strokeStyle = 'rgba(210,255,200,0.3)';
  context.lineWidth = 0.04;
  context.beginPath();
  context.moveTo(0.45, 0);
  context.lineTo(1.52, 0);
  context.stroke();
  // Forehead scutes and heavy brow ridges sweeping back past the eyes.
  context.strokeStyle = 'rgba(0,22,8,0.5)';
  context.lineWidth = 0.025;
  for (const x of [0.22, 0.34, 0.46]) {
    context.beginPath();
    context.arc(x - 0.12, 0, 0.2, -0.9, 0.9);
    context.stroke();
  }
  context.strokeStyle = '#0c2716';
  context.lineWidth = 0.06;
  context.lineCap = 'round';
  for (const side of [1, -1]) {
    context.beginPath();
    context.moveTo(0.92, 0.12 * side);
    context.quadraticCurveTo(0.72, 0.3 * side, 0.44, 0.4 * side);
    context.stroke();
    context.fillStyle = '#0a1f10';
    context.beginPath();
    context.ellipse(1.5, 0.08 * side, 0.05, 0.022, 0.4 * side, 0, Math.PI * 2);
    context.fill();
  }
  if (burnt > 0) {
    context.fillStyle = `rgba(28,12,0,${0.32 * burnt})`;
    headPath(context);
    context.fill();
  }
  // Horns spreading back over the neck, ringed toward the base.
  for (const side of [1, -1]) {
    const points = bezier({ x: 0.28, y: 0.26 * side }, { x: 0, y: 0.46 * side }, { x: -0.45, y: 0.82 * side },
      { x: -0.95, y: 0.78 * side }, 20);
    context.fillStyle = linear(context, points[0], points[points.length - 1],
      [[0, '#e9ddc0'], [0.6, '#b8a982'], [1, '#6e6248']]);
    taper(context, points, 0.16, 0.01);
    context.strokeStyle = 'rgba(60,45,20,0.45)';
    context.lineWidth = 0.012;
    for (let ring = 2; ring < 14; ring += 2) {
      const point = points[ring];
      const next = points[ring + 1];
      const angle = Math.atan2(next.y - point.y, next.x - point.x) + Math.PI / 2;
      const half = (0.16 * (1 - ring / 20)) / 2;
      context.beginPath();
      context.moveTo(point.x - Math.cos(angle) * half, point.y - Math.sin(angle) * half);
      context.lineTo(point.x + Math.cos(angle) * half, point.y + Math.sin(angle) * half);
      context.stroke();
    }
    // Barbels trailing back from the snout.
    context.fillStyle = '#b89c55';
    strands(context, { x: 1.4, y: 0.17 * side }, { x: -1, y: 0 }, { x: 0, y: side }, 2.6, 0.55, wave + side, 0.045);
  }
  // Glowing slit eyes bulging at the sides of the skull.
  for (const side of [1, -1]) {
    context.save();
    context.translate(0.6, 0.4 * side);
    context.rotate(0.3 * side);
    context.fillStyle = radial(context, { x: 0, y: 0 }, 0.11,
      [[0, '#fff5a8'], [0.4, '#ffb000'], [0.85, '#c84800'], [1, '#3a0d00']]);
    context.beginPath();
    context.ellipse(0, 0, 0.1, 0.055, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#120600';
    context.beginPath();
    context.ellipse(0, 0, 0.045, 0.012, 0, 0, Math.PI * 2);
    context.fill();
    context.globalCompositeOperation = 'lighter';
    context.fillStyle = radial(context, { x: 0, y: 0 }, 0.2, [[0, 'rgba(255,170,0,0.45)'], [1, 'rgba(255,90,0,0)']]);
    context.beginPath();
    context.arc(0, 0, 0.2, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
  if (breath) {
    context.save();
    context.globalCompositeOperation = 'lighter';
    context.fillStyle = radial(context, { x: 1.62, y: 0 }, 0.6, [[0, 'rgba(255,240,190,0.9)'], [1, 'rgba(255,120,0,0)']]);
    context.fillRect(1.0, -0.6, 1.2, 1.2);
    context.restore();
  }
}

/** Draws the dragon onto its own layer so the cut can split it into two halves. */
function paintDragon(context: Context, layout: SlayLayout, ms: number, spine: readonly SpinePoint[]): void {
  const card = layout.card;
  const pose = headPose(spine);
  const breath = breathing(ms);
  drawTuft(context, spine, card, ms);
  drawBody(context, layout, spine, ms);
  drawMane(context, spine, card, ms);
  context.save();
  context.translate(pose.x, pose.y);
  context.rotate(pose.angle);
  context.scale(card, card);
  drawHead(context, ms, clamp01((ms - SLAY_BODY_CATCH_MS[0]) / 400), breath);
  context.restore();

  // Firelight from the flames on its back and from the breath, landing only on the dragon.
  context.save();
  context.globalCompositeOperation = 'source-atop';
  const burnt = burnFront(layout, ms);
  for (let index = 0; index < spine.length; index += 8) {
    const point = spine[index];
    if (point.s > burnt) break;
    const flicker = 0.8 + 0.2 * Math.sin(ms * 0.02 + index);
    context.fillStyle = radial(context, point, 1.4 * card,
      [[0, `rgba(255,150,40,${0.22 * flicker})`], [1, 'rgba(255,90,0,0)']]);
    context.fillRect(point.x - 1.5 * card, point.y - 1.5 * card, 3 * card, 3 * card);
  }
  if (breath) {
    const mouth = headPoint(pose, card, MOUTH.x, MOUTH.y);
    context.fillStyle = radial(context, mouth, 2.6 * card, [[0, 'rgba(255,200,90,0.4)'], [1, 'rgba(255,100,0,0)']]);
    context.fillRect(mouth.x - 3 * card, mouth.y - 3 * card, 6 * card, 6 * card);
  }
  context.restore();
}

function drawParticles(context: Context, particles: readonly Particle[], kinds: readonly Particle['kind'][],
  sprites: { flames: HTMLCanvasElement[]; smoke: HTMLCanvasElement; ember: HTMLCanvasElement }, fade: number,
  card: number): void {
  const base = context.getTransform();
  for (const particle of particles) {
    if (!kinds.includes(particle.kind)) continue;
    const life = particle.age / particle.life;
    const size = particle.size + particle.grow * particle.age;
    // Flames below leave a rotated transform behind; every other particle draws in layer space.
    context.setTransform(base);
    if (particle.kind === 'spark') {
      context.globalAlpha = (1 - life) * fade;
      context.strokeStyle = 'rgb(255,230,170)';
      context.lineWidth = Math.max(1, particle.size);
      context.beginPath();
      context.moveTo(particle.x, particle.y);
      context.lineTo(particle.x - particle.vx * 0.025, particle.y - particle.vy * 0.025);
      context.stroke();
      continue;
    }
    if (particle.kind === 'smoke') {
      context.globalAlpha = Math.min(1, life * 3) * (1 - life) * 0.4 * fade;
      context.drawImage(sprites.smoke, particle.x - size / 2, particle.y - size / 2, size, size);
      continue;
    }
    if (particle.kind === 'ember') {
      context.globalAlpha = (1 - life) * (0.6 + 0.4 * Math.sin(particle.age * 40 + particle.seed * 9)) * fade;
      const glow = Math.max(3, size * 4);
      context.drawImage(sprites.ember, particle.x - glow / 2, particle.y - glow / 2, glow, glow);
      continue;
    }
    // Flames: tongues stretched along their motion that swell, then narrow toward the tip as they rise,
    // cooling from white-hot through yellow and orange to dark red.
    const stage = Math.min(4, Math.floor((1 - flameHeat(particle)) * 5));
    const width = particle.size * (0.55 + 1.1 * Math.min(1, life * 5)) * (1 - 0.55 * life) + particle.grow * particle.age;
    const length = width * (1.2 + Math.min(2.2, Math.hypot(particle.vx, particle.vy) / (3 * card)));
    const angle = Math.atan2(particle.vy, particle.vx) + Math.PI / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    context.globalAlpha = Math.min(1, life * 6) * (1 - life) ** 1.1
      * (0.75 + 0.25 * Math.sin(particle.age * 55 + particle.seed * 20)) * 0.8 * fade;
    context.setTransform(base.a * cos, base.a * sin, -base.a * sin, base.a * cos,
      base.a * particle.x + base.e, base.d * particle.y + base.f);
    context.drawImage(sprites.flames[stage], -width / 2, -length * 0.55, width, length);
  }
  context.setTransform(base);
  context.globalAlpha = 1;
}

function drawHalf(context: Context, image: HTMLCanvasElement, layout: SlayLayout, half: HalfPose, upper: boolean): void {
  const pivot = { x: layout.rowRight, y: layout.rowY };
  context.save();
  context.globalAlpha = half.alpha;
  context.translate(half.dx + pivot.x, half.dy + pivot.y);
  context.rotate(half.turn);
  context.translate(-pivot.x, -pivot.y);
  context.beginPath();
  if (upper) context.rect(-layout.width, -layout.height, layout.width * 3, layout.rowY + layout.height);
  else context.rect(-layout.width, layout.rowY, layout.width * 3, layout.height * 2);
  context.clip();
  context.drawImage(image, 0, 0, layout.width, layout.height);
  context.restore();
}

function drawBlade(context: Context, layout: SlayLayout, ms: number, timeline: SlayTimeline): void {
  const card = layout.card;
  const start = layout.rowLeft - 0.5 * card;
  const end = layout.rowRight + 0.5 * card;
  const blade = bladeX(layout, ms, timeline.strike, timeline.cut);
  const since = ms - timeline.strike;
  if (since < 0) return;
  const tip = blade ?? end;
  // The blade streak fades quickly after it crosses; the wound it leaves cools slowly.
  const streak = blade !== null ? 1 : clamp01(1 - (since - timeline.cut) / 400);
  const wound = sceneFade(ms, timeline.duration) * clamp01(1 - (since - timeline.cut) / 900);
  context.save();
  context.globalCompositeOperation = 'lighter';
  if (wound > 0) {
    context.globalAlpha = wound;
    context.strokeStyle = linear(context, { x: start, y: 0 }, { x: end, y: 0 },
      [[0, 'rgba(255,210,120,0)'], [0.05, 'rgba(255,200,110,0.9)'], [0.5, 'rgba(255,90,0,0.9)'],
        [0.95, 'rgba(255,200,110,0.9)'], [1, 'rgba(255,210,120,0)']]);
    context.lineWidth = Math.max(2, card * 0.05);
    context.beginPath();
    context.moveTo(start, layout.rowY);
    context.lineTo(tip, layout.rowY);
    context.stroke();
  }
  if (streak > 0) {
    context.globalAlpha = streak;
    context.strokeStyle = linear(context, { x: start, y: 0 }, { x: tip, y: 0 },
      [[0, 'rgba(255,220,170,0)'], [1, 'rgba(255,230,190,0.55)']]);
    context.lineWidth = card * 0.5;
    context.beginPath();
    context.moveTo(start, layout.rowY);
    context.lineTo(tip, layout.rowY);
    context.stroke();
    context.strokeStyle = linear(context, { x: start, y: 0 }, { x: tip, y: 0 },
      [[0, 'rgba(255,255,255,0)'], [0.4, 'rgba(255,252,240,0.9)'], [1, '#fff']]);
    context.lineWidth = Math.max(2.5, card * 0.07);
    context.beginPath();
    context.moveTo(start, layout.rowY);
    context.lineTo(tip, layout.rowY);
    context.stroke();
    if (blade !== null) {
      context.fillStyle = radial(context, { x: blade, y: layout.rowY }, card * 0.9,
        [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,240,200,0.6)'], [1, 'rgba(255,200,120,0)']]);
      context.fillRect(blade - card, layout.rowY - card, card * 2, card * 2);
    }
  }
  // A flash along the whole row as the blade reaches the far end.
  const flash = (ms - timeline.strike - timeline.cut + 36) / 320;
  if (flash >= 0 && flash <= 1) {
    context.globalAlpha = (1 - flash) ** 2 * 0.9;
    const middle = (layout.rowLeft + layout.rowRight) / 2;
    context.translate(middle, layout.rowY);
    context.scale(Math.max(1, (layout.rowRight - layout.rowLeft) / (3 * card)), 1);
    context.fillStyle = radial(context, { x: 0, y: 0 }, 2 * card,
      [[0, 'rgba(255,250,235,0.95)'], [0.4, 'rgba(255,170,70,0.4)'], [1, 'rgba(255,120,30,0)']]);
    context.fillRect(-2 * card, -2 * card, 4 * card, 4 * card);
  }
  context.restore();
}

export function createSlayRenderer(canvas: HTMLCanvasElement): SlayRenderer {
  const dragonCanvas = document.createElement('canvas');
  const sprites = {
    flames: FLAME_STOPS.map(gradientSprite), smoke: gradientSprite(SMOKE_STOPS), ember: gradientSprite(EMBER_STOPS),
  };
  let fire: FireSystem | null = null;

  return {
    draw: (layout, ms, dt, still, effect) => {
      const timeline = slayTimeline(effect);
      const dragonShown = effect === 'dragon';
      const context = canvas.getContext('2d');
      const dragon = dragonCanvas.getContext('2d');
      if (!context || !dragon || layout.width <= 0 || layout.height <= 0) return;
      const ratio = Math.min(window.devicePixelRatio || 1, layout.width < 700 ? 1.5 : 2);
      const width = Math.round(layout.width * ratio);
      const height = Math.round(layout.height * ratio);
      for (const target of [canvas, dragonCanvas]) {
        if (target.width !== width) target.width = width;
        if (target.height !== height) target.height = height;
      }
      fire ??= createFireSystem(layout);
      const card = layout.card;

      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, width, height);
      const jolt = still ? { x: 0, y: 0 } : shake(layout, ms, timeline.strike, timeline.cut);
      context.setTransform(ratio, 0, 0, ratio, jolt.x * ratio, jolt.y * ratio);

      // Darken the table, leaving a window on the row.
      const middle = { x: (layout.rowLeft + layout.rowRight) / 2, y: layout.rowY };
      context.globalAlpha = still ? 0.85 : backdropAlpha(ms, timeline.duration);
      context.fillStyle = radial(context, middle, Math.max(layout.width, layout.height) * 0.8,
        [[0, 'rgba(60,10,0,0.12)'], [0.35, 'rgba(30,4,0,0.45)'], [1, 'rgba(8,0,0,0.75)']]);
      context.fillRect(-card, -card, layout.width + 2 * card, layout.height + 2 * card);
      context.globalAlpha = 1;

      // Char: the row darkens where the fire has reached and stays dark for the table's own closed style.
      const front = still ? layout.rowRight : dragonShown ? rowFireFront(layout, ms) : fireSweepFront(layout, ms);
      if (front > layout.rowLeft) {
        context.fillStyle = 'rgba(6,2,2,0.58)';
        context.beginPath();
        context.roundRect(layout.rowLeft, layout.rowY - card / 2, front - layout.rowLeft, card, Math.min(6, card / 6));
        context.fill();
      }
      if (still) {
        context.strokeStyle = 'rgba(255,120,30,0.85)';
        context.lineWidth = Math.max(2, card * 0.05);
        context.beginPath();
        context.moveTo(layout.rowLeft, layout.rowY);
        context.lineTo(layout.rowRight, layout.rowY);
        context.stroke();
        return;
      }

      const fade = sceneFade(ms, timeline.duration);
      const spine = dragonShown ? dragonSpine(layout, ms) : null;
      emitRow(fire, layout, ms, dt, front, fade, dragonShown ? 1 : FIRE_ONLY_INTENSITY);
      if (spine) {
        const pose = headPose(spine);
        emitBody(fire, layout, spine, ms, dt);
        emitBreath(fire, layout, headPoint(pose, card, MOUTH.x, MOUTH.y), pose.angle, ms, dt);
      } else {
        emitSurge(fire, layout, front, ms, dt);
      }
      emitCut(fire, layout, ms, dt, timeline.strike, timeline.cut);
      stepFire(fire, card, ms, dt);

      context.save();
      drawParticles(context, fire.particles, ['smoke'], sprites, fade, card);
      context.restore();

      // Glowing bed of coals under the burning row.
      if (front > layout.rowLeft) {
        context.save();
        context.globalCompositeOperation = 'lighter';
        context.globalAlpha = (0.8 + 0.2 * Math.sin(ms * 0.013)) * fade;
        const half = (front - layout.rowLeft) / 2 + card * 0.4;
        context.translate((layout.rowLeft + front) / 2, layout.rowY);
        context.scale(half / card, 1);
        context.fillStyle = radial(context, { x: 0, y: 0 }, card,
          [[0, 'rgba(255,170,60,0.55)'], [0.5, 'rgba(255,70,0,0.25)'], [1, 'rgba(255,40,0,0)']]);
        context.fillRect(-card, -card, card * 2, card * 2);
        context.restore();
      }

      dragon.setTransform(1, 0, 0, 1, 0, 0);
      dragon.clearRect(0, 0, width, height);
      dragon.setTransform(ratio, 0, 0, ratio, 0, 0);
      const split = splitPose(layout, ms);
      if (spine && (!split || split.upper.alpha > 0)) {
        paintDragon(dragon, layout, ms, spine);
        if (split && split.flare > 0) {
          dragon.save();
          dragon.globalCompositeOperation = 'source-atop';
          dragon.fillStyle = `rgba(255,220,160,${split.flare * 0.7})`;
          dragon.fillRect(0, 0, layout.width, layout.height);
          dragon.restore();
        }
        if (split) {
          drawHalf(context, dragonCanvas, layout, split.upper, true);
          drawHalf(context, dragonCanvas, layout, split.lower, false);
        } else {
          context.drawImage(dragonCanvas, 0, 0, layout.width, layout.height);
        }
      }

      context.save();
      context.globalCompositeOperation = 'lighter';
      drawParticles(context, fire.particles, ['flame', 'ember', 'spark'], sprites, fade, card);
      context.restore();
      drawBlade(context, layout, ms, timeline);
    },
  };
}
