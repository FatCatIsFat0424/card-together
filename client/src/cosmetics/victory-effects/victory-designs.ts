// Per-series particle designs. Coordinates are unscaled pixels around the emitting seat
// (negative y is up); the runner scales them to the screen. Every shape is drawn with a
// thin dark "ink" edge so light particles stay visible on the paper theme.

import { VICTORY_DURATION_MS } from './victory-schedule';
import type { VictorySeries } from './victory-schedule';
import { between, integrate, particle, pick, polar, pushTrail } from './victory-particles';
import type { Particle, Random } from './victory-particles';

type Context = CanvasRenderingContext2D;

export interface VictoryDesign {
  /** Soft halo behind the seat while particles leave it. */
  readonly glow: string;
  spawn(random: Random, density: number): Particle[];
  step(item: Particle, dt: number): void;
  draw(context: Context, item: Particle, alpha: number, age: number): void;
  /** Drawn before the particles, e.g. constellation lines. */
  underlay?(context: Context, items: readonly Particle[], alphaOf: (item: Particle) => number): void;
  /** Static arrangement around the seat for reduced motion. */
  wreath(): Particle[];
}

const TAU = Math.PI * 2;

function count(base: number, density: number, minimum = 1): number {
  return Math.max(minimum, Math.round(base * density));
}

/** Positions `total` items evenly on a ring, starting at the top. */
function ring(total: number, radius: number, make: (angle: number, index: number) => Particle): Particle[] {
  return Array.from({ length: total }, (_, index) => {
    const angle = -Math.PI / 2 + index / total * TAU;
    const item = make(angle, index);
    item.x = Math.cos(angle) * radius;
    item.y = Math.sin(angle) * radius;
    item.angle = angle;
    item.radius = radius;
    return item;
  });
}

function place(context: Context, item: Particle): void {
  context.translate(item.x, item.y);
  if (item.rotation) context.rotate(item.rotation);
}

function inkStroke(context: Context, ink: string, alpha: number, width: number): void {
  context.globalAlpha = alpha * 0.4;
  context.strokeStyle = ink;
  context.lineWidth = width;
  context.stroke();
  context.globalAlpha = alpha;
}

