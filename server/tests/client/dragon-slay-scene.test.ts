import { describe, expect, it } from 'vitest';
import { getPresentationFrames } from '@shared/game-presentation';
import { SEVENS_SLAY_FRAME_MS } from '@shared/sevens-options';
import type { Card } from '@shared/types';
import {
  bladeX, bodyWidth, breathing, burnFront, createFireSystem, dragonSpine, DRAGON_BODY, DRAGON_CHEST, DRAGON_HEAD,
  emitBody, emitBreath, emitCut, emitRow, emitSurge, FIRE_CUT_MS, FIRE_STRIKE_MS, fireSweepFront, flameHeat, flightPath,
  headPose,
  pathPoint, rowFireFront, sceneFade, scorch, slayTimeline,
  seededRandom, slayLayout, SLAY_BREATH_START_MS, SLAY_CUT_MS, SLAY_DURATION_MS, SLAY_FLY_MS, SLAY_FLY_START_MS,
  SLAY_SPLIT_MS, SLAY_STRIKE_MS, snoutDistance, snoutPoint, SPINE_POINTS, splitPose, stepFire,
} from '../../../client/src/games/sevens/dragon-slay-scene';
import type { Particle, SlayLayout } from '../../../client/src/games/sevens/dragon-slay-scene';

const layout: SlayLayout = { width: 900, height: 600, rowLeft: 200, rowRight: 700, rowY: 300, card: 40 };

describe('dragon slaying timeline', () => {
  it('matches the shared frame length and leaves time after the cut for the halves to part', () => {
    const king: Card = { suit: 'hearts', rank: 13 };
    const frames = getPresentationFrames({
      gameType: 'sevens', phase: 'playing', options: { closeOnEnd: true },
      presentation: { id: 'p', startedAt: 0, logStart: 0 },
      log: [{ type: 'play', seat: 'N', card: king, timestamp: 0 }],
    } as unknown as Parameters<typeof getPresentationFrames>[0]);
    expect(frames.find((frame) => frame.kind === 'slay')?.durationMs).toBe(SLAY_DURATION_MS);
    expect(SLAY_STRIKE_MS).toBe(SLAY_FLY_START_MS + SLAY_FLY_MS);
    expect(SLAY_STRIKE_MS + SLAY_CUT_MS + SLAY_SPLIT_MS).toBeLessThanOrEqual(SLAY_DURATION_MS);
    expect(SLAY_CUT_MS).toBeLessThanOrEqual(150);
  });

  it('rises from below the bottom-left, turns 180 degrees, and ends at the row K end heading along the row', () => {
    const start = snoutPoint(layout, 0);
    expect(start.y).toBeGreaterThan(layout.height);
    expect(start.x).toBeLessThan(layout.width * 0.2);
    expect(start.hx).toBeCloseTo(-1);
    const end = snoutPoint(layout, SLAY_STRIKE_MS);
    expect(end.x).toBeCloseTo(layout.rowRight);
    expect(end.y).toBeCloseTo(layout.rowY);
    expect(end.hx).toBeCloseTo(1);
    expect(snoutPoint(layout, SLAY_DURATION_MS).x).toBeCloseTo(layout.rowRight);
    expect(snoutDistance(layout, 900)).toBeGreaterThan(snoutDistance(layout, 800));
  });

  it('follows a half circle bulging left, then a straight run along the row', () => {
    const path = flightPath(layout);
    const left = pathPoint(path, path.turn / 2);
    expect(left.x).toBeCloseTo(path.centerX - path.radius);
    expect(left.hy).toBeCloseTo(-1);
    const top = pathPoint(path, path.turn);
    expect(top.y).toBeCloseTo(layout.rowY);
    expect(top.x).toBeLessThan(layout.rowLeft);
    expect(pathPoint(path, path.total).x).toBeCloseTo(layout.rowRight);
    // Before the start the path continues off the bottom edge.
    expect(pathPoint(path, -100).y).toBeGreaterThan(layout.height);
  });

  it('breathes only between the breath start and the strike, then fades the scene at the end', () => {
    expect(breathing(SLAY_BREATH_START_MS - 1)).toBe(false);
    expect(breathing(SLAY_BREATH_START_MS)).toBe(true);
    expect(breathing(SLAY_STRIKE_MS)).toBe(false);
    expect(sceneFade(1000)).toBe(1);
    expect(sceneFade(SLAY_DURATION_MS)).toBe(0);
  });

  it('sweeps the blade along the row left to right during the cut only', () => {
    expect(bladeX(layout, SLAY_STRIKE_MS - 1)).toBeNull();
    expect(bladeX(layout, SLAY_STRIKE_MS)).toBeLessThan(layout.rowLeft);
    expect(bladeX(layout, SLAY_STRIKE_MS + SLAY_CUT_MS)).toBeGreaterThan(layout.rowRight);
    expect(bladeX(layout, SLAY_STRIKE_MS + SLAY_CUT_MS + 1)).toBeNull();
  });

  it('splits after the cut: the upper half rises, the lower half falls, both burning out', () => {
    expect(splitPose(layout, SLAY_STRIKE_MS + SLAY_CUT_MS - 1)).toBeNull();
    const end = splitPose(layout, SLAY_STRIKE_MS + SLAY_CUT_MS + SLAY_SPLIT_MS)!;
    expect(end.upper.dy).toBeLessThan(0);
    expect(end.lower.dy).toBeGreaterThan(0);
    expect(end.upper.alpha).toBe(0);
    expect(end.lower.alpha).toBe(0);
    expect(splitPose(layout, SLAY_STRIKE_MS + SLAY_CUT_MS)!.flare).toBe(1);
  });
});

