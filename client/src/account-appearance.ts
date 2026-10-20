import type { CSSProperties } from 'react';
import type { AccountProfile } from '@shared/types';
import { IMAGE_OPACITY_MAX } from '@shared/constants';
import { mediaUrl } from './media';
import { shopArtworkUrl } from './shop-art';

/** Editable appearance settings; seat artwork is also shared with room players. */
export type AccountAppearance = Partial<Pick<
  AccountProfile, 'tableBackground' | 'tableBackgroundOpacity' | 'cardBack' | 'cardBackOpacity' | 'seatBackground'
  | 'cardBackStyle' | 'tableBackgroundStyle' | 'seatBackgroundStyle'
>>;

function opacity(percent: number | undefined): string {
  return String((percent ?? IMAGE_OPACITY_MAX) / 100);
}

/** Variables for a seat artwork layer; undefined keeps the theme background. */
export function seatBackgroundStyle(
  appearance: Partial<Pick<AccountProfile, 'seatBackground' | 'seatBackgroundStyle'>> | null | undefined,
  reducedMotion = false,
): CSSProperties | undefined {
  const image = appearance?.seatBackgroundStyle ? shopArtworkUrl(appearance.seatBackgroundStyle, reducedMotion)
    : appearance?.seatBackground ? mediaUrl(appearance.seatBackground) : undefined;
  if (!image) return undefined;
  return { '--seat-image': `url("${image}")` } as CSSProperties;
}

/**
 * Variables for a `customTable` surface; undefined keeps the theme surface. `layered` leaves the CSS
 * image empty because `TableArt` draws the artwork.
 */
export function tableBackgroundStyle(
  appearance: AccountAppearance | null | undefined,
  reducedMotion = false,
  layered = false,
): CSSProperties | undefined {
  const image = appearance?.tableBackgroundStyle ? shopArtworkUrl(appearance.tableBackgroundStyle, reducedMotion)
    : appearance?.tableBackground ? mediaUrl(appearance.tableBackground) : undefined;
  if (!image) return undefined;
  return {
    '--table-image': layered ? 'none' : `url("${image}")`,
    '--table-image-opacity': opacity(appearance?.tableBackgroundOpacity),
  } as CSSProperties;
}

/**
 * Overrides the theme card back for every descendant; undefined keeps the theme default. `layered`
 * leaves the CSS image empty because each card back renders `CardBackArt`.
 */
export function cardBackStyle(
  appearance: AccountAppearance | null | undefined,
  reducedMotion = false,
  layered = false,
): CSSProperties | undefined {
  const image = appearance?.cardBackStyle ? shopArtworkUrl(appearance.cardBackStyle, reducedMotion)
    : appearance?.cardBack ? mediaUrl(appearance.cardBack) : undefined;
  if (!image) return undefined;
  return {
    // Plain card stock under the image so fading lightens it instead of exposing the theme pattern.
    '--card-back': 'var(--card-face)',
    '--card-back-image': layered ? 'none' : `url("${image}")`,
    '--card-back-size': 'cover',
    '--card-back-opacity': opacity(appearance?.cardBackOpacity),
    // Keeps the card edge visible when the image is faded or matches the table.
    '--card-back-outline': '1px solid var(--card-border)',
  } as CSSProperties;
}
