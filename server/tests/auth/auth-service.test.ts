import { mkdtemp, rm } from 'node:fs/promises';
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
import { hashPassword } from '../../src/auth/password';
import { REPOSITORY_ADAPTERS } from '../helpers/repository-adapters';
import type { Repository } from '../../src/database/repository';
import { seedAuthenticatedAccount, seedAuthenticatedSession } from './account-fixture';

describe.each(REPOSITORY_ADAPTERS)('account authentication ($name)', (adapter) => {
  let directory: string;
  let path: string;
  let repository: Repository;
  let service: AuthService;
  let time: number;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'bridge-auth-test-'));
    path = join(directory, adapter.fileName);
    repository = await adapter.open(path);
    time = 1000;
    service = createAuthService(repository, { now: () => time, sessionTtlMs: 10000 });
  });
  afterEach(async () => {
    await repository.close();
    await rm(directory, { recursive: true, force: true });
  });

  function seedAccount(username: string): ReturnType<typeof seedAuthenticatedAccount> {
    return seedAuthenticatedAccount(repository, username, {}, { now: time, sessionTtlMs: 10000 });
  }

  it('should register, authenticate case-insensitively, and never store raw credentials or tokens', async () => {
    const registered = await service.register({
      username: 'Alice',
      password: 'correct horse battery',
    });
    expect(registered.account.username).toBe('Alice');
    expect(registered.session).toMatchObject({ createdAt: time, expiresAt: time + 10000 });
    expect(registered.account.matchesPublic).toBe(true);
    expect((await repository.getAccountById(registered.account.id))?.matchesPublic).toBe(true);
    expect(registered.account).not.toHaveProperty('passwordHash');
    const text = await adapter.persisted(path);
    expect(text).not.toContain('correct horse battery');
    expect(text).not.toContain(registered.token);
    expect(text).toContain('scrypt$131072$8$1$');
    expect((await repository.getAccountById(registered.account.id))?.lastSeenAt).toBe(time);
    time += 500;
    const login = await service.login({ username: 'alice', password: 'correct horse battery' });
    expect(login.account.id).toBe(registered.account.id);
    // Friends see sign-ins as activity before any game socket connects.
    expect((await repository.getAccountById(registered.account.id))?.lastSeenAt).toBe(time);
    expect(login.token).not.toBe(registered.token);
    expect(await service.resolveSession(`other=foo; bridge_session=${login.token}`)).toMatchObject({
      account: registered.account,
    });
  });

  it('should preserve explicit private history through profile edits and reopening', async () => {
    const registered = await service.register({
      username: 'alice', password: 'correct password', matchesPublic: false,
    });
    expect(registered.account.matchesPublic).toBe(false);
    const updated = await service.updateProfile(registered.account.id, { nickname: 'Alice' });
    expect(updated.matchesPublic).toBe(false);
    await repository.close();
    repository = await adapter.open(path);
    service = createAuthService(repository, { now: () => time, sessionTtlMs: 10000 });
    expect((await service.resolveToken(registered.token))?.account.matchesPublic).toBe(false);
  });

  it('preserves independent simultaneous profile patches and ignores omitted and server-owned fields', async () => {
    const image = `${'a'.repeat(64)}.png`;
    const first = await seedAuthenticatedAccount(repository, 'cosmetic_owner', {
      coins: 1000, ownedAvatarBorders: ['cat'],
      ownedShopItems: ['nameplate-aurora', 'card-back-aurora', 'table-tide', 'seat-sakura'],
    }, { now: time, sessionTtlMs: 10000 });
    service = createAuthService(repository, { now: () => time, sessionTtlMs: 10000, mediaExists: () => true });
    const expected = {
      nameplate: 'nameplate-aurora', cardBackStyle: 'card-back-aurora', tableBackgroundStyle: 'table-tide',
      seatBackgroundStyle: 'seat-sakura', nickname: 'Updated nickname', avatar: 'fox', color: '#abcdef',
      cardBack: image, tableBackground: image, seatBackground: image, avatarImage: image,
      cardBackOpacity: 60, tableBackgroundOpacity: 40, matchesPublic: false, avatarBorder: 'cat',
    } as const;
    await Promise.all(Object.entries(expected).map(([field, value]) =>
      service.updateProfile(first.account.id, { [field]: value })));
    const beforeIgnored = await repository.getAccountById(first.account.id);
    expect(beforeIgnored).toMatchObject({ ...expected, coins: 1000,
      ownedShopItems: ['nameplate-aurora', 'card-back-aurora', 'table-tide', 'seat-sakura'] });
    await service.updateProfile(first.account.id, { nickname: undefined, cardBackStyle: undefined,
      id: 'forged', username: 'forged', passwordHash: 'forged', coins: 999999, coinRevision: 999,
      ownedShopItems: ['nameplate-tide'], ownedAvatarBorders: ['gold'] });
    expect(await repository.getAccountById(first.account.id)).toEqual({
      ...beforeIgnored, updatedAt: beforeIgnored!.updatedAt + 1,
    });
    await repository.close();
    repository = await adapter.open(path);
    service = createAuthService(repository, { now: () => time });
    expect((await service.resolveToken(first.token))?.account).toMatchObject({ ...expected, coins: 1000 });
  });

  it('should prefer the new session cookie and preserve legacy authentication', async () => {
    const current = await seedAccount('alice');
    const legacy = await seedAccount('bob');
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
    const first = await seedAccount('alice');
    const second = await seedAuthenticatedSession(repository, first.account.id, { now: time, sessionTtlMs: 10000 });
    await repository.close();
    repository = await adapter.open(path);
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
    const first = await seedAccount('alice');
    const second = await seedAuthenticatedSession(repository, first.account.id, { now: time, sessionTtlMs: 10000 });
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
    const first = await seedAccount('alice');
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

  it('should keep a stored legacy preset when the profile editor no longer sends one', async () => {
    const first = await seedAccount('legacy');
    await service.updateProfile(first.account.id, { avatar: 'panda' });
    const profile = await service.updateProfile(first.account.id, { nickname: 'No preset', color: '#123456' });
    expect(profile).toMatchObject({ nickname: 'No preset', avatar: 'panda' });
    await expect(service.updateProfile(first.account.id, { avatar: 'bot' })).rejects
      .toMatchObject({ status: 400, code: 'INVALID_AVATAR' });
    const registered = await service.register({ username: 'newcomer', password: 'correct password' });
    expect(registered.account.avatarImage).toBeNull();
  });

  it('should accept single dot or hyphen separators in usernames and reject other symbols', async () => {
    for (const username of ['a.b', 'first-last', 'j.r_r-t', 'a_1.b-2.c']) {
      expect((await service.register({ username, password: 'correct password' })).account.username)
        .toBe(username);
    }
    for (const username of [
      'ab', 'x'.repeat(25), 'a b', 'a..b', 'a.-b', '.ab', 'ab-', 'a@b', 'a/b', 'ａｂｃ', '使用者',
    ]) {
      await expect(service.register({ username, password: 'correct password' })).rejects
        .toMatchObject({ status: 400, code: 'INVALID_USERNAME' });
    }
    expect((await service.login({ username: '  A.B ', password: 'correct password' })).account
      .username).toBe('a.b');
  }, 30000);

  it('should require 6–128 characters without edge whitespace or common choices for new passwords', async () => {
    for (const password of [
      'five5', 'x'.repeat(129), ' padded', 'padded ', '\tpadded', 'Password', 'qwerty123',
    ]) {
      await expect(service.register({ username: 'alice', password })).rejects.toMatchObject({
        status: 400,
        code: 'INVALID_PASSWORD',
      });
    }
    const first = await service.register({ username: 'alice', password: 'six ch' });
    await expect(
      service.changePassword(first.account.id, { currentPassword: 'six ch', newPassword: 'password1' }),
    ).rejects.toMatchObject({ status: 400, code: 'INVALID_PASSWORD' });
    expect((await service.login({ username: 'alice', password: 'six ch' })).account.id)
      .toBe(first.account.id);
  }, 15000);

  it('accepts the maximum username and password lengths through real registration and login', async () => {
    const username = 'a'.repeat(24);
    const password = 'x'.repeat(128);
    const registered = await service.register({ username, password });
    expect(registered.account.username).toBe(username);
    expect((await service.login({ username, password })).account.id).toBe(registered.account.id);
  });

  it('should keep accepting passwords that were set under earlier rules', async () => {
    const legacyPassword = ' password123 ';
    const first = await service.register({ username: 'alice', password: 'correct password' });
    const account = await repository.getAccountById(first.account.id);
    expect(
      await repository.changePassword(
        first.account.id,
        account?.passwordHash ?? '',
        await hashPassword(legacyPassword),
        time,
      ),
    ).toBe(true);
    expect((await service.login({ username: 'alice', password: legacyPassword })).account.id)
      .toBe(first.account.id);
    await service.changePassword(first.account.id, {
      currentPassword: legacyPassword,
      newPassword: 'a fresh password',
    });
    await expect(service.login({ username: 'alice', password: '' })).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_PASSWORD',
    });
  }, 30000);
});
