import type { MediaId } from '../types/account';
import type { ProvidedEmoji } from '../types/emoji';

/**
 * 2–64 ASCII letters (case-sensitive), digits, `_`, `-` or `.`, not starting with `-` or
 * `.`. A strict superset of the earlier `[a-z0-9_]{2,32}` rule, so stored names stay valid;
 * no spaces or colons, so `:name:` tokens stay unambiguous.
 */
export const EMOJI_NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{1,63}$/;
export const EMOJI_NAME_MAX_LENGTH = 64;
/** Decoded upload limit for personal emoji; site emoji are compressed at import to fit it. */
export const EMOJI_MAX_BYTES = 2 * 1024 * 1024;
export const MAX_EMOJIS_PER_ACCOUNT = 300;
export const MAX_MESSAGE_EMOJIS = 20;

const EMOJI_TOKEN = /:([A-Za-z0-9_][A-Za-z0-9_.-]{1,63}):/g;
/**
 * Importer output: `<name>-<24 hex content digest>.<detected image type>`. The anchored
 * fixed-length suffix keeps the name unambiguous even when it contains `-` or `.`.
 */
const PROVIDED_EMOJI_FILE = /^([A-Za-z0-9_][A-Za-z0-9_.-]{1,63})-[a-f0-9]{24}\.(?:png|jpg|gif|webp)$/;

export function isEmojiName(value: unknown): value is string {
  return typeof value === 'string' && EMOJI_NAME_PATTERN.test(value);
}

/** True for a provided emoji file name; rejects paths, URLs, and arbitrary names. */
export function isProvidedEmojiFile(value: unknown): value is string {
  return typeof value === 'string' && PROVIDED_EMOJI_FILE.test(value);
}

/**
 * Validates a generated provided emoji catalog: unique valid names, each paired with its own
 * importer-format file. Throws instead of dropping entries so a corrupt catalog fails fast.
 */
export function parseProvidedEmojiCatalog(value: unknown): ProvidedEmoji[] {
  if (!Array.isArray(value)) throw new Error('Provided emoji catalog must be an array.');
  const names = new Set<string>();
  return value.map((entry: unknown, index): ProvidedEmoji => {
    const record = typeof entry === 'object' && entry !== null && !Array.isArray(entry)
      ? entry as Record<string, unknown> : null;
    const name = record?.name;
    const file = record?.file;
    if (!record || Object.keys(record).length !== 2 || !isEmojiName(name) || names.has(name) ||
      !isProvidedEmojiFile(file) || PROVIDED_EMOJI_FILE.exec(file)?.[1] !== name) {
      throw new Error(`Invalid or duplicate provided emoji catalog entry at index ${index}.`);
    }
    names.add(name);
    return { name, file };
  });
}

/** Unique `:name:` tokens in order of first appearance. */
export function extractEmojiNames(message: string): string[] {
  return [...new Set(Array.from(message.matchAll(EMOJI_TOKEN), (match) => match[1]))];
}

export type EmojiSegment =
  | string
  | { readonly name: string; readonly mediaId: MediaId }
  | { readonly name: string; readonly file: ProvidedEmoji['file'] };

/**
 * Splits a message into text and the emoji tokens attached to it. Personal `emojis` take
 * precedence over site-`provided` ones; unknown tokens stay text.
 */
export function splitEmojiText(
  message: string,
  emojis: Record<string, MediaId> = {},
  provided: Record<string, ProvidedEmoji['file']> = {},
): EmojiSegment[] {
  const segments: EmojiSegment[] = [];
  let last = 0;
  for (const match of message.matchAll(EMOJI_TOKEN)) {
    const name = match[1];
    const mediaId = Object.hasOwn(emojis, name) ? emojis[name] : undefined;
    const file = !mediaId && Object.hasOwn(provided, name) ? provided[name] : undefined;
    if (!mediaId && !file) continue;
    if (match.index > last) segments.push(message.slice(last, match.index));
    segments.push(mediaId ? { name, mediaId } : { name, file: file as string });
    last = match.index + match[0].length;
  }
  if (last < message.length) segments.push(message.slice(last));
  return segments;
}
