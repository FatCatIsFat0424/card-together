import type { CSSProperties } from 'react';
import type { AccountProfile } from '@shared/types';
import { IMAGE_OPACITY_MAX } from '@shared/constants';
import { mediaUrl } from './media';

/** Editable appearance settings; seat artwork is also shared with room players. */
export type AccountAppearance = Partial<Pick<
  AccountProfile, 'tableBackground' | 'tableBackgroundOpacity' | 'cardBack' | 'cardBackOpacity' | 'seatBackground'
>>;

function opacity(percent: number | undefined): string {
  return String((percent ?? IMAGE_OPACITY_MAX) / 100);
}

/** Variables for a seat artwork layer; undefined keeps the theme background. */
export function seatBackgroundStyle(
  appearance: Pick<AccountProfile, 'seatBackground'> | null | undefined,
): CSSProperties | undefined {
  if (!appearance?.seatBackground) return undefined;
  return { '--seat-image': `url("${mediaUrl(appearance.seatBackground)}")` } as CSSProperties;
}

/** Variables for a `customTable` surface; undefined keeps the theme surface. */
export function tableBackgroundStyle(
  appearance: AccountAppearance | null | undefined,
): CSSProperties | undefined {
  if (!appearance?.tableBackground) return undefined;
  return {
    '--table-image': `url("${mediaUrl(appearance.tableBackground)}")`,
    '--table-image-opacity': opacity(appearance.tableBackgroundOpacity),
  } as CSSProperties;
}

/** Overrides the theme card back for every descendant; undefined keeps the theme default. */
export function cardBackStyle(
  appearance: AccountAppearance | null | undefined,
): CSSProperties | undefined {
  if (!appearance?.cardBack) return undefined;
  return {
    // Plain card stock under the image so fading lightens it instead of exposing the theme pattern.
    '--card-back': 'var(--card-face)',
    '--card-back-image': `url("${mediaUrl(appearance.cardBack)}")`,
    '--card-back-size': 'cover',
    '--card-back-opacity': opacity(appearance.cardBackOpacity),
    // Keeps the card edge visible when the image is faded or matches the table.
    '--card-back-outline': '1px solid var(--card-border)',
  } as CSSProperties;
}
