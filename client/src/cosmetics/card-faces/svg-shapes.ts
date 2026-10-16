import type { Suit } from '@shared/types';

/** Rounds coordinates so generated markup stays short and deterministic. */
export function num(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * Suit silhouettes in a 100-unit box centred on the origin. Every sub-path winds the same
 * way so the overlapping club lobes merge under the default non-zero fill rule.
 */
export const SUIT_PATHS: Readonly<Record<Suit, string>> = {
  hearts: 'M0 46C-10 33-50 11-50-16C-50-36-36-48-22-48C-10-48-2-40 0-30C2-40 10-48 22-48C36-48 50-36 50-16C50 11 10 33 0 46Z',
  diamonds: 'M0-50C9-33 21-16 37 0C21 16 9 33 0 50C-9 33-21 16-37 0C-21-16-9-33 0-50Z',
  spades: 'M0-50C12-31 50-14 50 11C50 28 38 37 25 37C15 37 8 32 4 25C5 36 10 44 19 50H-19C-10 44-5 36-4 25C-8 32-15 37-25 37C-38 37-50 28-50 11C-50-14-12-31 0-50Z',
  clubs: [
    'M-23-23A23 23 0 1 1 23-23A23 23 0 1 1-23-23Z',
    'M-48 12A23 23 0 1 1-2 12A23 23 0 1 1-48 12Z',
    'M2 12A23 23 0 1 1 48 12A23 23 0 1 1 2 12Z',
    'M-12 4A12 12 0 1 1 12 4A12 12 0 1 1-12 4Z',
    'M4 14C5 32 10 43 19 50H-19C-10 43-5 32-4 14Z',
  ].join(''),
};

export function isRedSuit(suit: Suit): boolean {
  return suit === 'hearts' || suit === 'diamonds';
}

/** Four-point sparkle. */
export function sparkle(x: number, y: number, r: number, fill: string, opacity = 1): string {
  const k = r * 0.16;
  return `<path transform="translate(${num(x)} ${num(y)})" d="M0 ${num(-r)}Q${num(k)} ${num(-k)} ${num(r)} 0Q${num(k)} ${num(k)} 0 ${num(r)}Q${num(-k)} ${num(k)} ${num(-r)} 0Q${num(-k)} ${num(-k)} 0 ${num(-r)}Z" fill="${fill}" opacity="${opacity}"/>`;
}

/** Five notched cherry-blossom petals around a stamen dot. */
export function blossom(x: number, y: number, r: number, fill: string, centre: string, rotation = 0, opacity = 1): string {
  const petal = `M0 0C${num(-r * 0.55)} ${num(-r * 0.3)} ${num(-r * 0.6)} ${num(-r * 0.86)} ${num(-r * 0.2)} ${num(-r)}L0 ${num(-r * 0.84)}L${num(r * 0.2)} ${num(-r)}C${num(r * 0.6)} ${num(-r * 0.86)} ${num(r * 0.55)} ${num(-r * 0.3)} 0 0Z`;
  const petals = [0, 72, 144, 216, 288].map((angle) => `<path d="${petal}" transform="rotate(${angle})"/>`).join('');
  return `<g transform="translate(${num(x)} ${num(y)}) rotate(${rotation})" opacity="${opacity}"><g fill="${fill}">${petals}</g><circle r="${num(r * 0.2)}" fill="${centre}"/></g>`;
}

/** A single loose petal. */
export function petal(x: number, y: number, r: number, rotation: number, fill: string, opacity = 1): string {
  return `<path transform="translate(${num(x)} ${num(y)}) rotate(${rotation})" d="M0 ${num(r)}C${num(-r * 0.8)} ${num(r * 0.2)} ${num(-r * 0.5)} ${num(-r * 0.8)} ${num(-r * 0.12)} ${num(-r)}L0 ${num(-r * 0.78)}L${num(r * 0.12)} ${num(-r)}C${num(r * 0.5)} ${num(-r * 0.8)} ${num(r * 0.8)} ${num(r * 0.2)} 0 ${num(r)}Z" fill="${fill}" opacity="${opacity}"/>`;
}

/** Six-armed snowflake with side branches. */
export function snowflake(x: number, y: number, r: number, stroke: string, width: number, opacity = 1): string {
  const b = r * 0.32;
  const arm = `M0 0V${num(-r)}M0 ${num(-r * 0.5)}L${num(-b)} ${num(-r * 0.5 - b)}M0 ${num(-r * 0.5)}L${num(b)} ${num(-r * 0.5 - b)}M0 ${num(-r * 0.78)}L${num(-b * 0.6)} ${num(-r * 0.78 - b * 0.6)}M0 ${num(-r * 0.78)}L${num(b * 0.6)} ${num(-r * 0.78 - b * 0.6)}`;
  const arms = [0, 60, 120, 180, 240, 300].map((angle) => `<path d="${arm}" transform="rotate(${angle})"/>`).join('');
  return `<g transform="translate(${num(x)} ${num(y)})" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" fill="none" opacity="${opacity}">${arms}<circle r="${num(r * 0.14)}"/></g>`;
}

/** Rays alternating long and short around a centre. */
export function sunburst(x: number, y: number, inner: number, outer: number, count: number, stroke: string, width: number, opacity = 1, from = 0, to = 360): string {
  const span = to - from;
  const closed = span >= 360;
  const steps = closed ? count : count - 1;
  const rays: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = ((from + (span * index) / steps) - 90) * (Math.PI / 180);
    const length = index % 2 === 0 ? outer : inner + (outer - inner) * 0.6;
    rays.push(`M${num(Math.cos(angle) * inner)} ${num(Math.sin(angle) * inner)}L${num(Math.cos(angle) * length)} ${num(Math.sin(angle) * length)}`);
  }
  return `<path transform="translate(${num(x)} ${num(y)})" d="${rays.join('')}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" fill="none" opacity="${opacity}"/>`;
}

