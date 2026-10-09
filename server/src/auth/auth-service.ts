import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AccountProfile, AvatarPreset, MediaId } from '@shared/types';
import {
  IMAGE_OPACITY_MAX, IMAGE_OPACITY_MIN, NICKNAME_MAX_LENGTH, isImageOpacity, isMediaId,
} from '@shared/constants';
import type { Repository, SessionRecord, AccountRecord } from '../database/repository';
import { publicAccount } from '../database/repository';
import { isObject } from '../database/schema';
import { hashPassword, verifyPassword } from './password';

export const SESSION_COOKIE_NAME = 'card_together_session';
export const LEGACY_SESSION_COOKIE_NAME = 'bridge_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface AuthenticatedSession {
  readonly account: AccountProfile;
  readonly session: SessionRecord;
}

export interface AuthResult extends AuthenticatedSession {
  readonly token: string;
}

export interface AuthService {
  register(input: unknown): Promise<AuthResult>;
  login(input: unknown): Promise<AuthResult>;
  resolveSession(cookieHeader: string | undefined): Promise<AuthenticatedSession | null>;
  resolveToken(token: string | undefined): Promise<AuthenticatedSession | null>;
  logout(session: SessionRecord): Promise<void>;
  logoutAll(accountId: string): Promise<void>;
  updateProfile(accountId: string, input: unknown): Promise<AccountProfile>;
  changePassword(accountId: string, input: unknown): Promise<void>;
}

export function authError(
  status: number,
  code: string,
  message: string,
): Error & { status: number; code: string } {
  return Object.assign(new Error(message), { status, code });
}

function requiredObject(input: unknown): Record<string, unknown> {
  if (!isObject(input)) throw authError(400, 'INVALID_INPUT', 'Expected a JSON object.');
  return input;
}

function usernameValue(input: unknown): string {
  if (typeof input !== 'string' || !/^[a-zA-Z0-9_]{3,24}$/.test(input.trim())) {
    throw authError(
      400,
      'INVALID_USERNAME',
      'Username must be 3–24 letters, numbers, or underscores.',
    );
  }
  return input.trim();
}

function passwordValue(input: unknown): string {
  if (typeof input !== 'string' || input.length < 10 || input.length > 128) {
    throw authError(400, 'INVALID_PASSWORD', 'Password must be 10–128 characters.');
  }
  return input;
}

type EditableProfile = Pick<
  AccountProfile,
  | 'nickname' | 'color' | 'avatar' | 'avatarImage' | 'tableBackground'
  | 'tableBackgroundOpacity' | 'cardBack' | 'cardBackOpacity' | 'matchesPublic'
>;

function mediaValue(
  input: unknown,
  fallback: MediaId | null,
  mediaExists: (id: MediaId) => boolean,
): MediaId | null {
  if (input === undefined) return fallback;
  if (input === null) return null;
  if (!isMediaId(input) || !mediaExists(input)) {
    throw authError(400, 'INVALID_MEDIA', 'Upload the image before using it.');
  }
  return input;
}

function opacityValue(input: unknown, fallback: number): number {
  if (input === undefined) return fallback;
  if (!isImageOpacity(input)) {
    throw authError(
      400,
      'INVALID_OPACITY',
      `Opacity must be a whole number from ${IMAGE_OPACITY_MIN} to ${IMAGE_OPACITY_MAX}.`,
    );
  }
  return input;
}

function profileValues(
  input: Record<string, unknown>,
  fallback: EditableProfile,
  mediaExists: (id: MediaId) => boolean,
): EditableProfile {
  const nickname = input.nickname === undefined ? fallback.nickname : input.nickname;
  const color = input.color === undefined ? fallback.color : input.color;
  const avatar = input.avatar === undefined ? fallback.avatar : input.avatar;
  if (
    typeof nickname !== 'string' ||
    nickname.trim().length < 1 ||
    nickname.trim().length > NICKNAME_MAX_LENGTH ||
    Array.from(nickname).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  ) {
    throw authError(
      400,
      'INVALID_NICKNAME',
      'Nickname must be 1–20 characters without control characters.',
    );
  }
  if (typeof color !== 'string' || !/^#[\da-f]{6}$/i.test(color)) {
    throw authError(400, 'INVALID_COLOR', 'Choose a valid six-digit color.');
  }
  if (
    typeof avatar !== 'string' ||
    !['cat', 'fox', 'owl', 'bear', 'rabbit', 'panda'].includes(avatar)
  ) {
    throw authError(400, 'INVALID_AVATAR', 'Choose an available avatar.');
  }
  const matchesPublic =
    input.matchesPublic === undefined ? fallback.matchesPublic : input.matchesPublic;
  if (typeof matchesPublic !== 'boolean') {
    throw authError(400, 'INVALID_INPUT', 'Match visibility must be true or false.');
  }
  return {
    nickname: nickname.trim(),
    color: color.toLowerCase(),
    avatar: avatar as AvatarPreset,
    avatarImage: mediaValue(input.avatarImage, fallback.avatarImage, mediaExists),
    tableBackground: mediaValue(input.tableBackground, fallback.tableBackground, mediaExists),
    tableBackgroundOpacity: opacityValue(
      input.tableBackgroundOpacity, fallback.tableBackgroundOpacity,
    ),
    cardBack: mediaValue(input.cardBack, fallback.cardBack, mediaExists),
    cardBackOpacity: opacityValue(input.cardBackOpacity, fallback.cardBackOpacity),
    matchesPublic,
  };
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function readSessionCookie(
  cookieHeader: string | undefined,
  cookieName: string = SESSION_COOKIE_NAME,
): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator >= 0 && part.slice(0, separator).trim() === cookieName)
      return part.slice(separator + 1).trim();
  }
  return undefined;
}

