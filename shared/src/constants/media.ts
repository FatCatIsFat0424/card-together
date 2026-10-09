import type { MediaId } from '../types/account';

/** Content-addressed upload: sha256 hex digest plus image extension. */
export function isMediaId(value: unknown): value is MediaId {
  return typeof value === 'string' && /^[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(value);
}

/** Integer percent bounds for custom table background and card back image opacity. */
export const IMAGE_OPACITY_MIN = 20;
export const IMAGE_OPACITY_MAX = 100;

export function isImageOpacity(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= IMAGE_OPACITY_MIN &&
    Number(value) <= IMAGE_OPACITY_MAX;
}
