// ─── Table collapse renderer: paints table-collapse-scene onto a 2D canvas every animation frame ───

import { clamp01, seededRandom } from './dragon-slay-scene';
import {
  COLLAPSE_MS, collapseShade, CRACK_OPEN_MS, crackReach, crackWidth, FLASH_MS, openProgress, shatterTable,
} from './table-collapse-scene';
import type { Crack, Point, Shard, Shatter } from './table-collapse-scene';

type Context = CanvasRenderingContext2D;

export interface CollapseLayout {
  readonly width: number;
  readonly height: number;
  /** Where the blow lands: the middle of the suit rows */
  readonly impact: Point;
}

export interface CollapseRenderer {
  /** `ms` is the time since the collapse began; `still` draws the settled, broken table. */
  draw: (layout: CollapseLayout, ms: number, dt: number, still: boolean) => void;
}

interface Chip {
  x: number;
  y: number;
  vx: number;
  vy: number;
  turn: number;
  spin: number;
  size: number;
  age: number;
  life: number;
  dust: boolean;
}

function tracePolygon(context: Context, polygon: readonly Point[]): void {
  context.beginPath();
  context.moveTo(polygon[0].x, polygon[0].y);
  for (const point of polygon.slice(1)) context.lineTo(point.x, point.y);
  context.closePath();
}

/**
 * Each shard tips its own way, so it catches more or less light; pieces near the impact sink deeper. Edges
 * facing the light (top left) catch a bright bevel and the others fall into shadow, so neighbouring shards
 * read as separate plates. The pieces at the impact fall away into a dark hole.
 */
function drawShard(context: Context, shard: Shard, open: number): void {
  tracePolygon(context, shard.polygon);
  if (shard.fallen) {
    context.fillStyle = `rgba(3,2,2,${0.92 * open})`;
    context.fill();
  } else {
    const shade = 0.06 + 0.22 * shard.depth ** 1.5 + 0.07 * shard.tilt;
    context.fillStyle = shade >= 0 ? `rgba(0,0,0,${shade * open})` : `rgba(255,255,255,${-shade * open})`;
    context.fill();
  }
  shard.polygon.forEach((point, index) => {
    const next = shard.polygon[(index + 1) % shard.polygon.length];
    // Inward normal of this edge (the polygon winds clockwise on screen); facing up-left means lit.
    const nx = -(next.y - point.y);
    const ny = next.x - point.x;
    const norm = Math.hypot(nx, ny) || 1;
    const lit = nx + ny > 0;
    const inset = 1.2;
    context.strokeStyle = lit ? `rgba(255,250,240,${(shard.fallen ? 0.05 : 0.12) * open})`
      : `rgba(0,0,0,${(shard.fallen ? 0.6 : 0.3) * open})`;
    context.lineWidth = 1.2;
    context.beginPath();
    context.moveTo(point.x + (nx / norm) * inset, point.y + (ny / norm) * inset);
    context.lineTo(next.x + (nx / norm) * inset, next.y + (ny / norm) * inset);
    context.stroke();
  });
}

/** The split part of a crack: a thin dark gap with a faint lit lip on its upper side. */
function drawCrack(context: Context, crack: Crack, ms: number): void {
  const reach = crackReach(crack, ms);
  if (reach <= 0) return;
  const points: Point[] = [crack.points[0]];
  for (let index = 1; index < crack.points.length; index++) {
    const before = crack.points[index - 1];
    if (crack.lengths[index] <= reach) {
      points.push(crack.points[index]);
      continue;
    }
    const t = (reach - crack.lengths[index - 1]) / (crack.lengths[index] - crack.lengths[index - 1] || 1);
    points.push({ x: before.x + (crack.points[index].x - before.x) * t,
      y: before.y + (crack.points[index].y - before.y) * t });
    break;
  }
  const width = crackWidth(crack, ms);
  const trace = (shift: number): void => {
    context.beginPath();
    context.moveTo(points[0].x + shift, points[0].y + shift);
    for (const point of points.slice(1)) context.lineTo(point.x + shift, point.y + shift);
  };
  trace(0);
  context.strokeStyle = 'rgba(5,4,4,0.95)';
  context.lineWidth = width;
  context.stroke();
  trace(-width * 0.5 - 0.5);
  context.strokeStyle = 'rgba(255,250,240,0.16)';
  context.lineWidth = 0.8;
  context.stroke();
}

