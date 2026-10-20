import { CAMPAIGN_SEAT_MOTIFS } from './campaign-motifs';
import { SEAT_FRAMES } from '@shared/constants';

export type SeatFrameDesign = typeof SEAT_FRAMES[number]['design'];

/** Stroke or fill role; each design maps the roles to its own palette in CSS. */
export type MotifKind = 'line1' | 'line2' | 'fill1' | 'fill2' | 'fill3';

export interface MotifPart {
  readonly d: string;
  readonly kind: MotifKind;
  readonly transform?: string;
  /** Centre in the 24x24 box for parts that scale on turn. */
  readonly origin?: readonly [number, number];
}

/** Corner parts that animate on turn; each is drawn as its own image so it can move without repainting. */
export type MotifMotion = 'pulse' | 'glow' | 'twinkle' | 'twinkleLate' | 'ripple1' | 'ripple2' | 'ripple3' | 'sun';

/**
 * Corner ornament drawn in a 24x24 box with the frame ring's corner at about (13, 13), so the
 * top-left drawing is mirrored to the other corners. `alt` replaces the mirrored copy on the
 * top-right and bottom-left corners when a design wants a second motif.
 */
export interface SeatFrameMotif {
  readonly main: readonly MotifPart[];
  readonly alt?: readonly MotifPart[];
}

/** The design behind an equipped frame id, or null for no frame or an unknown id. */
export function seatFrameDesign(id: string | null | undefined): SeatFrameDesign | null {
  return SEAT_FRAMES.find((item) => item.id === id)?.design ?? null;
}

function dot(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
}

/** A dot that keeps its centre, for parts that scale around it. */
function dotPart(cx: number, cy: number, r: number, kind: MotifKind): MotifPart {
  return { d: dot(cx, cy, r), kind, origin: [cx, cy] };
}

/** How a corner part animates while its seat is on turn, or null when it stays still. */
export function motifMotion(design: SeatFrameDesign, part: MotifPart, index: number): MotifMotion | null {
  switch (design) {
    case 'starfleet': return part.kind === 'line2' ? 'pulse' : null;
    case 'neoncity': return part.kind === 'fill3' ? 'pulse' : null;
    case 'shrine': return part.kind === 'fill3' ? 'glow' : null;
    case 'constellation':
      return part.kind === 'fill2' ? 'twinkleLate' : part.kind === 'fill1' || part.kind === 'fill3' ? 'twinkle' : null;
    case 'dune': return (['ripple1', 'ripple2', 'ripple3', 'sun'] as const)[index] ?? null;
    default: return null;
  }
}

const PETAL = 'M0 0C-3.6-2-4.6-6.4-1.5-8.8L0-7.4L1.5-8.8C4.6-6.4 3.6-2 0 0Z';
const LOTUS_PETAL = 'M0 0C-3.4-2.6-3.8-8 0-11.5C3.8-8 3.4-2.6 0 0Z';
const FLAME = 'M0 0C-5-1-6.5-6-3.5-9C-3-7-2-6.5-1.5-6.5C-2.5-10-0.5-12.5 1-14.5C1.5-11 6-8 5.5-4C5-1.5 2.5 0 0 0Z';
const FLAME_CORE = 'M0 0C-2.4-0.6-3.2-3.4-1.6-5.2C-1.2-4-0.6-3.6-0.4-3.8C-0.9-6 0.1-7.6 0.8-8.6C1.2-6.6 3.4-5.2 3.1-2.8C2.8-1 1.4 0 0 0Z';
const BLOSSOM = [0, 72, 144, 216, 288].map((angle): MotifPart => ({
  d: PETAL, kind: 'fill1', transform: `translate(11 11) rotate(${angle})`,
}));

