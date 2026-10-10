import { createServer } from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import type { Repository } from './database/repository';
import { createAuthService } from './auth/auth-service';
import { getRequestSession, protectMutations, requireSession } from './auth/http-middleware';
import { createAuthRouter } from './http/auth-routes';
import { createFriendRouter } from './http/friend-routes';
import { createPlayerRouter } from './http/player-routes';
import { createMediaRouter } from './http/media-routes';
import { createEmojiRouter } from './http/emoji-routes';
import { createMediaStore } from './media/media-store';
import type { ProvidedEmojiCatalog } from './media/provided-emoji';
import { createRuntimeCoordinator } from './runtime/coordinator';
import { startBigTwoAutoPass } from './runtime/bigtwo-auto-pass';
import { startTurnTimers } from './runtime/turn-timers';
import { startBotTurns } from './runtime/bot-turns';
import { startSharedDeadlines } from './runtime/shared-deadline';
import { broadcastState, readPresence } from './socket/context';
import { getRoomMemberIds } from './managers/room-manager';
import { createVoiceManager } from './managers/voice-manager';
import { createFriendService } from './social/friend-service';
import type { TypedServer } from './socket/context';
import { setupConnectionHandler, updateConnectedProfile } from './socket/connection';

export interface ApplicationOptions {
  allowedOrigins: readonly string[];
  secureCookies?: boolean;
  trustProxyLoopback?: boolean;
  /** Uploaded image directory; media routes answer 503 without it. */
  mediaDirectory?: string;
  /** Site-provided chat emoji; none when omitted. */
  providedEmojis?: ProvidedEmojiCatalog;
  /** Listen before schedulers start; omitted when callers bind the server themselves. */
  listen?: { readonly port: number; readonly host?: string };
}

export async function createApplication(repository: Repository, options: ApplicationOptions): Promise<{
  httpServer: ReturnType<typeof createServer>;
  io: TypedServer;
  close: () => Promise<void>;
}> {
  const app = express();
  app.disable('x-powered-by');
  if (options.trustProxyLoopback) app.set('trust proxy', 'loopback');
  app.use(cors({ origin: [...options.allowedOrigins], credentials: true }));
  app.use('/api', (_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use('/api', protectMutations(options.allowedOrigins));
  // The media router parses its larger uploads itself, after session and rate checks.
  const smallJson = express.json({ limit: '16kb' });
  app.use((request, response, next) => {
    if (request.path === '/api/media' || request.path.startsWith('/api/media/')) next();
    else smallJson(request, response, next);
  });
  app.get('/health', (_request, response) => response.json({ status: 'ok' }));
  const httpServer = createServer(app);
  const io: TypedServer = new Server(httpServer, {
    cors: { origin: [...options.allowedOrigins], credentials: true },
    maxHttpBufferSize: 16_384,
    allowRequest: (request, callback) => {
      callback(null, options.allowedOrigins.includes(request.headers.origin ?? ''));
    },
  });
  const media = options.mediaDirectory ? createMediaStore(options.mediaDirectory) : null;
  const mediaExists = (id: string): boolean => Boolean(media?.path(id));
  const auth = createAuthService(repository, { mediaExists });
  const runtime = await createRuntimeCoordinator(repository);
  const context = {
    io, auth, runtime, voice: createVoiceManager(), friends: createFriendService(repository),
    listEmojis: (accountId: string) => repository.listEmojis(accountId),
    providedEmojis: options.providedEmojis ?? new Map(),
  };
  const stopConnections = setupConnectionHandler(context);
  app.use('/api/auth', createAuthRouter(auth, {
    ...options,
    onAccountUpdated: (account) => updateConnectedProfile(context, account),
    onSessionsRevoked: (accountId, tokenHash) => {
      for (const socket of io.sockets.sockets.values()) {
        if (socket.data.accountId === accountId && (!tokenHash || socket.data.tokenHash === tokenHash)) {
          socket.disconnect(true);
        }
      }
    },
  }));
  app.use('/api/friends', createFriendRouter(repository, auth, (ids) => readPresence(runtime, ids)));
  app.use('/api/players', createPlayerRouter(repository, auth));
  app.use('/api/media', createMediaRouter(media, auth));
  app.use('/api/emojis', createEmojiRouter(repository, auth, mediaExists));
  app.get('/api/account/history', requireSession(auth), (_request, response, next) => {
    void repository.listMatches(getRequestSession(response).account.id, 50)
      .then((matches) => response.json({ success: true, matches })).catch(next);
  });
  app.use('/api', (_request, response) => response.status(404).json({ success: false, error: 'Not found.' }));
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const status = error instanceof Error && 'status' in error && typeof error.status === 'number'
      && error.status >= 400 && error.status < 500 ? error.status : 500;
    if (status === 500) console.error('[http]', error);
    response.status(status).json({ success: false,
      error: status === 500 ? 'Unable to complete the request. Please try again.' : 'Invalid request.' });
  });

  // Bind before any scheduler can commit, so a second instance fails without writing.
  if (options.listen) {
    const { port, host } = options.listen;
    try {
      await new Promise<void>((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => {
          httpServer.off('error', reject);
          resolve();
        });
      });
    } catch (error) {
      stopConnections();
      await new Promise<void>((resolve) => io.close(() => resolve()));
      throw error;
    }
  }
  const publish = (code: string): void => broadcastState(io, getRoomMemberIds(code));
  let stopAutoPass: (() => void) | undefined;
  let stopTurnTimers: () => void;
  try {
    stopAutoPass = await startBigTwoAutoPass(runtime, publish);
    stopTurnTimers = await startTurnTimers(runtime, publish);
  } catch (error) {
    stopAutoPass?.();
    stopConnections();
    await new Promise<void>((resolve) => io.close(() => resolve()));
    throw error;
  }
  const stopBots = startBotTurns(runtime, publish);
  const stopSharedDeadlines = startSharedDeadlines(runtime, publish);

  return {
    httpServer, io,
    close: async (): Promise<void> => {
      stopSharedDeadlines();
      stopBots();
      stopTurnTimers();
      stopAutoPass?.();
      stopConnections();
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await runtime.idle();
      await repository.close();
    },
  };
}
