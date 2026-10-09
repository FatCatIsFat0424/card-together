import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAuthService,
  LEGACY_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  tokenHash,
} from '../../src/auth/auth-service';
import { createJsonRepository } from '../../src/database/json-repository';
import type { Repository } from '../../src/database/repository';
import { createAuthRouter } from '../../src/http/auth-routes';

const ORIGIN = 'http://localhost:5173';
const HEADERS = { Origin: ORIGIN, 'Content-Type': 'application/json' };

describe('account HTTP routes', () => {
  let directory: string;
  let repository: Repository;
  let server: Server;
  let baseUrl: string;
  let migrationHeaders: Record<string, string>;
  const onAccountUpdated = vi.fn();
  const onSessionsRevoked = vi.fn();

  beforeEach(async () => {
    onAccountUpdated.mockReset();
    onSessionsRevoked.mockReset();
    directory = await mkdtemp(join(tmpdir(), 'bridge-auth-http-'));
    repository = await createJsonRepository(join(directory, 'database.json'));
    const app = express();
    app.use(express.json({ limit: '16kb' }));
    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server.');
    baseUrl = `http://127.0.0.1:${address.port}/api/auth`;
    migrationHeaders = {
      ...HEADERS, Origin: new URL(baseUrl).origin, 'Sec-Fetch-Site': 'same-origin',
    };
    app.use(
      '/api/auth',
      createAuthRouter(createAuthService(repository), {
        allowedOrigins: [ORIGIN, new URL(baseUrl).origin],
        secureCookies: true,
        onAccountUpdated,
        onSessionsRevoked,
      }),
    );
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await repository.close();
    await rm(directory, { recursive: true, force: true });
  });

  async function register(username = 'alice'): Promise<{ cookie: string; id: string }> {
    const response = await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ username, password: 'correct password' }),
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({ success: true, account: { username } });
    expect(body).not.toHaveProperty('token');
    expect(body.account).not.toHaveProperty('passwordHash');
    const cookieHeader = response.headers.get('set-cookie')!;
    expect(cookieHeader).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=`));
    expect(cookieHeader).toContain('HttpOnly');
    expect(cookieHeader).toContain('SameSite=Lax');
    expect(cookieHeader).toContain('Secure');
    expect(response.headers.get('cache-control')).toBe('no-store');
    return { cookie: cookieHeader.split(';')[0], id: body.account.id as string };
  }

  it('should issue secure cookies, protect profile identity and invalidate the session on logout', async () => {
    const { cookie, id } = await register();
    const me = await fetch(`${baseUrl}/me`, { headers: { Cookie: cookie } });
    expect((await me.json()).account.id).toBe(id);
    const updated = await fetch(`${baseUrl}/profile`, {
      method: 'PATCH',
      headers: { ...HEADERS, Cookie: cookie },
      body: JSON.stringify({ nickname: 'Alice Fox', avatar: 'fox', id: 'someone-else' }),
    });
    expect(await updated.json()).toMatchObject({
      account: { id, nickname: 'Alice Fox', avatar: 'fox' },
    });
    expect(onAccountUpdated).toHaveBeenCalledWith(expect.objectContaining({ id, avatar: 'fox' }));
    const logout = await fetch(`${baseUrl}/logout`, {
      method: 'POST',
      headers: { ...HEADERS, Cookie: cookie },
    });
    expect(await logout.json()).toEqual({ success: true });
    expect(logout.headers.get('set-cookie')).toContain('Expires=Thu, 01 Jan 1970');
    expect(onSessionsRevoked).toHaveBeenCalledWith(id, expect.any(String));
    expect((await fetch(`${baseUrl}/me`, { headers: { Cookie: cookie } })).status).toBe(401);
  });

  it('should report a saved profile as successful when live sync fails', async () => {
    const { cookie, id } = await register();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    onAccountUpdated.mockRejectedValueOnce(new Error('runtime unavailable'));
    const updated = await fetch(`${baseUrl}/profile`, {
      method: 'PATCH',
      headers: { ...HEADERS, Cookie: cookie },
      body: JSON.stringify({ nickname: 'Saved anyway' }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ success: true, account: { id, nickname: 'Saved anyway' } });
    expect(error).toHaveBeenCalledTimes(1);
    expect((await repository.getAccountById(id))?.nickname).toBe('Saved anyway');
    error.mockRestore();
  });

  it('should migrate a legacy cookie without exposing the token or extending its expiry', async () => {
    const { id } = await register();
    const token = 'a'.repeat(43);
    const expiresAt = Math.floor(Date.now() / 1000) * 1000 + 60000;
    await repository.createSession({
      accountId: id, tokenHash: tokenHash(token), createdAt: Date.now(), expiresAt,
    }, (await repository.getAccountById(id))!.passwordHash);
    const legacyCookie = `${LEGACY_SESSION_COOKIE_NAME}=${token}`;
    const legacyMe = await fetch(`${baseUrl}/me`, { headers: { Cookie: legacyCookie } });
    expect(legacyMe.status).toBe(200);
    const response = await fetch(`${baseUrl}/migrate-session`, {
      method: 'POST', headers: { ...migrationHeaders, Cookie: legacyCookie }, body: '{}',
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ success: true, account: { id } });
    expect(body).not.toHaveProperty('token');
    const cookies = response.headers.getSetCookie();
    const migrated = cookies.find((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`));
    expect(migrated).toContain(`${SESSION_COOKIE_NAME}=${token}`);
    expect(migrated).toContain('Path=/card-together/');
    expect(migrated).toContain(`Expires=${new Date(expiresAt).toUTCString()}`);
    expect(migrated).toContain('HttpOnly');
    expect(migrated).toContain('Secure');
    expect(migrated).toContain('SameSite=Lax');
    expect(cookies).toEqual(expect.arrayContaining([
      expect.stringContaining(`${LEGACY_SESSION_COOKIE_NAME}=; Path=/bridge_online/`),
      expect.stringContaining(`${LEGACY_SESSION_COOKIE_NAME}=; Path=/;`),
    ]));
    const migratedCookie = `${SESSION_COOKIE_NAME}=${token}`;
    const migratedMe = await fetch(`${baseUrl}/me`, { headers: { Cookie: migratedCookie } });
    expect(migratedMe.status).toBe(200);
    await fetch(`${baseUrl}/logout`, {
      method: 'POST', headers: { ...HEADERS, Cookie: migratedCookie }, body: '{}',
    });
    const repeat = await fetch(`${baseUrl}/migrate-session`, {
      method: 'POST', headers: { ...migrationHeaders, Cookie: legacyCookie }, body: '{}',
    });
    expect(repeat.status).toBe(401);
    expect(repeat.headers.get('set-cookie')).toBeNull();
  });

  it('should upgrade a legacy cookie on authenticated restore with its original expiry', async () => {
    const { cookie, id } = await register();
    const token = cookie.split('=')[1];
    const session = await repository.getSession(tokenHash(token));
    const response = await fetch(`${baseUrl}/me`, {
      headers: { Cookie: cookie.replace(SESSION_COOKIE_NAME, LEGACY_SESSION_COOKIE_NAME) },
    });
    expect(response.status).toBe(200);
    expect((await response.json()).account.id).toBe(id);
    const cookies = response.headers.getSetCookie();
    const upgraded = cookies.find((value) => value.startsWith(`${SESSION_COOKIE_NAME}=`));
    expect(upgraded).toContain(`${cookie}; Path=/;`);
    expect(upgraded).toContain(`Expires=${new Date(session!.expiresAt).toUTCString()}`);
    expect(upgraded).toContain('HttpOnly');
    expect(upgraded).toContain('Secure');
    expect(upgraded).toContain('SameSite=Lax');
    for (const path of ['/', '/card-together/', '/bridge_online/']) {
      expect(cookies).toContainEqual(
        expect.stringContaining(`${LEGACY_SESSION_COOKIE_NAME}=; Path=${path};`),
      );
    }
    const restored = await fetch(`${baseUrl}/me`, { headers: { Cookie: cookie } });
    expect(restored.status).toBe(200);
    expect(restored.headers.get('set-cookie')).toBeNull();
  });

  it('should migrate a new cookie issued through the legacy application path', async () => {
    const { cookie, id } = await register();
    const migrated = await fetch(`${baseUrl}/migrate-session`, {
      method: 'POST', headers: { ...migrationHeaders, Cookie: cookie }, body: '{}',
    });
    expect(migrated.status).toBe(200);
    expect((await migrated.json()).account.id).toBe(id);
    expect(migrated.headers.getSetCookie()).toContainEqual(
      expect.stringContaining(`${cookie}; Path=/card-together/`),
    );
  });

  it('should retain a valid new identity and revoke both presented sessions on logout', async () => {
    const current = await register('alice');
    const legacy = await register('bob');
    const legacyCookie = legacy.cookie.replace(SESSION_COOKIE_NAME, LEGACY_SESSION_COOKIE_NAME);
    const cookie = `${legacyCookie}; ${current.cookie}`;
    const restored = await fetch(`${baseUrl}/me`, { headers: { Cookie: cookie } });
    expect((await restored.json()).account.id).toBe(current.id);
    expect(restored.headers.get('set-cookie')).toBeNull();
    const migrated = await fetch(`${baseUrl}/migrate-session`, {
      method: 'POST', headers: { ...migrationHeaders, Cookie: cookie }, body: '{}',
    });
    expect((await migrated.json()).account.id).toBe(current.id);
    expect(migrated.headers.getSetCookie()).toContainEqual(
      expect.stringContaining(`${current.cookie}; Path=/card-together/`),
    );
    const logout = await fetch(`${baseUrl}/logout`, {
      method: 'POST', headers: { ...HEADERS, Cookie: cookie }, body: '{}',
    });
    for (const name of [SESSION_COOKIE_NAME, LEGACY_SESSION_COOKIE_NAME]) {
      for (const path of ['/', '/card-together/', '/bridge_online/']) {
        expect(logout.headers.getSetCookie()).toContainEqual(
          expect.stringContaining(`${name}=; Path=${path};`),
        );
      }
    }
    for (const savedCookie of [current.cookie, legacyCookie]) {
      expect((await fetch(`${baseUrl}/me`, { headers: { Cookie: savedCookie } })).status).toBe(401);
    }
  });

  it('should reject missing, malformed, expired, revoked, and body-supplied legacy tokens', async () => {
    const { cookie, id } = await register();
    const token = cookie.split('=')[1];
    const expiredToken = 'b'.repeat(43);
    await repository.createSession({
      accountId: id, tokenHash: tokenHash(expiredToken), createdAt: 1, expiresAt: 2,
    }, (await repository.getAccountById(id))!.passwordHash);
    for (const legacyCookie of [
      undefined, `${LEGACY_SESSION_COOKIE_NAME}=bad`,
      `${LEGACY_SESSION_COOKIE_NAME}=${expiredToken}`,
    ]) {
      const response = await fetch(`${baseUrl}/migrate-session?token=${token}`, {
        method: 'POST',
        headers: { ...migrationHeaders, ...(legacyCookie ? { Cookie: legacyCookie } : {}) },
        body: JSON.stringify({ token }),
      });
      expect(response.status).toBe(401);
      expect(response.headers.get('set-cookie')).toBeNull();
    }
    const response = await fetch(`${baseUrl}/migrate-session`, {
      method: 'POST',
      headers: {
        ...migrationHeaders,
        Cookie: `${SESSION_COOKIE_NAME}=bad; ${LEGACY_SESSION_COOKIE_NAME}=${token}`,
      },
      body: '{}',
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('should require same-origin JSON migration requests', async () => {
    const { cookie } = await register();
    for (const headers of [
      { ...HEADERS },
      { ...migrationHeaders, 'Sec-Fetch-Site': 'same-site' },
      { ...migrationHeaders, Origin: 'https://attacker.example' },
    ]) {
      const response = await fetch(`${baseUrl}/migrate-session`, {
        method: 'POST', headers: { ...headers, Cookie: cookie }, body: '{}',
      });
      expect(response.status).toBe(403);
    }
    const response = await fetch(`${baseUrl}/migrate-session`, {
      method: 'POST',
      headers: { ...migrationHeaders, 'Content-Type': 'text/plain', Cookie: cookie }, body: '{}',
    });
    expect(response.status).toBe(415);
  });

  it('should reject missing or untrusted origins and simple cross-site request formats', async () => {
    for (const origin of [undefined, 'https://attacker.example', 'null']) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (origin) headers.Origin = origin;
      const response = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ username: 'alice', password: 'correct password' }),
      });
      expect(response.status).toBe(403);
    }
    const simple = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'text/plain' },
      body: '{}',
    });
    expect(simple.status).toBe(415);
    expect(await repository.getAccountByUsername('alice')).toBeNull();
  });

  it('should rate limit authentication attempts before password derivation', async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: HEADERS,
        body: '{}',
      });
      expect(response.status).toBe(400);
    }
    const blocked = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: HEADERS,
      body: '{}',
    });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('should require authentication for profile, password, and logout-all', async () => {
    for (const [path, method] of [
      ['me', 'GET'],
      ['profile', 'PATCH'],
      ['password', 'POST'],
      ['logout-all', 'POST'],
    ]) {
      expect((await fetch(`${baseUrl}/${path}`, { method, headers: HEADERS })).status).toBe(401);
    }
  });

  it('should revoke all account sessions and clear the cookie after a password change', async () => {
    const { cookie, id } = await register();
    const login = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ username: 'alice', password: 'correct password' }),
    });
    const secondCookie = login.headers.get('set-cookie')!.split(';')[0];
    const changed = await fetch(`${baseUrl}/password`, {
      method: 'POST',
      headers: { ...HEADERS, Cookie: cookie },
      body: JSON.stringify({
        currentPassword: 'correct password',
        newPassword: 'a brand new password',
      }),
    });
    expect(await changed.json()).toEqual({ success: true });
    expect(onSessionsRevoked).toHaveBeenCalledWith(id);
    expect(changed.headers.get('set-cookie')).toContain('Expires=Thu, 01 Jan 1970');
    for (const savedCookie of [cookie, secondCookie]) {
      expect((await fetch(`${baseUrl}/me`, { headers: { Cookie: savedCookie } })).status).toBe(401);
    }
  });
});
