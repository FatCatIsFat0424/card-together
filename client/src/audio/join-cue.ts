import type { ChatMessageEvent, RoomCode } from '@shared/types';

/**
 * Members already in the room receive the join line as a delta; the joining player gets it
 * inside their history snapshot instead, so only other members are cued.
 */
export function isJoinCue(event: ChatMessageEvent, roomCode: RoomCode | null, accountId: string | null): boolean {
  return event.roomCode === roomCode && event.message.system === true &&
    event.message.content === 'chat.playerJoined' && event.message.sender.id !== accountId;
}
