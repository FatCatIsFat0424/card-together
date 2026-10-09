import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuthService, SESSION_COOKIE_NAME, tokenHash } from '../../src/auth/auth-service';
import { protectMutations } from '../../src/auth/http-middleware';
import { createJsonRepository } from '../../src/database/json-repository';
import type { Repository } from '../../src/database/repository';
import { createFriendRouter } from '../../src/http/friend-routes';
import type { FriendPresence } from '../../src/http/friend-routes';

const ORIGIN = 'http://localhost:5173';
const PASSWORD_HASH = `scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`;

describe('friend HTTP routes', () => {
  let directory: string;
  let repository: Repository;
  let server: Server;
  let baseUrl: string;
  let cookies: Record<string, string>;
  let presence: Map<string, FriendPresence>;

  beforeEach(async (): Promise<void> => {
    directory = await mkdtemp(join(tmpdir(), 'bridge-friend-routes-'));
    repository = await createJsonRepository(join(directory, 'database.json'));
    cookies = {};
    const now = Date.now();
    for (const [username, tokenCharacter] of [['alice', 'a'], ['bob', 'b'], ['carol', 'c']]) {
      await repository.createAccount({
        id: username,
        username,
        usernameNormalized: username,
        passwordHash: PASSWORD_HASH,
        nickname: username,
        color: '#2563eb',
        avatar: 'cat',
        avatarImage: null,
        tableBackground: null,
        tableBackgroundOpacity: 100,
        cardBack: null,
        cardBackOpacity: 100,
        matchesPublic: false,
        createdAt: now,
        updatedAt: now,
      });
      const token = tokenCharacter.repeat(43);
      await repository.createSession({
        tokenHash: tokenHash(token),
        accountId: username,
        createdAt: now,
        expiresAt: now + 60_000,
      }, PASSWORD_HASH);
      cookies[username] = `${SESSION_COOKIE_NAME}=${token}`;
    }
    const app = express();
    app.use(express.json());
    app.use(protectMutations([ORIGIN]));
    presence = new Map();
    app.use('/api/friends', createFriendRouter(repository, createAuthService(repository),
      async (ids) => new Map(ids.flatMap((id) => presence.has(id) ? [[id, presence.get(id)!] as const] : []))));
    server = createServer(app);
    await new Promise<void>((resolve): void => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
    baseUrl = `http://127.0.0.1:${address.port}/api/friends`;
  });

  afterEach(async (): Promise<void> => {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject): void => {
        server.close((error): void => error ? reject(error) : resolve());
      });
    }
    await repository?.close();
    await rm(directory, { recursive: true, force: true });
  });

  function headers(username: string): Record<string, string> {
    return { Cookie: cookies[username], Origin: ORIGIN, 'Content-Type': 'application/json' };
  }

  it('should require an active session for reading, lookup and friend mutations', async () => {
    for (const [method, path] of [
      ['GET', ''], ['GET', '/search?username=bob'], ['POST', '/requests'],
      ['POST', '/requests/request-id/accept'], ['DELETE', '/requests/request-id'], ['DELETE', '/bob'],
    ]) {
      const response = await fetch(`${baseUrl}${path}`, {
        method, headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ success: false });
    }
    await repository.deleteAccountSessions('alice');
    const revoked = await fetch(baseUrl, { headers: headers('alice') });
    expect(revoked.status).toBe(401);
  });

  it('should use session identity and only let the recipient accept', async () => {
    const sent = await fetch(`${baseUrl}/requests`, {
      method: 'POST', headers: headers('alice'),
      body: JSON.stringify({ username: 'bob', accountId: 'carol', requesterId: 'carol' }),
    });
    expect(sent.status).toBe(201);
    const body = await sent.json();
    expect(body).toMatchObject({
      success: true, request: { requester: { id: 'alice' }, recipient: { id: 'bob' } },
    });
    expect(JSON.stringify(body)).not.toContain('passwordHash');
    const requestId = body.request.id as string;
    for (const username of ['alice', 'carol']) {
      const rejected = await fetch(`${baseUrl}/requests/${requestId}/accept`, {
        method: 'POST', headers: headers(username),
      });
      expect(rejected.status).toBe(404);
    }
    const accepted = await fetch(`${baseUrl}/requests/${requestId}/accept`, {
      method: 'POST', headers: headers('bob'),
    });
    expect(await accepted.json()).toEqual({ success: true });
    const listed = await fetch(baseUrl, { headers: headers('alice') });
    expect(await listed.json()).toMatchObject({
      success: true, friends: [{ id: 'bob', online: false, inRoom: false }], incoming: [], outgoing: [],
    });
    presence.set('bob', { online: true, inRoom: true });
    const present = await fetch(baseUrl, { headers: headers('alice') });
    expect(await present.json()).toMatchObject({ friends: [{ id: 'bob', online: true, inRoom: true }] });
    const removed = await fetch(`${baseUrl}/bob`, { method: 'DELETE', headers: headers('alice') });
    expect(await removed.json()).toEqual({ success: true });
    const empty = await fetch(baseUrl, { headers: headers('bob') });
    expect(await empty.json()).toEqual({ success: true, friends: [], incoming: [], outgoing: [] });
  });

  it('should reject cross-origin mutations even with a valid session', async () => {
    const response = await fetch(`${baseUrl}/requests`, {
      method: 'POST',
      headers: { ...headers('alice'), Origin: 'https://untrusted.example' },
      body: JSON.stringify({ username: 'bob' }),
    });
    expect(response.status).toBe(403);
    expect(await repository.listFriendships('alice')).toEqual([]);
  });

  it('should validate friend request bodies and exact username lookup queries', async () => {
    for (const body of [{}, [], { username: 42 }, { username: ['bob'] }]) {
      const invalid = await fetch(`${baseUrl}/requests`, {
        method: 'POST', headers: headers('alice'), body: JSON.stringify(body),
      });
      expect(invalid.status).toBe(400);
    }
    const invalidQuery = await fetch(`${baseUrl}/search?username=bob&username=carol`, {
      headers: headers('alice'),
    });
    expect(invalidQuery.status).toBe(400);
    const found = await fetch(`${baseUrl}/search?username=BOB`, { headers: headers('alice') });
    expect(await found.json()).toEqual({
      success: true,
      account: {
        id: 'bob', username: 'bob', nickname: 'bob', color: '#2563eb', avatar: 'cat',
        avatarImage: null,
      },
    });
  });
});
