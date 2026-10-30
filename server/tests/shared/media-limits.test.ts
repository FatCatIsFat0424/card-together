import { describe, expect, it } from 'vitest';
import {
  EMOJI_MAX_BYTES, formatMediaBytes, isMediaPurpose, MEDIA_MAX_BYTES, mediaTooLargeMessage,
} from '@shared/constants';

describe('media upload limits', () => {
  it('should share one limit per purpose', () => {
    expect(MEDIA_MAX_BYTES).toEqual({
      avatar: 512 * 1024, emoji: 2 * 1024 * 1024, background: 2 * 1024 * 1024, cardBack: 512 * 1024,
    });
    expect(EMOJI_MAX_BYTES).toBe(MEDIA_MAX_BYTES.emoji);
  });

  it('should recognize only known purposes', () => {
    expect(isMediaPurpose('avatar')).toBe(true);
    expect(isMediaPurpose('banner')).toBe(false);
    expect(isMediaPurpose('toString')).toBe(false);
    expect(isMediaPurpose(null)).toBe(false);
  });

  it('should format sizes in KB below 1 MB and MB with one decimal above, rounding up', () => {
    expect(formatMediaBytes(512 * 1024)).toBe('512 KB');
    expect(formatMediaBytes(512 * 1024 + 1)).toBe('513 KB');
    expect(formatMediaBytes(10)).toBe('1 KB');
    expect(formatMediaBytes(2 * 1024 * 1024)).toBe('2 MB');
    expect(formatMediaBytes(1.25 * 1024 * 1024)).toBe('1.3 MB');
    expect(formatMediaBytes(2 * 1024 * 1024 + 1)).toBe('2.1 MB');
  });

  it('should state the limit in the server message', () => {
    expect(mediaTooLargeMessage('avatar')).toBe('Image is too large. The limit is 512 KB.');
    expect(mediaTooLargeMessage('background')).toBe('Image is too large. The limit is 2 MB.');
  });
});
