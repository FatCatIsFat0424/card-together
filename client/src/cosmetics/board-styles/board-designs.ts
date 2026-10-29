// ─── Board styles: a palette for every board surface, generated from the series theme tokens ───

import { BOARD_STYLES } from '@shared/constants';
import type { BoardStyleId } from '@shared/types';
import { DEFAULT_BOARD_THEME } from '../../games/board/board-theme';
import type { BoardMotion, BoardPalette, BoardSurface } from '../../games/board/board-theme';
import { contrast, ensureContrast, luminance, mix, withLuminance } from '../colour';
import { SERIES_TOKENS } from '../series-tokens';
import type { SeriesTokens } from '../series-tokens';

export interface BoardDesign {
  readonly surfaces: Readonly<Record<BoardSurface, BoardPalette>>;
  /** Animated collections only. */
  readonly motion: BoardMotion | null;
}

/** Grid lines and roads against the material they are drawn on (WCAG non-text contrast). */
export const BOARD_LINE_CONTRAST = 3;
/** Cell gaps on felt boards, where the cell edge itself also separates squares. */
export const BOARD_GAP_CONTRAST = 1.8;
/** River text, mountain labels, and coordinates. */
export const BOARD_TEXT_CONTRAST = 4.5;
/** Edge stroke widths: full while the edge stays quiet, thinner as its contrast or its brightness grows. */
export const BOARD_EDGE_WIDTH = {
  max: 0.12, min: 0.04, softContrast: 2, loudContrast: 7, softLuminance: 0.3, loudLuminance: 0.7,
} as const;
/** Reversi felt stays mid-dark so both dark and light discs stand out from it. */
export const FELT_LUMINANCE = { min: 0.1, max: 0.24 } as const;

/** A bright accent or a high-contrast one draws a heavy line, so the stroke narrows with whichever is louder. */
export function edgeWidthFor(edge: string, surface: string): number {
  const { max, min, softContrast, loudContrast, softLuminance, loudLuminance } = BOARD_EDGE_WIDTH;
  const ramp = (value: number, soft: number, loud: number): number => Math.min(1, Math.max(0, (value - soft) / (loud - soft)));
  const loudness = Math.max(
    ramp(contrast(edge, surface), softContrast, loudContrast),
    ramp(luminance(edge), softLuminance, loudLuminance),
  );
  return Math.round((max - (max - min) * loudness) * 1000) / 1000;
}

function withEdgeWidth(palette: BoardPalette): BoardPalette {
  return { ...palette, edgeWidth: edgeWidthFor(palette.edge, palette.surface) };
}

function boardDesign(tokens: SeriesTokens): BoardDesign {
  const fixed = DEFAULT_BOARD_THEME.surfaces.wood;
  const light = tokens.board;
  const cell = mix(light, '#ffffff', 0.28);
  const ink = ensureContrast(mix(tokens.deep, tokens.base, 0.2), [light, cell], BOARD_TEXT_CONTRAST + 0.3);
  const water = mix(tokens.cool, '#4aa3e0', 0.45);
  const shared = {
    water,
    waterLine: mix(water, '#ffffff', 0.8),
    trap: mix(light, tokens.deep, 0.3),
    trapLine: ink,
    dens: [ensureContrast(tokens.warm, cell, 3), ensureContrast(tokens.cool, cell, 3)] as const,
    station: mix(light, '#ffffff', 0.45),
    camp: mix(tokens.accent, light, 0.45),
    campLine: ensureContrast(tokens.base, light, BOARD_LINE_CONTRAST),
    hqLine: ink,
    rail: mix(tokens.deep, '#000000', 0.2),
    railInner: mix(light, '#ffffff', 0.3),
    mountain: mix(tokens.base, light, 0.45),
    mountainLine: ink,
    hole: mix(light, tokens.deep, 0.32),
    holeRim: mix(tokens.deep, tokens.base, 0.3),
    homes: fixed.homes,
    edge: tokens.accent,
    edgeWidth: BOARD_EDGE_WIDTH.max,
  };
  const wood: BoardPalette = { ...shared, surface: light, line: ink, ink, cell };
  const feltCell = withLuminance(tokens.felt, FELT_LUMINANCE.min, FELT_LUMINANCE.max);
  const feltSurface = mix(feltCell, '#000000', 0.42);
  const green: BoardPalette = {
    ...shared, surface: feltSurface, line: mix(feltCell, '#000000', 0.62), cell: feltCell,
    ink: ensureContrast(mix(tokens.accent, '#ffffff', 0.5), feltSurface, BOARD_TEXT_CONTRAST + 0.3),
  };
  const meadowSurface = mix(withLuminance(tokens.felt, 0.06, 0.14), '#000000', 0.1);
  const meadow: BoardPalette = {
    ...shared, surface: meadowSurface, line: meadowSurface, cell: mix(light, tokens.felt, 0.12),
    ink: ensureContrast('#f1f5f9', meadowSurface, BOARD_TEXT_CONTRAST + 0.3),
  };
  const fieldSurface = mix(light, tokens.base, 0.12);
  const fieldInk = ensureContrast(ink, [fieldSurface, shared.station], BOARD_TEXT_CONTRAST + 0.3);
  const field: BoardPalette = { ...shared, surface: fieldSurface, line: fieldInk, ink: fieldInk, hqLine: fieldInk, cell };
  const starSurface = withLuminance(mix(tokens.base, tokens.deep, 0.35), 0.03, 0.09);
  const star: BoardPalette = {
    ...shared, surface: starSurface, line: mix(starSurface, '#000000', 0.2), cell: mix(light, tokens.base, 0.18),
    ink: ensureContrast(mix(tokens.accent, '#ffffff', 0.4), starSurface, BOARD_TEXT_CONTRAST + 0.3),
  };
  return {
    surfaces: {
      wood: withEdgeWidth(wood), green: withEdgeWidth(green), meadow: withEdgeWidth(meadow),
      field: withEdgeWidth(field), star: withEdgeWidth(star),
    },
    motion: tokens.motion ? { kind: tokens.motion.kind, glow: tokens.motion.glow } : null,
  };
}

export const BOARD_DESIGNS: Readonly<Record<BoardStyleId, BoardDesign>> = Object.fromEntries(
  BOARD_STYLES.map((item) => [item.id, boardDesign(SERIES_TOKENS[item.design])]),
) as Record<BoardStyleId, BoardDesign>;

export function resolveBoardStyle(value: unknown): BoardStyleId | null {
  return typeof value === 'string' && Object.hasOwn(BOARD_DESIGNS, value) ? value as BoardStyleId : null;
}
