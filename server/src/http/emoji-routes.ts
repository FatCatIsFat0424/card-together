import { Router } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { MediaId } from '@shared/types';
import { MAX_EMOJIS_PER_ACCOUNT, isEmojiName, isMediaId } from '@shared/constants';
import type { AuthService } from '../auth/auth-service';
import { getRequestSession, requireSession } from '../auth/http-middleware';
import type { Repository } from '../database/repository';

const MAX_BATCH = 50;
const NAME_RULE = '2–64 letters, digits, _, - or ., starting with a letter, digit or _';
const CONFLICTS: Record<string, number> = { EMOJI_EXISTS: 409, EMOJI_LIMIT: 409 };

function handleAsync(
  handler: (request: Request, response: Response) => Promise<void>,
): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    void handler(request, response).catch((error: unknown) => {
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code) : '';
      if (CONFLICTS[code] && error instanceof Error) {
        response.status(CONFLICTS[code]).json({ success: false, error: error.message });
      } else next(error);
    });
  };
}

function field(body: unknown, key: string): unknown {
  return typeof body === 'object' && body !== null && key in body
    ? (body as Record<string, unknown>)[key] : undefined;
}

function parseItems(
  value: unknown,
  mediaExists: (id: MediaId) => boolean,
): { name: string; mediaId: MediaId }[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BATCH) return null;
  const items = value.map((item: unknown) => ({
    name: field(item, 'name'), mediaId: field(item, 'mediaId'),
  }));
  const valid = items.every((item) => isEmojiName(item.name) && isMediaId(item.mediaId) &&
    mediaExists(item.mediaId));
  return valid && new Set(items.map((item) => item.name)).size === items.length
    ? items as { name: string; mediaId: MediaId }[] : null;
}

/** 1 to a full library of unique, non-empty ID strings. */
function parseIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_EMOJIS_PER_ACCOUNT) return null;
  const valid = value.every((id: unknown) => typeof id === 'string' && id.length > 0 && id.length <= 64);
  return valid && new Set(value).size === value.length ? value as string[] : null;
}

export function createEmojiRouter(
  repository: Repository,
  authService: AuthService,
  mediaExists: (id: MediaId) => boolean,
): Router {
  const router = Router();
  router.use(requireSession(authService));

  router.get('/', handleAsync(async (_request, response): Promise<void> => {
    const { account } = getRequestSession(response);
    response.json({ success: true, emojis: await repository.listEmojis(account.id) });
  }));

  router.post('/', handleAsync(async (request, response): Promise<void> => {
    const items = parseItems(field(request.body, 'items'), mediaExists);
    if (!items) {
      response.status(400).json({ success: false, error:
        `Send 1–${MAX_BATCH} emoji with unique names (${NAME_RULE}) and uploaded images.` });
      return;
    }
    const { account } = getRequestSession(response);
    const emojis = await repository.createEmojis(account.id, items, Date.now());
    response.status(201).json({ success: true, emojis });
  }));

  // A POST body instead of DELETE with a body, which some proxies and clients drop.
  router.post('/delete', handleAsync(async (request, response): Promise<void> => {
    const ids = parseIds(field(request.body, 'ids'));
    if (!ids) {
      response.status(400).json({ success: false, error:
        `Send 1–${MAX_EMOJIS_PER_ACCOUNT} unique emoji IDs.` });
      return;
    }
    const { account } = getRequestSession(response);
    response.json({ success: true, deleted: await repository.deleteEmojis(account.id, ids) });
  }));

  router.patch('/:id', handleAsync(async (request, response): Promise<void> => {
    const name = field(request.body, 'name');
    if (!isEmojiName(name)) {
      response.status(400).json({ success: false, error:
        `Emoji names use ${NAME_RULE}.` });
      return;
    }
    const { account } = getRequestSession(response);
    const emoji = await repository.renameEmoji(account.id, request.params.id, name);
    if (!emoji) {
      response.status(404).json({ success: false, error: 'Emoji not found.' });
      return;
    }
    response.json({ success: true, emoji });
  }));

  router.delete('/:id', handleAsync(async (request, response): Promise<void> => {
    const { account } = getRequestSession(response);
    if (!await repository.deleteEmoji(account.id, request.params.id)) {
      response.status(404).json({ success: false, error: 'Emoji not found.' });
      return;
    }
    response.json({ success: true });
  }));

  return router;
}
