import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io as connectSocket } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type { ChatMessage, ChatMessageEvent, ClientToServerEvents, ServerToClientEvents, Seat } from '@shared/types';
import type { PlayerSnapshot } from '@shared/types/socket-events';
import { createApplication } from '../../src/app';
import { SESSION_COOKIE_NAME, tokenHash } from '../../src/auth/auth-service';
import { createJsonRepository } from '../../src/database/json-repository';
import type { Repository } from '../../src/database/repository';

export const TEST_ORIGIN = 'http://localhost:5173';
export const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
export type TestClient = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface SocketMetrics {
  snapshots: number;
  payloadBytes: number;
  snapshotPayloadBytes: number;
  chatPayloadBytes: number;
  runtimeWrites: number;
  recipients: Map<string, number>;
  latestSnapshots: Map<string, PlayerSnapshot>;
  /** Number of `chat:message` deliveries since the last reset. */
  chatMessages: number;
  /** Chat history per account as a client would rebuild it from broadcasts; never reset. */
  chatViews: Map<string, ChatMessage[]>;
}

export interface SocketHarness {
  repository: Repository;
  application: Awaited<ReturnType<typeof createApplication>>;
  baseUrl: string;
  clients: TestClient[][];
  accountIds: string[][];
  cookies: string[][];
  roomCodes: string[];
  metrics: SocketMetrics;
  resetMetrics(): void;
  connect(cookie: string): Promise<TestClient>;
  close(): Promise<void>;
}

/**
 * One authenticated WebSocket-only client without automatic reconnection. `track` sees the client
 * before it connects, so callers can still disconnect it when the handshake fails.
 */
export async function connectClient(
  baseUrl: string, cookie: string, track: (client: TestClient) => void = () => {},
): Promise<TestClient> {
  const client: TestClient = connectSocket(baseUrl, {
    autoConnect: false, forceNew: true, reconnection: false, transports: ['websocket'],
    extraHeaders: { Origin: TEST_ORIGIN, Cookie: cookie },
  });
  track(client);
  await new Promise<void>((resolve, reject): void => {
    client.once('connect', (): void => resolve());
    client.once('connect_error', reject);
    client.connect();
  });
  return client;
}

