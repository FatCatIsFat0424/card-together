import type { VictoryDesign } from './victory-designs';
import { between, integrate, particle, pick, polar, pushTrail } from './victory-particles';
import type { Particle } from './victory-particles';

type Context = CanvasRenderingContext2D;
const TAU = Math.PI * 2;
const INK = '#152b3c';

/** Clamp at the design boundary so previews cannot accidentally allocate unbounded particles. */
function amount(base: number, density: number): number {
  return Math.round(base * (Number.isFinite(density) ? Math.max(0.15, Math.min(1, density)) : 1));
}

function path(context: Context, points: readonly (readonly [number, number])[], color: string, close = true): void {
  context.beginPath();
  points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
  if (close) {
    context.closePath();
    context.fillStyle = color;
    context.fill();
    context.strokeStyle = INK;
    context.lineWidth = 0.07;
  } else {
    context.strokeStyle = color;
    context.lineWidth = 0.1;
  }
  context.stroke();
}

function disc(context: Context, x: number, y: number, radius: number, color: string): void {
  context.beginPath();
  context.arc(x, y, radius, 0, TAU);
  context.fillStyle = color;
  context.fill();
}

function local(context: Context, item: Particle): void {
  context.translate(item.x, item.y);
  context.rotate(item.rotation);
  context.scale(item.size, item.size);
}

function lineTrail(context: Context, item: Particle, alpha: number, angular = false): void {
  if (!item.trail || item.trail.length < 4) return;
  context.beginPath();
  context.moveTo(item.trail[0], item.trail[1]);
  for (let i = 2; i < item.trail.length; i += 2) {
    if (angular) context.lineTo(item.trail[i], item.trail[i - 1]);
    context.lineTo(item.trail[i], item.trail[i + 1]);
  }
  context.globalAlpha = alpha * 0.5;
  context.strokeStyle = item.color;
  context.lineWidth = angular ? 1.7 : 2.5;
  context.stroke();
  context.globalAlpha = alpha;
}

function wreath(colors: readonly string[], kinds: readonly number[], size: number): Particle[] {
  return Array.from({ length: 8 }, (_, index) => {
    const angle = -Math.PI / 2 + index / 8 * TAU;
    return particle({ x: Math.cos(angle) * 54, y: Math.sin(angle) * 48, life: 1,
      color: colors[index % colors.length], kind: kinds[index % kinds.length], size, phase: index * 0.8 });
  });
}

function ship(context: Context, color: string): void {
  path(context, [[0, -1.7], [0.45, -0.3], [1.25, 0.9], [0.45, 0.6], [0.22, 1.2], [-0.22, 1.2], [-0.45, 0.6], [-1.25, 0.9], [-0.45, -0.3]], color);
  path(context, [[0, -1], [0.2, 0], [-0.2, 0]], '#164779');
  path(context, [[-0.24, 1.15], [-0.24, 1.95]], '#f8cc70', false);
  path(context, [[0.24, 1.15], [0.24, 1.95]], '#f8cc70', false);
}

function warp(context: Context, item: Particle): void {
  context.translate(item.x, item.y);
  context.beginPath();
  context.ellipse(0, 0, item.size, item.size * 0.5, -0.25, 0, TAU);
  context.strokeStyle = item.color;
  context.lineWidth = 2;
  context.stroke();
}

const starfleet: VictoryDesign = {
  glow: '#52d9f0',
  spawn(random, density) {
    const fleet = Array.from({ length: amount(12, density) }, (_, index) => particle({
      kind: 0, x: (index % 3 - 1) * 14, y: 12 + Math.floor(index / 3) * 8,
      ...polar(-Math.PI / 2 + (index % 3 - 1) * 0.28, between(random, 90, 155)),
      color: index % 3 ? '#65dff5' : '#f8cc70', size: between(random, 6, 10),
      rotation: (index % 3 - 1) * 0.28, life: 2.2, delay: Math.floor(index / 3) * 0.12, trail: [],
    }));
    const gates = [0, 0.4, 0.8].map((delay) => particle({ kind: 1, color: '#52d9f0', size: 12, life: 1.5, delay }));
    return [...gates, ...fleet];
  },
  step(item, dt) {
    if (item.kind === 1) item.size += dt * 66;
    else { item.vy -= dt * 30; integrate(item, dt); pushTrail(item, 12); }
  },
  draw(context, item, alpha) {
    if (item.kind === 1) return warp(context, item);
    lineTrail(context, item, alpha);
    local(context, item);
    ship(context, item.color);
  },
  wreath: () => wreath(['#65dff5', '#f8cc70'], [0], 7),
};

