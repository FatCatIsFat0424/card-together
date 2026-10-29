// ─── Piece styles: palettes and finishes generated from the series theme tokens ───

import { PIECE_STYLES } from '@shared/constants';
import type { PieceStyleId } from '@shared/types';
import { DEFAULT_BOARD_THEME, FIXED_PIECE_COLOURS } from '../../games/board/board-theme';
import type { PieceFinish, PiecePalette } from '../../games/board/board-theme';
import { ensureContrast, mix } from '../colour';
import { MATERIAL_GLOSS, SERIES_FONTS, SERIES_TOKENS } from '../series-tokens';
import type { SeriesTokens } from '../series-tokens';

export interface PieceDesign {
  readonly palette: PiecePalette;
  readonly finish: PieceFinish;
}

/** Lettering on engraved faces and solid bodies needs normal-text contrast (WCAG AA). */
export const PIECE_TEXT_CONTRAST = 4.5;

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
  const palette: PiecePalette = {
    face, red, black, blue, onSolid,
    accent: tokens.accent,
    font: SERIES_FONTS[tokens.font],
    darkStone: mix(tokens.deep, '#000000', 0.5),
    lightStone,
    lightStoneRim: ensureContrast(tokens.base, lightStone, 2.2),
    darkShine: white(0.08 + gloss * 0.3),
    lightShine: white(0.55 + gloss * 0.7),
    marbleShine: white(0.3 + gloss * 0.8),
    back: fixed.back, backPattern: fixed.backPattern, backRim: fixed.backRim, backRed: fixed.backRed, backBlack: fixed.backBlack,
    backBlue: fixed.backBlue, shadow: fixed.shadow, marbles: fixed.marbles,
  };
  return { palette, finish: { rim: tokens.rim, gloss } };
}

export const PIECE_DESIGNS: Readonly<Record<PieceStyleId, PieceDesign>> = Object.fromEntries(
  PIECE_STYLES.map((item) => [item.id, pieceDesign(SERIES_TOKENS[item.design])]),
) as Record<PieceStyleId, PieceDesign>;

export function resolvePieceStyle(value: unknown): PieceStyleId | null {
  return typeof value === 'string' && Object.hasOwn(PIECE_DESIGNS, value) ? value as PieceStyleId : null;
}

/** The piece palette of a style; colours that hide information always come from the default. */
export function piecePalette(style: PieceStyleId | null): PiecePalette {
  if (!style) return DEFAULT_BOARD_THEME.pieces;
  const palette = PIECE_DESIGNS[style].palette;
  return { ...palette, ...Object.fromEntries(FIXED_PIECE_COLOURS.map((key) => [key, DEFAULT_BOARD_THEME.pieces[key]])) };
}
