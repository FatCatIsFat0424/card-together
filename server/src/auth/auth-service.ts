import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AccountProfile, AvatarPreset, DailyRewardsStatus, MediaId } from '@shared/types';
import { isDailyTaskId } from '@shared/constants/daily-rewards';
import {
  IMAGE_OPACITY_MAX, IMAGE_OPACITY_MIN, NICKNAME_MAX_LENGTH, PASSWORD_MAX_LENGTH,
  USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, isImageOpacity, isMediaId,
  isUsername, isAvatarBorderId, isShopItemId,
} from '@shared/constants';
import type { Repository, SessionRecord, AccountRecord } from '../database/repository';
import { publicAccount } from '../database/repository';
import { equipmentError, isEquipmentStyle } from '../database/shop-equipment';
import type { EquipmentSlot } from '../database/shop-equipment';
import { isObject } from '../database/schema';
import { validateNewPassword } from './password-policy';
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
  purchaseAvatarBorder(accountId: string, input: unknown): Promise<AccountProfile>;
  purchaseShopItem(accountId: string, input: unknown): Promise<AccountProfile>;
  getDailyRewards(accountId: string): Promise<DailyRewardsStatus>;
  replaceDailyTask(accountId: string, input: unknown): Promise<{ account: AccountProfile; dailyRewards: DailyRewardsStatus }>;
  claimDailyReward(accountId: string, input: unknown): Promise<{ account: AccountProfile; dailyRewards: DailyRewardsStatus }>;
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
  const username = typeof input === 'string' ? input.trim() : '';
  if (!isUsername(username)) {
    throw authError(
      400,
      'INVALID_USERNAME',
      `Username must be ${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} letters, numbers, or ` +
        'underscores, optionally separated by single dots or hyphens.',
    );
  }
  return username;
}

/** Accepts any existing password, including ones set under earlier rules. */
function existingPasswordValue(input: unknown): string {
  if (typeof input !== 'string' || input.length < 1 || input.length > PASSWORD_MAX_LENGTH) {
    throw authError(
      400,
      'INVALID_PASSWORD',
      `Enter a password of up to ${PASSWORD_MAX_LENGTH} characters.`,
    );
  }
  return input;
}

type EditableProfile = Pick<
  AccountProfile,
  | 'nickname' | 'color' | 'avatar' | 'avatarImage' | 'seatBackground' | 'tableBackground'
  | 'tableBackgroundOpacity' | 'cardBack' | 'cardBackOpacity' | 'matchesPublic'
  | 'avatarBorder' | 'cardBackStyle' | 'tableBackgroundStyle' | 'seatBackgroundStyle' | 'nameplate'
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

function equipmentValue<Slot extends EquipmentSlot>(
  slot: Slot, input: unknown, fallback: AccountProfile[Slot],
): AccountProfile[Slot] {
  if (input === undefined) return fallback ?? null;
  if (input === null || isEquipmentStyle(slot, input)) return input;
  throw authError(400, 'INVALID_SHOP_ITEM', 'Choose an available item for this equipment slot.');
}

