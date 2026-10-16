// Canvas runner for victory effects: one canvas, a fixed-step simulation, and one
// requestAnimationFrame loop that stops itself when the effect ends.

import { VICTORY_DESIGNS } from './victory-designs';
import type { VictoryDesign } from './victory-designs';
import { envelope, seededRandom } from './victory-particles';
import type { Particle } from './victory-particles';
import type { VictorySeries } from './victory-schedule';

export interface Point { readonly x: number; readonly y: number }

export interface VictoryTarget {
  readonly series: VictorySeries;
  /** Seeds the particles so a resumed effect matches the frame it left off. */
  readonly seed: string;
  /** Viewport coordinates of the emitter, or null to skip it this frame. */
  locate(): Point | null;
}

export interface VictoryRunOptions {
  readonly targets: readonly VictoryTarget[];
  /** CSS pixels per design unit. */
  scale(width: number, height: number): number;
  /** Fraction of each design's particle count. */
  readonly density: number;
  /** Static glow instead of particles. */
  readonly reduced: boolean;
  readonly durationMs: number;
  /** Already-played time when resuming. */
  readonly startMs?: number;
  /** Restart after this pause instead of finishing (shop preview). */
  readonly loopGapMs?: number;
  /** Viewport rectangles to keep clear, such as the result dialog. */
  avoid?(): readonly DOMRect[];
  onDone?(): void;
}

const STEP = 1 / 60;
const MEASURE_MS = 200;
const HALO_RADIUS = 90;
const AVOID_RADIUS = 16;
/** Device pixels are capped so large phones do not pay for invisible detail. */
const MAX_PIXEL_RATIO = 2;

interface Emitter {
  readonly target: VictoryTarget;
  readonly design: VictoryDesign;
  particles: Particle[];
  origin: Point | null;
}

function haloStrength(seconds: number, reduced: boolean): number {
  if (reduced) return 0.55;
  if (seconds < 0.15) return seconds / 0.15;
  return Math.max(0, 1 - (seconds - 0.15) / 1.65);
}

export function runVictoryCanvas(canvas: HTMLCanvasElement, options: VictoryRunOptions): () => void {
  const context = canvas.getContext('2d');
  if (!context) {
    options.onDone?.();
    return () => undefined;
  }
  const { reduced, durationMs, loopGapMs } = options;
  const emitters: Emitter[] = options.targets.map((target) => ({
    target, design: VICTORY_DESIGNS[target.series], particles: [], origin: null,
  }));
  let cycle = 0;
  let simTime = 0;
  let width = 0;
  let height = 0;
  let ratio = 1;
  let scale = 1;
  let avoid: readonly DOMRect[] = [];
  let measuredAt = -Infinity;
  let frame = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let startedAt = performance.now() - (options.startMs ?? 0);

  const reset = (): void => {
    simTime = 0;
    for (const emitter of emitters) {
      emitter.particles = reduced ? emitter.design.wreath()
        : emitter.design.spawn(seededRandom(`${emitter.target.seed}:${cycle}`), options.density);
    }
  };

  const measure = (now: number): void => {
    measuredAt = now;
    const box = canvas.getBoundingClientRect();
    const nextRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    if (box.width !== width || box.height !== height || nextRatio !== ratio) {
      width = box.width;
      height = box.height;
      ratio = nextRatio;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    scale = options.scale(width, height);
    avoid = (options.avoid?.() ?? []).map((rect) => new DOMRect(rect.x - box.x, rect.y - box.y, rect.width, rect.height));
    for (const emitter of emitters) {
      const point = emitter.target.locate();
      emitter.origin = point ? { x: point.x - box.x, y: point.y - box.y } : null;
    }
  };

  const advance = (seconds: number): void => {
    while (simTime + STEP <= seconds) {
      simTime += STEP;
      for (const { design, particles } of emitters) {
        for (const item of particles) {
          const age = simTime - item.delay;
          if (age >= 0 && age <= item.life) design.step(item, STEP);
        }
      }
    }
  };

  const draw = (): void => {
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.save();
    if (avoid.length) {
      context.beginPath();
      context.rect(0, 0, width, height);
      for (const rect of avoid) {
        if (typeof context.roundRect === 'function') context.roundRect(rect.x, rect.y, rect.width, rect.height, AVOID_RADIUS);
        else context.rect(rect.x, rect.y, rect.width, rect.height);
      }
      context.clip('evenodd');
    }
    const alphaOf = (item: Particle): number => reduced ? 1 : envelope(simTime - item.delay, item.life);
    for (const { design, particles, origin } of emitters) {
      if (!origin) continue;
      context.save();
      context.translate(origin.x, origin.y);
      context.scale(scale, scale);
      const halo = haloStrength(simTime, reduced);
      if (halo > 0) {
        const gradient = context.createRadialGradient(0, 0, 0, 0, 0, HALO_RADIUS);
        gradient.addColorStop(0, design.glow);
        gradient.addColorStop(1, `${design.glow}00`);
        context.globalAlpha = halo * 0.45;
        context.fillStyle = gradient;
        context.fillRect(-HALO_RADIUS, -HALO_RADIUS, HALO_RADIUS * 2, HALO_RADIUS * 2);
      }
      if (design.underlay) {
        context.save();
        design.underlay(context, particles, alphaOf);
        context.restore();
      }
      for (const item of particles) {
        const alpha = alphaOf(item);
        if (alpha <= 0) continue;
        context.save();
        context.globalAlpha = alpha;
        // Static frames show every particle fully formed, e.g. an opened lotus.
        design.draw(context, item, alpha, reduced ? item.life : simTime - item.delay);
        context.restore();
      }
      context.restore();
    }
    context.restore();
  };

  const stop = (): void => {
    stopped = true;
    if (frame) cancelAnimationFrame(frame);
    if (timer) clearInterval(timer);
    frame = 0;
    timer = null;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
  };

  const finish = (): void => {
    stop();
    options.onDone?.();
  };

  const tick = (now: number): void => {
    frame = 0;
    if (stopped) return;
    let elapsed = now - startedAt;
    if (loopGapMs !== undefined && elapsed >= durationMs + loopGapMs) {
      startedAt = now;
      elapsed = 0;
      cycle += 1;
      reset();
    } else if (loopGapMs === undefined && elapsed >= durationMs) return finish();
    if (now - measuredAt >= MEASURE_MS) measure(now);
    advance(Math.min(elapsed, durationMs) / 1000);
    draw();
    frame = requestAnimationFrame(tick);
  };

  reset();
  if (reduced) {
    // Static frames only need redrawing when the layout moves.
    const paint = (): void => {
      if (loopGapMs === undefined && performance.now() - startedAt >= durationMs) return finish();
      measure(performance.now());
      draw();
    };
    paint();
    if (!stopped) timer = setInterval(paint, MEASURE_MS);
  } else frame = requestAnimationFrame(tick);
  return stop;
}
