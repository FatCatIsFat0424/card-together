import { afterEach, describe, expect, it, vi } from 'vitest';
import { resizeImage } from '../../../client/src/image-resize';

const ANIMATED_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAExpcf8AACH/C05FVFNDQVBFMi4wAwEAAAAh+QQFCgAAACwAAAAAAQABAAACAkwBACH5BAUKAAAALAAAAAABAAEAgExpcQAA/wICTAEAOw==',
  'base64',
);

afterEach(() => { vi.unstubAllGlobals(); });

function canvasFixture(width = 800, height = 400): {
  bitmap: { width: number; height: number; close: ReturnType<typeof vi.fn> };
  canvas: { width: number; height: number; getContext: ReturnType<typeof vi.fn>; toBlob: ReturnType<typeof vi.fn> };
  draw: ReturnType<typeof vi.fn>;
} {
  const bitmap = { width, height, close: vi.fn() };
  const draw = vi.fn();
  const canvas = {
    width: 0, height: 0, getContext: vi.fn().mockReturnValue({ drawImage: draw }),
    toBlob: vi.fn((callback: BlobCallback, type: string): void => callback(new Blob(['encoded'], { type }))),
  };
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
  vi.stubGlobal('document', { createElement: vi.fn().mockReturnValue(canvas) });
  return { bitmap, canvas, draw };
}

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

  it.each([
    { width: 800, height: 400, square: true, output: [256, 256], crop: [200, 0, 400, 400] },
    { width: 800, height: 400, square: false, output: [256, 128], crop: [0, 0, 800, 400] },
    { width: 100, height: 200, square: false, output: [100, 200], crop: [0, 0, 100, 200] },
  ])('crops or preserves the ratio without enlarging a static $width×$height image (square=$square)', async (row) => {
    const { bitmap, canvas, draw } = canvasFixture(row.width, row.height);
    const result = await resizeImage(new Blob(['source']), { size: 256, square: row.square, quality: 0.8, fallbackType: 'image/png' });
    expect([canvas.width, canvas.height]).toEqual(row.output);
    expect(draw).toHaveBeenCalledExactlyOnceWith(bitmap, ...row.crop, 0, 0, ...row.output);
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(result.type).toBe('image/webp');
    expect(canvas.toBlob).toHaveBeenCalledExactlyOnceWith(expect.any(Function), 'image/webp', 0.8);
  });

  it.each(['image/png', 'image/jpeg'] as const)('uses %s when the browser cannot encode WebP', async (fallbackType) => {
    const { canvas, bitmap } = canvasFixture();
    canvas.toBlob.mockImplementationOnce((callback: BlobCallback): void => callback(new Blob(['wrong'], { type: 'image/png' })));
    const result = await resizeImage(new Blob(['source']), { size: 256, square: false, quality: 0.9, fallbackType });
    expect(result.type).toBe(fallbackType);
    expect(canvas.toBlob.mock.calls.map((call) => call[1])).toEqual(['image/webp', fallbackType]);
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('reports null encoding and still releases the bitmap', async () => {
    const { canvas, bitmap } = canvasFixture();
    canvas.toBlob.mockImplementation((callback: BlobCallback): void => callback(null));
    await expect(resizeImage(new Blob(['source']), { size: 256, square: false, quality: 0.9, fallbackType: 'image/png' }))
      .rejects.toThrow('Unable to encode the image.');
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it.each(['context', 'drawing'] as const)('releases a bitmap when %s fails', async (failure) => {
    const { canvas, bitmap, draw } = canvasFixture();
    if (failure === 'context') canvas.getContext.mockReturnValue(null);
    else draw.mockImplementation(() => { throw new Error('Drawing failed.'); });
    await expect(resizeImage(new Blob(['source']), { size: 256, square: true, quality: 0.9, fallbackType: 'image/png' }))
      .rejects.toThrow(failure === 'context' ? 'Canvas is unavailable.' : 'Drawing failed.');
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(canvas.toBlob).not.toHaveBeenCalled();
  });
});
