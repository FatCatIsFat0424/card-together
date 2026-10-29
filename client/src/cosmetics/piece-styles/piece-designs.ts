// ─── Piece styles: palettes and finishes generated from the series theme tokens ───

import { PIECE_STYLES } from '@shared/constants';
import type { PieceStyleId } from '@shared/types';
import { DEFAULT_BOARD_THEME, FIXED_PIECE_COLOURS } from '../../games/board/board-theme';
import type { PieceFinish, PiecePalette } from '../../games/board/board-theme';
import { ensureContrast, mix, withLuminance } from '../colour';
import { MATERIAL_GLOSS, SERIES_FONTS, SERIES_TOKENS } from '../series-tokens';
import type { SeriesTokens } from '../series-tokens';

export interface PieceDesign {
  readonly palette: PiecePalette;
  readonly finish: PieceFinish;
  /** Shop thumbnail backdrop: a mid-dark ground that both stone shades stand out from, and the series glow on it. */
  readonly stage: { readonly ground: string; readonly glow: string };
}

/** Luminance range of the thumbnail ground, so the dark stone and the pale pieces both read against it. */
export const PIECE_STAGE_LUMINANCE = { min: 0.1, max: 0.2 } as const;

/** Lettering on engraved faces and solid bodies needs normal-text contrast (WCAG AA). */
export const PIECE_TEXT_CONTRAST = 4.5;
/** A face-down token against a revealed face, and its motif against its own back (WCAG non-text contrast). */
export const PIECE_BACK_CONTRAST = 3;
/** Luminance range of face-down backs: dark enough to read as a back on every light board. */
export const PIECE_BACK_LUMINANCE = { min: 0.03, max: 0.14 } as const;

const white = (opacity: number): string => `rgba(255, 255, 255, ${Math.round(opacity * 100) / 100})`;

function pieceDesign(tokens: SeriesTokens): PieceDesign {
  const fixed = DEFAULT_BOARD_THEME.pieces;
  const face = tokens.face;
  const onSolid = mix(face, '#ffffff', 0.6);
  const red = ensureContrast(tokens.warm, [face, onSolid], PIECE_TEXT_CONTRAST + 0.3);
  const black = ensureContrast(tokens.deep, face, 9);
  const blue = ensureContrast(tokens.cool, onSolid, PIECE_TEXT_CONTRAST + 0.3);
  const lightStone = mix(face, '#ffffff', 0.55);
  const gloss = MATERIAL_GLOSS[tokens.material];
  const back = ensureContrast(
    withLuminance(mix(tokens.base, tokens.deep, 0.45), PIECE_BACK_LUMINANCE.min, PIECE_BACK_LUMINANCE.max),
    face, PIECE_BACK_CONTRAST + 0.3,
  );
  const palette: PiecePalette = {
    face, red, black, blue, onSolid,
    accent: tokens.accent,
    font: SERIES_FONTS[tokens.font],
    darkStone: mix(tokens.deep, '#000000', 0.5),
    lightStone,
    lightStoneRim: ensureContrast(tokens.base, lightStone, 2.2),
    darkShine: white(0.08 + gloss * 0.3),
    lightShine: white(0.55 + gloss * 0.7),
    back,
    backPattern: ensureContrast(tokens.accent, back, PIECE_BACK_CONTRAST + 0.3),
    backRim: mix(tokens.accent, face, 0.4),
    // Hidden tiles keep their owner's side colour, so both players still see whose tile it is.
    backRed: red, backBlack: black, backBlue: blue,
    shadow: fixed.shadow, marbles: fixed.marbles,
  };
  const ground = withLuminance(mix(tokens.base, tokens.deep, 0.25), PIECE_STAGE_LUMINANCE.min, PIECE_STAGE_LUMINANCE.max);
  return {
    palette, finish: { rim: tokens.rim, gloss, material: tokens.material, back: tokens.back }, stage: { ground, glow: tokens.accent },
  };
}

export const PIECE_DESIGNS: Readonly<Record<PieceStyleId, PieceDesign>> = Object.fromEntries(
  PIECE_STYLES.map((item) => [item.id, pieceDesign(SERIES_TOKENS[item.design])]),
) as Record<PieceStyleId, PieceDesign>;

export function resolvePieceStyle(value: unknown): PieceStyleId | null {
  return typeof value === 'string' && Object.hasOwn(PIECE_DESIGNS, value) ? value as PieceStyleId : null;
}

/** The piece palette of a style; the shadow and the marbles always come from the default. */
export function piecePalette(style: PieceStyleId | null): PiecePalette {
  if (!style) return DEFAULT_BOARD_THEME.pieces;
  const palette = PIECE_DESIGNS[style].palette;
  return { ...palette, ...Object.fromEntries(FIXED_PIECE_COLOURS.map((key) => [key, DEFAULT_BOARD_THEME.pieces[key]])) };
}
