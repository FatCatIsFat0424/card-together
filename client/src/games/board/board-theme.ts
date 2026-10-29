// ─── Board and piece colours: every drawn colour comes from here through CSS variables ───

import type { CSSProperties } from 'react';

/** Surface family of a board; each game picks one, and a board style supplies a palette for each. */
export type BoardSurface = 'wood' | 'green' | 'meadow' | 'field' | 'star' | 'go';

/** Static texture tile laid over light board materials; `none` draws nothing. */
export type BoardPattern = 'none' | 'grain' | 'speckle' | 'brushed' | 'crackle';

export interface BoardPalette {
  /** Outer board and margin. */
  readonly surface: string;
  /** Grid lines, cell gaps, and roads. */
  readonly line: string;
  /** Coordinates and board text. */
  readonly ink: string;
  readonly cell: string;
  readonly water: string;
  readonly waterLine: string;
  readonly trap: string;
  readonly trapLine: string;
  /** Den fill of side 0 and side 1. */
  readonly dens: readonly [string, string];
  readonly station: string;
  readonly camp: string;
  readonly campLine: string;
  readonly hqLine: string;
  readonly rail: string;
  readonly railInner: string;
  readonly mountain: string;
  readonly mountainLine: string;
  readonly hole: string;
  readonly holeRim: string;
  /** Rim colours of the six star corners, in `STAR_CORNERS` order. */
  readonly homes: readonly string[];
  /** Outer edge of the board. */
  readonly edge: string;
  /** Stroke width of the outer edge in board units. */
  readonly edgeWidth: number;
  /** Xiangqi palace diagonals. */
  readonly palace: string;
  /** Band between the two halves of a river board (Xiangqi). */
  readonly river: string;
  /** Board text such as the river inscription. */
  readonly font: string;
  /** Texture tile and its colour. */
  readonly pattern: BoardPattern;
  readonly grain: string;
}

export interface PiecePalette {
  /** Engraved token face (Xiangqi, Banqi) */
  readonly face: string;
  readonly red: string;
  readonly black: string;
  readonly blue: string;
  /** Text on solid tokens and tiles */
  readonly onSolid: string;
  /**
   * Face-down Banqi tokens and hidden Land Battle Chess tiles in the viewer's own piece style. The server never
   * sends hidden identities, so every face-down piece in one view is drawn alike.
   */
  readonly back: string;
  readonly backPattern: string;
  readonly backRim: string;
  /** Side tints of hidden Land Battle Chess tiles, so their owner stays visible */
  readonly backRed: string;
  readonly backBlack: string;
  readonly backBlue: string;
  /** Rim beads and notches of styled pieces */
  readonly accent: string;
  /** Piece lettering */
  readonly font: string;
  readonly darkStone: string;
  readonly lightStone: string;
  readonly lightStoneRim: string;
  readonly shadow: string;
  /** Highlight fills of stones; marbles take theirs from the finish's material (`marble-finish.ts`) */
  readonly darkShine: string;
  readonly lightShine: string;
  /** Marble colours of the six star corners, in `STAR_CORNERS` order. */
  readonly marbles: readonly string[];
}

export interface MarkerPalette {
  readonly last: string;
  readonly lastDot: string;
  readonly selected: string;
  readonly target: string;
  readonly capture: string;
  readonly check: string;
}

/** Edge treatment of round pieces: an extra inner ring, or beads or notches on the rim. */
export type PieceRim = 'plain' | 'double' | 'beaded' | 'notched';

/** Motif on the back of face-down pieces; `ring` is the default look. */
export type PieceBackMotif = 'ring' | 'wave' | 'petal' | 'star' | 'lattice' | 'diamond' | 'sun' | 'hex' | 'neon';

/** Shape details of a piece style that colours alone cannot express. */
export interface PieceFinish {
  readonly rim: PieceRim;
  /** Opacity of the highlight under the lettering of round tokens; 0 draws none. */
  readonly gloss: number;
  /** Surface of Chinese checkers marbles; glass when unset. Their hue always stays the corner colour. */
  readonly material?: MarbleMaterial;
  readonly back: PieceBackMotif;
}

/** Marble surfaces a piece style can give Chinese checkers marbles: highlight shape, texture, and sheen. */
export type MarbleMaterial = 'glass' | 'porcelain' | 'jade' | 'enamel' | 'ivory' | 'lacquer' | 'stone' | 'metal';

export const DEFAULT_PIECE_FINISH: PieceFinish = { rim: 'plain', gloss: 0, back: 'ring' };

export type BoardMotionKind = 'drift' | 'flicker' | 'sweep' | 'pulse' | 'gleam';

export type EffectParticle = 'petal' | 'streak' | 'spark' | 'dot' | 'flake' | 'leaf' | 'ember' | 'bubble';
export type EffectAura = 'ring' | 'orbit' | 'flame' | 'radar' | 'neon' | 'halo';

/**
 * Piece effects of a piece style, drawn in an HTML layer over the board: a selection aura, a ripple where a
 * piece lands, a burst on captures, and flips. `loop` styles keep their aura moving while a piece is selected;
 * the others play it once.
 */
export interface PieceEffects {
  readonly colour: string;
  readonly colour2: string;
  readonly particle: EffectParticle;
  readonly count: number;
  readonly spread: number;
  readonly aura: EffectAura;
  readonly loop: boolean;
}

/** Ambient light of animated board styles, composited between the board surface and the pieces. */
export interface BoardMotion {
  readonly kind: BoardMotionKind;
  readonly glow: string;
}