function torii(context: Context): void {
  path(context, [[-1.6, -1], [0, -0.8], [1.6, -1], [1.4, -0.6], [-1.4, -0.6]], '#e16742');
  path(context, [[-1.3, -0.2], [1.3, -0.2]], '#e16742', false);
  path(context, [[-1.1, -0.6], [-0.8, -0.6], [-0.8, 1.2], [-1.1, 1.2]], '#d85336');
  path(context, [[0.8, -0.6], [1.1, -0.6], [1.1, 1.2], [0.8, 1.2]], '#d85336');
}

function lantern(context: Context, color: string): void {
  path(context, [[-0.55, -1], [0.55, -1], [0.8, -0.7], [0.8, 0.7], [0.55, 1], [-0.55, 1], [-0.8, 0.7], [-0.8, -0.7]], color);
  path(context, [[-0.45, -0.8], [-0.45, 0.8]], '#b5432c', false);
  path(context, [[0.45, -0.8], [0.45, 0.8]], '#b5432c', false);
  path(context, [[-0.6, -1], [0.6, -1]], '#fbe6a5', false);
  path(context, [[0, 1], [0, 1.6]], '#e6bb62', false);
}

const shrine: VictoryDesign = {
  glow: '#4fc8b2',
  spawn(random, density) {
    return [particle({ kind: 2, y: -20, size: 27, color: '#d85336', life: 2.6 }),
      ...Array.from({ length: amount(15, density) }, () => particle({
        x: between(random, -62, 62), y: between(random, 0, 30), vx: between(random, -10, 10),
        vy: -between(random, 40, 85), size: between(random, 7, 11), color: pick(random, ['#f9d17e', '#f4a66a']),
        life: 2.1, delay: between(random, 0.1, 0.8), phase: random() * TAU, phaseSpeed: 3,
      })),
      ...Array.from({ length: amount(12, density) }, (_, index) => particle({
        kind: 1, angle: index / 12 * TAU, radius: 40, angularSpeed: 1.7, radialSpeed: 20,
        size: 5, color: '#6be2c6', life: 2.3, delay: 0.15, phaseSpeed: 4,
      })),
    ];
  },
  step(item, dt) {
    if (item.kind === 2) return;
    integrate(item, dt);
    if (item.kind === 1) {
      item.angle += item.angularSpeed * dt; item.radius += item.radialSpeed * dt;
      item.x = Math.cos(item.angle) * item.radius; item.y = Math.sin(item.angle) * item.radius * 0.55 - 25;
    } else item.x += Math.sin(item.phase) * dt * 8;
  },
  draw(context, item) {
    local(context, item);
    if (item.kind === 2) return torii(context);
    if (item.kind === 0) { context.rotate(Math.sin(item.phase) * 0.12); return lantern(context, item.color); }
    context.beginPath();
    context.moveTo(0, -1.8);
    context.bezierCurveTo(-0.1, -0.3, 1.6, -0.2, 0.7, 1);
    context.bezierCurveTo(-0.8, 1.6, -1.5, 0, 0, -1.8);
    context.fillStyle = item.color; context.fill();
    disc(context, 0, 0.5, 0.35, '#e2ffe4');
  },
  wreath: () => wreath(['#f9d17e', '#6be2c6'], [0, 1], 7),
};

