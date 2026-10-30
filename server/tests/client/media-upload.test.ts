import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MEDIA_MAX_BYTES, mediaTooLargeMessage } from '@shared/constants';
import type { MediaPurpose } from '@shared/constants';

const api = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('../../../client/src/api', () => api);
vi.mock('../../../client/src/deployment', () => ({ API_BASE_URL: '' }));
import { uploadImage } from '../../../client/src/media';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

const oversize = (purpose: MediaPurpose, extra = 1): Blob =>
  new Blob([new Uint8Array(MEDIA_MAX_BYTES[purpose] + extra)], { type: 'image/gif' });

/** Minimal browser FileReader: node has none, and only the data URL's payload matters here. */
class FakeFileReader {
  result = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  error = null;
  readAsDataURL(): void {
    this.result = 'data:image/gif;base64,AAAA';
    queueMicrotask(() => this.onload?.());
  }
}

describe('image upload size limits', () => {
  beforeEach(() => {
    vi.stubGlobal('FileReader', FakeFileReader);
    api.apiRequest.mockReset();
    useI18nStore.getState().setLocale('zh-TW');
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('should refuse an oversize file before sending it, naming the limit and the file size', async () => {
    await expect(uploadImage(oversize('avatar', 800 * 1024), 'avatar')).rejects
      .toThrow('頭像檔案上限為 512 KB，這個檔案是 1.3 MB。');
    useI18nStore.getState().setLocale('en');
    await expect(uploadImage(oversize('cardBack'), 'cardBack')).rejects
      .toThrow('Card back files are limited to 512 KB; this file is 513 KB.');
    await expect(uploadImage(oversize('background'), 'background')).rejects.toThrow('2.1 MB');
    await expect(uploadImage(oversize('emoji'), 'emoji')).rejects.toThrow('Emoji files are limited to 2 MB');
    expect(api.apiRequest).not.toHaveBeenCalled();
  });

  it('should send a file exactly at the limit', async () => {
    const id = `${'a'.repeat(64)}.gif`;
    api.apiRequest.mockResolvedValue({ success: true, id });
    const file = new Blob([new Uint8Array(MEDIA_MAX_BYTES.avatar)], { type: 'image/gif' });
    await expect(uploadImage(file, 'avatar')).resolves.toBe(id);
  });

  it('should localize the server refusal and pass other errors through', async () => {
    const file = new Blob([new Uint8Array(1024)], { type: 'image/gif' });
    api.apiRequest.mockResolvedValueOnce({ success: false, status: 413, error: mediaTooLargeMessage('avatar') });
    await expect(uploadImage(file, 'avatar')).rejects.toThrow('頭像檔案上限為 512 KB，這個檔案是 1 KB。');
    api.apiRequest.mockResolvedValueOnce({ success: false, status: 413, error: 'Your image storage is full.' });
    await expect(uploadImage(file, 'avatar')).rejects.toThrow('Your image storage is full.');
  });
});