/**
 * A complete look for every board game. P4 board and piece styles provide alternatives; markers stay
 * fixed so legality hints read the same under every style.
 */
export interface BoardTheme {
  readonly surfaces: Readonly<Record<BoardSurface, BoardPalette>>;
  readonly pieces: PiecePalette;
  readonly markers: MarkerPalette;
  readonly finish?: PieceFinish;
  readonly motion?: BoardMotion | null;
  /** Piece effects; none without a piece style. */
  readonly effects?: PieceEffects | null;
}

const STAR_COLOURS = ['#e53935', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#f5f5f5'] as const;

const WOOD: BoardPalette = {
  surface: '#dcb775', line: '#5b3a1a', ink: '#5b3a1a', cell: '#e4c48a', water: '#4aa3e0', waterLine: '#e0f2fe',
  trap: '#a98b5e', trapLine: '#5b3a1a', dens: ['#b91c1c', '#1d4ed8'], station: '#ecdfb4', camp: '#a9d4b0',
  campLine: '#4d7a58', hqLine: '#7a4a1f', rail: '#3f3a30', railInner: '#cdbd92', mountain: '#8d9378',
  mountainLine: '#5f6650', hole: '#9a7440', holeRim: '#6b4f2a', homes: STAR_COLOURS, edge: '#dcb775', edgeWidth: 0.12,
  palace: '#5b3a1a', river: '#dcb775', font: "'Noto Serif TC', 'Noto Sans TC', serif", pattern: 'none', grain: '#dcb775',
};

/** Kaya (榧木) go board: warm yellow wood with a fine grain and dark ink lines. */
export const GO_KAYA = { surface: '#e4bd76', line: '#3b2a16', edge: '#b88a47', grain: '#cf9f55' } as const;

/** Matches the approved 2026-10-29 mockups. */
export const DEFAULT_BOARD_THEME: BoardTheme = {
  surfaces: {
    wood: WOOD,
    green: { ...WOOD, surface: '#14532d', line: '#175132', ink: '#bbf7d0', cell: '#2a7d4f', edge: '#14532d' },
    meadow: { ...WOOD, surface: '#4d6b3a', line: '#4d6b3a', ink: '#e2e8f0', cell: '#b9cf8e', edge: '#4d6b3a' },
    field: { ...WOOD, surface: '#cdbd92', line: '#7b6a49', ink: '#3f4636', edge: '#cdbd92' },
    // The star board reads its fields as materials (StarBoard.tsx): cell is the wood face, line its grain,
    // surface the dark outer edge, edge the inlay, hole the upper well, and holeRim the dark hole bottom.
    star: {
      ...WOOD, surface: '#4a2d14', line: '#7a4f22', ink: '#f8e7c4', cell: '#d4a869', edge: '#e9c77d', hole: '#8c6234',
      holeRim: '#35210f',
    },
    go: {
      ...WOOD, surface: GO_KAYA.surface, line: GO_KAYA.line, ink: GO_KAYA.line, cell: GO_KAYA.surface, edge: GO_KAYA.edge,
      pattern: 'grain', grain: GO_KAYA.grain,
    },
  },
  pieces: {
    face: '#f7ebc8', red: '#c0392b', black: '#1f2937', blue: '#2563eb', onSolid: '#ffffff', back: '#1d4ed8',
    backPattern: 'rgba(255, 255, 255, 0.4)', backRim: '#ffffff', backRed: '#c0392b', backBlack: '#1f2937',
    backBlue: '#2563eb', accent: '#ffffff',
    font: "'Noto Serif TC', 'Noto Sans TC', serif", darkStone: '#151a24', lightStone: '#f4f6fa', lightStoneRim: '#9aa5b8',
    shadow: 'rgba(0, 0, 0, 0.3)', darkShine: 'rgba(255, 255, 255, 0.14)', lightShine: 'rgba(255, 255, 255, 0.9)',
    marbles: STAR_COLOURS,
  },
  markers: {
    last: '#2563eb', lastDot: '#ef4444', selected: '#fbbf24', target: '#16a34a', capture: '#ea580c', check: '#dc2626',
  },
};

const kebab = (name: string): string => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/**
 * Piece colours every piece style keeps: the drop shadow, and the marble hues that name the corner they belong
 * to. Styles still change a marble's finish (`PieceFinish`): material, gloss, and rim.
 */
export const FIXED_PIECE_COLOURS = ['shadow', 'marbles'] as const;

/** CSS custom properties for one surface of a theme; the board view and pieces read only these. */
export function boardThemeStyle(theme: BoardTheme, surface: BoardSurface): CSSProperties {
  const palette = theme.surfaces[surface];
  const entries: [string, string][] = [];
  for (const [name, value] of Object.entries(palette)) {
    if (typeof value === 'string') entries.push([`--board-${kebab(name)}`, value]);
    else if (typeof value === 'number') entries.push([`--board-${kebab(name)}`, String(value)]);
  }
  palette.dens.forEach((value, side) => entries.push([`--board-den-${side}`, value]));
  palette.homes.forEach((value, side) => entries.push([`--board-home-${side}`, value]));
  for (const [name, value] of Object.entries(theme.pieces)) {
    if (typeof value === 'string') entries.push([`--piece-${kebab(name)}`, value]);
  }
  theme.pieces.marbles.forEach((value, side) => entries.push([`--piece-marble-${side}`, value]));
  for (const [name, value] of Object.entries(theme.markers)) entries.push([`--marker-${kebab(name)}`, value]);
  return Object.fromEntries(entries) as CSSProperties;
}