/** Real HTTP/Socket transport and JSON storage; fixture sessions avoid password hashing. */
export async function createSocketHarness(roomCount = 3): Promise<SocketHarness> {
  const directory = await mkdtemp(join(tmpdir(), 'bridge-socket-performance-'));
  const allClients: TestClient[] = [];
  let cleanupRepository: Repository | undefined;
  let cleanupApplication: SocketHarness['application'] | undefined;
  let closing: Promise<void> | undefined;
  function close(): Promise<void> {
    closing ??= (async (): Promise<void> => {
      let applicationClosed = false;
      try {
        if (cleanupApplication) { await cleanupApplication.close(); applicationClosed = true; }
      } finally {
        for (const client of allClients) client.disconnect();
        try { if (!applicationClosed) await cleanupRepository?.close(); }
        finally { await rm(directory, { recursive: true, force: true }); }
      }
    })();
    return closing;
  }
  try {
    const repository = await createJsonRepository(join(directory, 'database.json'));
    cleanupRepository = repository;
    const metrics: SocketMetrics = {
      snapshots: 0, payloadBytes: 0, snapshotPayloadBytes: 0, chatPayloadBytes: 0, runtimeWrites: 0,
      recipients: new Map(), latestSnapshots: new Map(), chatMessages: 0, chatViews: new Map(),
    };
    const saveRuntime = repository.saveRuntime.bind(repository);
    repository.saveRuntime = async (...args): Promise<void> => {
      metrics.runtimeWrites += 1;
      await saveRuntime(...args);
    };
    const accountIds: string[][] = [];
    const cookies: string[][] = [];
    const passwordHash = `scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`;
    const now = Date.now();
    for (let roomIndex = 0; roomIndex < roomCount; roomIndex += 1) {
      accountIds.push([]);
      cookies.push([]);
      for (let seatIndex = 0; seatIndex < 4; seatIndex += 1) {
        const id = `account-${roomIndex}-${seatIndex}`;
        const username = `player_${roomIndex}_${seatIndex}`;
        const token = randomBytes(32).toString('base64url');
        await repository.createAccount({
          id, username, usernameNormalized: username, passwordHash, nickname: username,
          avatar: 'cat', avatarImage: null, tableBackground: null,
          tableBackgroundOpacity: 100, cardBack: null, cardBackOpacity: 100, matchesPublic: false,
          color: '#2563eb', createdAt: now, updatedAt: now,
        });
        await repository.createSession({
          tokenHash: tokenHash(token), accountId: id, createdAt: now, expiresAt: now + 3_600_000,
        }, passwordHash);
        accountIds[roomIndex].push(id);
        cookies[roomIndex].push(`${SESSION_COOKIE_NAME}=${token}`);
      }
    }

    const application = await createApplication(repository, { allowedOrigins: [TEST_ORIGIN] });
    cleanupApplication = application;
    const adapter = application.io.sockets.adapter;
    const broadcast = adapter.broadcast.bind(adapter);
    function recipientSocketIds(options: Parameters<typeof adapter.broadcast>[1]): Set<string> {
      const ids = new Set<string>();
      for (const room of options.rooms) for (const id of adapter.rooms.get(room) ?? []) ids.add(id);
      for (const room of options.except ?? []) for (const id of adapter.rooms.get(room) ?? []) ids.delete(id);
      return ids;
    }
    adapter.broadcast = (packet, options): void => {
      if (packet.data?.[0] === 'chat:message') {
        const { message } = packet.data[1] as ChatMessageEvent;
        const recipients = recipientSocketIds(options).size;
        metrics.chatMessages += recipients;
        metrics.chatPayloadBytes += Buffer.byteLength(JSON.stringify(packet.data[1])) * recipients;
        for (const room of options.rooms) {
          if (!room.startsWith('account:')) continue;
          const accountId = room.slice('account:'.length);
          metrics.chatViews.set(accountId, [...metrics.chatViews.get(accountId) ?? [], message]);
        }
      }
      if (packet.data?.[0] === 'player:state') {
        const payload = packet.data[1] as PlayerSnapshot;
        const recipients = recipientSocketIds(options).size;
        metrics.snapshots += recipients;
        const bytes = Buffer.byteLength(JSON.stringify(payload)) * recipients;
        metrics.snapshotPayloadBytes += bytes;
        metrics.payloadBytes += bytes;
        if (payload.player) {
          metrics.recipients.set(payload.player.id,
            (metrics.recipients.get(payload.player.id) ?? 0) + recipients);
          metrics.latestSnapshots.set(payload.player.id, payload);
          if (payload.chatHistory) metrics.chatViews.set(payload.player.id, payload.chatHistory);
          else if (!payload.room) metrics.chatViews.set(payload.player.id, []);
        }
      }
      broadcast(packet, options);
    };
    await new Promise<void>((resolve, reject): void => {
      application.httpServer.once('error', reject);
      application.httpServer.listen(0, '127.0.0.1', resolve);
    });
    const address = application.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Expected server address');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    function connect(cookie: string): Promise<TestClient> {
      return connectClient(baseUrl, cookie, (client) => allClients.push(client));
    }

    function requireSuccess(response: { success: boolean; error?: string }): void {
      if (!response.success) throw new Error(response.error ?? 'Fixture action failed');
    }

    const clients: TestClient[][] = [];
    const roomCodes: string[] = [];
    for (let roomIndex = 0; roomIndex < roomCount; roomIndex += 1) {
      const roomClients: TestClient[] = [];
      clients.push(roomClients);
      for (const cookie of cookies[roomIndex]) {
        const client = await connect(cookie);
        requireSuccess(await client.timeout(5_000).emitWithAck('player:resume'));
        roomClients.push(client);
      }
      const created = await roomClients[0].timeout(5_000).emitWithAck('room:create', { gameType: 'bridge' });
      requireSuccess(created);
      if (!created.roomCode) throw new Error('Missing fixture room');
      roomCodes.push(created.roomCode);
      for (let seatIndex = 0; seatIndex < 4; seatIndex += 1) {
        const client = roomClients[seatIndex];
        if (seatIndex > 0) requireSuccess(await client.timeout(5_000)
          .emitWithAck('room:join', { roomCode: created.roomCode }));
        requireSuccess(await client.timeout(5_000).emitWithAck('room:changeSeat', { seat: SEATS[seatIndex] }));
      }
    }

    function resetMetrics(): void {
      metrics.snapshots = 0;
      metrics.payloadBytes = 0;
      metrics.snapshotPayloadBytes = 0;
      metrics.chatPayloadBytes = 0;
      metrics.runtimeWrites = 0;
      metrics.recipients.clear();
      metrics.latestSnapshots.clear();
      metrics.chatMessages = 0;
    }
    resetMetrics();
    return {
      repository, application, baseUrl, clients, accountIds, cookies, roomCodes, metrics, connect, resetMetrics,
      close,
    };
  } catch (error) {
    try { await close(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Socket fixture setup and cleanup failed.', { cause: cleanupError }); }
    throw error;
  }
}
