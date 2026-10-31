import type { ChatMention, PlayerInfo, RoomInfo } from '@shared/types';
import type { ChatMentionTranslationKey } from '../chat-mention-i18n';

export type { ChatMention } from '@shared/types';

export interface MentionDraft {
  readonly text: string;
  readonly mentions: readonly ChatMention[];
}

export interface MentionCandidate {
  readonly player: PlayerInfo;
  readonly seat: string | null;
}

export const EMPTY_MENTION_DRAFT: MentionDraft = { text: '', mentions: [] };
export const CHAT_MAX_LENGTH = 500;
export const CHAT_MAX_MENTIONS = 20;

export function mentionCandidates(room: RoomInfo | null, senderId: string | null): readonly MentionCandidate[] {
  if (!room) return [];
  const observers = new Set(room.observerIds);
  const restricted = senderId !== null && observers.has(senderId);
  const candidates: MentionCandidate[] = [];
  const seen = new Set<string>();
  const add = (player: PlayerInfo | null, seat: string | null): void => {
    if (!player || player.isBot || seen.has(player.id) || (restricted && !observers.has(player.id))) return;
    seen.add(player.id);
    candidates.push({ player, seat });
  };
  for (const [seat, info] of Object.entries(room.seats)) add(info.player, seat);
  room.additionalSeats?.forEach((info, index) => add(info.player, `P${index + 5}`));
  room.spectators?.forEach((player) => add(player, null));
  return candidates;
}

/** Invalid ranges remain ordinary text; never interpret text as identity metadata. */
export function validMentions(text: string, mentions?: readonly ChatMention[]): readonly ChatMention[] {
  let end = 0;
  return (mentions ?? []).filter((mention) => {
    if (!Number.isSafeInteger(mention.start) || !Number.isSafeInteger(mention.end)
      || mention.start < end || mention.end > text.length || mention.start < 0
      || !mention.playerId || !mention.nickname || text.slice(mention.start, mention.end) !== `@${mention.nickname}`) return false;
    end = mention.end;
    return true;
  });
}

export function isMentioned(text: string, mentions: readonly ChatMention[] | undefined, viewerId: string | null): boolean {
  return viewerId !== null && validMentions(text, mentions).some((mention) => mention.playerId === viewerId);
}

export function replaceMentionRange(draft: MentionDraft, start: number, end: number, replacement: string): MentionDraft {
  const text = draft.text.slice(0, start) + replacement + draft.text.slice(end);
  const shift = replacement.length - (end - start);
  const mentions = draft.mentions.flatMap((mention) => {
    if (mention.end === start && start === end && /^[\p{L}\p{N}\p{M}_]/u.test(replacement)) return [];
    if (mention.end <= start) return [mention];
    if (mention.start >= end) return [{ ...mention, start: mention.start + shift, end: mention.end + shift }];
    return [];
  });
  return { text, mentions };
}

/** Reconcile native typing, deletion, paste and undo without recreating unselected mentions. */
export function editMentionDraft(draft: MentionDraft, text: string,
  replaced?: { readonly start: number; readonly end: number }): MentionDraft {
  if (draft.text === text) {
    if (!replaced || replaced.start === replaced.end) return draft;
    return { text, mentions: draft.mentions.filter((mention) => mention.end <= replaced.start || mention.start >= replaced.end) };
  }
  let start = 0;
  while (start < draft.text.length && start < text.length && draft.text[start] === text[start]) start++;
  let oldEnd = draft.text.length;
  let newEnd = text.length;
  while (oldEnd > start && newEnd > start && draft.text[oldEnd - 1] === text[newEnd - 1]) { oldEnd--; newEnd--; }
  // A native selection disambiguates identical adjacent tokens with different identities.
  const replacementEnd = replaced ? replaced.end + text.length - draft.text.length : -1;
  if (replaced && replacementEnd >= replaced.start
    && draft.text.slice(0, replaced.start) === text.slice(0, replaced.start)
    && draft.text.slice(replaced.end) === text.slice(replacementEnd)) {
    start = replaced.start;
    oldEnd = replaced.end;
    newEnd = replacementEnd;
  }
  return replaceMentionRange(draft, start, oldEnd, text.slice(start, newEnd));
}

export function mentionQuery(draft: MentionDraft, start: number, end: number): { start: number; end: number; query: string } | null {
  if (start !== end || draft.mentions.some((mention) => start > mention.start && start <= mention.end)) return null;
  const match = /(?:^|\s)@([^\s@]*)$/.exec(draft.text.slice(0, start));
  return match ? { start: start - match[1].length - 1, end: start, query: match[1] } : null;
}

export function searchMentionCandidates(candidates: readonly MentionCandidate[], query: string): readonly MentionCandidate[] {
  const search = query.toLocaleLowerCase();
  return candidates.filter(({ player }) => player.nickname.toLocaleLowerCase().includes(search)
    || player.username.toLocaleLowerCase().includes(search));
}

export function insertMention(draft: MentionDraft, start: number, end: number, player: PlayerInfo): MentionDraft {
  if (draft.mentions.length >= CHAT_MAX_MENTIONS) return draft;
  const token = `@${player.nickname}`;
  if (draft.text.length - (end - start) + token.length + 1 > CHAT_MAX_LENGTH) return draft;
  const next = replaceMentionRange(draft, start, end, `${token} `);
  return { ...next, mentions: [...next.mentions, { playerId: player.id, nickname: player.nickname,
    start, end: start + token.length }].sort((left, right) => left.start - right.start) };
}

export type PreparedMentionMessage = {
  readonly ok: true;
  readonly payload: { readonly message: string; readonly mentions?: readonly ChatMention[] };
} | { readonly ok: false; readonly error: ChatMentionTranslationKey };

/** Preserve the draft when a chosen identity needs reselection; never silently change recipients. */
export function prepareMentionMessage(draft: MentionDraft, candidates: readonly MentionCandidate[]): PreparedMentionMessage {
  const valid = validMentions(draft.text, draft.mentions);
  if (valid.length !== draft.mentions.length || valid.length > CHAT_MAX_MENTIONS) {
    return { ok: false, error: 'chatMention.error.invalid' };
  }
  for (const mention of valid) {
    const candidate = candidates.find(({ player }) => player.id === mention.playerId);
    if (!candidate) return { ok: false, error: 'chatMention.error.reselect' };
    if (candidate.player.nickname !== mention.nickname) return { ok: false, error: 'chatMention.error.renamed' };
  }
  const message = draft.text.trim();
  const offset = draft.text.length - draft.text.trimStart().length;
  const mentions = valid.map((mention) => ({ ...mention, start: mention.start - offset, end: mention.end - offset }));
  return { ok: true, payload: mentions.length ? { message, mentions } : { message } };
}

export type MentionKeyAction = 'next' | 'previous' | 'select' | 'dismiss' | 'send' | null;

export function mentionKeyAction(key: string, composing: boolean, open: boolean, shift: boolean): MentionKeyAction {
  if (composing) return null;
  if (open) {
    if (key === 'ArrowDown') return 'next';
    if (key === 'ArrowUp') return 'previous';
    if (key === 'Enter' || (key === 'Tab' && !shift)) return 'select';
    if (key === 'Escape') return 'dismiss';
  }
  return key === 'Enter' && !shift ? 'send' : null;
}
