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
import * as passwords from '../../src/auth/password';
import { createAuthRouter } from '../../src/http/auth-routes';
import { seedAuthenticatedAccount } from './account-fixture';

const ORIGIN = 'http://localhost:5173';
const HEADERS = { Origin: ORIGIN, 'Content-Type': 'application/json' };

describe('account HTTP routes', () => {
  let directory: string;
  let repository: Repository;
  let server: Server;
  let baseUrl: string;
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
    app.use(
      '/api/auth',
      createAuthRouter(createAuthService(repository), {
        allowedOrigins: [ORIGIN],
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

  async function seedAccount(username = 'alice'): Promise<{ cookie: string; id: string }> {
    const seeded = await seedAuthenticatedAccount(repository, username);
    return { cookie: seeded.cookie, id: seeded.account.id };
  }

  it('authenticates achievement progress and claims, rejects forged ownership and purchases, and equips earned titles', async () => {
    expect((await fetch(`${baseUrl}/achievements`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/achievements/claim`, { method: 'POST', headers: HEADERS,
      body: JSON.stringify({ category: 'table' }) })).status).toBe(401);
    const { cookie, id } = await seedAccount();
    const headers = { ...HEADERS, Cookie: cookie };
    const progress = await fetch(`${baseUrl}/achievements`, { headers });
    expect(progress.status).toBe(200);
    expect(progress.headers.get('cache-control')).toBe('no-store');
    expect(await progress.json()).toMatchObject({ achievements: { categories: [{ id: 'table', claimed: false }, { id: 'daily' }] } });
    const claim = (body: unknown) => fetch(`${baseUrl}/achievements/claim`, { method: 'POST', headers, body: JSON.stringify(body) });
    expect((await claim({ category: 'unknown' })).status).toBe(400);
    expect((await claim({ category: 'table', games: 100, wins: 100, claimed: true })).status).toBe(409);
    expect((await fetch(`${baseUrl}/achievements/claim`, { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' },
      body: JSON.stringify({ category: 'table' }) })).status).toBe(403);
    expect((await fetch(`${baseUrl}/shop/items`, { method: 'POST', headers,
      body: JSON.stringify({ item: 'nameplate-table-traveler', price: 0 }) })).status).toBe(400);
    expect((await fetch(`${baseUrl}/profile`, { method: 'PATCH', headers, body: JSON.stringify({
      nameplate: 'nameplate-table-traveler', ownedAchievementNameplates: ['nameplate-table-traveler'],
    }) })).status).toBe(403);
    expect(onAccountUpdated).not.toHaveBeenCalled();
    expect((await repository.getAccountById(id))!.ownedAchievementNameplates).toBeUndefined();

    const earned = await seedAuthenticatedAccount(repository, 'earner', { achievements: { games: 1000, wins: 250,
      gameTypes: ['bridge', 'bigtwo', 'sevens', 'holdem', 'blackjack'], dailyTasks: 0 } });
    const earnedHeaders = { ...HEADERS, Cookie: earned.cookie };
    onAccountUpdated.mockImplementation(async (account) => {
      expect((await repository.getAccountById(account.id))!.ownedAchievementNameplates).toContain('nameplate-table-traveler');
    });
    const claimed = await fetch(`${baseUrl}/achievements/claim`, { method: 'POST', headers: earnedHeaders,
      body: JSON.stringify({ category: 'table' }) });
    expect(claimed.status).toBe(200);
    const body = await claimed.json();
    expect(body.account.ownedAchievementNameplates).toEqual(['nameplate-table-traveler']);
    expect(body.account).not.toHaveProperty('achievements');
    expect(body.account).not.toHaveProperty('passwordHash');
    expect(onAccountUpdated).toHaveBeenCalledTimes(1);
    const equipped = await fetch(`${baseUrl}/profile`, { method: 'PATCH', headers: earnedHeaders,
      body: JSON.stringify({ nameplate: 'nameplate-table-traveler' }) });
    expect(equipped.status).toBe(200);
    expect(await equipped.json()).toMatchObject({ account: { nameplate: 'nameplate-table-traveler' } });
  });

  it('authenticates daily rewards, validates claims, and publishes only durable owner updates', async () => {
    expect((await fetch(`${baseUrl}/daily-rewards`)).status).toBe(401);
    const { cookie, id } = await seedAccount();
    const headers = { ...HEADERS, Cookie: cookie };
    const status = await (await fetch(`${baseUrl}/daily-rewards`, { headers })).json();
    expect(status).toMatchObject({ success: true, dailyRewards: { wins: 0, gameTypes: [] } });
    const day = status.dailyRewards.day as string;
    const claim = (body: object, origin = ORIGIN) => fetch(`${baseUrl}/daily-rewards`, {
      method: 'POST', headers: { ...headers, Origin: origin }, body: JSON.stringify(body),
    });
    expect((await claim({ reward: 'check-in', day }, 'https://evil.invalid')).status).toBe(403);
    expect((await claim({ reward: 'coins', day })).status).toBe(400);
    expect((await claim({ reward: 'check-in', day: 123 })).status).toBe(400);
    expect((await claim({ reward: 'win-two', day })).status).toBe(409);
    expect((await claim({ reward: 'check-in', day: '2000-01-01' })).status).toBe(409);
    expect(onAccountUpdated).not.toHaveBeenCalled();
    const response = await (await claim({ reward: 'check-in', day, coins: 9999, accountId: 'other' })).json();
    expect(response).toMatchObject({ success: true, account: { id, coins: 10, coinRevision: 1 },
      dailyRewards: { checkInDays: [day] } });
    expect(response.account).not.toHaveProperty('dailyRewards');
    expect(response.account).not.toHaveProperty('passwordHash');
    expect(onAccountUpdated).toHaveBeenCalledWith(expect.objectContaining({ id, coins: 10 }));
    await claim({ reward: 'check-in', day });
    expect(await repository.getAccountById(id)).toMatchObject({ coins: 10, coinRevision: 1 });
  });

  it('authenticates task replacement and returns a durable idempotent assignment', async () => {
    const path = `${baseUrl}/daily-rewards/replace`;
    expect((await fetch(path, { method: 'POST', headers: HEADERS, body: '{}' })).status).toBe(401);
    const { cookie, id } = await seedAccount();
    const headers = { ...HEADERS, Cookie: cookie };
    const initial = await (await fetch(`${baseUrl}/daily-rewards`, { headers })).json();
    const { day, tasks } = initial.dailyRewards;
    const replace = (task: string, date = day) => fetch(path, { method: 'POST', headers, body: JSON.stringify({ task, day: date }) });
    expect((await replace('fake')).status).toBe(400);
    expect((await replace(tasks[0].id, '2000-01-01')).status).toBe(409);
    const response = await (await replace(tasks[0].id)).json();
    expect(response).toMatchObject({ success: true, account: { id, coins: 0 }, dailyRewards: { swapsRemaining: 0 } });
    expect(response.dailyRewards.tasks).toHaveLength(3);
    expect(response.dailyRewards.tasks[0].id).not.toBe(tasks[0].id);
    expect(onAccountUpdated).toHaveBeenCalledWith(expect.objectContaining({ id, coins: 0 }));
    expect((await (await replace(tasks[0].id)).json()).dailyRewards.tasks).toEqual(response.dailyRewards.tasks);
    expect((await replace(tasks[1].id)).status).toBe(409);
  });

  it('should issue secure cookies, protect profile identity and invalidate the session on logout', async () => {
    const { cookie, id } = await register();
    const me = await fetch(`${baseUrl}/me`, { headers: { Cookie: cookie } });
    expect((await me.json()).account.id).toBe(id);
    const updated = await fetch(`${baseUrl}/profile`, {
      method: 'PATCH',
      headers: { ...HEADERS, Cookie: cookie },
      body: JSON.stringify({ nickname: 'Alice Fox', avatar: 'fox', id: 'someone-else', coins: 1000000 }),
    });
    expect(await updated.json()).toMatchObject({
      account: { id, nickname: 'Alice Fox', avatar: 'fox', coins: 0 },
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
    const { cookie, id } = await seedAccount();
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

  it('should authenticate purchases, ignore client prices and equip only owned borders', async () => {
    const { cookie, id } = await seedAccount();
    const headers = { ...HEADERS, Cookie: cookie };
    const buy = (body: object, requestHeaders: Record<string, string> = headers): Promise<Response> => fetch(`${baseUrl}/shop/avatar-borders`, {
      method: 'POST', headers: requestHeaders, body: JSON.stringify(body),
    });
    expect((await buy({ border: 'copper' }, HEADERS)).status).toBe(401);
    expect((await buy({ border: 'copper' }, { ...headers, Origin: 'https://attacker.example' })).status).toBe(403);
    expect((await buy({ border: 'unknown' })).status).toBe(400);
    expect((await buy({ border: 'copper', price: 0, coins: 9999 })).status).toBe(409);
    const bob = await seedAuthenticatedAccount(repository, 'bob', { id: 'shop-test-bob', coins: 100 });
    const bobHeaders = { ...HEADERS, Cookie: bob.cookie };
    const response = await buy({ border: 'copper', price: 0, accountId: id }, bobHeaders);
    expect(await response.json()).toMatchObject({ account: {
      id: 'shop-test-bob', coins: 50, coinRevision: 1, ownedAvatarBorders: ['copper'], avatarBorder: null,
    } });
    expect(await (await buy({ border: 'copper' }, bobHeaders)).json()).toMatchObject({ account: { coins: 50 } });
    const patch = (body: object): Promise<Response> => fetch(`${baseUrl}/profile`, {
      method: 'PATCH', headers: bobHeaders, body: JSON.stringify(body),
    });
    expect((await patch({ avatarBorder: 'gold', ownedAvatarBorders: ['gold'] })).status).toBe(403);
    expect(await (await patch({ avatarBorder: 'copper', coins: 9999 })).json()).toMatchObject({ account: {
      coins: 50, avatarBorder: 'copper', ownedAvatarBorders: ['copper'],
    } });
    expect(onAccountUpdated).toHaveBeenCalledWith(expect.objectContaining({ avatarBorder: 'copper' }));
    expect(await (await patch({ avatarBorder: null })).json()).toMatchObject({ account: { avatarBorder: null, coins: 50 } });
    expect((await repository.getAccountById(id))?.coins).toBe(0);
  });

  it('should authenticate every shop category, enforce catalog pricing and preserve equipment ownership', async () => {
    const owner = await seedAuthenticatedAccount(repository, 'cosmetic_owner', { coins: 1000 });
    const headers = { ...HEADERS, Cookie: owner.cookie };
    const buy = (body: unknown, requestHeaders: Record<string, string> = headers): Promise<Response> =>
      fetch(`${baseUrl}/shop/items`, { method: 'POST', headers: requestHeaders, body: JSON.stringify(body) });
    const patch = (body: unknown): Promise<Response> => fetch(`${baseUrl}/profile`, {
      method: 'PATCH', headers, body: JSON.stringify(body),
    });
    expect((await buy({ item: 'card-back-aurora' }, HEADERS)).status).toBe(401);
    expect((await buy({ item: 'card-back-aurora' }, { ...headers, Origin: 'https://attacker.example' })).status).toBe(403);
    for (const body of [null, [], {}, { item: 'unknown' }, { item: { id: 'card-back-aurora' } }]) {
      expect((await buy(body)).status).toBe(400);
    }
    expect((await patch({ cardBackStyle: 'card-back-aurora', ownedShopItems: ['card-back-aurora'] })).status).toBe(403);
    expect((await patch({ cardBackStyle: 'table-aurora' })).status).toBe(400);
    for (const item of ['card-back-aurora', 'table-tide', 'seat-sakura', 'nameplate-aurora', 'stickers-table-talk', 'sakura']) {
      expect((await buy({ item, price: 0, coins: 9999, accountId: 'another-account' })).status).toBe(200);
    }
    expect(await (await buy({ item: 'card-back-aurora' })).json()).toMatchObject({ account: {
      id: owner.account.id, coins: 200, coinRevision: 6,
      ownedAvatarBorders: ['sakura'],
      ownedShopItems: ['card-back-aurora', 'table-tide', 'seat-sakura', 'nameplate-aurora', 'stickers-table-talk'],
    } });
    expect(await (await patch({ cardBackStyle: 'card-back-aurora', tableBackgroundStyle: 'table-tide',
      seatBackgroundStyle: 'seat-sakura', nameplate: 'nameplate-aurora', avatarBorder: 'sakura', coins: 9999 })).json())
      .toMatchObject({ account: { coins: 200, cardBackStyle: 'card-back-aurora', tableBackgroundStyle: 'table-tide',
        seatBackgroundStyle: 'seat-sakura', nameplate: 'nameplate-aurora', avatarBorder: 'sakura' } });
    expect(onAccountUpdated).toHaveBeenCalledWith(expect.objectContaining({ nameplate: 'nameplate-aurora' }));
    expect((await patch({ nameplate: 'nameplate-tide' })).status).toBe(403);
    expect((await patch({ nameplate: 'stickers-table-talk' })).status).toBe(400);
    expect(await (await patch({ cardBackStyle: null, tableBackgroundStyle: null, seatBackgroundStyle: null, nameplate: null })).json())
      .toMatchObject({ account: { cardBackStyle: null, tableBackgroundStyle: null, seatBackgroundStyle: null, nameplate: null, coins: 200 } });
    expect((await buy({ item: 'gold', price: 0 })).status).toBe(409);
  });

  it('should reject unowned official equipment when registering', async () => {
    const response = await fetch(`${baseUrl}/register`, {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({ username: 'new_owner', password: 'correct password', nameplate: 'nameplate-aurora',
        ownedShopItems: ['nameplate-aurora'] }),
    });
    expect(response.status).toBe(403);
    expect(await repository.getAccountByUsername('new_owner')).toBeNull();
  });

  it.each([
    ['frog', 160], ['bear', 150], ['dog', 150], ['antlers', 220], ['cthulhu', 280],
  ])('should purchase and equip the %s border at its catalog price', async (border, price) => {
    const { id } = await register();
    const account = await repository.getAccountById(id);
    if (!account) throw new Error('Expected a registered account.');
    await repository.createAccount({ ...account, id: 'animal-border-bob',
      username: 'bob', usernameNormalized: 'bob', coins: 1000 });
    const login = await fetch(`${baseUrl}/login`, {
      method: 'POST', headers: HEADERS, body: JSON.stringify({ username: 'bob', password: 'correct password' }),
    });
    const headers = { ...HEADERS, Cookie: login.headers.get('set-cookie')!.split(';')[0] };
    const purchased = await fetch(`${baseUrl}/shop/avatar-borders`, {
      method: 'POST', headers, body: JSON.stringify({ border, price: 0 }),
    });
    expect(purchased.status).toBe(200);
    expect(await purchased.json()).toMatchObject({ account: {
      coins: 1000 - price, ownedAvatarBorders: [border], avatarBorder: null,
    } });
    const equipped = await fetch(`${baseUrl}/profile`, {
      method: 'PATCH', headers, body: JSON.stringify({ avatarBorder: border }),
    });
    expect(equipped.status).toBe(200);
    expect(await equipped.json()).toMatchObject({ account: { avatarBorder: border } });
    const restored = await fetch(`${baseUrl}/me`, { headers: { Cookie: headers.Cookie } });
    expect(await restored.json()).toMatchObject({ account: {
      coins: 1000 - price, ownedAvatarBorders: [border], avatarBorder: border,
    } });
  });

  it('should upgrade a legacy cookie on authenticated restore with its original expiry', async () => {
    const { cookie, id } = await seedAccount();
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
    for (const path of ['/', '/card-together/']) {
      expect(cookies).toContainEqual(
        expect.stringContaining(`${LEGACY_SESSION_COOKIE_NAME}=; Path=${path};`),
      );
    }
    const restored = await fetch(`${baseUrl}/me`, { headers: { Cookie: cookie } });
    expect(restored.status).toBe(200);
    expect(restored.headers.get('set-cookie')).toBeNull();
  });

  it('should retain a valid new identity and revoke both presented sessions on logout', async () => {
    const current = await seedAccount('alice');
    const legacy = await seedAccount('bob');
    const legacyCookie = legacy.cookie.replace(SESSION_COOKIE_NAME, LEGACY_SESSION_COOKIE_NAME);
    const cookie = `${legacyCookie}; ${current.cookie}`;
    const restored = await fetch(`${baseUrl}/me`, { headers: { Cookie: cookie } });
    expect((await restored.json()).account.id).toBe(current.id);
    expect(restored.headers.get('set-cookie')).toBeNull();
    const logout = await fetch(`${baseUrl}/logout`, {
      method: 'POST', headers: { ...HEADERS, Cookie: cookie }, body: '{}',
    });
    for (const name of [SESSION_COOKIE_NAME, LEGACY_SESSION_COOKIE_NAME]) {
      for (const path of ['/', '/card-together/']) {
        expect(logout.headers.getSetCookie()).toContainEqual(
          expect.stringContaining(`${name}=; Path=${path};`),
        );
      }
    }
    for (const savedCookie of [current.cookie, legacyCookie]) {
      expect((await fetch(`${baseUrl}/me`, { headers: { Cookie: savedCookie } })).status).toBe(401);
    }
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
    const derive = vi.spyOn(passwords, 'verifyPassword');
    const blocked = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ username: 'alice', password: 'valid password' }),
    });
    expect(derive).not.toHaveBeenCalled();
    derive.mockRestore();
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
