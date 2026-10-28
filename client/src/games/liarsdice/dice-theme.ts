import type { CSSProperties } from 'react';

/**
 * Everything the dice renderer paints with. Cosmetic series provide their own theme; the renderer reads
 * only these values, as CSS custom properties set once on a container, so a theme never touches markup.
 */
export interface DiceTheme {
  /** Die body */
  readonly body: string;
  /** Die border */
  readonly edge: string;
  /** Pips of faces 2–6 */
  readonly pip: string;
  /** The single pip of a one, which is wild in most rounds */
  readonly pipOne: string;
  /** Border and glow of dice that match a bid */
  readonly match: string;
  /** Cup body, rim band, and shaded inside */
  readonly cupBody: string;
  readonly cupRim: string;
  readonly cupShade: string;
}

export const DEFAULT_DICE_THEME: DiceTheme = {
  body: '#f6f1e4',
  edge: '#bdb294',
  pip: '#2a2420',
  pipOne: '#b3261e',
  match: '#e0a800',
  cupBody: '#6b4428',
  cupRim: '#a8743f',
  cupShade: '#3d2515',
};

/** The custom properties that carry a theme to every die inside the element they are set on. */
export function diceThemeVars(theme: DiceTheme): CSSProperties {
  return {
    '--die-body': theme.body,
    '--die-edge': theme.edge,
    '--die-pip': theme.pip,
    '--die-pip-one': theme.pipOne,
    '--die-match': theme.match,
    '--cup-body': theme.cupBody,
    '--cup-rim': theme.cupRim,
    '--cup-shade': theme.cupShade,
  } as CSSProperties;
}

/** The theme the viewer's equipped dice style selects; only the default style exists so far. */
export function useDiceTheme(): DiceTheme {
  return DEFAULT_DICE_THEME;
}
