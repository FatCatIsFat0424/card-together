import type { Request, RequestHandler, Response } from 'express';
import type { AuthService, AuthenticatedSession } from './auth-service';

export function protectMutations(allowedOrigins: readonly string[]): RequestHandler {
  const origins = new Set(allowedOrigins);
  return (request, response, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      next();
      return;
    }
    if (!origins.has(request.get('origin') ?? '')) {
      response.status(403).json({ success: false, error: 'Request origin is not allowed.' });
      return;
    }
    if (request.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      response
        .status(415)
        .json({ success: false, error: 'Use application/json for this request.' });
      return;
    }
    next();
  };
}

export function requireSession(service: AuthService): RequestHandler {
  return (request, response, next) => {
    void service
      .resolveSession(request.headers.cookie)
      .then((auth) => {
        if (!auth) {
          response.status(401).json({ success: false, error: 'Sign in to continue.' });
          return;
        }
        response.locals.auth = auth;
        next();
      })
      .catch(next);
  };
}

export function getRequestSession(response: Response): AuthenticatedSession {
  const auth: unknown = response.locals.auth;
  if (!auth) throw new Error('Authentication middleware must run first.');
  return auth as AuthenticatedSession;
}

interface RateBucket {
  count: number;
  resetAt: number;
}

/** Bounded, process-local abuse protection using Express's configured proxy trust policy. */
export function createRateLimiter(
  limit: number, windowMs: number, keyPrefix = '',
  identity?: (request: Request, response: Response) => string,
): RequestHandler {
  const buckets = new Map<string, RateBucket>();
  return (request, response, next) => {
    const now = Date.now();
    const key = `${keyPrefix}:${identity ? identity(request, response)
      : request.ip ?? request.socket.remoteAddress ?? 'unknown'}`;
    for (const [entryKey, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(entryKey);
    let bucket = buckets.get(key);
    if (!bucket) {
      if (buckets.size >= 10000) {
        response
          .status(429)
          .json({ success: false, error: 'Too many requests. Please try again later.' });
        return;
      }
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > limit) {
      response.setHeader('Retry-After', Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)));
      response
        .status(429)
        .json({ success: false, error: 'Too many requests. Please try again later.' });
      return;
    }
    next();
  };
}