function aircraft(context: Context, phase: number): void {
  path(context, [[0, -1.6], [0.25, -0.6], [1.7, 0.2], [1.6, 0.6], [0.25, 0.2], [0.2, 1], [0.65, 1.3], [0.55, 1.5], [-0.55, 1.5], [-0.65, 1.3], [-0.2, 1], [-0.25, 0.2], [-1.6, 0.6], [-1.7, 0.2], [-0.25, -0.6]], '#b5c28b');
  path(context, [[-Math.cos(phase) * 0.9, -1.6], [Math.cos(phase) * 0.9, -1.6]], '#edc46d', false);
}

function tank(context: Context): void {
  path(context, [[-1.4, 0], [1.4, 0], [1.6, 0.7], [1.2, 1], [-1.2, 1], [-1.6, 0.7]], '#536744');
  path(context, [[-0.6, 0], [-0.6, -0.7], [0.5, -0.7], [0.9, 0]], '#b5c28b');
  path(context, [[0.4, -0.5], [1.7, -0.5]], '#edc46d', false);
  [-0.9, -0.3, 0.3, 0.9].forEach((x) => disc(context, x, 0.55, 0.18, '#d7c885'));
}

const ironfront: VictoryDesign = {
  glow: '#dfb75b',
  spawn(random, density) {
    return [particle({ kind: 2, size: 10, color: '#dfb75b', life: 2.5 }),
      ...Array.from({ length: amount(9, density) }, (_, index) => particle({
        kind: 0, x: (index % 3 - 1) * 25, y: 20 + Math.floor(index / 3) * 18,
        vx: (index % 3 - 1) * 25, vy: -95, size: between(random, 8, 11),
        life: 2.1, delay: Math.floor(index / 3) * 0.18, color: '#b5c28b', phaseSpeed: 24, trail: [],
      })),
      ...[-1, 1].map((side) => particle({ kind: 1, x: side * 24, y: 30, vx: side * 33, size: 13,
        color: '#b5c28b', life: 2.4, delay: 0.1 })),
    ];
  },
  step(item, dt) {
    if (item.kind === 2) { item.size += 42 * dt; item.rotation += dt * 2.5; return; }
    integrate(item, dt); pushTrail(item, 9);
  },
  draw(context, item, alpha) {
    if (item.kind === 2) {
      context.translate(item.x, item.y);
      context.strokeStyle = item.color; context.lineWidth = 1.4;
      context.beginPath(); context.arc(0, 0, item.size, 0, TAU); context.stroke();
      context.beginPath(); context.arc(0, 0, item.size * 0.6, 0, TAU); context.stroke();
      context.rotate(item.rotation);
      context.beginPath(); context.moveTo(0, 0); context.lineTo(item.size, 0); context.stroke();
      return;
    }
    lineTrail(context, item, alpha); local(context, item);
    if (item.kind === 1) tank(context); else aircraft(context, item.phase);
  },
  wreath: () => wreath(['#b5c28b'], [0, 1], 8),
};

function tower(context: Context, color: string, phase: number): void {
  const height = 1.2 + Math.sin(phase) * 0.25;
  path(context, [[-0.7, 1], [-0.7, -height], [0.3, -height - 0.4], [0.8, -height], [0.8, 1]], '#253b71');
  path(context, [[-0.7, 1], [-0.7, -height], [0.3, -height - 0.4], [0.8, -height], [0.8, 1]], color, false);
  path(context, [[0.3, -height - 0.4], [0.3, 1]], color, false);
  for (const y of [-0.5, 0, 0.5]) path(context, [[-0.4, y], [0, y]], '#9cffff', false);
}

