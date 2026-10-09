import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { ProvidedEmoji } from '@shared/types';
import { parseProvidedEmojiCatalog } from '@shared/constants';

/** Site-provided chat emoji keyed by name. */
export type ProvidedEmojiCatalog = ReadonlyMap<string, ProvidedEmoji>;

/** Written by `npm run emoji:import`; deployment copies it with the shared sources. */
export const PROVIDED_EMOJI_CATALOG_PATH = fileURLToPath(
  new URL('../../../shared/src/provided-emoji.generated.json', import.meta.url),
);

/**
 * Reads the importer's catalog. A missing file means the site has no provided emoji;
 * unreadable or invalid content throws so startup fails instead of silently dropping emoji.
 */
export async function loadProvidedEmojiCatalog(path: string): Promise<ProvidedEmojiCatalog> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return new Map();
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`Provided emoji catalog is not valid JSON: ${path}`);
  }
  return new Map(parseProvidedEmojiCatalog(value).map((emoji) => [emoji.name, emoji]));
}
