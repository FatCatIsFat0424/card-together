import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createAuthService,
  LEGACY_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  readSessionCookie,
} from '../../src/auth/auth-service';
import type { AuthService } from '../../src/auth/auth-service';
import { createJsonRepository } from '../../src/database/json-repository';
import type { Repository } from '../../src/database/repository';

describe('account authentication', () => {
  let directory: string;
  let path: string;
  let repository: Repository;
  let service: AuthService;
  let time: number;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'bridge-auth-test-'));
    path = join(directory, 'database.json');
    repository = await createJsonRepository(path);
    time = 1000;
    service = createAuthService(repository, { now: () => time, sessionTtlMs: 10000 });
  });
  afterEach(async () => {
    await repository.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('should register, authenticate case-insensitively, and never store raw credentials or tokens', async () => {
    const registered = await service.register({
      username: 'Alice',
      password: 'correct horse battery',
    });
    expect(registered.account.username).toBe('Alice');
    expect(registered.account).not.toHaveProperty('passwordHash');
    const text = await readFile(path, 'utf8');
    expect(text).not.toContain('correct horse battery');
    expect(text).not.toContain(registered.token);
    expect(text).toContain('scrypt$131072$8$1$');
    const login = await service.login({ username: 'alice', password: 'correct horse battery' });
    expect(login.account.id).toBe(registered.account.id);
    expect(login.token).not.toBe(registered.token);
    expect(await service.resolveSession(`other=foo; bridge_session=${login.token}`)).toMatchObject({
      account: registered.account,
    });
  });

  it('should prefer the new session cookie and preserve legacy authentication', async () => {
    const current = await service.register({ username: 'alice', password: 'correct password' });
    const legacy = await service.register({ username: 'bob', password: 'correct password' });
    const legacyCookie = `${LEGACY_SESSION_COOKIE_NAME}=${legacy.token}`;
    const cookie = `${legacyCookie}; ${SESSION_COOKIE_NAME}=${current.token}`;
    expect((await service.resolveSession(cookie))?.account.id).toBe(current.account.id);
    expect((await service.resolveSession(legacyCookie))?.account.id).toBe(legacy.account.id);
    expect(await service.resolveSession(`${SESSION_COOKIE_NAME}=bad; ${legacyCookie}`)).toBeNull();
    expect(readSessionCookie(SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it('should return the same invalid-credentials error for unknown usernames and incorrect passwords', async () => {
    await service.register({ username: 'alice', password: 'correct password' });
    for (const username of ['alice', 'unknown']) {
      await expect(service.login({ username, password: 'wrong password' })).rejects.toMatchObject({
        status: 401,
        message: 'Invalid username or password.',
      });
    }
  });

  it('should preserve sessions across reopening, reject expired sessions, and support logout-all', async () => {
    const first = await service.register({ username: 'alice', password: 'correct password' });
    const second = await service.login({ username: 'alice', password: 'correct password' });
    await repository.close();
    repository = await createJsonRepository(path);
    service = createAuthService(repository, { now: () => time, sessionTtlMs: 10000 });
    expect(await service.resolveToken(first.token)).not.toBeNull();
    time = 11000;
    expect(await service.resolveToken(first.token)).toBeNull();
    time = 2000;
    await service.logoutAll(first.account.id);
    expect(await service.resolveToken(first.token)).toBeNull();
    expect(await service.resolveToken(second.token)).toBeNull();
  });

  it('should revoke only the selected session on ordinary logout', async () => {
    const first = await service.register({ username: 'alice', password: 'correct password' });
    const second = await service.login({ username: 'alice', password: 'correct password' });
    await service.logout(first.session);
    expect(await service.resolveToken(first.token)).toBeNull();
    expect(await service.resolveToken(second.token)).not.toBeNull();
  });

  it('should require the current password and revoke every session after a successful password change', async () => {
    const first = await service.register({ username: 'alice', password: 'correct password' });
    const second = await service.login({ username: 'alice', password: 'correct password' });
    await expect(
      service.changePassword(first.account.id, {
        currentPassword: 'wrong password',
        newPassword: 'brand new password',
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(await service.resolveToken(first.token)).not.toBeNull();
    await service.changePassword(first.account.id, {
      currentPassword: 'correct password',
      newPassword: 'brand new password',
    });
    expect(await service.resolveToken(first.token)).toBeNull();
    expect(await service.resolveToken(second.token)).toBeNull();
    await expect(
      service.login({ username: 'alice', password: 'correct password' }),
    ).rejects.toMatchObject({ status: 401 });
    expect(
      (await service.login({ username: 'alice', password: 'brand new password' })).account.id,
    ).toBe(first.account.id);
  }, 15000);

  it('should validate account fields and persist profile changes without changing identity', async () => {
    await expect(
      service.register({ username: 'a', password: 'correct password' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(service.register({ username: 'alice', password: 'short' })).rejects.toMatchObject({
      status: 400,
    });
    const first = await service.register({ username: 'alice', password: 'correct password' });
    for (const input of [
      { nickname: ' ' },
      { nickname: 'x'.repeat(21) },
      { avatar: 'https://host/image.svg' },
      { color: 'red' },
    ]) {
      await expect(service.updateProfile(first.account.id, input)).rejects.toMatchObject({
        status: 400,
      });
    }
    const profile = await service.updateProfile(first.account.id, {
      nickname: 'New name',
      avatar: 'fox',
      color: '#AbCdEf',
      username: 'hijacked',
      passwordHash: 'bad',
    });
    expect(profile).toMatchObject({
      id: first.account.id,
      username: 'alice',
      nickname: 'New name',
      avatar: 'fox',
      color: '#abcdef',
    });
    expect((await service.resolveToken(first.token))?.account).toEqual(profile);
    await expect(
      service.register({ username: 'ALICE', password: 'correct password' }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
