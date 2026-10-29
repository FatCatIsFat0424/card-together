// ─── Board and piece colours: every drawn colour comes from here through CSS variables ───

import type { CSSProperties } from 'react';

/** Surface family of a board; each game picks one, and a board style supplies a palette for each. */
export type BoardSurface = 'wood' | 'green' | 'meadow' | 'field' | 'star';

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
}

export interface PiecePalette {
  /** Engraved token face (Xiangqi, Banqi) */
  readonly face: string;
  readonly red: string;
  readonly black: string;
  readonly blue: string;
  /** Text on solid tokens and tiles */
  readonly onSolid: string;
  /** Face-down Banqi tokens and hidden Land Battle Chess tiles; piece styles never change these */
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
  /** Highlight fills of stones and marbles */
  readonly darkShine: string;
  readonly lightShine: string;
  readonly marbleShine: string;
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

/** Shape details of a piece style that colours alone cannot express. */
export interface PieceFinish {
  readonly rim: PieceRim;
  /** Opacity of the highlight under the lettering of round tokens; 0 draws none. */
  readonly gloss: number;
}

export const DEFAULT_PIECE_FINISH: PieceFinish = { rim: 'plain', gloss: 0 };

export type BoardMotionKind = 'drift' | 'flicker' | 'sweep' | 'pulse' | 'gleam';

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
}

const STAR_COLOURS = ['#e53935', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#f5f5f5'] as const;

const WOOD: BoardPalette = {
  surface: '#dcb775', line: '#5b3a1a', ink: '#5b3a1a', cell: '#e4c48a', water: '#4aa3e0', waterLine: '#e0f2fe',
  trap: '#a98b5e', trapLine: '#5b3a1a', dens: ['#b91c1c', '#1d4ed8'], station: '#ecdfb4', camp: '#a9d4b0',
  campLine: '#4d7a58', hqLine: '#7a4a1f', rail: '#3f3a30', railInner: '#cdbd92', mountain: '#8d9378',
  mountainLine: '#5f6650', hole: '#9a7440', holeRim: '#6b4f2a', homes: STAR_COLOURS, edge: '#dcb775',
};

/** Matches the approved 2026-10-29 mockups. */
export const DEFAULT_BOARD_THEME: BoardTheme = {
  surfaces: {
    wood: WOOD,
    green: { ...WOOD, surface: '#14532d', line: '#175132', ink: '#bbf7d0', cell: '#2a7d4f', edge: '#14532d' },
    meadow: { ...WOOD, surface: '#4d6b3a', line: '#4d6b3a', ink: '#e2e8f0', cell: '#b9cf8e', edge: '#4d6b3a' },
    field: { ...WOOD, surface: '#cdbd92', line: '#7b6a49', ink: '#3f4636', edge: '#cdbd92' },
    star: { ...WOOD, surface: '#7a5a33', line: '#6b4f2a', ink: '#f8e7c4', cell: '#d8b26a', edge: '#7a5a33' },
  },
  pieces: {
    face: '#f7ebc8', red: '#c0392b', black: '#1f2937', blue: '#2563eb', onSolid: '#ffffff', back: '#1d4ed8',
    backPattern: 'rgba(255, 255, 255, 0.4)', backRim: '#ffffff', backRed: '#c0392b', backBlack: '#1f2937',
    backBlue: '#2563eb', accent: '#ffffff',
    font: "'Noto Serif TC', 'Noto Sans TC', serif", darkStone: '#151a24', lightStone: '#f4f6fa', lightStoneRim: '#9aa5b8',
    shadow: 'rgba(0, 0, 0, 0.3)', darkShine: 'rgba(255, 255, 255, 0.14)', lightShine: 'rgba(255, 255, 255, 0.9)',
    marbleShine: 'rgba(255, 255, 255, 0.55)', marbles: STAR_COLOURS,
  },
  markers: {
    last: '#2563eb', lastDot: '#ef4444', selected: '#fbbf24', target: '#16a34a', capture: '#ea580c', check: '#dc2626',
  },
};

const kebab = (name: string): string => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/** Piece colours that hide information; every piece style keeps them, so face-down pieces look alike to everyone. */
export const FIXED_PIECE_COLOURS = [
  'back', 'backPattern', 'backRim', 'backRed', 'backBlack', 'backBlue', 'shadow', 'marbles',
] as const;

/** CSS custom properties for one surface of a theme; the board view and pieces read only these. */
export function boardThemeStyle(theme: BoardTheme, surface: BoardSurface): CSSProperties {
  const palette = theme.surfaces[surface];
  const entries: [string, string][] = [];
  for (const [name, value] of Object.entries(palette)) {
    if (typeof value === 'string') entries.push([`--board-${kebab(name)}`, value]);
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