const neoncity: VictoryDesign = {
  glow: '#e65edc',
  spawn(random, density) {
    return [
      ...Array.from({ length: amount(10, density) }, (_, index) => particle({
        x: (index - 4.5) * 18, y: 35, vy: -between(random, 28, 55), size: between(random, 10, 16),
        color: index % 2 ? '#ee72df' : '#60e9ed', life: 2.1, delay: between(random, 0, 0.7),
      })),
      ...Array.from({ length: amount(24, density) }, (_, index) => particle({
        kind: 1, ...polar(index / 24 * TAU, between(random, 65, 130)), color: index % 2 ? '#ee72df' : '#60e9ed',
        size: 3.5, life: 1.8, delay: between(random, 0, 0.9), trail: [], phaseSpeed: 6,
      })),
    ];
  },
  step(item, dt) {
    const previous = Math.floor(item.phase / (Math.PI / 2));
    integrate(item, dt);
    if (item.kind === 1) {
      if (Math.floor(item.phase / (Math.PI / 2)) !== previous) { const vx = item.vx; item.vx = -item.vy; item.vy = vx; }
      pushTrail(item, 16);
    }
  },
  draw(context, item, alpha) {
    if (item.kind === 1) lineTrail(context, item, alpha, true);
    local(context, item);
    if (item.kind === 0) return tower(context, item.color, item.phase);
    path(context, [[-0.6, -0.6], [0.6, -0.6], [0.6, 0.6], [-0.6, 0.6]], item.color);
  },
  wreath: () => wreath(['#ee72df', '#60e9ed'], [0, 1], 9),
};

function shield(context: Context): void {
  path(context, [[-1, -0.7], [1, -0.7], [0.85, 0.5], [0.5, 1], [0, 1.3], [-0.5, 1], [-0.85, 0.5]], '#2c58a1');
  path(context, [[-0.8, -0.8], [-1, -1.5], [-0.4, -1.1], [0, -1.7], [0.4, -1.1], [1, -1.5], [0.8, -0.8]], '#f0cc70');
  path(context, [[-0.4, -0.25], [-0.2, -0.5], [0.1, -0.3], [0.4, -0.5], [0.6, -0.1], [0.3, 0.2], [0.5, 0.6], [0, 1], [-0.5, 0.6], [-0.3, 0.2], [-0.6, 0]], '#f0cc70');
  disc(context, -0.15, -0.12, 0.07, '#17396d'); disc(context, 0.25, -0.12, 0.07, '#17396d');
}

const crownrealm: VictoryDesign = {
  glow: '#ebc56a',
  spawn(random, density) {
    return [particle({ kind: 0, y: -30, size: 29, color: '#f0cc70', life: 2.8 }),
      ...[-1, 1].map((side) => particle({ kind: 1, x: side * 44, y: -15, size: 22,
        color: '#365fa8', life: 2.6, phaseSpeed: side * 3 })),
      ...Array.from({ length: amount(32, density) }, () => particle({
        kind: 2, ...polar(-Math.PI / 2 + between(random, -1.3, 1.3), between(random, 100, 210)),
        gravity: 170, drag: 0.6, size: between(random, 3, 6), spin: between(random, -2, 2),
        life: 2, delay: between(random, 0.1, 0.9), color: pick(random, ['#f0cc70', '#fff0b7', '#4d79c4']),
      })),
    ];
  },
  step(item, dt) {
    integrate(item, dt);
    if (item.kind === 0) item.y -= 7 * dt;
  },
  draw(context, item) {
    local(context, item);
    if (item.kind === 0) return shield(context);
    if (item.kind === 1) {
      const wave = Math.sin(item.phase) * 0.18;
      path(context, [[-0.6, -1], [0.6, -1], [0.6 + wave, 1.2], [wave, 0.9], [-0.6 + wave, 1.2]], item.color);
      path(context, [[0, -0.9], [wave, 0.6]], '#f0cc70', false);
      path(context, [[-0.8, -1.1], [0.8, -1.1]], '#f0cc70', false);
      return;
    }
    path(context, [[0, -1], [0.35, -0.25], [1, 0], [0.35, 0.25], [0, 1], [-0.35, 0.25], [-1, 0], [-0.35, -0.25]], item.color);
  },
  wreath: () => [particle({ y: -38, size: 22, life: 1, color: '#f0cc70' }),
    ...wreath(['#f0cc70', '#4d79c4'], [2], 4)],
};

export const CAMPAIGN_VICTORIES = { starfleet, shrine, ironfront, neoncity, crownrealm } as const;
