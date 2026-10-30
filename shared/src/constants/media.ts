import type { MediaId } from '../types/account';
// The emoji importer runs emoji.ts under plain Node, so that module cannot import this one.
import { EMOJI_MAX_BYTES } from './emoji';

/** What an uploaded image is for; each purpose has its own size limit. */
export type MediaPurpose = 'avatar' | 'emoji' | 'background' | 'cardBack';

/** Decoded upload limit per purpose; the server enforces it and the client checks it before sending. */
export const MEDIA_MAX_BYTES: Readonly<Record<MediaPurpose, number>> = {
  avatar: 512 * 1024,
  // Site emoji are compressed at import to fit this limit.
  emoji: EMOJI_MAX_BYTES,
  background: 2 * 1024 * 1024,
  cardBack: 512 * 1024,
};

export function isMediaPurpose(value: unknown): value is MediaPurpose {
  return typeof value === 'string' && Object.hasOwn(MEDIA_MAX_BYTES, value);
}

/** Size for messages: whole KB below 1 MB, else MB with at most one decimal; rounded up so a limit is never shown as met. */
export function formatMediaBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
  return `${Math.ceil((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/** Start of the server's 413 message for an oversize image; clients match it to show a localized text. */
export const MEDIA_TOO_LARGE_PREFIX = 'Image is too large';

export function mediaTooLargeMessage(purpose: MediaPurpose): string {
  return `${MEDIA_TOO_LARGE_PREFIX}. The limit is ${formatMediaBytes(MEDIA_MAX_BYTES[purpose])}.`;
}

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
