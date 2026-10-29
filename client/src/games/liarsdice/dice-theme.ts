import type { CSSProperties } from 'react';
import { useEquippedDiceTheme } from '../../cosmetics/dice-styles/use-dice-style';

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
  /** Highlight layered over the die body (a CSS image), or `none`. */
  readonly sheen: string;
  /** Animated collections: a light that pulses over the cup. */
  readonly cupGlow: string | null;
  /**
   * Dice effects of a dice style: rolled dice land with a trail in `trail`, then a sheen and a halo on wild
   * ones; `loop` styles also run a slow sheen over the dice in hand. None by default.
   */
  readonly effects: { readonly trail: string; readonly loop: boolean } | null;
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
  sheen: 'none',
  cupGlow: null,
  effects: null,
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
    '--die-sheen': theme.sheen,
    ...theme.cupGlow ? { '--cup-glow': theme.cupGlow } : {},
    ...theme.effects ? { '--die-trail': theme.effects.trail } : {},
  } as CSSProperties;
}

/** The theme the viewer's equipped dice style selects; other players never see it. */
export function useDiceTheme(): DiceTheme {
  return useEquippedDiceTheme() ?? DEFAULT_DICE_THEME;
}
