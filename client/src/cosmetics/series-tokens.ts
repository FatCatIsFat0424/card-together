// ─── Series theme tokens: the few values piece, board, and dice styles are generated from ───

import type { ShopSeries } from '@shared/types';

/** Surface finish; it sets the highlight strength of pieces and dice. */
export type SeriesMaterial = 'glass' | 'porcelain' | 'jade' | 'enamel' | 'ivory' | 'lacquer' | 'stone' | 'metal';

/** Edge treatment of round pieces. */
export type SeriesRim = 'plain' | 'double' | 'beaded' | 'notched';

/** Piece lettering; every family falls back to the bundled Noto fonts. */
export type SeriesFont = 'serif' | 'sans' | 'kai';

/** Motif on the back of face-down pieces (Banqi tokens, hidden Land Battle Chess tiles). */
export type SeriesBackMotif = 'ring' | 'wave' | 'petal' | 'star' | 'lattice' | 'diamond' | 'sun' | 'hex' | 'neon';

/** Ambient board motion of the animated collections, drawn under the pieces. */
export type SeriesMotion = 'drift' | 'flicker' | 'sweep' | 'pulse' | 'gleam';

/** Particle shape of the one-shot piece effects (capture bursts, dice trails). */
export type SeriesParticle = 'petal' | 'streak' | 'spark' | 'dot' | 'flake' | 'leaf' | 'ember' | 'bubble';

/** Selection aura: animated collections loop one while a piece is selected; the others ring once. */
export type SeriesAura = 'ring' | 'orbit' | 'flame' | 'radar' | 'neon' | 'halo';

/** One-shot effect parameters of a collection; colours come from `motion.glow` or `accent`. */
export interface SeriesEffect {
  readonly particle: SeriesParticle;
  /** Particles per capture burst (at most 10). */
  readonly count: number;
  /** Burst reach as a share of the effect box, about 0.5 to 0.75. */
  readonly spread: number;
  readonly aura: SeriesAura;
}

export interface SeriesTokens {
  readonly material: SeriesMaterial;
  readonly rim: SeriesRim;
  readonly font: SeriesFont;
  readonly back: SeriesBackMotif;
  /** Pale piece face and dice body. */
  readonly face: string;
  /** First side (Xiangqi red) and the single pip of a one. */
  readonly warm: string;
  /** Second side (Xiangqi black), grid lines, and pips. */
  readonly deep: string;
  /** Jungle's blue side and water. */
  readonly cool: string;
  /** Decorative highlight: rim beads, cup bands, board edges. */
  readonly accent: string;
  /** Mid tone: stone rims, cups, star boards. */
  readonly base: string;
  /** Light board material. */
  readonly board: string;
  /** Felt of cell boards (Reversi, Jungle). */
  readonly felt: string;
  /** A dark dice body for night-themed collections; pale dice otherwise. */
  readonly diceBody?: string;
  readonly motion?: { readonly kind: SeriesMotion; readonly glow: string };
  readonly effect: SeriesEffect;
}

