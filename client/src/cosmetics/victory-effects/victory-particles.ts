// Particle model shared by the table overlay and the shop preview. Positions are relative to
// the emitting seat so layout changes move a running effect with its seat.

export interface Particle {
  kind: number;
  /** Seconds after the effect starts before the particle appears. */
  delay: number;
  /** Seconds the particle stays visible once it appears. */
  life: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** px/s², positive falls. */
  gravity: number;
  /** Fraction of velocity kept per second. */
  drag: number;
  size: number;
  rotation: number;
  spin: number;
  /** Free-running angle for flutter, flip, twinkle, or sway. */
  phase: number;
  phaseSpeed: number;
  /** Polar motion used by orbiting particles. */
  angle: number;
  radius: number;
  angularSpeed: number;
  radialSpeed: number;
  color: string;
  /** Flattened recent positions for ribbons and streaks; null when unused. */
  trail: number[] | null;
}

export type Random = () => number;

/** Deterministic, so a remounted effect can fast-forward to the same frame. */
export function seededRandom(seed: string): Random {
  let state = 0x9e3779b9;
  for (let index = 0; index < seed.length; index++) state = Math.imul(state ^ seed.charCodeAt(index), 0x85ebca6b);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function between(random: Random, min: number, max: number): number {
  return min + random() * (max - min);
}

export function pick<T>(random: Random, values: readonly T[]): T {
  return values[Math.floor(random() * values.length) % values.length];
}

export function particle(values: Partial<Particle> & Pick<Particle, 'color' | 'life'>): Particle {
  return {
    kind: 0, delay: 0, x: 0, y: 0, vx: 0, vy: 0, gravity: 0, drag: 1, size: 4, rotation: 0, spin: 0,
    phase: 0, phaseSpeed: 0, angle: 0, radius: 0, angularSpeed: 0, radialSpeed: 0, trail: null, ...values,
  };
}

/** Velocity pointing at `angle` (radians, 0 = right, -π/2 = up). */
export function polar(angle: number, speed: number): Pick<Particle, 'vx' | 'vy'> {
  return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
}

/** Fades in quickly and out over the last third so nothing pops. */
export function envelope(age: number, life: number): number {
  if (age < 0 || age > life) return 0;
  const progress = age / life;
  if (progress < 0.08) return progress / 0.08;
  if (progress > 0.65) return Math.max(0, (1 - progress) / 0.35);
  return 1;
}

/** Shared ballistic step; designs adjust velocities before it or override positions after it. */
export function integrate(item: Particle, dt: number): void {
  const keep = item.drag === 1 ? 1 : item.drag ** dt;
  item.vx *= keep;
  item.vy = item.vy * keep + item.gravity * dt;
  item.x += item.vx * dt;
  item.y += item.vy * dt;
  item.rotation += item.spin * dt;
  item.phase += item.phaseSpeed * dt;
}

export function pushTrail(item: Particle, length: number): void {
  if (!item.trail) return;
  item.trail.push(item.x, item.y);
  if (item.trail.length > length * 2) item.trail.splice(0, item.trail.length - length * 2);
}
