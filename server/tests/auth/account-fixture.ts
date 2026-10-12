import { randomBytes, randomUUID } from 'node:crypto';
import { createAuthService, SESSION_COOKIE_NAME, tokenHash } from '../../src/auth/auth-service';
import type { AccountProfile } from '@shared/types';
import type { AccountRecord, Repository, SessionRecord } from '../../src/database/repository';

interface SessionOptions {
  readonly now?: number;
  readonly sessionTtlMs?: number;
}

interface SessionFixture {
  readonly token: string;
  readonly cookie: string;
  readonly session: SessionRecord;
}

export async function seedAuthenticatedSession(
  repository: Repository, accountId: string, options: SessionOptions = {},
): Promise<SessionFixture> {
  const account = await repository.getAccountById(accountId);
  if (!account) throw new Error('Expected an existing fixture account');
  const now = options.now ?? Date.now();
  const token = randomBytes(32).toString('base64url');
  const session: SessionRecord = { tokenHash: tokenHash(token), accountId,
    createdAt: now, expiresAt: now + (options.sessionTtlMs ?? 24 * 60 * 60 * 1000) };
  if (!(await repository.createSession(session, account.passwordHash))) {
    throw new Error('Expected seeded session to persist');
  }
  return { token, session, cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

const PASSWORD_HASH = `scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`;

/** Creates a durable account and real session for tests whose oracle does not involve passwords. */
export async function seedAuthenticatedAccount(
  repository: Repository, username: string, overrides: Partial<AccountRecord> = {}, options: SessionOptions = {},
): Promise<{ account: AccountProfile } & SessionFixture> {
  const now = options.now ?? Date.now();
  const record: AccountRecord = {
    id: randomUUID(), username, usernameNormalized: username.toLowerCase(), nickname: username,
    color: '#2563eb', avatar: 'cat', avatarImage: null, tableBackground: null,
    tableBackgroundOpacity: 100, cardBack: null, cardBackOpacity: 100, matchesPublic: true, coins: 0,
    passwordHash: PASSWORD_HASH, createdAt: now, updatedAt: now, ...overrides,
  };
  await repository.createAccount(record);
  const fixture = await seedAuthenticatedSession(repository, record.id, options);
  const authenticated = await createAuthService(repository, { now: () => now }).resolveToken(fixture.token);
  if (!authenticated) throw new Error('Expected seeded authenticated account');
  return { account: authenticated.account, ...fixture };
}
