import type { MediaId } from './account';

/** A custom chat emoji in one account's library; used in chat as `:name:`. */
export interface EmojiRecord {
  readonly id: string;
  readonly accountId: string;
  readonly name: string;
  readonly mediaId: MediaId;
  readonly createdAt: number;
}

/** A site-provided chat emoji available to every account; used in chat as `:name:`. */
export interface ProvidedEmoji {
  readonly name: string;
  /** Content-hashed file name inside the static `provided-emoji/` directory; not a URL. */
  readonly file: string;
}
