import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthService } from '../../src/auth/auth-service';
import { createAuthRouter } from '../../src/http/auth-routes';
import { createPlayerRouter } from '../../src/http/player-routes';
import type { Repository } from '../../src/database/repository';
import { REPOSITORY_ADAPTERS } from '../helpers/repository-adapters';
import { seedAuthenticatedAccount } from './account-fixture';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

const ORIGIN = 'http://localhost:5173';
const HEADERS = { Origin: ORIGIN, 'Content-Type': 'application/json' };

describe.each(REPOSITORY_ADAPTERS)('owner progression HTTP routes ($name)', (adapter) => {
  let directory: string;
  let path: string;
  let repository: Repository;
  let server: Server;
  let baseUrl: string;
  const onAccountUpdated = vi.fn();

  beforeEach(async () => {
    onAccountUpdated.mockReset();
    directory = await mkdtemp(join(tmpdir(), 'progression-http-'));
    path = join(directory, adapter.fileName);
    repository = await adapter.open(path);
    const service = createAuthService(repository);
    const app = express();
    app.use(express.json());
    app.use('/api/auth', createAuthRouter(service, { allowedOrigins: [ORIGIN], onAccountUpdated }));
    app.use('/api/players', createPlayerRouter(repository, service));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server.');
    baseUrl = `http://127.0.0.1:${address.port}/api`;
  });
  afterEach(async () => {
    vi.mocked(rename).mockClear();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await repository.close();
    await rm(directory, { recursive: true, force: true });
  });

  async function seed(username: string, games = 0): Promise<{ id: string; headers: typeof HEADERS & { Cookie: string } }> {
    const fixture = await seedAuthenticatedAccount(repository, username, { coins: 321, matchesPublic: false,
      achievements: { games, wins: 0, gameTypes: games > 0 ? ['bigtwo'] : [], dailyTasks: 0 } });
    return { id: fixture.account.id, headers: { ...HEADERS, Cookie: fixture.cookie } };
  }

  function claim(headers: Record<string, string>, body: unknown): Promise<Response> {
    return fetch(`${baseUrl}/auth/progression/claim`, { method: 'POST', headers, body: JSON.stringify(body) });
  }

  it('requires a session and reads only the session owner even with a forged query', async () => {
    expect((await fetch(`${baseUrl}/auth/progression`)).status).toBe(401);
    expect((await claim(HEADERS, { reward: 'level-5' })).status).toBe(401);
    const owner = await seed('alice');
    const other = await seed('bob', 1225);
    const response = await fetch(`${baseUrl}/auth/progression?accountId=${other.id}`, { headers: owner.headers });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ success: true, progression: { level: { level: 1, games: 0, totalXp: '0' } } });
    expect((await claim(owner.headers, { reward: 'level-50' })).status).toBe(409);
    expect((await claim({ ...owner.headers, Origin: 'https://evil.example' }, { reward: 'level-5' })).status).toBe(403);
    expect(onAccountUpdated).not.toHaveBeenCalled();
  });

  it('rejects every extra payload field, account spoofing, invalid reward, and client progress', async () => {
    const owner = await seed('alice', 10);
    const other = await seed('bob', 1225);
    for (const body of [null, [], 'level-5', {}, { reward: 'level-1' }, { reward: 'nameplate-level-5' },
      { reward: 'level-5', accountId: other.id }, { reward: 'level-5', id: other.id },
      { reward: 'level-5', account: { id: other.id } }, { reward: 'level-5', progress: 999 },
      { reward: 'level-5', progression: { level: 50 } }, { reward: 'level-5', amount: 100 },
      { reward: 'level-5', games: 1225 }, { reward: 'level-5', claimed: true }]) {
      expect((await claim(owner.headers, body)).status).toBe(400);
    }
    expect(onAccountUpdated).not.toHaveBeenCalled();
    expect((await repository.getAccountById(owner.id))!.ownedAchievementNameplates).toBeUndefined();
    expect((await repository.getAccountById(other.id))!.ownedAchievementNameplates).toBeUndefined();
    expect((await claim(owner.headers, { reward: 'level-5' })).status).toBe(200);
    expect((await repository.getAccountById(other.id))!.ownedAchievementNameplates).toBeUndefined();
  });

  it('publishes a sanitized account only after durable ownership and supports retry and equipment', async () => {
    const owner = await seed('alice', 10);
    onAccountUpdated.mockImplementation(async () => {
      const committed = await adapter.readDocument(path);
      expect(committed.accounts.find((entry) => entry.id === owner.id)!.ownedAchievementNameplates).toEqual(['nameplate-level-5']);
    });
    const response = await claim(owner.headers, { reward: 'level-5' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ success: true, account: { id: owner.id, coins: 321,
      nameplate: null, ownedAchievementNameplates: ['nameplate-level-5'] }, progression: {
      level: { level: 5, games: 10, totalXp: '1000' }, rewards: expect.arrayContaining([
        { id: 'level-5', eligible: true, claimed: true },
      ]),
    } });
    for (const field of ['passwordHash', 'achievements', 'dailyRewards', 'progression']) expect(body.account).not.toHaveProperty(field);
    expect(onAccountUpdated).toHaveBeenCalledWith(body.account);
    const updatedAt = body.account.updatedAt;
    expect((await (await claim(owner.headers, { reward: 'level-5' })).json()).account.updatedAt).toBe(updatedAt);
    expect((await fetch(`${baseUrl}/auth/shop/items`, { method: 'POST', headers: owner.headers,
      body: JSON.stringify({ item: 'nameplate-level-5' }) })).status).toBe(400);
    const equipped = await fetch(`${baseUrl}/auth/profile`, { method: 'PATCH', headers: owner.headers,
      body: JSON.stringify({ nameplate: 'nameplate-level-5' }) });
    expect(equipped.status).toBe(200);
    const viewer = await seed('bob');
    const profile = await (await fetch(`${baseUrl}/players/${owner.id}`, { headers: viewer.headers })).json();
    expect(profile).toEqual({ success: true, account: { id: owner.id, username: 'alice', nickname: 'alice',
      color: '#2563eb', avatar: 'cat', avatarImage: null, avatarBorder: null, nameplate: 'nameplate-level-5', chatFrame: null } });
  });

  it('never publishes a failed grant, keeps progress unclaimed, and allows retry', async () => {
    const owner = await seed('alice', 10);
    const before = await adapter.persisted(path);
    adapter.failNextCommit(new Error('disk full'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect((await claim(owner.headers, { reward: 'level-5' })).status).toBe(500);
    } finally {
      errorLog.mockRestore();
    }
    expect(onAccountUpdated).not.toHaveBeenCalled();
    expect(await adapter.persisted(path)).toBe(before);
    const progress = await (await fetch(`${baseUrl}/auth/progression`, { headers: owner.headers })).json();
    expect(progress.progression.rewards[0]).toEqual({ id: 'level-5', eligible: true, claimed: false });
    expect((await claim(owner.headers, { reward: 'level-5' })).status).toBe(200);
    expect(onAccountUpdated).toHaveBeenCalledTimes(1);
  });
});
