import { describe, expect, it } from 'vitest';
import { resizeImage } from '../../../client/src/image-resize';

const ANIMATED_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAExpcf8AACH/C05FVFNDQVBFMi4wAwEAAAAh+QQFCgAAACwAAAAAAQABAAACAkwBACH5BAUKAAAALAAAAAABAAEAgExpcQAA/wICTAEAOw==',
  'base64',
);

describe('image upload preparation', () => {
  it.each([true, false])('should preserve every GIF frame for square=%s uploads', async (square) => {
    const file = new File([ANIMATED_GIF], 'animated.gif', { type: 'image/gif' });
    const result = await resizeImage(file, {
      size: 256, square, quality: 0.9, fallbackType: 'image/png',
    });
    expect(result).toBe(file);
    expect(result.type).toBe('image/gif');
    expect(Buffer.from(await result.arrayBuffer())).toEqual(ANIMATED_GIF);
  });
});
