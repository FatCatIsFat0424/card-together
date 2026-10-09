import type { MediaId } from '@shared/types';
import { apiRequest } from './api';
import { API_BASE_URL } from './deployment';

export type MediaPurpose = 'avatar' | 'emoji' | 'background' | 'cardBack';

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

/** Rejects with the server's error message when the upload is refused. */
export async function uploadImage(file: Blob, purpose: MediaPurpose): Promise<MediaId> {
  const result = await apiRequest<{ id: MediaId }>('/api/media', 'POST', {
    data: await base64(file),
    purpose,
  });
  if (!result.success) throw new Error(result.error);
  return result.id;
}
