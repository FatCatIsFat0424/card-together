import { Router } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AuthService } from '../auth/auth-service';
import { getRequestSession, requireSession } from '../auth/http-middleware';
import type { Repository } from '../database/repository';
import type { FriendEntry } from '@shared/types';
import { createFriendService } from '../social/friend-service';

export type FriendPresence = Pick<FriendEntry, 'online' | 'inRoom' | 'hostedRoomCode'>;

/** Reads committed runtime presence; injected so HTTP routes never touch managers directly. */
export type PresenceReader = (accountIds: readonly string[]) => Promise<ReadonlyMap<string, FriendPresence>>;

function handleAsync(
  handler: (request: Request, response: Response) => Promise<void>,
): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    void handler(request, response).catch(next);
  };
}

function usernameFromBody(body: unknown): unknown {
  return typeof body === 'object' && body !== null && 'username' in body
    ? body.username
    : undefined;
}

export function createFriendRouter(
  repository: Repository, authService: AuthService, readPresence: PresenceReader,
): Router {
  const router = Router();
  const friends = createFriendService(repository);
  router.use(requireSession(authService));

  router.get('/', handleAsync(async (_request, response): Promise<void> => {
    const { account } = getRequestSession(response);
    const list = await friends.list(account.id);
    const presence = await readPresence(list.friends.map((friend) => friend.id));
    response.json({ success: true, ...list, friends: list.friends.map((friend) => ({
      ...friend, online: presence.get(friend.id)?.online ?? false, inRoom: presence.get(friend.id)?.inRoom ?? false,
      hostedRoomCode: presence.get(friend.id)?.hostedRoomCode ?? null,
    })) });
  }));

  router.get('/search', handleAsync(async (request, response): Promise<void> => {
    const result = await friends.findByUsername(request.query.username);
    if (!result.success) {
      response.status(result.status).json({ success: false, error: result.error });
      return;
    }
    response.json({ success: true, account: result.data });
  }));

  router.post('/requests', handleAsync(async (request, response): Promise<void> => {
    const { account } = getRequestSession(response);
    const result = await friends.request(account.id, usernameFromBody(request.body));
    if (!result.success) {
      response.status(result.status).json({ success: false, error: result.error });
      return;
    }
    response.status(201).json({ success: true, request: result.data });
  }));

  router.post('/requests/:id/accept', handleAsync(async (request, response): Promise<void> => {
    const { account } = getRequestSession(response);
    const result = await friends.accept(account.id, request.params.id);
    if (!result.success) {
      response.status(result.status).json({ success: false, error: result.error });
      return;
    }
    response.json({ success: true });
  }));

  router.delete('/requests/:id', handleAsync(async (request, response): Promise<void> => {
    const { account } = getRequestSession(response);
    const result = await friends.dismiss(account.id, request.params.id);
    if (!result.success) {
      response.status(result.status).json({ success: false, error: result.error });
      return;
    }
    response.json({ success: true });
  }));

  router.delete('/:accountId', handleAsync(async (request, response): Promise<void> => {
    const { account } = getRequestSession(response);
    const result = await friends.remove(account.id, request.params.accountId);
    if (!result.success) {
      response.status(result.status).json({ success: false, error: result.error });
      return;
    }
    response.json({ success: true });
  }));

  return router;
}