export function createAuthService(
  repository: Repository,
  options: {
    now?: () => number;
    sessionTtlMs?: number;
    mediaExists?: (id: MediaId) => boolean;
  } = {},
): AuthService {
  const now = options.now ?? Date.now;
  const mediaExists = options.mediaExists ?? ((): boolean => false);
  const ttl = options.sessionTtlMs ?? SESSION_TTL_MS;

  async function createSession(account: AccountRecord): Promise<AuthResult> {
    const token = randomBytes(32).toString('base64url');
    const createdAt = now();
    const session: SessionRecord = {
      tokenHash: tokenHash(token),
      accountId: account.id,
      createdAt,
      expiresAt: createdAt + ttl,
    };
    // A concurrent password change must invalidate an in-flight password login too.
    if (!(await repository.createSession(session, account.passwordHash))) {
      throw authError(401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
    }
    return { account: publicAccount(account), token, session };
  }

  async function resolveToken(token: string | undefined): Promise<AuthenticatedSession | null> {
    if (!token || !/^[\w-]{43}$/.test(token)) return null;
    const session = await repository.getSession(tokenHash(token));
    if (!session || session.expiresAt <= now()) return null;
    const account = await repository.getAccountById(session.accountId);
    return account ? { account: publicAccount(account), session } : null;
  }

  return {
    register: async (input) => {
      const body = requiredObject(input);
      const username = usernameValue(body.username);
      const password = passwordValue(body.password);
      const profile = profileValues(body, {
        nickname: username.slice(0, NICKNAME_MAX_LENGTH),
        color: '#4f8cff',
        avatar: 'cat',
        avatarImage: null,
        tableBackground: null,
        tableBackgroundOpacity: IMAGE_OPACITY_MAX,
        cardBack: null,
        cardBackOpacity: IMAGE_OPACITY_MAX,
        matchesPublic: false,
      }, mediaExists);
      const passwordHash = await hashPassword(password);
      const createdAt = now();
      try {
        const account = await repository.createAccount({
          id: randomUUID(),
          username,
          usernameNormalized: username.toLowerCase(),
          passwordHash,
          ...profile,
          createdAt,
          updatedAt: createdAt,
        });
        return await createSession(account);
      } catch (error) {
        if (isObject(error) && error.code === 'USERNAME_EXISTS')
          throw authError(409, 'USERNAME_EXISTS', 'Username is already taken.');
        throw error;
      }
    },
    login: async (input) => {
      const body = requiredObject(input);
      const username = usernameValue(body.username);
      const password = passwordValue(body.password);
      const account = await repository.getAccountByUsername(username.toLowerCase());
      const valid = await verifyPassword(password, account?.passwordHash ?? null);
      if (!account || !valid)
        throw authError(401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
      return createSession(account);
    },
    resolveSession: (cookieHeader) =>
      resolveToken(
        readSessionCookie(cookieHeader) ?? readSessionCookie(cookieHeader, LEGACY_SESSION_COOKIE_NAME),
      ),
    resolveToken,
    logout: (session) => repository.deleteSession(session.tokenHash),
    logoutAll: (accountId) => repository.deleteAccountSessions(accountId),
    updateProfile: async (accountId, input) => {
      const body = requiredObject(input);
      const account = await repository.getAccountById(accountId);
      if (!account) throw authError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
      const profile = profileValues(body, account, mediaExists);
      const updated = await repository.updateProfile(accountId, profile, now());
      if (!updated) throw authError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
      return publicAccount(updated);
    },
    changePassword: async (accountId, input) => {
      const body = requiredObject(input);
      const currentPassword = passwordValue(body.currentPassword);
      const newPassword = passwordValue(body.newPassword);
      const account = await repository.getAccountById(accountId);
      if (!account || !(await verifyPassword(currentPassword, account.passwordHash))) {
        throw authError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect.');
      }
      const passwordHash = await hashPassword(newPassword);
      if (
        !(await repository.changePassword(accountId, account.passwordHash, passwordHash, now()))
      ) {
        throw authError(
          409,
          'PASSWORD_CHANGED',
          'Password changed during this request. Sign in again.',
        );
      }
    },
  };
}
