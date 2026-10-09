import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, PlayerSnapshot, ServerToClientEvents } from '@shared/types';

export type ConnectionSocket = Pick<
  Socket<ServerToClientEvents, ClientToServerEvents>,
  'connected' | 'on' | 'off' | 'timeout' | 'connect' | 'disconnect'
>;

export type ConnectionState = 'connecting' | 'ready' | 'error';

interface ListenerTarget {
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}

export interface AccountConnectionOptions {
  readonly socket: ConnectionSocket;
  /** Receives `online`; normally `window`. */
  readonly network: ListenerTarget;
  /** Receives `visibilitychange`; normally `document`. */
  readonly page: ListenerTarget & { readonly visibilityState: DocumentVisibilityState };
  readonly setConnection: (state: ConnectionState) => void;
  readonly applySnapshot: (snapshot: PlayerSnapshot) => void;
  readonly restoreAccount: () => void;
  readonly now?: () => number;
  readonly resumeTimeoutMs?: number;
  /** Hidden duration after which a visible page re-verifies a seemingly connected socket. */
  readonly staleAfterMs?: number;
}

export const RESUME_TIMEOUT_MS = 10_000;
export const STALE_AFTER_MS = 10_000;

/** Runs the account socket session lifecycle and returns a function that stops it. */
export function startAccountConnection(options: AccountConnectionOptions): () => void {
  const { socket, network, page } = options;
  const now = options.now ?? Date.now;
  const resumeTimeoutMs = options.resumeTimeoutMs ?? RESUME_TIMEOUT_MS;
  const staleAfterMs = options.staleAfterMs ?? STALE_AFTER_MS;
  let stopped = false;
  let resumeId = 0;
  let resuming = false;
  let hiddenAt: number | null = page.visibilityState === 'hidden' ? now() : null;

  // Restarting also skips any remaining reconnection backoff delay.
  const reconnectNow = (): void => {
    socket.disconnect();
    socket.connect();
  };

  const resume = (reason: 'connect' | 'verify'): void => {
    resumeId += 1;
    const id = resumeId;
    resuming = true;
    socket.timeout(resumeTimeoutMs).emit('player:resume', (error, snapshot) => {
      if (stopped || id !== resumeId) return;
      resuming = false;
      if (error) {
        // A drop mid-resume rejects the ack; the next connect resumes again.
        if (!socket.connected) return;
        // An unanswered check after sleep usually means a half-open transport.
        if (reason === 'verify') reconnectNow();
        else options.setConnection('error');
        return;
      }
      if (!snapshot.success) {
        options.setConnection('error');
        return;
      }
      options.applySnapshot(snapshot);
    });
  };

  const handleConnect = (): void => {
    options.setConnection('connecting');
    resume('connect');
  };

  const handleDisconnect = (reason: string): void => {
    resumeId += 1;
    resuming = false;
    if (reason === 'io server disconnect') {
      // The server will not be retried automatically; the account may have expired.
      options.setConnection('error');
      options.restoreAccount();
    } else {
      options.setConnection('connecting');
    }
  };

  const handleConnectError = (): void => {
    options.setConnection('error');
    options.restoreAccount();
  };

  const handleOnline = (): void => {
    if (!socket.connected) reconnectNow();
  };

  const handleVisibility = (): void => {
    if (page.visibilityState !== 'visible') {
      hiddenAt ??= now();
      return;
    }
    const hiddenFor = hiddenAt === null ? 0 : now() - hiddenAt;
    hiddenAt = null;
    if (!socket.connected) reconnectNow();
    else if (!resuming && hiddenFor >= staleAfterMs) resume('verify');
  };

  socket.on('connect', handleConnect);
  socket.on('disconnect', handleDisconnect);
  socket.on('connect_error', handleConnectError);
  network.addEventListener('online', handleOnline);
  page.addEventListener('visibilitychange', handleVisibility);
  if (socket.connected) handleConnect();
  else socket.connect();

  return () => {
    stopped = true;
    socket.off('connect', handleConnect);
    socket.off('disconnect', handleDisconnect);
    socket.off('connect_error', handleConnectError);
    network.removeEventListener('online', handleOnline);
    page.removeEventListener('visibilitychange', handleVisibility);
    socket.disconnect();
  };
}
