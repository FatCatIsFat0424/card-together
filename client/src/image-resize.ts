// Static image resizing requires browser canvas APIs.

interface ResizeOptions {
  /** Square output edge, or the longest side limit when `square` is false. */
  size: number;
  /** Centre-crop to a square before scaling. */
  square: boolean;
  quality: number;
  /** Used when the browser cannot encode WebP. */
  fallbackType: 'image/png' | 'image/jpeg';
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function resizeImage(file: Blob, options: ResizeOptions): Promise<Blob> {
  // Canvas encodes a single frame, so preserve GIF bytes to retain their animation.
  if (file.type === 'image/gif') return file;
  const bitmap = await createImageBitmap(file);
  const crop = options.square ? Math.min(bitmap.width, bitmap.height) : 0;
  const sourceWidth = crop || bitmap.width;
  const sourceHeight = crop || bitmap.height;
  const scale = Math.min(1, options.size / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement('canvas');
  canvas.width = options.square ? options.size : Math.round(sourceWidth * scale);
  canvas.height = options.square ? options.size : Math.round(sourceHeight * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable.');
  context.drawImage(bitmap, (bitmap.width - sourceWidth) / 2, (bitmap.height - sourceHeight) / 2,
    sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const webp = await encode(canvas, 'image/webp', options.quality);
  if (webp?.type === 'image/webp') return webp;
  const fallback = await encode(canvas, options.fallbackType, options.quality);
  if (!fallback) throw new Error('Unable to encode the image.');
  return fallback;
}
