import express, { Router } from 'express';
import { isMediaPurpose, MEDIA_MAX_BYTES, mediaTooLargeMessage } from '@shared/constants';
import type { AuthService } from '../auth/auth-service';
import { createRateLimiter, getRequestSession, requireSession } from '../auth/http-middleware';
import type { MediaStore } from '../media/media-store';
import { sniffImage } from '../media/media-store';

const CONTENT_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
} as const;

/** Without a store every media request answers 503 so clients can hide upload UI. */
export function createMediaRouter(store: MediaStore | null, authService: AuthService): Router {
  const router = Router();
  if (!store) {
    router.use((_request, response) => {
      response.status(503).json({ success: false, error: 'Media uploads are unavailable.' });
    });
    return router;
  }

  router.post(
    '/',
    requireSession(authService),
    // Room for one full emoji library import (300) per window.
    createRateLimiter(400, 15 * 60 * 1000, 'media'),
    // Parse the large body only after origin, session, and rate checks have passed.
    express.json({ limit: '3mb' }),
    (request, response, next) => {
      const body: unknown = request.body;
      const data = typeof body === 'object' && body !== null && 'data' in body ? body.data : null;
      const purpose = typeof body === 'object' && body !== null && 'purpose' in body
        ? body.purpose : null;
      if (typeof data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(data) || !isMediaPurpose(purpose)) {
        response.status(400).json({ success: false, error: 'Send base64 image data and a purpose.' });
        return;
      }
      const bytes = Buffer.from(data, 'base64');
      if (bytes.length > MEDIA_MAX_BYTES[purpose]) {
        response.status(413).json({ success: false, error: mediaTooLargeMessage(purpose) });
        return;
      }
      if (!sniffImage(bytes)) {
        response.status(400).json({ success: false, error: 'Upload a PNG, JPEG, GIF, or WebP image.' });
        return;
      }
      const { account } = getRequestSession(response);
      void store.save(bytes, account.id).then((id) => {
        if (id) response.json({ success: true, id });
        else response.status(413).json({ success: false, error: 'Your image storage is full.' });
      }).catch(next);
    },
  );

  router.get('/:id', (request, response, next) => {
    const path = store.path(request.params.id);
    if (!path) {
      response.status(404).json({ success: false, error: 'Not found.' });
      return;
    }
    const extension = path.slice(path.lastIndexOf('.') + 1) as keyof typeof CONTENT_TYPES;
    response.setHeader('Content-Type', CONTENT_TYPES[extension]);
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'");
    response.sendFile(path, { cacheControl: false }, (error) => {
      if (error && !response.headersSent) next(error);
    });
  });

  return router;
}
