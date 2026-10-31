import type { ChatMention } from '@shared/types';

/** Parses only explicit selections; literal @text never selects a player. */
export function parseChatMentions(value: unknown, content: string): ChatMention[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) return null;
  const mentions: ChatMention[] = [];
  for (const entry of value as readonly unknown[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const keys = Object.keys(entry);
    if (keys.length !== 4 || keys.some((key) => !['playerId', 'nickname', 'start', 'end'].includes(key))) return null;
    const { playerId, nickname, start, end } = entry as Record<string, unknown>;
    if (typeof playerId !== 'string' || !playerId || typeof nickname !== 'string' || !nickname ||
      typeof start !== 'number' || !Number.isSafeInteger(start) || start < 0 ||
      typeof end !== 'number' || !Number.isSafeInteger(end) || end <= start || end > content.length ||
      content.slice(start, end) !== `@${nickname}`) return null;
    mentions.push({ playerId, nickname, start, end });
  }
  mentions.sort((a, b) => a.start - b.start);
  if (mentions.some((mention, index) => index > 0 && mention.start < mentions[index - 1].end)) return null;
  return mentions;
}
