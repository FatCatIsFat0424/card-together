import type { ProvidedEmoji } from '@shared/types';
import { isProvidedEmojiFile, parseProvidedEmojiCatalog } from '@shared/constants';

/** An absent generated file means a checkout without site-provided emoji. */
const generated = import.meta.glob<unknown>(
  '@shared/provided-emoji.generated.json', { eager: true, import: 'default' },
);

/** The catalog bundled with this build; the server validates sends against its own copy. */
export const PROVIDED_EMOJIS: readonly ProvidedEmoji[] = parseProvidedEmojiCatalog(
  Object.values(generated).flatMap((catalog) => Array.isArray(catalog) ? catalog : [catalog]),
);

/** Static URL for an importer-generated file name; null for anything else, including URLs. */
export function providedEmojiUrl(file: string): string | null {
  return isProvidedEmojiFile(file) ? `${import.meta.env.BASE_URL}provided-emoji/${file}` : null;
}
