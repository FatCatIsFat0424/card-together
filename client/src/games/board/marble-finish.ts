// ─── Chinese checkers marbles: shades of the fixed corner hues under a piece style's material and rim ───

import { ensureContrast, mix } from '../../cosmetics/colour';
import type { MarbleMaterial, PieceFinish, PieceRim } from './board-theme';

/**
 * Least WCAG contrast between every marble hue and the dark hole bottom it sits in, on every board style. The
 * approved mockup reached 2.02 for its weakest series (crownrealm against the purple marble), so styles keep 2.
 */
export const MARBLE_HOLE_CONTRAST = 2;
/** Rim beads and notches against the marble they decorate, so a gold accent stays visible on a yellow marble. */
export const MARBLE_RIM_CONTRAST = 2;

interface MaterialLook {
  /** Highlight opacity. */
  readonly gloss: number;
  /** Amount of white in the lit side and of black in the shaded side of the body gradient. */
  readonly light: number;
  readonly shade: number;
}

const MATERIALS: Readonly<Record<MarbleMaterial, MaterialLook>> = {
  glass: { gloss: 0.5, light: 0.6, shade: 0.5 },
  porcelain: { gloss: 0.38, light: 0.4, shade: 0.3 },
  jade: { gloss: 0.3, light: 0.4, shade: 0.35 },
  enamel: { gloss: 0.34, light: 0.5, shade: 0.45 },
  ivory: { gloss: 0.22, light: 0.28, shade: 0.3 },
  lacquer: { gloss: 0.42, light: 0.35, shade: 0.6 },
  stone: { gloss: 0.12, light: 0.15, shade: 0.35 },
  metal: { gloss: 0.46, light: 0.5, shade: 0.5 },
};

export interface MarbleShades {
  readonly material: MarbleMaterial;
  readonly body: string;
  readonly light: string;
  readonly shade: string;
  /** Dark edge that separates the marble from its hole and from neighbouring marbles. */
  readonly outline: string;
  readonly rimStyle: PieceRim;
  /** Colour of the rim's beads, notches, or inner ring. */
  readonly rim: string;
  readonly gloss: number;
}

/** Shades of one corner hue: the hue never changes, only the material's light, shade, and highlight. */
export function marbleShades(hue: string, accent: string, finish: PieceFinish): MarbleShades {
  const material = finish.material ?? 'glass';
  const look = MATERIALS[material];
  return {
    material,
    body: hue,
    light: mix(hue, '#ffffff', look.light),
    shade: mix(hue, '#000000', look.shade),
    outline: mix(hue, '#000000', 0.62),
    rimStyle: finish.rim,
    rim: ensureContrast(accent, hue, MARBLE_RIM_CONTRAST),
    gloss: look.gloss,
  };
}