/** Grit and chips knocked loose near the impact as the shards part: chips drop, dust drifts up. */
function stepChips(context: Context, chips: Chip[], shatter: Shatter, random: () => number, ms: number,
  dt: number): void {
  const [open, settle] = CRACK_OPEN_MS;
  const near = shatter.cracks.filter((crack) => crack.width > 2);
  if (ms >= open && ms <= settle && near.length > 0) {
    for (let spawn = Math.round(120 * dt); spawn > 0; spawn--) {
      const crack = near[Math.floor(random() * near.length)];
      const point = crack.points[Math.floor(random() * crack.points.length)];
      const dust = random() < 0.35;
      chips.push({ x: point.x, y: point.y, vx: (random() - 0.5) * 50, vy: dust ? -15 - random() * 25 : random() * 30,
        turn: random() * Math.PI, spin: (random() - 0.5) * 12, size: dust ? 8 + random() * 12 : 1.5 + random() * 3,
        age: 0, life: dust ? 0.9 : 0.6 + random() * 0.4, dust });
    }
  }
  let kept = 0;
  for (const chip of chips) {
    chip.age += dt;
    if (chip.age >= chip.life) continue;
    chip.vy += (chip.dust ? -10 : 420) * dt;
    chip.x += chip.vx * dt;
    chip.y += chip.vy * dt;
    chip.turn += chip.spin * dt;
    const fade = 1 - chip.age / chip.life;
    if (chip.dust) {
      context.fillStyle = `rgba(80,72,64,${0.2 * fade})`;
      context.beginPath();
      context.arc(chip.x, chip.y, chip.size * (1 + chip.age * 1.5), 0, Math.PI * 2);
      context.fill();
    } else {
      context.save();
      context.translate(chip.x, chip.y);
      context.rotate(chip.turn);
      context.fillStyle = `rgba(20,30,28,${fade})`;
      context.beginPath();
      context.moveTo(-chip.size, -chip.size * 0.6);
      context.lineTo(chip.size, -chip.size * 0.3);
      context.lineTo(chip.size * 0.2, chip.size);
      context.closePath();
      context.fill();
      context.restore();
    }
    chips[kept++] = chip;
  }
  chips.length = kept;
}

export function createCollapseRenderer(canvas: HTMLCanvasElement): CollapseRenderer {
  const random = seededRandom(23);
  const chips: Chip[] = [];
  let shatter: { key: string; value: Shatter } | null = null;

  return {
    draw: (layout, elapsed, dt, still) => {
      const context = canvas.getContext('2d');
      if (!context || layout.width <= 0 || layout.height <= 0) return;
      const ms = still ? COLLAPSE_MS : elapsed;
      const ratio = Math.min(window.devicePixelRatio || 1, layout.width < 700 ? 1.5 : 2);
      const width = Math.round(layout.width * ratio);
      const height = Math.round(layout.height * ratio);
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      // The break follows the table size, but stays put while the table only jolts or the rows sink.
      const key = `${Math.round(layout.width)}x${Math.round(layout.height)}`;
      if (!shatter || shatter.key !== key) {
        shatter = { key, value: shatterTable(layout.width, layout.height, layout.impact) };
      }

      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, width, height);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.fillStyle = `rgba(4,3,3,${collapseShade(ms)})`;
      context.fillRect(0, 0, layout.width, layout.height);
      const open = openProgress(ms);
      if (open > 0) for (const shard of shatter.value.shards) drawShard(context, shard, open);
      for (const crack of shatter.value.cracks) drawCrack(context, crack, ms);
      if (still) return;

      stepChips(context, chips, shatter.value, random, ms, dt);
      // The blow that breaks the table.
      if (ms < FLASH_MS) {
        const { x, y } = layout.impact;
        context.save();
        context.globalCompositeOperation = 'lighter';
        const glow = context.createRadialGradient(x, y, 0, x, y, 140);
        glow.addColorStop(0, `rgba(255,250,235,${0.7 * (1 - clamp01(ms / FLASH_MS))})`);
        glow.addColorStop(1, 'rgba(255,240,220,0)');
        context.fillStyle = glow;
        context.fillRect(x - 140, y - 140, 280, 280);
        context.restore();
      }
    },
  };
}
