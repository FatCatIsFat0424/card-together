import { randomUUID } from 'node:crypto';
import type { FriendEntry, FriendRequest, FriendsData, PublicAccount } from '@shared/types/social';
import type { AccountRecord, FriendshipRecord, Repository } from '../database/repository';

interface FriendError {
  readonly success: false;
  readonly status: 400 | 401 | 404 | 409;
  readonly error: string;
}

type FriendResult<T> = { readonly success: true; readonly data: T } | FriendError;

/** Live presence is added by the HTTP route after reading accepted-friend metadata. */
export type FriendList = Omit<FriendsData, 'friends'> & {
  readonly friends: Omit<FriendEntry, 'online' | 'inRoom' | 'hostedRoomCode'>[];
};

export interface FriendService {
  list(accountId: string): Promise<FriendList>;
  areFriends(accountId: string, otherId: string): Promise<boolean>;
  findByUsername(username: unknown): Promise<FriendResult<PublicAccount | null>>;
  request(accountId: string, username: unknown): Promise<FriendResult<FriendRequest>>;
  accept(accountId: string, requestId: string): Promise<FriendResult<null>>;
  dismiss(accountId: string, requestId: string): Promise<FriendResult<null>>;
  remove(accountId: string, friendId: string): Promise<FriendResult<null>>;
}

export function publicProfile(account: AccountRecord): PublicAccount {
  return {
    id: account.id,
    username: account.username,
    nickname: account.nickname,
    color: account.color,
    avatar: account.avatar,
    avatarImage: account.avatarImage,
    avatarBorder: account.avatarBorder ?? null,
    nameplate: account.nameplate ?? null,
    chatFrame: account.chatFrame ?? null,
  };
}

function requestProfile(
  record: FriendshipRecord,
  requester: AccountRecord,
  recipient: AccountRecord,
): FriendRequest {
  return {
    id: record.id,
    requester: publicProfile(requester),
    recipient: publicProfile(recipient),
    createdAt: record.createdAt,
  };
}

function normalizeUsername(username: unknown): string | null {
  if (typeof username !== 'string') return null;
  const normalized = username.trim().toLowerCase();
  return normalized.length > 0 && normalized.length <= 64 ? normalized : null;
}

function notFound(): FriendError {
  return { success: false, status: 404, error: 'Friend request not found.' };
}

/** Every transition is checked atomically by the repository, including pair uniqueness. */
export function createFriendService(repository: Repository): FriendService {
  async function acceptedFriendship(
    accountId: string,
    friendId: string,
  ): Promise<FriendshipRecord | undefined> {
    const relationships = await repository.listFriendships(accountId);
    return relationships.find((relationship): boolean => (
      relationship.status === 'accepted'
      && (relationship.requesterId === accountId
        ? relationship.recipientId === friendId
        : relationship.requesterId === friendId)
    ));
  }

  return {
    async list(accountId: string): Promise<FriendList> {
      const relationships = await repository.listFriendships(accountId);
      const accountIds = new Set<string>([accountId]);
      for (const relationship of relationships) {
        accountIds.add(relationship.requesterId);
        accountIds.add(relationship.recipientId);
      }
      const accounts = new Map<string, AccountRecord>();
      await Promise.all([...accountIds].map(async (id: string): Promise<void> => {
        const account = await repository.getAccountById(id);
        if (account) accounts.set(id, account);
      }));
      const friends: FriendList['friends'] = [];
      const incoming: FriendRequest[] = [];
      const outgoing: FriendRequest[] = [];
      for (const relationship of relationships) {
        const requester = accounts.get(relationship.requesterId);
        const recipient = accounts.get(relationship.recipientId);
        if (!requester || !recipient) continue;
        if (relationship.status === 'accepted') {
          const friend = requester.id === accountId ? recipient : requester;
          friends.push({ ...publicProfile(friend), lastSeenAt: friend.lastSeenAt ?? null });
        } else if (relationship.recipientId === accountId) {
          incoming.push(requestProfile(relationship, requester, recipient));
        } else {
          outgoing.push(requestProfile(relationship, requester, recipient));
        }
      }
      friends.sort((first, second): number => first.nickname.localeCompare(second.nickname));
      incoming.sort((first, second): number => second.createdAt - first.createdAt);
      outgoing.sort((first, second): number => second.createdAt - first.createdAt);
      return { friends, incoming, outgoing };
    },

    async findByUsername(username: unknown): Promise<FriendResult<PublicAccount | null>> {
      const normalized = normalizeUsername(username);
      if (!normalized) {
        return { success: false, status: 400, error: 'Enter a username.' };
      }
      const account = await repository.getAccountByUsername(normalized);
      return { success: true, data: account ? publicProfile(account) : null };
    },

    async request(accountId: string, username: unknown): Promise<FriendResult<FriendRequest>> {
      const normalized = normalizeUsername(username);
      if (!normalized) {
        return { success: false, status: 400, error: 'Enter a username.' };
      }
      const [requester, recipient] = await Promise.all([
        repository.getAccountById(accountId),
        repository.getAccountByUsername(normalized),
      ]);
      if (!requester) {
        return { success: false, status: 401, error: 'Sign in to continue.' };
      }
      if (!recipient) {
        return { success: false, status: 404, error: 'No account has that username.' };
      }
      if (requester.id === recipient.id) {
        return { success: false, status: 400, error: 'You cannot add yourself as a friend.' };
      }
      const now = Date.now();
      try {
        const relationship = await repository.createFriendship({
          id: randomUUID(),
          requesterId: requester.id,
          recipientId: recipient.id,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        });
        return { success: true, data: requestProfile(relationship, requester, recipient) };
      } catch (error: unknown) {
        if (error instanceof Error && 'code' in error && error.code === 'FRIENDSHIP_EXISTS') {
          return {
            success: false,
            status: 409,
            error: 'You are already friends or have a pending friend request.',
          };
        }
        if (error instanceof Error && 'code' in error && error.code === 'INVALID_FRIENDSHIP') {
          return { success: false, status: 400, error: 'Unable to send this friend request.' };
        }
        throw error;
      }
    },

    async accept(accountId: string, requestId: string): Promise<FriendResult<null>> {
      const relationship = await repository.acceptFriendship(requestId, accountId);
      return relationship ? { success: true, data: null } : notFound();
    },

    async dismiss(accountId: string, requestId: string): Promise<FriendResult<null>> {
      const deleted = await repository.deleteFriendship(requestId, accountId, 'pending');
      return deleted ? { success: true, data: null } : notFound();
    },

    async areFriends(accountId: string, otherId: string): Promise<boolean> {
      return Boolean(await acceptedFriendship(accountId, otherId));
    },

    async remove(accountId: string, friendId: string): Promise<FriendResult<null>> {
      const friendship = await acceptedFriendship(accountId, friendId);
      if (friendship
        && await repository.deleteFriendship(friendship.id, accountId, 'accepted')) {
        return { success: true, data: null };
      }
      return { success: false, status: 404, error: 'Friend not found.' };
    },
  };
}
