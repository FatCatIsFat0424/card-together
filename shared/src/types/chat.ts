// ─── Chat types ───

import type { MediaId } from './account';
import type { EmojiRecord, ProvidedEmoji } from './emoji';
import type { PlayerInfo } from './player';

/** Chat message */
export interface ChatMessage {
  readonly id: string;
  readonly sender: PlayerInfo;
  readonly content: string;
  readonly timestamp: number;
  /** Large standalone image resolved from the sender's existing emoji library. */
  readonly sticker?: Pick<EmojiRecord, 'id' | 'name' | 'mediaId'>;
  /** Large standalone image resolved from the site-provided emoji catalog. */
  readonly providedSticker?: ProvidedEmoji;
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