describe('dragon pose', () => {
  it('is long and thickest at the chest, tapering to the tail tip', () => {
    expect(DRAGON_BODY).toBeGreaterThanOrEqual(12);
    expect(Math.max(...Array.from({ length: 101 }, (_, index) => bodyWidth(index / 100)))).toBeCloseTo(DRAGON_CHEST);
    expect(bodyWidth(0)).toBeLessThan(bodyWidth(0.1));
    for (let u = 0.1; u < 1; u += 0.05) expect(bodyWidth(u + 0.05)).toBeLessThan(bodyWidth(u));
    expect(bodyWidth(1)).toBeLessThan(0.1);
  });

  it('lays the spine behind the neck along the path, swaying across it, with unit normals', () => {
    const spine = dragonSpine(layout, SLAY_STRIKE_MS);
    const path = flightPath(layout);
    const neck = snoutDistance(layout, SLAY_STRIKE_MS) - DRAGON_HEAD * layout.card;
    expect(spine).toHaveLength(SPINE_POINTS);
    expect(spine[0].x).toBeCloseTo(pathPoint(path, neck).x);
    for (const point of spine) {
      const centre = pathPoint(path, neck - point.s);
      expect(Math.hypot(point.x - centre.x, point.y - centre.y)).toBeLessThanOrEqual(0.3 * layout.card);
      expect(Math.hypot(point.nx, point.ny)).toBeCloseTo(1);
    }
    // On the straight run the dragon's left side faces up the screen, and the head faces the K end.
    expect(spine[0].ny).toBeLessThan(0);
    expect(Math.abs(headPose(spine).angle)).toBeLessThan(0.4);
  });

  it('spreads fire from the neck to the tail and scorches what has burned', () => {
    expect(burnFront(layout, 0)).toBe(0);
    expect(burnFront(layout, SLAY_STRIKE_MS)).toBe(DRAGON_BODY * layout.card);
    expect(scorch(layout, 900, 0)).toBeGreaterThan(scorch(layout, 900, 300));
    expect(scorch(layout, 0, 0)).toBe(0);
  });

  it('burns the row only once the dragon is on it, up to where the breath has reached', () => {
    expect(rowFireFront(layout, 0)).toBe(layout.rowLeft);
    const onRow = Array.from({ length: 200 }, (_, index) => index * 10)
      .find((ms) => snoutDistance(layout, ms) >= flightPath(layout).turn)!;
    expect(rowFireFront(layout, onRow - 10)).toBe(layout.rowLeft);
    expect(rowFireFront(layout, onRow + 300)).toBeGreaterThan(layout.rowLeft);
    expect(rowFireFront(layout, SLAY_STRIKE_MS)).toBe(layout.rowRight);
    expect(rowFireFront(layout, SLAY_DURATION_MS)).toBe(layout.rowRight);
  });

  it('falls back to the middle of the table when the row is not rendered', () => {
    const fallback = slayLayout({ left: 0, top: 0, width: 600, height: 400 }, null);
    expect(fallback).toMatchObject({ rowLeft: 90, rowRight: 510, rowY: 200 });
    expect(slayLayout({ left: 10, top: 20, width: 600, height: 400 },
      { left: 110, top: 220, width: 300, height: 44 })).toEqual({
      width: 600, height: 400, rowLeft: 100, rowRight: 400, rowY: 222, card: 44,
    });
  });
});