/** Teardrop flame pointing up from its base point. */
export function flame(x: number, base: number, height: number, width: number, fill: string, opacity = 1, lean = 0): string {
  const w = width / 2;
  return `<path d="M${num(x - w)} ${num(base)}C${num(x - w * 1.1)} ${num(base - height * 0.45)} ${num(x + lean - w * 0.2)} ${num(base - height * 0.6)} ${num(x + lean)} ${num(base - height)}C${num(x + lean + w * 0.5)} ${num(base - height * 0.55)} ${num(x + w * 1.15)} ${num(base - height * 0.4)} ${num(x + w)} ${num(base)}Z" fill="${fill}" opacity="${opacity}"/>`;
}

/** Lotus bloom whose petals fan upward from the base point. */
export function lotus(x: number, y: number, size: number, fill: string, inner: string, opacity = 1): string {
  const s = size / 40;
  const leaf = (angle: number, length: number, colour: string): string =>
    `<path transform="rotate(${angle})" d="M0 0C${num(-9 * s)} ${num(-length * 0.35)} ${num(-7 * s)} ${num(-length * 0.8)} 0 ${num(-length)}C${num(7 * s)} ${num(-length * 0.8)} ${num(9 * s)} ${num(-length * 0.35)} 0 0Z" fill="${colour}"/>`;
  return `<g transform="translate(${num(x)} ${num(y)})" opacity="${opacity}">${leaf(-72, 26 * s, fill)}${leaf(72, 26 * s, fill)}${leaf(-40, 34 * s, fill)}${leaf(40, 34 * s, fill)}${leaf(-16, 38 * s, inner)}${leaf(16, 38 * s, inner)}${leaf(0, 42 * s, fill)}</g>`;
}

/** Bamboo culm with nodes, drawn from top to bottom. */
export function bambooStalk(x: number, top: number, bottom: number, width: number, fill: string, node: string, opacity = 1): string {
  const parts: string[] = [];
  const segment = 44;
  for (let y = top; y < bottom; y += segment) {
    const end = Math.min(y + segment - 3, bottom);
    parts.push(`<rect x="${num(x - width / 2)}" y="${num(y)}" width="${num(width)}" height="${num(end - y)}" rx="${num(width / 2.5)}" fill="${fill}"/>`);
    parts.push(`<rect x="${num(x - width / 2 - 1.2)}" y="${num(end - 1)}" width="${num(width + 2.4)}" height="3" rx="1.5" fill="${node}"/>`);
  }
  return `<g opacity="${opacity}">${parts.join('')}</g>`;
}

/** Slender bamboo leaf whose stem sits at the anchor point. */
export function bambooLeaf(x: number, y: number, length: number, rotation: number, fill: string, opacity = 1): string {
  const w = length * 0.16;
  return `<path transform="translate(${num(x)} ${num(y)}) rotate(${rotation})" d="M0 0C${num(w)} ${num(-length * 0.3)} ${num(w * 0.7)} ${num(-length * 0.75)} 0 ${num(-length)}C${num(-w * 0.7)} ${num(-length * 0.75)} ${num(-w)} ${num(-length * 0.3)} 0 0Z" fill="${fill}" opacity="${opacity}"/>`;
}

/** Deterministic pseudo-random sequence so generated decks are identical on every load. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
