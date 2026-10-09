import { EMOJI_NAME_MAX_LENGTH, isEmojiName } from '@shared/constants';

const FALLBACK = 'emoji';

/**
 * Emoji name from a file name, following the site emoji importer: the trimmed basename when
 * it is already valid; otherwise other characters become `_`, repeats collapse, and leading
 * separators and trailing `_` are removed (`emoji` when too little remains). De-duplicated
 * against `taken` with `_2`, `_3`, ...; the result is added to `taken`.
 */
export function emojiNameFromFile(fileName: string, taken: Set<string>): string {
  const raw = fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '').trim();
  const normalized = raw.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/_{2,}/g, '_')
    .replace(/^[_.-]+/, '').slice(0, EMOJI_NAME_MAX_LENGTH).replace(/_+$/, '');
  const base = isEmojiName(raw) ? raw : isEmojiName(normalized) ? normalized : FALLBACK;
  let name = base;
  for (let suffix = 2; taken.has(name); suffix += 1) {
    name = `${base.slice(0, EMOJI_NAME_MAX_LENGTH - String(suffix).length - 1)}_${suffix}`;
  }
  taken.add(name);
  return name;
}