export const SERIES_TOKENS: Readonly<Record<ShopSeries, SeriesTokens>> = {
  aurora: {
    material: 'glass', rim: 'double', font: 'sans', back: 'wave', face: '#eef7f5', warm: '#c2185b', deep: '#14384f', cool: '#3b4cc0',
    accent: '#58e7c2', base: '#1f6f7a', board: '#cfe9e4', felt: '#1f6f7a',
    effect: { particle: 'dot', count: 8, spread: 0.62, aura: 'ring' },
  },
  tide: {
    material: 'porcelain', rim: 'beaded', font: 'sans', back: 'wave', face: '#f2f8f8', warm: '#cc3a50', deep: '#0c3956', cool: '#1e6aa8',
    accent: '#69d7de', base: '#14566b', board: '#d7ebea', felt: '#1d6f80',
    effect: { particle: 'bubble', count: 7, spread: 0.6, aura: 'ring' },
  },
  sakura: {
    material: 'porcelain', rim: 'beaded', font: 'kai', back: 'petal', face: '#fbf0f2', warm: '#c0304f', deep: '#3e2240', cool: '#4c5fb3',
    accent: '#f5aec3', base: '#8d4d6c', board: '#f3d9df', felt: '#8d4d6c',
    effect: { particle: 'petal', count: 7, spread: 0.7, aura: 'ring' },
  },
  constellation: {
    material: 'enamel', rim: 'double', font: 'serif', back: 'star', face: '#f3efe2', warm: '#b8342a', deep: '#172648', cool: '#2f4d86',
    accent: '#ead5a2', base: '#2f4d86', board: '#d6dcec', felt: '#2f4d86', diceBody: '#172648',
    effect: { particle: 'spark', count: 8, spread: 0.66, aura: 'ring' },
  },
  bamboo: {
    material: 'jade', rim: 'plain', font: 'kai', back: 'lattice', face: '#e8f1e4', warm: '#b23a2a', deep: '#14382f', cool: '#2c5d8a',
    accent: '#8bc6a3', base: '#2f7358', board: '#dfe6c8', felt: '#2f7358',
    effect: { particle: 'leaf', count: 6, spread: 0.66, aura: 'ring' },
  },
  gilded: {
    material: 'ivory', rim: 'notched', font: 'serif', back: 'diamond', face: '#f8f0dc', warm: '#a8262e', deep: '#272232', cool: '#2b4a8a',
    accent: '#c9975b', base: '#49384d', board: '#e8d6ad', felt: '#5a4560',
    effect: { particle: 'spark', count: 8, spread: 0.6, aura: 'ring' },
  },
  ember: {
    material: 'lacquer', rim: 'plain', font: 'serif', back: 'sun', face: '#fbeee0', warm: '#b8321c', deep: '#3d1f26', cool: '#2d4f8f',
    accent: '#ec8256', base: '#a9482f', board: '#e9cdb0', felt: '#7a3424', diceBody: '#3d1f26',
    effect: { particle: 'ember', count: 9, spread: 0.64, aura: 'ring' },
  },
  lotus: {
    material: 'jade', rim: 'beaded', font: 'kai', back: 'petal', face: '#f3f1e6', warm: '#b9375e', deep: '#1f4148', cool: '#2f5f9a',
    accent: '#e5b3c3', base: '#3d7378', board: '#dce8df', felt: '#3d7378',
    effect: { particle: 'petal', count: 6, spread: 0.64, aura: 'ring' },
  },
  frost: {
    material: 'glass', rim: 'double', font: 'sans', back: 'hex', face: '#f2f8fb', warm: '#c22f45', deep: '#1c3850', cool: '#2a64a6',
    accent: '#99d4e1', base: '#3f7391', board: '#dcebf2', felt: '#3f7391',
    effect: { particle: 'flake', count: 8, spread: 0.62, aura: 'ring' },
  },
  dune: {
    material: 'stone', rim: 'notched', font: 'serif', back: 'diamond', face: '#f8ecd8', warm: '#ab3a24', deep: '#4b3a47', cool: '#2f5a87',
    accent: '#d7a378', base: '#b87d57', board: '#ecd3ad', felt: '#9a6544',
    effect: { particle: 'dot', count: 9, spread: 0.58, aura: 'ring' },
  },
  starfleet: {
    material: 'metal', rim: 'notched', font: 'sans', back: 'hex', face: '#e9f1f8', warm: '#c4302b', deep: '#0c2546', cool: '#1f5fbf',
    accent: '#78e6ff', base: '#174783', board: '#cfdbe8', felt: '#174783', diceBody: '#0c2546',
    motion: { kind: 'drift', glow: '#65dff5' },
    effect: { particle: 'streak', count: 8, spread: 0.68, aura: 'orbit' },
  },
  shrine: {
    material: 'lacquer', rim: 'beaded', font: 'kai', back: 'lattice', face: '#faf0de', warm: '#c03a22', deep: '#142f36', cool: '#1f6a8a',
    accent: '#f7ce77', base: '#236d64', board: '#ecdcbc', felt: '#236d64',
    motion: { kind: 'flicker', glow: '#ffb35c' },
    effect: { particle: 'ember', count: 8, spread: 0.62, aura: 'flame' },
  },
  ironfront: {
    material: 'metal', rim: 'notched', font: 'sans', back: 'diamond', face: '#ece8d4', warm: '#a8321f', deep: '#253626', cool: '#2f4f7a',
    accent: '#d6bc69', base: '#4d5e3c', board: '#d8d3b4', felt: '#4d5e3c',
    motion: { kind: 'sweep', glow: '#e8c16b' },
    effect: { particle: 'spark', count: 9, spread: 0.64, aura: 'radar' },
  },
  neoncity: {
    material: 'glass', rim: 'double', font: 'sans', back: 'neon', face: '#eef0fa', warm: '#c2187a', deep: '#141e39', cool: '#1f6fd1',
    accent: '#36d5e4', base: '#503067', board: '#d9d6ea', felt: '#3a2b5c', diceBody: '#141e39',
    motion: { kind: 'pulse', glow: '#ef68dd' },
    effect: { particle: 'spark', count: 10, spread: 0.7, aura: 'neon' },
  },
  crownrealm: {
    material: 'enamel', rim: 'notched', font: 'serif', back: 'star', face: '#fbf4e2', warm: '#b02a2a', deep: '#102c58', cool: '#204d8d',
    accent: '#f1cd73', base: '#b28a39', board: '#eadcb6', felt: '#204d8d',
    motion: { kind: 'gleam', glow: '#f6d87c' },
    effect: { particle: 'flake', count: 8, spread: 0.66, aura: 'halo' },
  },
};

/** Highlight opacity per material. */
export const MATERIAL_GLOSS: Readonly<Record<SeriesMaterial, number>> = {
  glass: 0.5, porcelain: 0.38, jade: 0.3, enamel: 0.34, ivory: 0.22, lacquer: 0.42, stone: 0.12, metal: 0.46,
};

export const SERIES_FONTS: Readonly<Record<SeriesFont, string>> = {
  serif: "'Noto Serif TC', 'Noto Sans TC', serif",
  sans: "'Noto Sans TC', 'Inter', sans-serif",
  kai: "'BiauKai', 'Kaiti TC', 'STKaiti', 'DFKai-SB', 'Noto Serif TC', serif",
};