describe('fire-only effect', () => {
  it('uses the shared frame lengths and finishes the cut with time left before the end', () => {
    for (const effect of ['dragon', 'fire'] as const) {
      const timeline = slayTimeline(effect);
      expect(timeline.duration).toBe(SEVENS_SLAY_FRAME_MS[effect]);
      expect(timeline.fireStart).toBeLessThanOrEqual(timeline.strike);
      expect(timeline.fireEnd).toBeGreaterThanOrEqual(timeline.strike);
      expect(timeline.strike + timeline.cut).toBeLessThan(timeline.duration - 300);
    }
    expect(slayTimeline('dragon').cut).toBe(SLAY_CUT_MS);
    expect(slayTimeline('fire').duration).toBeLessThan(slayTimeline('dragon').duration);
    // Fire only: the blade sweeps from 0.28 s to 0.58 s, the row burns until 1.4 s, then fades out by 1.7 s.
    expect(slayTimeline('fire')).toEqual({ duration: 1700, fireStart: 280, fireEnd: 1400, strike: 280, cut: 300 });
    expect(sceneFade(1400, 1700)).toBe(1);
    expect(sceneFade(1700, 1700)).toBe(0);
  });

  it('moves the fire and the blade right together, the row burning up to the blade', () => {
    const { strike, cut } = slayTimeline('fire');
    expect(strike).toBe(FIRE_STRIKE_MS);
    expect(cut).toBe(FIRE_CUT_MS);
    expect(fireSweepFront(layout, strike - 1)).toBe(layout.rowLeft);
    for (const ms of [strike + cut * 0.25, strike + cut * 0.5, strike + cut * 0.75]) {
      expect(fireSweepFront(layout, ms)).toBeCloseTo(bladeX(layout, ms, strike, cut)!);
    }
    expect(fireSweepFront(layout, strike + cut)).toBe(layout.rowRight);
    expect(fireSweepFront(layout, strike + cut + 500)).toBe(layout.rowRight);
  });

  it('surges where the blade is only during the sweep', () => {
    const fire = createFireSystem(layout);
    const during = FIRE_STRIKE_MS + FIRE_CUT_MS / 2;
    emitSurge(fire, layout, fireSweepFront(layout, during), during, 0.05);
    expect(fire.particles.length).toBeGreaterThan(0);
    const after = createFireSystem(layout);
    emitSurge(after, layout, layout.rowRight, FIRE_STRIKE_MS + FIRE_CUT_MS + 1, 0.05);
    expect(after.particles).toHaveLength(0);
  });
});

describe('fire simulation', () => {
  it('is deterministic for a seed', () => {
    const first = seededRandom(3);
    const second = seededRandom(3);
    expect(Array.from({ length: 5 }, first)).toEqual(Array.from({ length: 5 }, second));
  });

  it('emits row, body and breath fire while flying, and sparks during the cut, within the budget', () => {
    const fire = createFireSystem(layout);
    const spine = dragonSpine(layout, 1200);
    emitRow(fire, layout, 1200, 0.05);
    emitBody(fire, layout, spine, 1200, 0.05);
    emitBreath(fire, layout, { x: 500, y: 300 }, 0, 1200, 0.05);
    expect(fire.particles.length).toBeGreaterThan(20);
    expect(fire.particles.every((particle) => particle.kind !== 'spark')).toBe(true);
    emitCut(fire, layout, SLAY_STRIKE_MS + 60, 0.05);
    expect(fire.particles.some((particle) => particle.kind === 'spark')).toBe(true);
    for (let step = 0; step < 200; step++) emitRow(fire, layout, 1500, 0.05);
    expect(fire.particles.length).toBeLessThanOrEqual(fire.cap);
  });

  it('stops body fire once the halves part, and breath once the blade comes', () => {
    const fire = createFireSystem(layout);
    emitBody(fire, layout, dragonSpine(layout, SLAY_STRIKE_MS + SLAY_CUT_MS), SLAY_STRIKE_MS + SLAY_CUT_MS, 0.05);
    emitBreath(fire, layout, { x: 500, y: 300 }, 0, SLAY_STRIKE_MS, 0.05);
    expect(fire.particles).toHaveLength(0);
  });

  it('lifts flames, drops sparks, and removes particles at the end of their life', () => {
    const fire = createFireSystem(layout);
    const base = { age: 0, life: 0.5, size: 10, grow: 0, heat: 1, seed: 0.3, vx: 0, vy: 0 };
    fire.particles.push({ ...base, kind: 'flame', x: 100, y: 100 }, { ...base, kind: 'spark', x: 100, y: 100 },
      { ...base, kind: 'smoke', x: 100, y: 100, life: 0.01 });
    stepFire(fire, layout.card, 0, 0.05);
    const [flame, spark] = fire.particles as Particle[];
    expect(fire.particles).toHaveLength(2);
    expect(flame.vy).toBeLessThan(0);
    expect(spark.vy).toBeGreaterThan(0);
  });

  it('cools flames from white-hot as they age', () => {
    expect(flameHeat({ heat: 1, age: 0, life: 1 })).toBe(1);
    expect(flameHeat({ heat: 1, age: 0.5, life: 1 })).toBeLessThan(0.5);
    expect(flameHeat({ heat: 1, age: 1, life: 1 })).toBe(0);
  });
});
