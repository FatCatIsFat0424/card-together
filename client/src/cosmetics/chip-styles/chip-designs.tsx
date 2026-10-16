import type { ReactNode } from 'react';
import type { ChipStyleId } from '@shared/types';

/** Chips are drawn in a 64-unit box; the rim spans radius 24 to 31 and the face is radius 20.5. */
export const CHIP_CENTER = 32;
export const CHIP_RIM_RADIUS = 27.5;
export const CHIP_RIM_WIDTH = 7;
export const CHIP_FACE_RADIUS = 20.5;

interface ChipPalette {
  readonly rim: string;
  readonly spot: string;
  readonly ring: string;
  readonly face: string;
  readonly main: string;
  readonly detail: string;
}

export interface ChipDesign {
  readonly palette: ChipPalette;
  readonly spots: { readonly shape: 'bar' | 'dot'; readonly count: number; readonly size: number };
  readonly emblem: (palette: ChipPalette) => ReactNode;
}

const ROUND = { strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function rotations(count: number, offset = 0): readonly number[] {
  return Array.from({ length: count }, (_, index) => offset + (360 / count) * index);
}

const aurora: ChipDesign = {
  palette: { rim: '#1f6f7a', spot: '#58e7c2', ring: '#ab9cf2', face: '#12303f', main: '#58e7c2', detail: '#ab9cf2' },
  spots: { shape: 'bar', count: 8, size: 11 },
  emblem: ({ main, detail }) => <>
    <path d="M17.5 24.5C23 18.5 27.5 30 33 24.5S42 20 46.5 25" fill="none" stroke={detail} strokeWidth="3" opacity=".75" {...ROUND} />
    <path d="M16.5 32C22.5 25.5 27 38 33 32S42.5 27 47.5 32.5" fill="none" stroke={main} strokeWidth="3.6" {...ROUND} />
    <path d="M17.5 40C23 34 27.5 45.5 33 40S42 35.5 46.5 40.5" fill="none" stroke={detail} strokeWidth="3" opacity=".75" {...ROUND} />
    <circle cx="40" cy="18.5" r="1.3" fill={main} />
    <circle cx="25" cy="46" r="1.1" fill={detail} />
  </>,
};

const tide: ChipDesign = {
  palette: { rim: '#14566b', spot: '#cee9dd', ring: '#69d7de', face: '#0b3247', main: '#69d7de', detail: '#cee9dd' },
  spots: { shape: 'bar', count: 6, size: 16 },
  emblem: ({ main, detail }) => <>
    <g fill="none" strokeWidth="2.4" {...ROUND}>
      <path d="M20 35.5A12 12 0 0 1 44 35.5" stroke={main} />
      <path d="M24.5 35.5A7.5 7.5 0 0 1 39.5 35.5" stroke={detail} />
      <path d="M28.5 35.5A3.5 3.5 0 0 1 35.5 35.5" stroke={main} />
      <path d="M17.5 41.5q3.6-3.4 7.2 0t7.3 0 7.2 0 7.3 0" stroke={detail} strokeWidth="2.2" />
      <path d="M20 47q3-2.8 6 0t6 0 6 0 6 0" stroke={main} strokeWidth="2" opacity=".7" />
    </g>
    <circle cx="32" cy="20" r="2" fill={detail} opacity=".85" />
  </>,
};

const sakura: ChipDesign = {
  palette: { rim: '#8d4d6c', spot: '#f6ddcb', ring: '#f5aec3', face: '#4a2f4a', main: '#f5aec3', detail: '#f6ddcb' },
  spots: { shape: 'dot', count: 10, size: 2.2 },
  emblem: ({ main, detail }) => <>
    {rotations(5, 0).map((angle) => (
      <path key={angle} transform={`rotate(${angle} 32 32)`} fill={main}
        d="M32 31.5C26.5 27.5 25.2 20.5 28.4 15.2Q30.4 16 32 18.6Q33.6 16 35.6 15.2C38.8 20.5 37.5 27.5 32 31.5Z" />
    ))}
    <circle cx="32" cy="32" r="3.2" fill={detail} />
    {rotations(5, 36).map((angle) => (
      <circle key={angle} cx="32" cy="24.2" r=".9" fill="#8d4d6c" transform={`rotate(${angle} 32 32)`} />
    ))}
    <circle cx="44.5" cy="44" r="1.6" fill={main} opacity=".7" />
    <circle cx="19.5" cy="19.5" r="1.2" fill={detail} opacity=".7" />
  </>,
};

const constellation: ChipDesign = {
  palette: { rim: '#2f4d86', spot: '#ead5a2', ring: '#93b5eb', face: '#172648', main: '#ead5a2', detail: '#93b5eb' },
  spots: { shape: 'bar', count: 12, size: 6 },
  emblem: ({ main, detail }) => <>
    <path d="M19 41L26 22.5 44 19.5 46 40" fill="none" stroke={detail} strokeWidth="1" opacity=".7" strokeDasharray="2 2" />
    <path fill={main} d="M32 17.5L35 29 46.5 32 35 35 32 46.5 29 35 17.5 32 29 29Z" />
    <circle cx="19" cy="41" r="1.8" fill={detail} />
    <circle cx="26" cy="22.5" r="1.5" fill={detail} />
    <circle cx="44" cy="19.5" r="1.8" fill={detail} />
    <circle cx="46" cy="40" r="1.5" fill={detail} />
  </>,
};

const bamboo: ChipDesign = {
  palette: { rim: '#2f7358', spot: '#e7d8ac', ring: '#8bc6a3', face: '#14382f', main: '#8bc6a3', detail: '#e7d8ac' },
  spots: { shape: 'bar', count: 8, size: 10 },
  emblem: ({ main, detail }) => <>
    <g transform="rotate(-24 32 32)">
      <rect x="29" y="13" width="6" height="11.5" rx="2.4" fill={main} />
      <rect x="29" y="26.5" width="6" height="11" rx="2.4" fill={main} />
      <rect x="29" y="39.5" width="6" height="11.5" rx="2.4" fill={main} />
      <rect x="28" y="24" width="8" height="1.8" rx=".9" fill={detail} />
      <rect x="28" y="37" width="8" height="1.8" rx=".9" fill={detail} />
    </g>
    <path d="M36.5 31C41 26 46.5 26.5 48.5 29 44 32.5 40.5 33 36.5 31Z" fill={detail} />
    <path d="M27.5 40C23 40 19 37.5 17.5 34.5 22 33.5 25.5 35.5 27.5 40Z" fill={detail} opacity=".85" />
  </>,
};

const gilded: ChipDesign = {
  palette: { rim: '#c9975b', spot: '#49384d', ring: '#f2d79c', face: '#272232', main: '#f2d79c', detail: '#c9975b' },
  spots: { shape: 'bar', count: 16, size: 5 },
  emblem: ({ main, detail }) => <>
    <path d="M19.5 25L25.5 17.5H38.5L44.5 25 32 47Z" fill={detail} stroke={main} strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M19.5 25H44.5M25.5 17.5L29 25 32 17.5 35 25 38.5 17.5M29 25L32 47 35 25" fill="none" stroke={main} strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M25.5 17.5L29 25 32 17.5Z M32 17.5L35 25 38.5 17.5Z" fill={main} opacity=".55" />
  </>,
};

const ember: ChipDesign = {
  palette: { rim: '#a9482f', spot: '#ffd1a0', ring: '#ec8256', face: '#3d1f26', main: '#ec8256', detail: '#ffd1a0' },
  spots: { shape: 'bar', count: 6, size: 17 },
  emblem: ({ main, detail }) => <>
    <path fill={main} d="M32.5 14C34.5 21 43.5 25.5 43.5 36C43.5 43.5 38.5 48.5 32 48.5S20.5 43.5 20.5 36C20.5 31.5 22.5 28.5 25 25.5C25.5 29 27.5 30.5 29.5 30.5C28 24 29 18.5 32.5 14Z" />
    <path fill={detail} d="M32 47C27.5 47 25 43.5 25 39.5C25 36 27 34 29 31.5C29.5 34 31 35 32.5 35C32 32.5 33 30 34.5 28.5C36.5 32 39 34.5 39 39.5C39 43.5 36.5 47 32 47Z" />
    <path fill={main} opacity=".55" d="M32 46.5C30 46.5 28.8 45 28.8 43C28.8 41.3 30 40.3 31 39C31.5 40.3 33 40.8 34 42C35 44 34 46.5 32 46.5Z" />
  </>,
};

const lotus: ChipDesign = {
  palette: { rim: '#3d7378', spot: '#e9dbb3', ring: '#e5b3c3', face: '#1f4148', main: '#e5b3c3', detail: '#e9dbb3' },
  spots: { shape: 'dot', count: 8, size: 2.8 },
  emblem: ({ main, detail }) => <>
    <g transform="translate(0 4)">
      {[-62, 62].map((angle) => (
        <path key={angle} transform={`rotate(${angle} 32 42)`} fill={main} opacity=".75"
          d="M32 42C26.5 36 26.5 28 32 22.5C37.5 28 37.5 36 32 42Z" />
      ))}
      {[-31, 31].map((angle) => (
        <path key={angle} transform={`rotate(${angle} 32 42)`} fill={main} opacity=".95"
          d="M32 42C25.5 35 25.5 26 32 19.5C38.5 26 38.5 35 32 42Z" />
      ))}
      <path fill={detail} d="M32 42C26 34.5 26 25.5 32 17.5C38 25.5 38 34.5 32 42Z" />
      <path d="M32 40.5V25" stroke={main} strokeWidth="1" opacity=".6" fill="none" />
      <path d="M17 44.5q3.75-2.5 7.5 0t7.5 0 7.5 0 7.5 0" fill="none" stroke={detail} strokeWidth="1.8" opacity=".8" {...ROUND} />
    </g>
  </>,
};

const frost: ChipDesign = {
  palette: { rim: '#3f7391', spot: '#e4f4fa', ring: '#99d4e1', face: '#1c3850', main: '#e4f4fa', detail: '#99d4e1' },
  spots: { shape: 'bar', count: 12, size: 7 },
  emblem: ({ main, detail }) => <>
    <g fill="none" strokeWidth="2.3" {...ROUND}>
      {rotations(6).map((angle) => (
        <g key={angle} transform={`rotate(${angle} 32 32)`}>
          <path d="M32 32V15.5" stroke={main} />
          <path d="M32 21.5L28 17.5M32 21.5L36 17.5" stroke={main} strokeWidth="1.9" />
          <path d="M32 27L29.5 24.5M32 27L34.5 24.5" stroke={detail} strokeWidth="1.5" />
        </g>
      ))}
    </g>
    <circle cx="32" cy="32" r="2.6" fill={detail} />
  </>,
};

const dune: ChipDesign = {
  palette: { rim: '#b87d57', spot: '#f6dba3', ring: '#d7a378', face: '#4b3a47', main: '#d7a378', detail: '#f6dba3' },
  spots: { shape: 'bar', count: 8, size: 12 },
  emblem: ({ main, detail }) => <>
    <circle cx="32" cy="24.5" r="6.4" fill={detail} />
    <path fill="#94644f" d="M12.4 36C20 30 27 31 33 35S45 37 51.97 33A21 21 0 0 1 12.4 36Z" />
    <path fill={main} d="M13.7 40C21 35 28 38 33 42S45 44 50.7 39A21 21 0 0 1 13.7 40Z" />
    <path d="M13.7 40C21 35 28 38 33 42S45 44 50.7 39" fill="none" stroke={detail} strokeWidth="1.4" strokeLinecap="round" opacity=".9" />
  </>,
};

export const CHIP_DESIGNS: Readonly<Record<ChipStyleId, ChipDesign>> = {
  'chips-aurora': aurora,
  'chips-tide': tide,
  'chips-sakura': sakura,
  'chips-constellation': constellation,
  'chips-bamboo': bamboo,
  'chips-gilded': gilded,
  'chips-ember': ember,
  'chips-lotus': lotus,
  'chips-frost': frost,
  'chips-dune': dune,
};

/** Stored ids can outlive a catalog entry; unknown values fall back to the default chip. */
export function resolveChipStyle(value: unknown): ChipStyleId | null {
  return typeof value === 'string' && Object.hasOwn(CHIP_DESIGNS, value) ? value as ChipStyleId : null;
}
