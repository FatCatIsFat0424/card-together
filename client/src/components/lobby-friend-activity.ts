import type { FriendEntry, FriendRoomPresence } from '@shared/types';

type Presence = Pick<FriendEntry, 'online' | 'room'>;

export type FriendActivity =
  | { readonly kind: 'playing' | 'replaying' | 'waiting'; readonly room: FriendRoomPresence }
  | { readonly kind: 'lobby' };

export type FriendAction = 'join' | 'spectate' | 'invite';

/** What an online friend is doing: in a waiting room, a running match or shared replay, or idle in the lobby. */
export function friendActivity(friend: Presence): FriendActivity | null {
  if (!friend.online) return null;
  const room = friend.room;
  if (!room) return { kind: 'lobby' };
  return { kind: room.status === 'waiting' ? 'waiting' : room.status, room };
}

/**
 * The main action for a friend: join a waiting room with space, spectate a running one, or invite a
 * friend in the lobby into the viewer's own room. Nothing for offline friends or the viewer's own room.
 */
export function friendAction(friend: Presence, viewerRoomCode: string | null): FriendAction | null {
  if (!friend.online) return null;
  const room = friend.room;
  if (room) {
    if (room.code === viewerRoomCode) return null;
    return room.joinable ? 'join' : room.spectatable ? 'spectate' : null;
  }
  return viewerRoomCode ? 'invite' : null;
}

/** Online friends first, each group keeping the input order. */
export function friendGroups<T extends Pick<FriendEntry, 'online'>>(friends: readonly T[]): { online: T[]; offline: T[] } {
  return { online: friends.filter((friend) => friend.online), offline: friends.filter((friend) => !friend.online) };
}

/** Joining or spectating, for sorting friends whose room the viewer can enter first. */
export function canEnterFriendRoom(friend: Presence): boolean {
  return Boolean(friend.online && (friend.room?.joinable || friend.room?.spectatable));
}
