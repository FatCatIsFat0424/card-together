import type { ChatMessage } from './chat';
import type { FriendRequest, PublicAccount } from './social';

export type MessageContent = Pick<ChatMessage, 'content' | 'sticker' | 'providedSticker' | 'emojis' | 'providedEmojis'>;

export interface DirectMessage extends MessageContent {
  readonly id: string;
  readonly clientId: string;
  readonly sender: PublicAccount;
  readonly recipientId: string;
  readonly timestamp: number;
}

export type MessageInput = { message: string } | { stickerId: string } | { providedSticker: string };

export interface Conversation {
  readonly account: PublicAccount;
  readonly lastMessage: DirectMessage;
  readonly unreadCount: number;
  readonly canSend: boolean;
}

export interface MessageHistory {
  readonly account: PublicAccount;
  readonly messages: DirectMessage[];
  readonly hasMore: boolean;
  readonly canSend: boolean;
}

export interface AcceptedFriendNotification {
  readonly id: string;
  readonly account: PublicAccount;
  readonly createdAt: number;
}

export interface SocialOverview {
  readonly incoming: FriendRequest[];
  readonly accepted: AcceptedFriendNotification[];
  readonly conversations: Conversation[];
}