function sparklePath(context: Context, size: number): void {
  const inner = size * 0.28;
  context.beginPath();
  for (let point = 0; point < 8; point++) {
    const radius = point % 2 === 0 ? size : inner;
    const angle = -Math.PI / 2 + point * Math.PI / 4;
    context.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  context.closePath();
}

function sparkle(context: Context, item: Particle, alpha: number, ink: string, twinkle = true): void {
  place(context, item);
  const size = item.size * (twinkle ? 0.65 + 0.35 * Math.sin(item.phase) : 1);
  sparklePath(context, size);
  context.fillStyle = item.color;
  context.fill();
  inkStroke(context, ink, alpha, 0.8);
}

function dot(context: Context, item: Particle, alpha: number, ink: string): void {
  context.beginPath();
  context.arc(item.x, item.y, item.size, 0, TAU);
  context.fillStyle = item.color;
  context.fill();
  inkStroke(context, ink, alpha, 0.6);
}

function trailPath(context: Context, trail: readonly number[]): boolean {
  if (trail.length < 4) return false;
  context.beginPath();
  context.moveTo(trail[0], trail[1]);
  for (let index = 2; index < trail.length; index += 2) context.lineTo(trail[index], trail[index + 1]);
  return true;
}

function streak(
  context: Context, item: Particle, alpha: number, ink: string, width: number, highlight?: string, glow = false,
): void {
  if (!item.trail || !trailPath(context, item.trail)) return;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  if (glow) {
    context.globalAlpha = alpha * 0.22;
    context.strokeStyle = item.color;
    context.lineWidth = width * 2.8;
    context.stroke();
  }
  inkStroke(context, ink, alpha, width + 1.6);
  context.strokeStyle = item.color;
  context.lineWidth = width;
  context.stroke();
  if (!highlight) return;
  context.globalAlpha = alpha * 0.7;
  context.strokeStyle = highlight;
  context.lineWidth = width * 0.35;
  context.stroke();
}

function ringStroke(context: Context, item: Particle, alpha: number, ink: string, flatten: number, sides = 0): void {
  context.translate(item.x, item.y);
  context.rotate(item.rotation);
  context.beginPath();
  if (sides) {
    for (let side = 0; side <= sides; side++) {
      const angle = side / sides * TAU;
      context.lineTo(Math.cos(angle) * item.size, Math.sin(angle) * item.size * flatten);
    }
  } else context.ellipse(0, 0, item.size, item.size * flatten, 0, 0, TAU);
  inkStroke(context, ink, alpha, 4);
  context.strokeStyle = item.color;
  context.lineWidth = 2.2;
  context.stroke();
}

// ─── Aurora: curling ribbons of northern light with twinkling motes ───

const AURORA_INK = '#143550';
const aurora: VictoryDesign = {
  glow: '#58e7c2',
  spawn(random, density) {
    const ribbons = Array.from({ length: count(14, density, 5) }, () => particle({
      ...polar(-Math.PI / 2 + between(random, -1.25, 1.25), between(random, 240, 360)),
      color: pick(random, ['#58e7c2', '#7ff0d0', '#ab9cf2', '#c7bdf8', '#6fd3f0']),
      life: between(random, 1.6, 2.2), delay: between(random, 0, 0.5), drag: 0.25, gravity: -30,
      size: between(random, 5, 8), phase: random() * TAU, phaseSpeed: between(random, 4, 7), trail: [],
    }));
    const motes = Array.from({ length: count(26, density, 8) }, () => particle({
      kind: 1, ...polar(random() * TAU, between(random, 60, 200)), x: between(random, -18, 18),
      y: between(random, -18, 18), color: pick(random, ['#ffffff', '#c7bdf8', '#7ff0d0']),
      life: between(random, 1.2, 2), delay: between(random, 0.2, 1.1), drag: 0.5, gravity: -20,
      size: between(random, 3, 6), phase: random() * TAU, phaseSpeed: between(random, 10, 16),
    }));
    return [...ribbons, ...motes];
  },
  step(item, dt) {
    if (item.kind === 0) item.vx += Math.cos(item.phase) * 320 * dt;
    integrate(item, dt);
    pushTrail(item, 26);
  },
  draw(context, item, alpha) {
    if (item.kind === 0) streak(context, item, alpha, AURORA_INK, item.size, '#ffffff', true);
    else sparkle(context, item, alpha, AURORA_INK);
  },
  wreath: () => ring(10, 46, (_, index) => particle({
    kind: 1, color: index % 2 ? '#ab9cf2' : '#58e7c2', life: 1, size: index % 2 ? 5 : 8,
  })),
};

// ─── Tide: rising bubbles, a fountain of spray, and spreading ripples ───

const TIDE_INK = '#14566b';
const tide: VictoryDesign = {
  glow: '#69d7de',
  spawn(random, density) {
    const bubbles = Array.from({ length: count(34, density, 10) }, () => particle({
      x: between(random, -28, 28), y: between(random, -10, 10), vx: between(random, -50, 50),
      vy: -between(random, 60, 150), gravity: -30, drag: 0.7,
      color: pick(random, ['#69d7de', '#cee9dd', '#9fe6ea']), life: between(random, 1.6, 2.4),
      delay: between(random, 0, 1), size: between(random, 4, 12), phase: random() * TAU,
      phaseSpeed: between(random, 3, 6),
    }));
    const ripples = [0, 0.35, 0.7].map((delay) => particle({
      kind: 1, y: 8, color: '#9fe6ea', life: 1.4, delay, size: 12,
    }));
    const spray = Array.from({ length: count(14, density, 5) }, () => particle({
      kind: 2, ...polar(-Math.PI / 2 + between(random, -0.6, 0.6), between(random, 260, 420)),
      gravity: 700, drag: 0.95, color: pick(random, ['#69d7de', '#cee9dd']),
      life: between(random, 0.9, 1.3), delay: between(random, 0, 0.3), size: between(random, 2.5, 4),
    }));
    return [...ripples, ...bubbles, ...spray];
  },
  step(item, dt) {
    if (item.kind === 0) item.vx += Math.cos(item.phase) * 90 * dt;
    if (item.kind === 1) item.size += 95 * dt;
    integrate(item, dt);
  },
  draw(context, item, alpha) {
    if (item.kind === 1) return ringStroke(context, item, alpha, TIDE_INK, 0.42);
    if (item.kind === 2) {
      context.translate(item.x, item.y);
      context.rotate(Math.atan2(item.vy, item.vx));
      context.beginPath();
      context.ellipse(0, 0, item.size * 1.7, item.size, 0, 0, TAU);
      context.fillStyle = item.color;
      context.fill();
      return inkStroke(context, TIDE_INK, alpha, 0.6);
    }
    context.translate(item.x, item.y);
    context.beginPath();
    context.arc(0, 0, item.size, 0, TAU);
    context.globalAlpha = alpha * 0.22;
    context.fillStyle = item.color;
    context.fill();
    inkStroke(context, TIDE_INK, alpha, 2.6);
    context.strokeStyle = item.color;
    context.lineWidth = 1.6;
    context.stroke();
    context.beginPath();
    context.arc(-item.size * 0.35, -item.size * 0.35, item.size * 0.25, 0, TAU);
    context.fillStyle = '#ffffff';
    context.globalAlpha = alpha * 0.85;
    context.fill();
  },
  wreath: () => [
    particle({ kind: 1, y: 8, color: '#9fe6ea', life: 1, size: 40 }),
    ...ring(8, 46, (_, index) => particle({ color: index % 2 ? '#cee9dd' : '#69d7de', life: 1, size: 5 + index % 3 * 2 })),
  ],
};

// ─── Sakura: a burst of fluttering petals and whole blossoms ───

const SAKURA_INK = '#5e3954';

function petalPath(context: Context, size: number): void {
  context.beginPath();
  context.moveTo(0, size);
  context.bezierCurveTo(-size * 0.9, size * 0.2, -size * 0.7, -size * 0.8, -size * 0.32, -size);
  context.lineTo(0, -size * 0.72);
  context.lineTo(size * 0.32, -size);
  context.bezierCurveTo(size * 0.7, -size * 0.8, size * 0.9, size * 0.2, 0, size);
  context.closePath();
}

function blossom(context: Context, size: number, color: string, alpha: number, ink: string): void {
  for (let petal = 0; petal < 5; petal++) {
    context.save();
    context.rotate(petal * TAU / 5);
    context.translate(0, -size * 0.55);
    petalPath(context, size * 0.55);
    context.fillStyle = color;
    context.fill();
    inkStroke(context, ink, alpha, 0.7);
    context.restore();
  }
  context.beginPath();
  context.arc(0, 0, size * 0.2, 0, TAU);
  context.fillStyle = '#e07a98';
  context.fill();
}

const sakura: VictoryDesign = {
  glow: '#f5aec3',
  spawn(random, density) {
    const make = (kind: number): Particle => particle({
      kind, ...polar(-Math.PI / 2 + between(random, -2.8, 2.8), between(random, 180, 380)),
      drag: 0.22, gravity: 70, spin: between(random, -3, 3), phase: random() * TAU,
      phaseSpeed: between(random, 5, 9), life: between(random, 2, 2.6), delay: between(random, 0, 0.45),
      color: pick(random, ['#f5aec3', '#f7c4d3', '#f6ddcb', '#ee93ae']),
      size: kind === 0 ? between(random, 7, 12) : between(random, 9, 13),
    });
    return [
      ...Array.from({ length: count(40, density, 12) }, () => make(0)),
      ...Array.from({ length: count(6, density, 2) }, () => make(1)),
    ];
  },
  step(item, dt) {
    item.vx += Math.sin(item.phase * 0.5) * 40 * dt;
    integrate(item, dt);
  },
  draw(context, item, alpha) {
    place(context, item);
    if (item.kind === 1) return blossom(context, item.size, item.color, alpha, SAKURA_INK);
    context.scale(Math.max(0.2, Math.abs(Math.cos(item.phase))), 1);
    petalPath(context, item.size);
    context.fillStyle = item.color;
    context.fill();
    inkStroke(context, SAKURA_INK, alpha, 0.8);
  },
  wreath: () => ring(10, 46, (angle, index) => particle({
    kind: index % 2, color: index % 2 ? '#f7c4d3' : '#ee93ae', life: 1, size: index % 2 ? 10 : 7,
    rotation: angle + Math.PI / 2,
  })),
};

// ─── Constellation: stars burst out and settle into a linked constellation ───

const STAR_INK = '#121c38';
const constellation: VictoryDesign = {
  glow: '#93b5eb',
  spawn(random, density) {
    const total = count(18, density, 8);
    const stars = Array.from({ length: total }, (_, index) => particle({
      ...polar(index / total * TAU + between(random, -0.15, 0.15), between(random, 300, 380)),
      drag: 0.08, delay: 0.05 + index * 0.02, life: between(random, 2.4, 2.7), size: between(random, 5, 9),
      phase: random() * TAU, phaseSpeed: between(random, 6, 10),
      color: pick(random, ['#ead5a2', '#fff3cf', '#93b5eb', '#c9dafc']),
    }));
    const glints = Array.from({ length: count(26, density, 8) }, () => particle({
      kind: 1, ...polar(random() * TAU, between(random, 120, 420)), drag: 0.3, color: '#fff3cf',
      life: between(random, 0.6, 1.2), delay: between(random, 0, 0.4), size: between(random, 1.2, 2.4),
    }));
    const meteors = [0.5, 0.9].map((delay, index) => particle({
      kind: 2, x: index ? 20 : -20, y: -10,
      ...polar(-Math.PI / 2 + (index ? 0.9 : -0.9) * between(random, 0.7, 1), 520),
      drag: 0.6, delay, life: 1, color: '#ead5a2', trail: [],
    }));
    return [...stars, ...glints, ...meteors];
  },
  step(item, dt) {
    integrate(item, dt);
    pushTrail(item, 12);
  },
  underlay(context, items, alphaOf) {
    const stars = items.filter((item) => item.kind === 0);
    if (stars.length < 3) return;
    stars.forEach((star, index) => {
      const next = stars[(index + 1) % stars.length];
      const alpha = Math.min(alphaOf(star), alphaOf(next));
      if (alpha <= 0) return;
      context.beginPath();
      context.moveTo(star.x, star.y);
      context.lineTo(next.x, next.y);
      inkStroke(context, STAR_INK, alpha * 0.6, 2.4);
      context.globalAlpha = alpha * 0.6;
      context.strokeStyle = '#c9dafc';
      context.lineWidth = 1.2;
      context.stroke();
    });
  },
  draw(context, item, alpha) {
    if (item.kind === 1) return dot(context, item, alpha, STAR_INK);
    if (item.kind === 2) return streak(context, item, alpha, STAR_INK, 2.4, '#ffffff');
    context.beginPath();
    context.arc(item.x, item.y, item.size * 1.7, 0, TAU);
    context.globalAlpha = alpha * 0.22;
    context.fillStyle = '#93b5eb';
    context.fill();
    context.globalAlpha = alpha;
    sparkle(context, item, alpha, STAR_INK);
  },
  wreath: () => ring(8, 48, (_, index) => particle({
    color: index % 2 ? '#c9dafc' : '#ead5a2', life: 1, size: index % 2 ? 5 : 8, phase: Math.PI / 2,
  })),
};

// ─── Bamboo: a whirlwind of slender leaves and wind lines ───

const BAMBOO_INK = '#102d29';

function leafPath(context: Context, size: number): void {
  context.beginPath();
  context.moveTo(-size * 1.4, 0);
  context.quadraticCurveTo(0, -size * 0.5, size * 1.4, 0);
  context.quadraticCurveTo(0, size * 0.5, -size * 1.4, 0);
  context.closePath();
}

const bamboo: VictoryDesign = {
  glow: '#8bc6a3',
  spawn(random, density) {
    const swirl = (kind: number): Particle => {
      const angle = random() * TAU;
      const turn = random() < 0.5 ? -1 : 1;
      const tangent = polar(angle + turn * Math.PI / 2, between(random, 260, 380));
      const outward = polar(angle, between(random, 60, 120));
      return particle({
        kind, x: Math.cos(angle) * 14, y: Math.sin(angle) * 14, vx: tangent.vx + outward.vx,
        vy: tangent.vy + outward.vy, angularSpeed: turn * between(random, 2.2, 3.2), drag: 0.45,
        gravity: kind === 0 ? 40 : -10, life: between(random, 2, 2.6), delay: between(random, 0, 0.5),
        size: between(random, 11, 16), phase: random() * TAU, phaseSpeed: between(random, 6, 10),
        color: kind === 0 ? pick(random, ['#8bc6a3', '#6fae86', '#a9d8b8']) : '#e7d8ac',
        trail: kind === 1 ? [] : null,
      });
    };
    return [
      ...Array.from({ length: count(5, density, 2) }, () => swirl(1)),
      ...Array.from({ length: count(26, density, 8) }, () => swirl(0)),
    ];
  },
  step(item, dt) {
    const turn = item.angularSpeed * dt;
    const { vx, vy } = item;
    item.vx = vx * Math.cos(turn) - vy * Math.sin(turn);
    item.vy = vx * Math.sin(turn) + vy * Math.cos(turn);
    integrate(item, dt);
    item.rotation = Math.atan2(item.vy, item.vx);
    pushTrail(item, 14);
  },
  draw(context, item, alpha) {
    if (item.kind === 1) return streak(context, item, alpha, BAMBOO_INK, 1.6);
    place(context, item);
    context.scale(1, Math.max(0.45, Math.abs(Math.cos(item.phase))));
    leafPath(context, item.size);
    context.fillStyle = item.color;
    context.fill();
    inkStroke(context, BAMBOO_INK, alpha, 0.8);
    context.beginPath();
    context.moveTo(-item.size * 1.2, 0);
    context.lineTo(item.size * 1.2, 0);
    inkStroke(context, BAMBOO_INK, alpha, 0.7);
  },
  wreath: () => ring(9, 46, (angle, index) => particle({
    color: ['#8bc6a3', '#6fae86', '#a9d8b8'][index % 3], life: 1, size: 11, rotation: angle + Math.PI / 2,
  })),
};

// ─── Gilded: a fountain of spinning coins, a gold ring, and glints ───

const GILDED_INK = '#49384d';

function coin(context: Context, item: Particle, alpha: number): void {
  place(context, item);
  const face = Math.cos(item.phase);
  context.scale(Math.max(0.12, Math.abs(face)), 1);
  context.beginPath();
  context.arc(0, 0, item.size, 0, TAU);
  context.fillStyle = '#c9975b';
  context.fill();
  inkStroke(context, GILDED_INK, alpha, 1.2);
  context.beginPath();
  context.arc(0, 0, item.size * 0.74, 0, TAU);
  context.fillStyle = face > 0 ? '#f2d79c' : '#e2b56e';
  context.fill();
  const mark = item.size * 0.32;
  context.beginPath();
  context.moveTo(0, -mark);
  context.lineTo(mark * 0.7, 0);
  context.lineTo(0, mark);
  context.lineTo(-mark * 0.7, 0);
  context.closePath();
  context.fillStyle = '#c9975b';
  context.fill();
}

const gilded: VictoryDesign = {
  glow: '#f2d79c',
  spawn(random, density) {
    const coins = Array.from({ length: count(30, density, 10) }, () => particle({
      x: between(random, -10, 10), ...polar(-Math.PI / 2 + between(random, -0.6, 0.6), between(random, 430, 640)),
      gravity: 980, drag: 0.92, size: between(random, 9, 13), spin: between(random, -2, 2),
      phase: random() * TAU, phaseSpeed: between(random, 8, 14), life: between(random, 1.5, 2),
      delay: between(random, 0, 1), color: '#c9975b',
    }));
    const glints = Array.from({ length: count(18, density, 6) }, () => {
      const angle = -Math.PI / 2 + between(random, -1.6, 1.6);
      const radius = between(random, 30, 110);
      return particle({
        kind: 1, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, vy: -12,
        color: pick(random, ['#fff6dc', '#f2d79c']), life: between(random, 0.5, 0.9),
        delay: between(random, 0.1, 2.2), size: between(random, 4, 7), phase: random() * TAU, phaseSpeed: 14,
      });
    });
    const flash = particle({ kind: 2, color: '#f2d79c', life: 1, size: 16 });
    return [flash, ...coins, ...glints];
  },
  step(item, dt) {
    if (item.kind === 2) item.size += 140 * dt;
    integrate(item, dt);
  },
  draw(context, item, alpha) {
    if (item.kind === 2) return ringStroke(context, item, alpha, GILDED_INK, 1);
    if (item.kind === 1) return sparkle(context, item, alpha, GILDED_INK);
    coin(context, item, alpha);
  },
  wreath: () => ring(8, 46, (_, index) => index % 2
    ? particle({ kind: 1, color: '#fff6dc', life: 1, size: 6, phase: Math.PI / 2 })
    : particle({ color: '#c9975b', life: 1, size: 10, phase: index * 0.4 })),
};

// ─── Ember: fireworks that rise from the seat and burst into falling sparks ───

const EMBER_INK = '#301e26';
const ROCKET_FLIGHT = 0.5;
const ember: VictoryDesign = {
  glow: '#ec8256',
  spawn(random, density) {
    const items: Particle[] = [];
    const bursts = density >= 0.6 ? 3 : 2;
    const palette = ['#ec8256', '#ffb35c', '#ff6f4a'];
    for (let index = 0; index < bursts; index++) {
      const delay = index * 0.33;
      const targetX = between(random, -150, 150);
      const targetY = -between(random, 140, 210);
      items.push(particle({
        y: -6, vx: targetX / ROCKET_FLIGHT, vy: (targetY + 6) / ROCKET_FLIGHT, delay, life: ROCKET_FLIGHT,
        color: '#ffd1a0', size: 2.6, trail: [],
      }));
      const sparks = count(21, density, 10);
      for (let spark = 0; spark < sparks; spark++) items.push(particle({
        kind: 1, x: targetX, y: targetY, ...polar(spark / sparks * TAU + between(random, -0.12, 0.12), between(random, 170, 300)),
        gravity: 170, drag: 0.45, delay: delay + ROCKET_FLIGHT, life: between(random, 1.1, 1.5),
        size: between(random, 2.4, 3.4), color: random() < 0.7 ? palette[index % palette.length] : '#ffd1a0',
      }));
      items.push(particle({
        kind: 4, x: targetX, y: targetY, delay: delay + ROCKET_FLIGHT, life: 0.35, size: 8, color: palette[index % palette.length],
      }));
      for (let crackle = 0; crackle < count(6, density, 2); crackle++) items.push(particle({
        kind: 2, x: targetX + between(random, -80, 80), y: targetY + between(random, -60, 80), vy: 20,
        delay: delay + ROCKET_FLIGHT + between(random, 0.5, 0.8), life: 0.35, size: between(random, 2.5, 3.5),
        color: '#fff1d6', phase: random() * TAU, phaseSpeed: 30,
      }));
    }
    for (let rising = 0; rising < count(10, density, 4); rising++) items.push(particle({
      kind: 3, x: between(random, -24, 24), vy: -between(random, 40, 90), phase: random() * TAU, phaseSpeed: 4,
      delay: between(random, 0, 1.2), life: between(random, 1.4, 2.2), size: between(random, 1.6, 2.6), color: '#ec8256',
    }));
    return items;
  },
  step(item, dt) {
    if (item.kind === 3) item.vx = Math.sin(item.phase) * 18;
    if (item.kind === 4) item.size += 120 * dt;
    integrate(item, dt);
    pushTrail(item, 10);
  },
  draw(context, item, alpha) {
    if (item.kind === 0) {
      streak(context, item, alpha, EMBER_INK, 2, '#ffffff');
      context.globalAlpha = alpha;
      return dot(context, { ...item, size: 3, color: '#fff1d6' }, alpha, EMBER_INK);
    }
    if (item.kind === 2) return sparkle(context, item, alpha, EMBER_INK);
    if (item.kind === 3) return dot(context, item, alpha, EMBER_INK);
    if (item.kind === 4) {
      const gradient = context.createRadialGradient(item.x, item.y, 0, item.x, item.y, item.size);
      gradient.addColorStop(0, '#fff1d6');
      gradient.addColorStop(0.4, item.color);
      gradient.addColorStop(1, `${item.color}00`);
      context.fillStyle = gradient;
      context.fillRect(item.x - item.size, item.y - item.size, item.size * 2, item.size * 2);
      return;
    }
    context.beginPath();
    context.moveTo(item.x - item.vx * 0.06, item.y - item.vy * 0.06);
    context.lineTo(item.x, item.y);
    context.lineCap = 'round';
    inkStroke(context, EMBER_INK, alpha, item.size + 1.6);
    context.strokeStyle = item.color;
    context.lineWidth = item.size;
    context.stroke();
  },
  wreath: () => ring(10, 46, (angle, index) => particle({
    kind: 1, ...polar(angle, 220), color: index % 2 ? '#ffd1a0' : '#ec8256', life: 1, size: 2.6,
  })),
};

// ─── Lotus: blossoms open and float upward with lantern lights and ripples ───

const LOTUS_INK = '#18333c';

function lotusPetal(context: Context, angle: number, length: number, width: number, color: string, alpha: number): void {
  context.save();
  context.rotate(angle);
  context.beginPath();
  context.moveTo(0, 0);
  context.quadraticCurveTo(-width, -length * 0.55, 0, -length);
  context.quadraticCurveTo(width, -length * 0.55, 0, 0);
  context.closePath();
  context.fillStyle = color;
  context.fill();
  inkStroke(context, LOTUS_INK, alpha, 0.8);
  context.restore();
}

function lotusFlower(context: Context, size: number, alpha: number): void {
  for (const angle of [-1.05, 1.05, -0.52, 0.52]) lotusPetal(context, angle, size, size * 0.36, '#d993ab', alpha);
  for (const angle of [-0.3, 0.3, 0]) lotusPetal(context, angle, size * 0.95, size * 0.34, '#f0c9d5', alpha);
  context.beginPath();
  context.ellipse(0, 0, size * 0.62, size * 0.16, 0, 0, TAU);
  context.fillStyle = '#7fb8b0';
  context.fill();
  inkStroke(context, LOTUS_INK, alpha, 0.8);
  context.beginPath();
  context.arc(0, -size * 0.18, size * 0.1, 0, TAU);
  context.fillStyle = '#e9dbb3';
  context.fill();
}

const lotus: VictoryDesign = {
  glow: '#e5b3c3',
  spawn(random, density) {
    const blossoms = Array.from({ length: count(5, density, 3) }, (_, index) => particle({
      x: between(random, -80, 80), y: between(random, -6, 6), vx: between(random, -16, 16),
      vy: -between(random, 45, 85), drag: 0.9, gravity: -6, phase: random() * TAU,
      phaseSpeed: between(random, 1.6, 2.4), size: between(random, 19, 25), life: between(random, 2.2, 2.6),
      delay: index * 0.18, color: '#e5b3c3',
    }));
    const lights = Array.from({ length: count(16, density, 5) }, () => particle({
      kind: 1, x: between(random, -60, 60), vy: -between(random, 30, 80), phase: random() * TAU,
      phaseSpeed: between(random, 2, 4), size: between(random, 2, 3.5), life: between(random, 1.6, 2.4),
      delay: between(random, 0.2, 1.4), color: '#e9dbb3',
    }));
    const ripples = [0, 0.5].map((delay) => particle({ kind: 2, y: 6, delay, life: 1.6, size: 14, color: '#7fb8b0' }));
    const petals = Array.from({ length: count(10, density, 3) }, () => particle({
      kind: 3, ...polar(-Math.PI / 2 + between(random, -1.8, 1.8), between(random, 90, 170)), drag: 0.35,
      gravity: 20, spin: between(random, -2, 2), life: between(random, 1.8, 2.4), delay: between(random, 0.2, 0.7),
      size: between(random, 6, 9), color: pick(random, ['#e5b3c3', '#f0c9d5']),
    }));
    return [...ripples, ...petals, ...blossoms, ...lights];
  },
  step(item, dt) {
    if (item.kind === 0) item.rotation = Math.sin(item.phase) * 0.18;
    if (item.kind === 1) item.vx = Math.sin(item.phase) * 14;
    if (item.kind === 2) item.size += 70 * dt;
    integrate(item, dt);
  },
  draw(context, item, alpha, age) {
    if (item.kind === 2) return ringStroke(context, item, alpha, LOTUS_INK, 0.35);
    if (item.kind === 1) {
      context.beginPath();
      context.arc(item.x, item.y, item.size * 2.6, 0, TAU);
      context.globalAlpha = alpha * 0.25;
      context.fillStyle = item.color;
      context.fill();
      context.globalAlpha = alpha;
      return dot(context, item, alpha, LOTUS_INK);
    }
    place(context, item);
    if (item.kind === 3) return lotusPetal(context, 0, item.size * 1.6, item.size * 0.5, item.color, alpha);
    const bloom = 1 - (1 - Math.min(1, Math.max(0, age) / 0.5)) ** 3;
    context.scale(bloom, bloom);
    lotusFlower(context, item.size, alpha);
  },
  wreath: () => [
    particle({ kind: 2, y: 6, life: 1, size: 44, color: '#7fb8b0' }),
    ...[-2.5, -Math.PI / 2, -0.64].map((angle) => particle({
      x: Math.cos(angle) * 50, y: Math.sin(angle) * 50, life: 1, size: 18, color: '#e5b3c3',
    })),
    ...ring(6, 34, () => particle({ kind: 1, life: 1, size: 2.4, color: '#e9dbb3' })),
  ],
};

// ─── Frost: snowflakes and ice glints spray out from a widening hexagon ───

const FROST_INK = '#193044';

function snowflake(context: Context, item: Particle, alpha: number): void {
  place(context, item);
  const size = item.size;
  context.beginPath();
  for (let arm = 0; arm < 6; arm++) {
    const angle = arm * Math.PI / 3;
    const along = (distance: number, side: number): [number, number] => [
      Math.sin(angle) * distance + Math.cos(angle) * side, -Math.cos(angle) * distance + Math.sin(angle) * side,
    ];
    context.moveTo(0, 0);
    context.lineTo(...along(size, 0));
    context.moveTo(...along(size * 0.55, 0));
    context.lineTo(...along(size * 0.8, size * 0.24));
    context.moveTo(...along(size * 0.55, 0));
    context.lineTo(...along(size * 0.8, -size * 0.24));
  }
  context.lineCap = 'round';
  inkStroke(context, FROST_INK, alpha, size * 0.26);
  context.strokeStyle = item.color;
  context.lineWidth = size * 0.13;
  context.stroke();
}

const frost: VictoryDesign = {
  glow: '#99d4e1',
  spawn(random, density) {
    const flakes = Array.from({ length: count(22, density, 8) }, () => particle({
      ...polar(random() * TAU, between(random, 170, 320)), drag: 0.28, gravity: 30,
      spin: between(random, -1.4, 1.4), size: between(random, 7, 12), life: between(random, 2.1, 2.7),
      delay: between(random, 0, 0.45), color: pick(random, ['#e4f4fa', '#c4e8f2', '#99d4e1']),
    }));
    const glints = Array.from({ length: count(20, density, 6) }, () => particle({
      kind: 1, ...polar(random() * TAU, between(random, 80, 260)), drag: 0.25, color: '#ffffff',
      life: between(random, 0.8, 1.4), delay: between(random, 0.1, 0.9), size: between(random, 2.5, 4.5),
      phase: random() * TAU, phaseSpeed: 12,
    }));
    const rings = [0, 0.35].map((delay) => particle({
      kind: 2, delay, life: 1.5, size: 18, spin: 0.6, color: '#c4e8f2',
    }));
    return [...rings, ...flakes, ...glints];
  },
  step(item, dt) {
    if (item.kind === 2) item.size += 90 * dt;
    integrate(item, dt);
  },
  draw(context, item, alpha) {
    if (item.kind === 2) return ringStroke(context, item, alpha, FROST_INK, 1, 6);
    if (item.kind === 1) return sparkle(context, item, alpha, FROST_INK);
    snowflake(context, item, alpha);
  },
  wreath: () => [
    particle({ kind: 2, life: 1, size: 32, color: '#c4e8f2' }),
    ...ring(6, 50, (angle, index) => particle({
      color: index % 2 ? '#99d4e1' : '#e4f4fa', life: 1, size: 9, rotation: angle,
    })),
  ],
};

// ─── Dune: a rising dust devil of sand grains and wind-swept arcs ───

const DUNE_INK = '#342a3b';
const DUNE_FLATTEN = 0.5;
const dune: VictoryDesign = {
  glow: '#f6dba3',
  spawn(random, density) {
    const orbit = (kind: number): Particle => particle({
      kind, angle: random() * TAU, radius: between(random, 6, 22), angularSpeed: -between(random, 3.2, 5.2),
      radialSpeed: between(random, 35, 70), phaseSpeed: -between(random, 20, 45),
      size: kind === 0 ? between(random, 1.6, 3.2) : between(random, 1.6, 2.4),
      life: between(random, 1.8, 2.6), delay: between(random, 0, 0.6),
      color: kind === 0 ? pick(random, ['#d7a378', '#f6dba3', '#e8bf8a', '#b98560', '#8f6a55']) : '#e8bf8a',
    });
    return [
      ...Array.from({ length: count(8, density, 3) }, () => orbit(1)),
      ...Array.from({ length: count(80, density, 24) }, () => orbit(0)),
    ];
  },
  step(item, dt) {
    item.angle += item.angularSpeed * dt;
    item.angularSpeed *= 0.55 ** dt;
    item.radius += item.radialSpeed * dt;
    item.phase += item.phaseSpeed * dt;
    item.x = Math.cos(item.angle) * item.radius;
    item.y = Math.sin(item.angle) * item.radius * DUNE_FLATTEN + item.phase;
  },
  draw(context, item, alpha) {
    if (item.kind === 0) return dot(context, item, alpha, DUNE_INK);
    context.beginPath();
    context.ellipse(0, item.phase, item.radius, item.radius * DUNE_FLATTEN, 0, item.angle, item.angle + 0.8);
    context.lineCap = 'round';
    inkStroke(context, DUNE_INK, alpha, item.size + 1.4);
    context.strokeStyle = item.color;
    context.lineWidth = item.size;
    context.stroke();
  },
  wreath: () => [
    ...[0, 2.1, 4.2].map((angle) => particle({ kind: 1, angle, radius: 50, life: 1, size: 2.4, color: '#e8bf8a' })),
    ...ring(18, 50, (_, index) => particle({
      life: 1, size: index % 3 ? 1.6 : 2.4, color: index % 2 ? '#d7a378' : '#b98560',
    })).map((grain) => ({ ...grain, y: grain.y * DUNE_FLATTEN })),
  ],
};

/** Shortens late particles so every effect has faded out when the overlay ends. */
function withinWindow(design: VictoryDesign): VictoryDesign {
  const limit = VICTORY_DURATION_MS / 1000;
  return {
    ...design,
    spawn: (random, density) => design.spawn(random, density).map((item) => {
      item.life = Math.min(item.life, limit - item.delay);
      return item;
    }),
  };
}

export const VICTORY_DESIGNS: Readonly<Record<VictorySeries, VictoryDesign>> = {
  aurora: withinWindow(aurora),
  tide: withinWindow(tide),
  sakura: withinWindow(sakura),
  constellation: withinWindow(constellation),
  bamboo: withinWindow(bamboo),
  gilded: withinWindow(gilded),
  ember: withinWindow(ember),
  lotus: withinWindow(lotus),
  frost: withinWindow(frost),
  dune: withinWindow(dune),
};
