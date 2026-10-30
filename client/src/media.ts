import { formatMediaBytes, MEDIA_MAX_BYTES, MEDIA_TOO_LARGE_PREFIX } from '@shared/constants';
import type { MediaPurpose } from '@shared/constants';
import type { MediaId } from '@shared/types';
import { apiRequest } from './api';
import { API_BASE_URL } from './deployment';
import { useI18nStore } from './stores/i18n-store';

export type { MediaPurpose } from '@shared/constants';

/** Localized refusal naming the purpose's limit and the file's size. */
export function mediaTooLargeText(purpose: MediaPurpose, size: number): string {
  return useI18nStore.getState().t(`media.tooLarge.${purpose}`, {
    limit: formatMediaBytes(MEDIA_MAX_BYTES[purpose]), size: formatMediaBytes(size),
  });
}

export function mediaUrl(id: MediaId): string {
  return `${API_BASE_URL}/api/media/${encodeURIComponent(id)}`;
}

function base64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (): void => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = (): void => reject(reader.error ?? new Error('Unable to read the image.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Rejects with a message fit for display when the upload is refused. GIFs are not resized, so the size
 * is checked here rather than waiting for the server's 413.
 */
export async function uploadImage(file: Blob, purpose: MediaPurpose): Promise<MediaId> {
  if (file.size > MEDIA_MAX_BYTES[purpose]) throw new Error(mediaTooLargeText(purpose, file.size));
  const result = await apiRequest<{ id: MediaId }>('/api/media', 'POST', {
    data: await base64(file),
    purpose,
  });
  if (!result.success) {
    throw new Error(result.status === 413 && result.error.startsWith(MEDIA_TOO_LARGE_PREFIX)
      ? mediaTooLargeText(purpose, file.size) : result.error);
  }
  return result.id;
}
