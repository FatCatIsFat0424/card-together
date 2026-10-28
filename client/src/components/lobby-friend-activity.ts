import type { FriendEntry } from '@shared/types';

type Presence = Pick<FriendEntry, 'online' | 'inRoom' | 'hostedRoomCode'>;

export type FriendActivity =
  | { readonly kind: 'hosting'; readonly code: string }
  | { readonly kind: 'room' }
  | { readonly kind: 'lobby' };

export type FriendAction = 'join' | 'invite';

/**
 * What an online friend is doing, as far as the presence data tells: hosting a joinable room, sitting in
 * someone else's room, or idle in the lobby. The server does not report which game or whether it has started.
 */
export function friendActivity(friend: Presence): FriendActivity | null {
  if (!friend.online) return null;
  if (friend.hostedRoomCode) return { kind: 'hosting', code: friend.hostedRoomCode };
  return friend.inRoom ? { kind: 'room' } : { kind: 'lobby' };
}

/** Joining needs a hosted room; inviting needs a room of the viewer's own and a friend who is not already in one. */
export function friendAction(friend: Presence, viewerInRoom: boolean): FriendAction | null {
  if (!friend.online) return null;
  if (friend.hostedRoomCode) return 'join';
  return viewerInRoom && !friend.inRoom ? 'invite' : null;
}
