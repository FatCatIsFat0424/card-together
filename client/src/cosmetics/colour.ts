// ─── Colour arithmetic for generated cosmetics: mixing, WCAG contrast, and perceptual distance ───

type Rgb = readonly [number, number, number];

function rgb(hex: string): Rgb {
  const value = /^#([\da-f]{6})$/i.exec(hex);
  if (!value) throw new Error(`Expected a #rrggbb colour, got ${hex}`);
  const number = Number.parseInt(value[1], 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

function hex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((channel) => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, '0')).join('')}`;
}

/** `amount` 0 keeps `from`, 1 gives `to`. */
export function mix(from: string, to: string, amount: number): string {
  const a = rgb(from);
  const b = rgb(to);
  return hex([0, 1, 2].map((index) => a[index] + (b[index] - a[index]) * amount) as unknown as Rgb);
}

/** WCAG relative luminance. */
export function luminance(colour: string): number {
  const [r, g, b] = rgb(colour).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/**
 * Darkens or lightens `colour` (toward whichever end contrasts more with every background) until it reaches
 * `ratio` against all of them, so generated palettes stay legible whatever the series colours are.
 */
export function ensureContrast(colour: string, backgrounds: string | readonly string[], ratio: number): string {
  const against = typeof backgrounds === 'string' ? [backgrounds] : backgrounds;
  const worst = (candidate: string): number => Math.min(...against.map((background) => contrast(candidate, background)));
  if (worst(colour) >= ratio) return colour;
  const target = worst(mix(colour, '#000000', 1)) >= worst(mix(colour, '#ffffff', 1)) ? '#000000' : '#ffffff';
  for (let step = 1; step <= 20; step += 1) {
    const candidate = mix(colour, target, step / 20);
    if (worst(candidate) >= ratio) return candidate;
  }
  return target;
}

/** Moves `colour` toward black or white until its luminance lies within `[min, max]`. */
export function withLuminance(colour: string, min: number, max: number): string {
  for (let step = 0; step <= 20; step += 1) {
    const lighter = mix(colour, '#ffffff', step / 20);
    const darker = mix(colour, '#000000', step / 20);
    if (luminance(colour) < min ? luminance(lighter) >= min : luminance(darker) <= max) {
      return luminance(colour) < min ? lighter : darker;
    }
  }
  return colour;
}

function lab(colour: string): Rgb {
  const [r, g, b] = rgb(colour).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const xyz = [
    (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047,
    0.2126 * r + 0.7152 * g + 0.0722 * b,
    (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883,
  ].map((value) => (value > 216 / 24389 ? Math.cbrt(value) : (24389 / 27 * value + 16) / 116));
  return [116 * xyz[1] - 16, 500 * (xyz[0] - xyz[1]), 200 * (xyz[1] - xyz[2])];
}

/** CIE76 colour difference; about 2.3 is just noticeable, and above 30 two colours read as different hues or shades. */
export function colourDistance(a: string, b: string): number {
  const first = lab(a);
  const second = lab(b);
  return Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);
}
