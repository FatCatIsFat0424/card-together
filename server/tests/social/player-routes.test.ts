import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApplication } from '../../src/app';
import { SESSION_COOKIE_NAME, tokenHash } from '../../src/auth/auth-service';
import { createJsonRepository } from '../../src/database/json-repository';
import type { AccountRecord, Repository } from '../../src/database/repository';

const ORIGIN = 'http://localhost:5173';
const PASSWORD_HASH = `scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`;

describe('public player profile HTTP routes', () => {
  let directory: string;
  let repository: Repository;
  let application: Awaited<ReturnType<typeof createApplication>>;
  let baseUrl: string;
  let accounts: Record<string, AccountRecord>;
  let cookies: Record<string, string>;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'bridge-player-profiles-'));
    repository = await createJsonRepository(join(directory, 'database.json'));
    accounts = {};
    cookies = {};
    const now = Date.now();
    for (const [username, tokenCharacter] of [
      ['alice', 'a'],
      ['bravo', 'b'],
    ]) {
      const account: AccountRecord = {
        id: randomUUID(),
        username,
        usernameNormalized: username,
        nickname: `${username} nickname`,
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
        passwordHash: PASSWORD_HASH,
      };
      await repository.createAccount(account);
      accounts[username] = account;
      const token = tokenCharacter.repeat(43);
      await repository.createSession(
        {
          tokenHash: tokenHash(token),
          accountId: account.id,
          createdAt: now,
          expiresAt: now + 60_000,
        },
        PASSWORD_HASH,
      );
      cookies[username] = `${SESSION_COOKIE_NAME}=${token}`;
    }
    application = await createApplication(repository, { allowedOrigins: [ORIGIN] });
    await new Promise<void>((resolve) => {
      application.httpServer.listen(0, '127.0.0.1', resolve);
    });
    const address = application.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Expected HTTP server address.');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await application?.close();
    await rm(directory, { recursive: true, force: true });
  });

  function headers(username = 'alice'): Record<string, string> {
    return { Cookie: cookies[username], Origin: ORIGIN, 'Content-Type': 'application/json' };
  }

  it('should require an active session for both existing and missing profiles', async () => {
    for (const accountId of [accounts.alice.id, randomUUID()]) {
      const response = await fetch(`${baseUrl}/api/players/${accountId}`);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ success: false, error: 'Sign in to continue.' });
    }
    await repository.deleteAccountSessions(accounts.alice.id);
    const revoked = await fetch(`${baseUrl}/api/players/${accounts.bravo.id}`, {
      headers: headers(),
    });
    expect(revoked.status).toBe(401);
    const expiredToken = 'c'.repeat(43);
    await repository.createSession(
      {
        tokenHash: tokenHash(expiredToken),
        accountId: accounts.alice.id,
        createdAt: 100,
        expiresAt: 200,
      },
      PASSWORD_HASH,
    );
    const expired = await fetch(`${baseUrl}/api/players/${accounts.bravo.id}`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${expiredToken}` },
    });
    expect(expired.status).toBe(401);
  });

  it('should expose exactly the same public fields for self and another player', async () => {
    for (const account of Object.values(accounts)) {
      const response = await fetch(`${baseUrl}/api/players/${account.id}`, { headers: headers() });
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({
        success: true,
        account: {
          id: account.id,
          username: account.username,
          nickname: account.nickname,
          color: account.color,
          avatar: account.avatar,
          avatarImage: null,
        },
      });
    }
    // Viewing another profile does not require creating a friendship first.
    expect(await repository.listFriendships(accounts.alice.id)).toEqual([]);
  });

  it('should return 404 for an absent player and reject malformed or oversized IDs', async () => {
    const missing = await fetch(`${baseUrl}/api/players/${randomUUID()}`, { headers: headers() });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ success: false, error: 'Player not found.' });
    for (const malformed of ['x'.repeat(129), 'invalid%20id', 'invalid%2Fid']) {
      const response = await fetch(`${baseUrl}/api/players/${malformed}`, { headers: headers() });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ success: false, error: 'Invalid player ID.' });
    }
  });

  it('should return fresh nickname, avatar and color after the owner edits their account', async () => {
    const target = `${baseUrl}/api/players/${accounts.bravo.id}`;
    const before = await fetch(target, { headers: headers() });
    expect((await before.json()).account.avatar).toBe('cat');
    const updated = await fetch(`${baseUrl}/api/auth/profile`, {
      method: 'PATCH',
      headers: headers('bravo'),
      body: JSON.stringify({ nickname: 'New nickname', avatar: 'fox', color: '#abcdef' }),
    });
    expect(updated.status).toBe(200);
    const after = await fetch(target, { headers: headers() });
    expect(await after.json()).toEqual({
      success: true,
      account: {
        id: accounts.bravo.id,
        username: 'bravo',
        nickname: 'New nickname',
        avatar: 'fox',
        avatarImage: null,
        color: '#abcdef',
      },
    });
  });

  it('should show match history to its owner and to others only once made public', async () => {
    const extra = ['charlie', 'delta'].map((username) => ({
      ...accounts.alice, id: randomUUID(), username, usernameNormalized: username,
    }));
    for (const account of extra) await repository.createAccount(account);
    await repository.saveMatch({
      id: randomUUID(),
      roomCode: 'ABC123',
      accountIds: [accounts.alice.id, accounts.bravo.id, ...extra.map((account) => account.id)],
      finishedAt: 500,
      result: {
        gameType: 'bridge',
        contract: { level: 1, suit: 'nt', declarer: 'N' },
        declarerTeamTricks: 7,
        defenderTeamTricks: 6,
        requiredTricks: 7,
        declarerTeamWins: true,
      },
    });
    const history = `${baseUrl}/api/players/${accounts.bravo.id}/history`;
    const own = await fetch(history, { headers: headers('bravo') });
    expect(own.status).toBe(200);
    const body = await own.json();
    expect(body.matches).toHaveLength(1);
    expect(body.players[accounts.alice.id]).toMatchObject({ username: 'alice', avatarImage: null });
    expect(body.players[accounts.alice.id]).not.toHaveProperty('passwordHash');

    const hidden = await fetch(history, { headers: headers() });
    expect(hidden.status).toBe(403);
    expect((await hidden.json()).success).toBe(false);

    const published = await fetch(`${baseUrl}/api/auth/profile`, {
      method: 'PATCH',
      headers: headers('bravo'),
      body: JSON.stringify({ matchesPublic: true }),
    });
    expect(published.status).toBe(200);
    const visible = await fetch(history, { headers: headers() });
    expect(visible.status).toBe(200);
    expect((await visible.json()).matches).toHaveLength(1);

    const missing = await fetch(`${baseUrl}/api/players/${randomUUID()}/history`, { headers: headers() });
    expect(missing.status).toBe(404);
  });

  it('should use the application error handler without exposing repository details', async () => {
    const lookup = repository.getAccountById.bind(repository);
    vi.spyOn(repository, 'getAccountById').mockImplementation(async (id) => {
      if (id === accounts.bravo.id) throw new Error('private database path and internal query');
      return lookup(id);
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await fetch(`${baseUrl}/api/players/${accounts.bravo.id}`, {
      headers: headers(),
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false,
      error: 'Unable to complete the request. Please try again.',
    });
  });
});
