import { Router } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AuthService } from '../auth/auth-service';
import { createRateLimiter, getRequestSession, requireSession } from '../auth/http-middleware';
import type { Repository } from '../database/repository';
import type { ProvidedEmojiCatalog } from '../media/provided-emoji';
import { createMessageService, messageError } from '../social/message-service';

export type SocialPublisher = (accountIds: readonly string[]) => void;

function handleAsync(handler: (request: Request, response: Response) => Promise<void>): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    void handler(request, response).catch((error: unknown) => {
      const codes: Record<string, number> = {
        NOT_FRIENDS: 403, MESSAGE_CONFLICT: 409, INVALID_MESSAGE: 400, MESSAGE_NOT_FOUND: 404,
        INVALID_MESSAGE_READ: 400,
        MESSAGE_EXPIRED: 400,
      };
      const code = error instanceof Error && 'code' in error ? String(error.code) : '';
      const status = error instanceof Error && 'status' in error && typeof error.status === 'number'
        ? error.status : codes[code];
      if (error instanceof Error && status && status >= 400 && status < 500) {
        response.status(status).json({ success: false, error: error.message });
      } else next(error);
    });
  };
}

function object(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw messageError(400, 'Invalid message payload.');
  }
  return body as Record<string, unknown>;
}

/** `{ ids }` with 1–100 unique IDs, or `{ [everyKey]: true }` for every eligible notification. */
function notificationIds(body: Record<string, unknown>, everyKey: 'all' | 'read'): readonly string[] | 'all' {
  const keys = Object.keys(body);
  if (keys.length === 1 && body[everyKey] === true) return 'all';
  const ids = body.ids;
  if (keys.length !== 1 || !Array.isArray(ids) || ids.length === 0 || ids.length > 100
    || !ids.every((id: unknown) => typeof id === 'string' && id.length > 0 && id.length <= 128)
    || new Set(ids).size !== ids.length) throw messageError(400, 'Send 1–100 unique notification IDs.');
  return ids as string[];
}

export function createMessageRouter(
  repository: Repository, auth: AuthService, provided: ProvidedEmojiCatalog,
  publish: SocialPublisher,
): Router {
  const router = Router();
  const messages = createMessageService(repository, provided);
  router.use(requireSession(auth));

  router.get('/', handleAsync(async (_request, response): Promise<void> => {
    response.json({ success: true, ...await messages.overview(getRequestSession(response).account.id) });
  }));

  /** Marks notifications read: `{ ids }` (accepted notifications or incoming requests) or `{ all: true }`. */
  router.post('/notifications/read', handleAsync(async (request, response): Promise<void> => {
    const body = object(request.body);
    const accountId = getRequestSession(response).account.id;
    await repository.markFriendNotificationsRead(accountId, notificationIds(body, 'all'));
    publish([accountId]);
    response.json({ success: true });
  }));

  /** Deletes accepted notifications: `{ ids }`, or every read one with `{ read: true }`. */
  router.post('/notifications/clear', handleAsync(async (request, response): Promise<void> => {
    const body = object(request.body);
    const accountId = getRequestSession(response).account.id;
    const ids = notificationIds(body, 'read');
    if (ids === 'all') await repository.clearReadFriendNotifications(accountId);
    else await repository.dismissFriendNotifications(accountId, ids);
    publish([accountId]);
    response.json({ success: true });
  }));

  router.get('/:accountId', handleAsync(async (request, response): Promise<void> => {
    const before = request.query.before;
    if (before !== undefined && (typeof before !== 'string' || !before || before.length > 128)) {
      throw messageError(400, 'Invalid message cursor.');
    }
    response.json({ success: true, ...await messages.history(
      getRequestSession(response).account.id, request.params.accountId, before,
    ) });
  }));

  router.post('/:accountId/read', handleAsync(async (request, response): Promise<void> => {
    const body = object(request.body);
    if (Object.keys(body).length !== 1 || typeof body.messageId !== 'string'
      || !body.messageId || body.messageId.length > 128) throw messageError(400, 'Invalid message ID.');
    const accountId = getRequestSession(response).account.id;
    await repository.markDirectMessagesRead(accountId, request.params.accountId, body.messageId);
    publish([accountId]);
    response.json({ success: true });
  }));

  router.post('/:accountId', createRateLimiter(5, 5000, 'direct-message',
    (_request, response) => getRequestSession(response).account.id),
    handleAsync(async (request, response): Promise<void> => {
      const accountId = getRequestSession(response).account.id;
      const message = await messages.send(accountId, request.params.accountId, request.body);
      publish([accountId, message.recipientId]);
      response.status(201).json({ success: true, message });
    }));

  return router;
}
