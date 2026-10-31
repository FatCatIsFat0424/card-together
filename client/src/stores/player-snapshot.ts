import { GAME_SEAT_ORDER } from '@shared/constants';
import { roomSeatInfo } from '@shared/rules/seats';
import type { ChatMessageEvent, PlayerSnapshot } from '@shared/types';
import { useAccountStore } from './account-store';
import { usePlayerStore } from './player-store';
import { useRoomStore } from './room-store';
import { useGameStore } from './game-store';
import { useChatStore } from './chat-store';
import { useChatMentionStore } from './chat-mention-store';

export function applyPlayerSnapshot(snapshot: PlayerSnapshot): void {
  if (!snapshot.success || !snapshot.player) return;
  const account = useAccountStore.getState().account;
  if (!account || snapshot.player.id !== account.id) return;
  const previousRoom = useRoomStore.getState().currentRoomCode;
  if ((snapshot.room?.code ?? null) !== previousRoom) useChatMentionStore.getState().reset();
  usePlayerStore.getState().setPlayer(snapshot.player);
  useAccountStore.getState().setAccount({ ...account, ...snapshot.player });
  if (snapshot.coins !== undefined) useAccountStore.getState().setCoins(account.id, snapshot.coins, snapshot.coinRevision);
  if (snapshot.room) {
    useRoomStore.getState().setRoom(snapshot.room.code, snapshot.room);
    const seat = GAME_SEAT_ORDER.find(
      (value) => (snapshot.room ? roomSeatInfo(snapshot.room, value)?.player?.id : null) === snapshot.player?.id,
    );
    useRoomStore.getState().setMySeat(seat ?? null);
    if (snapshot.serverNow !== undefined) {
      useRoomStore.getState().setReplayClockOffset(snapshot.serverNow - Date.now());
    }
  } else {
    useRoomStore.getState().leaveRoom();
  }
  if (snapshot.gameState) {
    useGameStore.getState().restore(snapshot.gameState);
  } else {
    useGameStore.getState().reset();
  }
  // Broadcasts omit unchanged history; new messages arrive through applyChatMessage.
  if (snapshot.chatHistory) {
    useChatStore.getState().setMessages(snapshot.chatHistory);
    useChatMentionStore.getState().syncHistory(snapshot.chatHistory);
  }
  else if (!snapshot.room || snapshot.room.code !== previousRoom) useChatStore.getState().clearMessages();
  useAccountStore.getState().setConnection('ready');
}

export function applyChatMessage(event: ChatMessageEvent): void {
  if (useRoomStore.getState().currentRoomCode !== event.roomCode) return;
  const accountId = useAccountStore.getState().account?.id;
  if (!accountId || useChatStore.getState().messages.some((message) => message.id === event.message.id)) return;
  useChatStore.getState().addMessage(event.message);
  const foreground = typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus();
  useChatMentionStore.getState().receive(event.message, accountId, foreground);
}