function requireOwnedEquipment(profile: EditableProfile, account: Pick<AccountProfile, 'ownedShopItems'>): void {
  const error = equipmentError(profile, account);
  if (error) throw authError(error === 'INVALID_SHOP_ITEM' ? 400 : 403, error, 'Purchase this item before equipping it.');
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
  const avatarBorder = input.avatarBorder === undefined ? fallback.avatarBorder ?? null : input.avatarBorder;
  if (avatarBorder !== null && !isAvatarBorderId(avatarBorder)) {
    throw authError(400, 'INVALID_BORDER', 'Choose an available avatar border.');
  }
  return {
    nickname: nickname.trim(),
    color: color.toLowerCase(),
    avatar: avatar as AvatarPreset,
    avatarBorder,
    cardBackStyle: equipmentValue('cardBackStyle', input.cardBackStyle, fallback.cardBackStyle),
    tableBackgroundStyle: equipmentValue('tableBackgroundStyle', input.tableBackgroundStyle, fallback.tableBackgroundStyle),
    seatBackgroundStyle: equipmentValue('seatBackgroundStyle', input.seatBackgroundStyle, fallback.seatBackgroundStyle),
    nameplate: equipmentValue('nameplate', input.nameplate, fallback.nameplate),
    avatarImage: mediaValue(input.avatarImage, fallback.avatarImage, mediaExists),
    seatBackground: mediaValue(input.seatBackground, fallback.seatBackground ?? null, mediaExists),
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
      const password = validateNewPassword(body.password);
      const profile = profileValues(body, {
        nickname: username.slice(0, NICKNAME_MAX_LENGTH),
        color: '#4f8cff',
        avatar: 'cat',
        avatarImage: null,
        seatBackground: null,
        tableBackground: null,
        tableBackgroundOpacity: IMAGE_OPACITY_MAX,
        cardBack: null,
        cardBackOpacity: IMAGE_OPACITY_MAX,
        matchesPublic: true,
      }, mediaExists);
      const passwordHash = await hashPassword(password);
      if (profile.avatarBorder) throw authError(403, 'BORDER_NOT_OWNED', 'Purchase this avatar border first.');
      requireOwnedEquipment(profile, {});
      const createdAt = now();
      try {
        const account = await repository.createAccount({
          id: randomUUID(),
          username,
          usernameNormalized: username.toLowerCase(),
          passwordHash,
          ...profile,
          coins: 0,
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
      const password = existingPasswordValue(body.password);
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
      if (profile.avatarBorder && !account.ownedAvatarBorders?.includes(profile.avatarBorder)) {
        throw authError(403, 'BORDER_NOT_OWNED', 'Purchase this avatar border first.');
      }
      requireOwnedEquipment(profile, account);
      const changes: Partial<EditableProfile> = {};
      for (const field of Object.keys(profile) as (keyof EditableProfile)[]) {
        // Preserve unrelated changes committed since the fallback profile was read.
        if (Object.hasOwn(body, field) && body[field] !== undefined) {
          Object.assign(changes, { [field]: profile[field] });
        }
      }
      const updated = await repository.updateProfile(accountId, changes, now());
      if (!updated) throw authError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
      return publicAccount(updated);
    },
    purchaseAvatarBorder: async (accountId, input) => {
      const body = requiredObject(input);
      if (!isAvatarBorderId(body.border)) {
        throw authError(400, 'INVALID_BORDER', 'Choose an available avatar border.');
      }
      try {
        const account = await repository.purchaseAvatarBorder(accountId, body.border, now());
        if (!account) throw authError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
        return publicAccount(account);
      } catch (error) {
        if (isObject(error) && error.code === 'INSUFFICIENT_COINS') {
          throw authError(409, 'INSUFFICIENT_COINS', 'Not enough coins. Play more games to earn coins.');
        }
        throw error;
      }
    },
    purchaseShopItem: async (accountId, input) => {
      const body = requiredObject(input);
      if (!isShopItemId(body.item)) {
        throw authError(400, 'INVALID_SHOP_ITEM', 'Choose an available shop item.');
      }
      try {
        const account = await repository.purchaseShopItem(accountId, body.item, now());
        if (!account) throw authError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
        return publicAccount(account);
      } catch (error) {
        if (isObject(error) && error.code === 'INSUFFICIENT_COINS') {
          throw authError(409, 'INSUFFICIENT_COINS', 'Not enough coins. Play more games to earn coins.');
        }
        throw error;
      }
    },
    getDailyRewards: async (accountId) => {
      const status = await repository.getDailyRewards(accountId);
      if (!status) throw authError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
      return status;
    },
    claimDailyReward: async (accountId, input) => {
      const body = requiredObject(input);
      const reward = body.reward;
      if ((reward !== 'check-in' && !isDailyTaskId(reward))
        || typeof body.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.day)) {
        throw authError(400, 'INVALID_DAILY_REWARD', 'Choose today’s daily reward.');
      }
      try {
        const result = await repository.claimDailyReward(accountId, reward, body.day);
        if (!result) throw authError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
        return { account: publicAccount(result.account), dailyRewards: result.dailyRewards };
      } catch (error) {
        if (isObject(error) && (error.code === 'DAILY_DATE_CHANGED' || error.code === 'DAILY_TASK_INCOMPLETE' || error.code === 'DAILY_TASK_UNASSIGNED')) {
          throw authError(409, error.code, 'Refresh today’s rewards and check your progress.');
        }
        throw error;
      }
    },
    replaceDailyTask: async (accountId, input) => {
      const body = requiredObject(input);
      if (!isDailyTaskId(body.task) || typeof body.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.day)) {
        throw authError(400, 'INVALID_DAILY_TASK', 'Choose an assigned daily task.');
      }
      try {
        const result = await repository.replaceDailyTask(accountId, body.task, body.day);
        if (!result) throw authError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
        return { account: publicAccount(result.account), dailyRewards: result.dailyRewards };
      } catch (error) {
        if (isObject(error) && typeof error.code === 'string' && error.code.startsWith('DAILY_')) {
          throw authError(409, error.code, 'Refresh today’s tasks and check your replacement allowance.');
        }
        throw error;
      }
    },
    changePassword: async (accountId, input) => {
      const body = requiredObject(input);
      const currentPassword = existingPasswordValue(body.currentPassword);
      const newPassword = validateNewPassword(body.newPassword);
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
