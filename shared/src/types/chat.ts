// ─── Chat types ───

import type { MediaId } from './account';
import type { EmojiRecord, ProvidedEmoji } from './emoji';
import type { PlayerInfo } from './player';
import type { ShopStickerId } from '../constants/shop';

/** A selected room player; offsets use UTF-16 in the trimmed message, with an exclusive end. */
export interface ChatMention {
  readonly playerId: string;
  readonly nickname: string;
  /** The range must contain exactly `@${nickname}`. */
  readonly start: number;
  readonly end: number;
}

/** Chat message */
export interface ChatMessage {
  readonly id: string;
  readonly sender: PlayerInfo;
  readonly content: string;
  readonly mentions?: readonly ChatMention[];
  readonly timestamp: number;
  /** Large standalone image resolved from the sender's existing emoji library. */
  readonly sticker?: Pick<EmojiRecord, 'id' | 'name' | 'mediaId'>;
  /** Large standalone image resolved from the site-provided emoji catalog. */
  readonly providedSticker?: ProvidedEmoji;
  /** Official sticker whose pack ownership was checked before sending. */
  readonly shopSticker?: ShopStickerId;
  /** Custom emoji used in `content` (name → media), resolved from the sender's library. */
  readonly emojis?: Record<string, MediaId>;
  /**
   * Site-provided emoji used in `content` (name → file), for names the sender's library lacks;
   * never shares a name with `emojis`.
   */
  readonly providedEmojis?: Record<string, ProvidedEmoji['file']>;
  /** System line: `content` is a client i18n key, `sender` the player it concerns. */
  readonly system?: true;
  /**
   * Sent by a spectator or eliminated player during a match; hidden from the seats
   * still playing so hidden hands cannot be passed on.
   */
  readonly audience?: 'observers';
}
