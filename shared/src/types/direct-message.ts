import type { ChatMessage } from './chat';
import type { FriendRequest, PublicAccount } from './social';
import type { ShopStickerId } from '../constants/shop';

export type MessageContent = Pick<ChatMessage, 'content' | 'sticker' | 'providedSticker' | 'shopSticker' | 'emojis' | 'providedEmojis'>;

export interface DirectMessage extends MessageContent {
  readonly id: string;
  readonly clientId: string;
  readonly sender: PublicAccount;
  readonly recipientId: string;
  readonly timestamp: number;
}

export type MessageInput = { message: string } | { stickerId: string } | { providedSticker: string } | { shopSticker: ShopStickerId };

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
  /** Null while unread. */
  readonly readAt: number | null;
}

/** A pending request to the viewer, with the viewer's notification read state. */
export interface IncomingFriendNotification extends FriendRequest {
  /** Null while unread. */
  readonly readAt: number | null;
}

export interface SocialOverview {
  readonly incoming: IncomingFriendNotification[];
  readonly accepted: AcceptedFriendNotification[];
  readonly conversations: Conversation[];
}