export const SEAT_FRAME_MOTIFS: Record<SeatFrameDesign, SeatFrameMotif> = {
  ...CAMPAIGN_SEAT_MOTIFS,
  // Four ribbons leaving the outer corner, like curtains of light.
  aurora: {
    main: [
      { d: 'M3 3C10 3.5 15 8 22 9.5', kind: 'line1' },
      { d: 'M3 3C3.5 10 8 15 9.5 22', kind: 'line1' },
      { d: 'M6 6C11 6.5 14 9 18 13', kind: 'line2' },
      { d: 'M6 6C6.5 11 9 14 13 18', kind: 'line2' },
      { d: dot(3, 3, 1.8), kind: 'fill3' },
      { d: dot(22, 9.5, 1.1), kind: 'fill1' },
      { d: dot(9.5, 22, 1.1), kind: 'fill1' },
      { d: dot(18, 13, 0.9), kind: 'fill2' },
      { d: dot(13, 18, 0.9), kind: 'fill2' },
    ],
  },
  // Two wave crests curling around the corner, with foam beads.
  tide: {
    main: [
      { d: 'M2.5 15C2.5 8 7 3 14 3C19 3 21 7.5 18 9.5C15.5 11 12.5 8.5 14.5 6.5', kind: 'line1' },
      { d: 'M15 2.5C8 2.5 3 7 3 14C3 19 7.5 21 9.5 18C11 15.5 8.5 12.5 6.5 14.5', kind: 'line2' },
      { d: dot(21, 11.5, 1), kind: 'fill3' },
      { d: dot(11.5, 21, 1), kind: 'fill3' },
      { d: dot(14.5, 6.5, 1.2), kind: 'fill1' },
      { d: dot(6.5, 14.5, 1.2), kind: 'fill2' },
    ],
  },
  // A five-petal blossom on two corners and a bud with a drifting petal on the others.
  sakura: {
    main: [
      ...BLOSSOM,
      { d: dot(11, 11, 1.7), kind: 'fill3' },
    ],
    alt: [
      { d: PETAL, kind: 'fill1', transform: 'translate(12 12) rotate(-25) scale(0.8)' },
      { d: PETAL, kind: 'fill1', transform: 'translate(12 12) rotate(30) scale(0.8)' },
      { d: dot(12, 12, 1.3), kind: 'fill3' },
      { d: PETAL, kind: 'fill2', transform: 'translate(19 6) rotate(40) scale(0.55)' },
      { d: PETAL, kind: 'fill2', transform: 'translate(6 19) rotate(-130) scale(0.55)' },
    ],
  },
  // A four-point star joined to fainter stars by hairline lines.
  constellation: {
    main: [
      { d: 'M15 9L21 11', kind: 'line2' },
      { d: 'M9 15L11 21', kind: 'line2' },
      { d: 'M9 3L10.2 7.8L15 9L10.2 10.2L9 15L7.8 10.2L3 9L7.8 7.8Z', kind: 'fill1', origin: [9, 9] },
      dotPart(21, 11, 1.4, 'fill2'),
      dotPart(11, 21, 1.4, 'fill2'),
      dotPart(17.5, 4.5, 0.9, 'fill3'),
      dotPart(4.5, 17.5, 0.9, 'fill3'),
      dotPart(21.5, 17, 0.7, 'fill3'),
      dotPart(17, 21.5, 0.7, 'fill3'),
    ],
  },
  // Two leaves growing along the edges from a bamboo node.
  bamboo: {
    main: [
      { d: 'M3 3C10 2.5 17 6 20.5 13C13 13.5 6 10 3 3Z', kind: 'fill1' },
      { d: 'M3 3C2.5 10 6 17 13 20.5C13.5 13 10 6 3 3Z', kind: 'fill1' },
      { d: 'M7 7C10 8 13 11 14.5 14.5C11 13 8 10 7 7Z', kind: 'fill2' },
      { d: 'M3.5 3.5C9 6 14 9 19 12.5', kind: 'line2' },
      { d: 'M3.5 3.5C6 9 9 14 12.5 19', kind: 'line2' },
      { d: dot(3.5, 3.5, 1.8), kind: 'fill3' },
    ],
  },
  // Art Deco fan with a jewel set on the frame's corner.
  gilded: {
    main: [
      { d: 'M13 3A10 10 0 0 0 3 13', kind: 'line1' },
      { d: 'M13 8A5 5 0 0 0 8 13', kind: 'line2' },
      { d: 'M13 13L9.2 3.8M13 13L5.9 5.9M13 13L3.8 9.2', kind: 'line2' },
      { d: 'M13 9.5L16.5 13L13 16.5L9.5 13Z', kind: 'fill1' },
      { d: 'M13 11.2L14.8 13L13 14.8L11.2 13Z', kind: 'fill3' },
    ],
  },
  // A flame burning on the corner between two obsidian shards.
  ember: {
    main: [
      { d: 'M15 7L22 9.5L15 12Z', kind: 'fill2' },
      { d: 'M15 7L22 9.5L15 12Z', kind: 'line1' },
      { d: 'M7 15L9.5 22L12 15Z', kind: 'fill2' },
      { d: 'M7 15L9.5 22L12 15Z', kind: 'line1' },
      { d: FLAME, kind: 'fill1', transform: 'translate(13.5 13.5) rotate(-45) scale(0.95)' },
      { d: FLAME_CORE, kind: 'fill3', transform: 'translate(13.5 13.5) rotate(-45) scale(0.95)' },
      { d: dot(19, 3.5, 0.8), kind: 'fill3' },
      { d: dot(3.5, 19, 0.8), kind: 'fill3' },
    ],
  },
  // A lotus bud opening from the corner, with ripples and pearls.
  lotus: {
    main: [
      { d: LOTUS_PETAL, kind: 'fill1', transform: 'translate(13 13) rotate(-82) scale(1.05)' },
      { d: LOTUS_PETAL, kind: 'fill1', transform: 'translate(13 13) rotate(-8) scale(1.05)' },
      { d: LOTUS_PETAL, kind: 'fill3', transform: 'translate(13 13) rotate(-45) scale(1.25)' },
      { d: 'M16 21Q19 20 21 17', kind: 'line2' },
      { d: 'M13.5 22.5Q18.5 22 22.5 17.5', kind: 'line2' },
      { d: dot(20, 7, 0.9), kind: 'fill2' },
      { d: dot(7, 20, 0.9), kind: 'fill2' },
    ],
  },
  // A snowflake arm and ice shards.
  frost: {
    main: [
      { d: 'M13 13L3.5 3.5M9.5 9.5V5.5M9.5 9.5H5.5M6.2 6.2V3.2M6.2 6.2H3.2', kind: 'line1' },
      { d: 'M15 6.5L18 4L21 6.5L18 9Z', kind: 'fill1' },
      { d: 'M6.5 15L4 18L6.5 21L9 18Z', kind: 'fill1' },
      { d: 'M18 12L19.8 10.5L21.5 12L19.8 13.5Z', kind: 'fill2' },
      { d: 'M12 18L10.5 19.8L12 21.5L13.5 19.8Z', kind: 'fill2' },
      { d: dot(13, 13, 1.6), kind: 'fill3' },
      { d: dot(3.5, 3.5, 1.1), kind: 'fill3' },
    ],
  },
  // A rising sun with sand ripples spreading from the corner.
  dune: {
    main: [
      { d: 'M8 13A5 5 0 0 1 13 8', kind: 'line1' },
      { d: 'M5 13A8 8 0 0 1 13 5', kind: 'line2' },
      { d: 'M2.5 13A10.5 10.5 0 0 1 13 2.5', kind: 'line1' },
      dotPart(13, 13, 3, 'fill3'),
      { d: dot(19, 6, 0.8), kind: 'fill2' },
      { d: dot(6, 19, 0.8), kind: 'fill2' },
      { d: dot(21, 10, 0.7), kind: 'fill2' },
      { d: dot(10, 21, 0.7), kind: 'fill2' },
    ],
  },
};
