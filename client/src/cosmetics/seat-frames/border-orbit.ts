// ─── A small mark travelling clockwise around a rounded frame, as transform keyframes ───

interface OrbitPoint {
  distance: number;
  x: number;
  y: number;
  angle: number;
}

/** Steps per quarter arc; chords stay within a fraction of a pixel of the curve at seat-frame radii. */
const ARC_STEPS = 8;

/** Points along one lap, starting where the top edge leaves the top-left arc. */
function lap(width: number, height: number, radius: number): OrbitPoint[] {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const points: OrbitPoint[] = [];
  let distance = 0;
  let previous: { x: number; y: number } | null = null;
  const add = (x: number, y: number, angle: number): void => {
    if (previous) distance += Math.hypot(x - previous.x, y - previous.y);
    points.push({ distance, x, y, angle });
    previous = { x, y };
  };
  const corners = [
    { cx: width - r, cy: r, start: -90 },
    { cx: width - r, cy: height - r, start: 0 },
    { cx: r, cy: height - r, start: 90 },
    { cx: r, cy: r, start: 180 },
  ];
  add(r, 0, 0);
  corners.forEach(({ cx, cy, start }, index) => {
    for (let step = 0; step <= ARC_STEPS; step += 1) {
      const turn = start + step / ARC_STEPS * 90;
      const radians = turn * Math.PI / 180;
      add(cx + r * Math.cos(radians), cy + r * Math.sin(radians), index * 90 + step / ARC_STEPS * 90);
    }
  });
  add(r, 0, 360);
  return points;
}

function at(points: readonly OrbitPoint[], distance: number): OrbitPoint {
  const index = points.findIndex((point) => point.distance >= distance);
  if (index <= 0) return points[Math.max(0, index)];
  const [a, b] = [points[index - 1], points[index]];
  const t = b.distance === a.distance ? 0 : (distance - a.distance) / (b.distance - a.distance);
  return { distance, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: a.angle + (b.angle - a.angle) * t };
}

/**
 * Keyframes equal to `offset-path: inset(0 round radius)` with `offset-rotate: auto` for an element
 * placed at the frame's top-left corner, running from `from` to `to` of a lap (fractions, `to` may
 * exceed 1). Transforms keep the motion on the compositor, which offset-distance animations cannot.
 */
export function borderOrbitKeyframes(
  frame: { width: number; height: number; radius: number },
  mark: { width: number; height: number },
  from: number,
  to: number,
): Keyframe[] {
  const one = lap(frame.width, frame.height, frame.radius);
  const length = one[one.length - 1].distance;
  if (!length) return [];
  const points = [...one, ...one.slice(1).map((point) => ({ ...point, distance: point.distance + length, angle: point.angle + 360 }))];
  const start = from * length;
  const end = to * length;
  const path = [at(points, start), ...points.filter((point) => point.distance > start && point.distance < end), at(points, end)];
  return path.map((point) => ({
    offset: (point.distance - start) / (end - start),
    easing: 'linear',
    transform: `translate(${round(point.x - mark.width / 2)}px, ${round(point.y - mark.height / 2)}px) rotate(${round(point.angle)}deg)`,
  }));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000 || 0;
}

/**
 * Runs the orbit on `mark` around `frame` on the compositor, starting `from` of a lap, and refits the path
 * at the same lap position only when the frame or mark size changes. While it runs, `data-orbit` replaces
 * the static CSS motion path that places the mark when idle. Returns the function that stops it.
 */
export function runBorderOrbit(mark: HTMLElement, frame: HTMLElement, lap: { from: number; seconds: number }): () => void {
  let animation: Animation | null = null;
  let fitted = '';
  const fit = (): void => {
    const box = { width: frame.clientWidth, height: frame.clientHeight,
      radius: parseFloat(getComputedStyle(frame).borderTopLeftRadius) || 0 };
    const size = { width: mark.offsetWidth, height: mark.offsetHeight };
    const key = `${box.width} ${box.height} ${box.radius} ${size.width} ${size.height}`;
    // A resize observer first reports the size it starts with, which the first fit already used.
    if (key === fitted) return;
    fitted = key;
    const elapsed = animation?.currentTime ?? 0;
    animation?.cancel();
    animation = mark.animate(borderOrbitKeyframes(box, size, lap.from, lap.from + 1),
      { duration: lap.seconds * 1000, iterations: Infinity });
    animation.currentTime = elapsed;
  };
  mark.dataset.orbit = '';
  fit();
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
  resize?.observe(frame);
  return () => {
    resize?.disconnect();
    animation?.cancel();
    delete mark.dataset.orbit;
  };
}
