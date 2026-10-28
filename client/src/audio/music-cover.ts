/** Stable 32-bit hash of a string (FNV-1a), used to give every album its own colours. */
export function hashText(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Two-colour gradient for a cover swatch; the same name always gives the same colours. */
export function coverGradient(name: string): string {
  const hue = hashText(name) % 360;
  return `linear-gradient(135deg, hsl(${hue} 62% 52%), hsl(${(hue + 48) % 360} 66% 42%))`;
}
