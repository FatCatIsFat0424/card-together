// ─── Dice styles: die bodies, pips, and cups generated from the series theme tokens ───

import { DICE_STYLES } from '@shared/constants';
import type { DiceStyleId } from '@shared/types';
import type { DiceTheme } from '../../games/liarsdice/dice-theme';
import { ensureContrast, mix } from '../colour';
import { MATERIAL_GLOSS, SERIES_TOKENS } from '../series-tokens';
import type { SeriesTokens } from '../series-tokens';

/** Pips carry the whole value of a die. */
export const PIP_CONTRAST = 4.5;
/** The wild one stays readable while differing in colour from the other pips. */
export const PIP_ONE_CONTRAST = 3;

function diceDesign(tokens: SeriesTokens): DiceTheme {
  const body = tokens.diceBody ?? tokens.face;
  const dark = tokens.diceBody !== undefined;
  const gloss = MATERIAL_GLOSS[tokens.material];
  return {
    body,
    edge: mix(body, dark ? tokens.accent : tokens.base, 0.45),
    pip: ensureContrast(dark ? mix(tokens.face, '#ffffff', 0.4) : tokens.deep, body, PIP_CONTRAST + 0.5),
    pipOne: ensureContrast(dark ? tokens.accent : tokens.warm, body, PIP_ONE_CONTRAST + 0.3),
    match: dark ? '#ffd166' : '#e0a800',
    cupBody: mix(tokens.base, '#000000', 0.15),
    cupRim: tokens.accent,
    cupShade: mix(tokens.base, '#000000', 0.55),
    sheen: `linear-gradient(145deg, rgb(255 255 255 / ${Math.round(gloss * 60) / 100}), transparent 55%)`,
    cupGlow: tokens.motion?.glow ?? null,
    effects: { trail: tokens.motion?.glow ?? tokens.accent, loop: tokens.motion !== undefined },
  };
}

export const DICE_DESIGNS: Readonly<Record<DiceStyleId, DiceTheme>> = Object.fromEntries(
  DICE_STYLES.map((item) => [item.id, diceDesign(SERIES_TOKENS[item.design])]),
) as Record<DiceStyleId, DiceTheme>;

export function resolveDiceStyle(value: unknown): DiceStyleId | null {
  return typeof value === 'string' && Object.hasOwn(DICE_DESIGNS, value) ? value as DiceStyleId : null;
}
