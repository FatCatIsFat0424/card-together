import { Router } from 'express';
import type { CookieOptions, Request, RequestHandler, Response } from 'express';
import type { AccountProfile } from '@shared/types';
import type { AuthService, AuthResult } from '../auth/auth-service';
import {
  LEGACY_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  readSessionCookie,
} from '../auth/auth-service';
import {
  createRateLimiter,
  getRequestSession,
  protectMutations,
  requireSession,
} from '../auth/http-middleware';

export interface AuthRouterConfig {
  readonly allowedOrigins: readonly string[];
  readonly secureCookies?: boolean;
  readonly onAccountUpdated?: (account: AccountProfile) => void | Promise<void>;
  readonly onSessionsRevoked?: (accountId: string, tokenHash?: string) => void | Promise<void>;
}

export function createAuthRouter(service: AuthService, config: AuthRouterConfig): Router {
  const router = Router();
  const cookieOptions: CookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies ?? false,
    path: '/',
  };
  const auth = requireSession(service);
  const sensitiveLimit = createRateLimiter(20, 15 * 60 * 1000, 'auth');
  router.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.use(protectMutations(config.allowedOrigins));
  router.use(createRateLimiter(300, 60 * 1000, 'account'));

  function route(action: (request: Request, response: Response) => Promise<void>): RequestHandler {
    return (request, response, next) => {
      void action(request, response).catch(next);
    };
  }

  function clearSessionCookies(response: Response): void {
    for (const name of [SESSION_COOKIE_NAME, LEGACY_SESSION_COOKIE_NAME]) {
      for (const path of ['/', '/card-together/']) {
        response.clearCookie(name, { ...cookieOptions, path });
      }
    }
  }

  function clearLegacySessionCookies(response: Response): void {
    for (const path of ['/', '/card-together/']) {
      response.clearCookie(LEGACY_SESSION_COOKIE_NAME, { ...cookieOptions, path });
    }
  }

  async function revokePresentedSessions(request: Request): Promise<void> {
    const revoked = new Set<string>();
    for (const name of [SESSION_COOKIE_NAME, LEGACY_SESSION_COOKIE_NAME]) {
      const auth = await service.resolveToken(readSessionCookie(request.headers.cookie, name));
      if (!auth || revoked.has(auth.session.tokenHash)) continue;
      await service.logout(auth.session);
      revoked.add(auth.session.tokenHash);
      await config.onSessionsRevoked?.(auth.account.id, auth.session.tokenHash);
    }
  }

  function signedIn(response: Response, result: AuthResult, status = 200): void {
    response.cookie(SESSION_COOKIE_NAME, result.token, {
      ...cookieOptions,
      expires: new Date(result.session.expiresAt),
    });
    response.status(status).json({ success: true, account: result.account });
  }

  router.post(
    '/register',
    sensitiveLimit,
    route(async (request, response) => {
      signedIn(response, await service.register(request.body), 201);
    }),
  );
  router.post(
    '/login',
    sensitiveLimit,
    route(async (request, response) => {
      signedIn(response, await service.login(request.body));
    }),
  );
  router.get(
    '/me',
    auth,
    route(async (request, response) => {
      const authenticated = getRequestSession(response);
      if (readSessionCookie(request.headers.cookie) === undefined) {
        response.cookie(
          SESSION_COOKIE_NAME,
          readSessionCookie(request.headers.cookie, LEGACY_SESSION_COOKIE_NAME),
          { ...cookieOptions, expires: new Date(authenticated.session.expiresAt) },
        );
        clearLegacySessionCookies(response);
      }
      response.json({ success: true, account: authenticated.account });
    }),
  );
  router.post(
    '/logout',
    route(async (request, response) => {
      await revokePresentedSessions(request);
      clearSessionCookies(response);
      response.json({ success: true });
    }),
  );
  router.post(
    '/logout-all',
    auth,
    route(async (_request, response) => {
      const { account } = getRequestSession(response);
      await service.logoutAll(account.id);
      await config.onSessionsRevoked?.(account.id);
      clearSessionCookies(response);
      response.json({ success: true });
    }),
  );
  router.patch(
    '/profile',
    auth,
    route(async (request, response) => {
      const account = await service.updateProfile(
        getRequestSession(response).account.id,
        request.body,
      );
      try {
        await config.onAccountUpdated?.(account);
      } catch (error) {
        // The profile is saved; live tables catch up on the next snapshot or resume.
        console.error('[auth] Unable to sync the updated profile:', error);
      }
      response.json({ success: true, account });
    }),
  );
  router.post(
    '/password',
    sensitiveLimit,
    auth,
    route(async (request, response) => {
      const { account } = getRequestSession(response);
      await service.changePassword(account.id, request.body);
      await config.onSessionsRevoked?.(account.id);
      clearSessionCookies(response);
      response.json({ success: true });
    }),
  );
  router.use(
    (error: unknown, _request: Request, response: Response, _next: (error?: unknown) => void) => {
      if (
        error instanceof Error &&
        'status' in error &&
        typeof error.status === 'number' &&
        error.status >= 400 &&
        error.status < 500
      ) {
        response.status(error.status).json({ success: false, error: error.message });
        return;
      }
      console.error('[auth] Request failed:', error);
      response
        .status(500)
        .json({ success: false, error: 'Unable to complete the request. Please try again.' });
    },
  );
  return router;
}
