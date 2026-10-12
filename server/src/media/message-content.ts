import type { EmojiRecord, MediaId, ProvidedEmoji } from '@shared/types';
import { MAX_MESSAGE_EMOJIS, extractEmojiNames } from '@shared/constants';

export interface ResolvedMessageEmojis {
  readonly emojis: Record<string, MediaId>;
  readonly providedEmojis: Record<string, ProvidedEmoji['file']>;
}

/** Personal assets take precedence; unresolved tokens remain plain text. */
export function resolveMessageEmojis(
  content: string,
  library: readonly Pick<EmojiRecord, 'name' | 'mediaId'>[],
  provided: ReadonlyMap<string, ProvidedEmoji> = new Map(),
): ResolvedMessageEmojis {
  const owned = new Map(library.map((emoji) => [emoji.name, emoji.mediaId]));
  const used = extractEmojiNames(content).filter((name) => owned.has(name) || provided.has(name))
    .slice(0, MAX_MESSAGE_EMOJIS);
  const emojis: Record<string, MediaId> = {};
  const providedEmojis: Record<string, ProvidedEmoji['file']> = {};
  for (const name of used) {
    const mediaId = owned.get(name);
    if (mediaId) emojis[name] = mediaId;
    else {
      const asset = provided.get(name);
      if (asset) providedEmojis[name] = asset.file;
    }
  }
  return { emojis, providedEmojis };
}
