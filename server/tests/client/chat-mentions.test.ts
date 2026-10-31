import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, PlayerInfo, RoomInfo } from '@shared/types';
import {
  CHAT_MAX_MENTIONS, EMPTY_MENTION_DRAFT, editMentionDraft, insertMention, isMentioned, mentionCandidates,
  mentionKeyAction, mentionQuery, prepareMentionMessage, replaceMentionRange, searchMentionCandidates, validMentions,
} from '../../../client/src/components/chat-mentions';
import type { ChatMention, MentionDraft } from '../../../client/src/components/chat-mentions';

const state = vi.hoisted(() => ({ messages: [] as unknown[], room: null as RoomInfo | null, viewerId: 'account-id' }));
vi.mock('../../../client/src/stores/chat-store', () => ({
  useChatStore: (select: (value: typeof state) => unknown) => select(state),
}));
vi.mock('../../../client/src/stores/chat-mention-store', () => ({
  useChatMentionStore: (select: (value: { unreadIds: readonly string[]; targetMessageId: null; requestJump: () => void }) => unknown) =>
    select({ unreadIds: [], targetMessageId: null, requestJump: () => {} }),
}));
vi.mock('../../../client/src/stores/account-store', () => ({
  useAccountStore: (select: (value: { account: { id: string } }) => unknown) => select({ account: { id: state.viewerId } }),
}));
vi.mock('../../../client/src/stores/player-store', () => ({
  usePlayerStore: (select: (value: { playerId: string }) => unknown) => select({ playerId: 'session-id' }),
}));
vi.mock('../../../client/src/stores/room-store', () => ({
  useRoomStore: (select: (value: { roomInfo: RoomInfo | null }) => unknown) => select({ roomInfo: state.room }),
}));
vi.mock('../../../client/src/socket', () => ({ socket: {} }));
vi.mock('../../../client/src/media', () => ({ mediaUrl: (id: string) => `/api/media/${id}` }));
vi.mock('../../../client/src/api', () => ({ apiRequest: vi.fn() }));

import { ChatMessageBody } from '../../../client/src/components/ChatEmoji';
import { ChatPanel } from '../../../client/src/components/ChatPanel';
import { ChatMentionComposer } from '../../../client/src/components/ChatMentionComposer';
import { ChatRoomMentionBody } from '../../../client/src/components/ChatRoomMentionBody';
import { chatLogShown, intersectsChatViewport } from '../../../client/src/components/use-chat-mention-reading';
import { useI18nStore } from '../../../client/src/stores/i18n-store';
import { chatMentionErrorKey } from '../../../client/src/chat-mention-i18n';

const ALICE: PlayerInfo = { id: 'alice', username: 'alice-one', nickname: 'Alice', avatar: 'cat', avatarImage: null, color: '#123456' };
const OTHER_ALICE: PlayerInfo = { ...ALICE, id: 'other-alice', username: 'alice-two' };
const VIEWER: PlayerInfo = { ...ALICE, id: 'account-id', username: 'viewer' };
function room(): RoomInfo {
  return { code: 'ABC123', gameType: 'bridge', status: 'playing', createdAt: 1, hostId: ALICE.id,
    abortVote: null, abortVoteCooldownUntil: null,
    seats: { N: { player: ALICE, isReady: false }, E: { player: { ...ALICE, id: 'bot', isBot: true }, isReady: false },
      S: { player: null, isReady: false }, W: { player: VIEWER, isReady: false } },
    additionalSeats: [{ player: OTHER_ALICE, isReady: false }],
    spectators: [{ ...ALICE, id: 'spectator', username: 'watcher' }], observerIds: ['spectator', VIEWER.id] };
}
function selected(prefix = ''): MentionDraft {
  return insertMention({ text: `${prefix}@al`, mentions: [] }, prefix.length, prefix.length + 3, ALICE);
}
function message(id: string, playerId = 'account-id'): ChatMessage & { mentions: readonly ChatMention[] } {
  return { id, sender: ALICE, content: '@Alice', timestamp: 1, mentions: [{ playerId, nickname: 'Alice', start: 0, end: 6 }] };
}

afterEach(() => {
  vi.unstubAllGlobals();
  state.messages = []; state.room = null; state.viewerId = 'account-id';
  useI18nStore.setState({ locale: 'zh-TW' });
});

describe('intentional mention drafts', () => {
  it('leaves typed, pasted and undone @names plain until a candidate is chosen', () => {
    const plain = editMentionDraft(EMPTY_MENTION_DRAFT, '@Alice');
    expect(prepareMentionMessage(plain, mentionCandidates(room(), null))).toEqual({ ok: true, payload: { message: '@Alice' } });
    const chosen = selected();
    expect(chosen).toEqual({ text: '@Alice ', mentions: [{ playerId: ALICE.id, nickname: 'Alice', start: 0, end: 6 }] });
    const erased = editMentionDraft(chosen, '');
    expect(editMentionDraft(erased, '@Alice ').mentions).toEqual([]);
  });

  it('uses UTF-16 offsets, shifts around emoji edits and trims without mutating drafts', () => {
    const draft = selected('  😀 ');
    const before = structuredClone(draft);
    const emoji = replaceMentionRange(draft, 5, 5, ':wave: ');
    expect(emoji.mentions[0].start).toBe(12);
    expect(emoji.text.slice(12, 18)).toBe('@Alice');
    const prepared = prepareMentionMessage(emoji, mentionCandidates(room(), null));
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error(prepared.error);
    expect(prepared.payload.message).toBe('😀 :wave: @Alice');
    expect(prepared.payload.mentions?.[0]).toMatchObject({ start: 10, end: 16 });
    expect(draft).toEqual(before);
  });

  it('drops an edited token and preserves untouched identities, including duplicate names', () => {
    const first = selected();
    const both = insertMention({ ...first, text: `${first.text}@al` }, 7, 10, OTHER_ALICE);
    const deleted = editMentionDraft(both, '@Alice ', { start: 0, end: 7 });
    expect(deleted.mentions).toEqual([{ playerId: OTHER_ALICE.id, nickname: 'Alice', start: 0, end: 6 }]);
    expect(editMentionDraft(first, '@Alicex ').mentions).toEqual([]);
    expect(editMentionDraft(first, '@Alice ', { start: 0, end: 6 }).mentions).toEqual([]);
    expect(editMentionDraft(first, 'x@Alice ').mentions[0]).toMatchObject({ start: 1, end: 7 });
    expect(editMentionDraft(first, '@Alice! ').mentions[0]).toMatchObject({ start: 0, end: 6 });
    expect(replaceMentionRange(first, 3, 3, ':wave:').mentions).toEqual([]);
  });

  it('refuses sending removed, renamed and newly restricted targets while preserving the draft', () => {
    const draft = selected();
    const before = structuredClone(draft);
    expect(prepareMentionMessage(draft, [])).toEqual({ ok: false, error: 'chatMention.error.reselect' });
    expect(prepareMentionMessage(draft, [{ player: { ...ALICE, nickname: 'Renamed' }, seat: 'N' }]))
      .toEqual({ ok: false, error: 'chatMention.error.renamed' });
    expect(prepareMentionMessage(draft, mentionCandidates(room(), VIEWER.id))).toEqual({ ok: false, error: 'chatMention.error.reselect' });
    expect(draft).toEqual(before);
  });

  it('enforces content and mention limits without truncating selected tokens', () => {
    const full = { text: `${'x'.repeat(498)}@a`, mentions: [] };
    expect(insertMention(full, 498, 500, ALICE)).toBe(full);
    let draft = EMPTY_MENTION_DRAFT;
    for (let index = 0; index < CHAT_MAX_MENTIONS; index++) draft = insertMention(draft, draft.text.length, draft.text.length, ALICE);
    expect(draft.mentions).toHaveLength(CHAT_MAX_MENTIONS);
    expect(insertMention(draft, draft.text.length, draft.text.length, ALICE)).toBe(draft);
  });

  it('finds only a caret-local query outside existing mention tokens', () => {
    expect(mentionQuery({ text: 'hi @ali', mentions: [] }, 7, 7)).toEqual({ start: 3, end: 7, query: 'ali' });
    expect(mentionQuery({ text: 'mail@ali', mentions: [] }, 8, 8)).toBeNull();
    expect(mentionQuery(selected(), 4, 4)).toBeNull();
    expect(mentionQuery({ text: '@ali', mentions: [] }, 0, 4)).toBeNull();
  });

  it('never selects or sends while composing and selecting a mention never sends', () => {
    for (const key of ['Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'Escape']) expect(mentionKeyAction(key, true, true, false)).toBeNull();
    expect(mentionKeyAction('Enter', false, true, false)).toBe('select');
    expect(mentionKeyAction('Tab', false, true, false)).toBe('select');
    expect(mentionKeyAction('Tab', false, true, true)).toBeNull();
    expect(mentionKeyAction('Escape', false, true, false)).toBe('dismiss');
    expect(mentionKeyAction('Enter', false, false, false)).toBe('send');
    expect(mentionKeyAction('Enter', false, false, true)).toBeNull();
  });
});

describe('room mention candidates', () => {
  it('includes self, additional seats and spectators, excludes bots, and keeps same-name identities distinct', () => {
    const candidates = mentionCandidates(room(), ALICE.id);
    expect(candidates.map(({ player, seat }) => [player.id, player.username, seat])).toEqual([
      ['alice', 'alice-one', 'N'], ['account-id', 'viewer', 'W'], ['other-alice', 'alice-two', 'P5'], ['spectator', 'watcher', null],
    ]);
    expect(searchMentionCandidates(candidates, 'ALICE-TWO').map(({ player }) => player.id)).toEqual(['other-alice']);
    expect(searchMentionCandidates(candidates, 'alice')).toHaveLength(4);
  });

  it('limits observer and eliminated senders to the current observer audience', () => {
    expect(mentionCandidates(room(), VIEWER.id).map(({ player }) => player.id)).toEqual(['account-id', 'spectator']);
    expect(mentionCandidates(room(), 'spectator').map(({ player }) => player.id)).toEqual(['account-id', 'spectator']);
    expect(mentionCandidates(null, VIEWER.id)).toEqual([]);
  });
});

describe('room mention rendering', () => {
  it('localizes every mention acknowledgement error', () => {
    for (const error of [
      'Invalid chat mentions. Please select players again.',
      'Mentioned players must be human members of this room. Please select players again.',
      'A mentioned player changed their nickname. Please select them again.',
      'Observers can only mention other observers during a match.',
    ]) {
      const key = chatMentionErrorKey(error);
      expect(key).not.toBeNull();
      useI18nStore.setState({ locale: 'en' });
      expect(useI18nStore.getState().t(key!)).toBe(error);
      useI18nStore.setState({ locale: 'zh-TW' });
      expect(useI18nStore.getState().t(key!)).not.toBe(error);
    }
    expect(chatMentionErrorKey('Unknown error')).toBeNull();
  });
  it('renders selected composer tokens as colored text with a native textarea and accessible combobox', () => {
    const html = renderToStaticMarkup(createElement(ChatMentionComposer, { draft: selected(), onChange: vi.fn(),
      candidates: mentionCandidates(room(), null), inputRef: { current: null }, busy: false }));
    expect(html).toMatch(/class="[^"]*composerMention[^"]*">@Alice/);
    expect(html).toContain('role="combobox"');
    expect(html).toContain('maxLength="500"');
    expect(html).toContain('<textarea');
  });

  it('renders only supplied valid ranges and keeps mixed emoji and unsafe content escaped', () => {
    const content = '<script>x</script> :wave: @Alice @Alice';
    const start = content.indexOf('@Alice');
    const data = { ...message('safe'), content, emojis: { wave: 'wave.png' },
      mentions: [{ playerId: ALICE.id, nickname: 'Alice', start, end: start + 6 }] };
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ChatRoomMentionBody, { message: data, room: room() })));
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('src="/api/media/wave.png"');
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('@Alice</span>');
    expect(validMentions(content, [{ ...data.mentions[0], end: start + 5 }])).toEqual([]);
    const plain = renderToStaticMarkup(createElement(ChatMessageBody, { message: data }));
    expect(plain).not.toContain('<button');
    expect(plain).toContain('@Alice @Alice');
  });

  it('falls back to a profile link when the mentioned member left', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null,
      createElement(ChatRoomMentionBody, { message: message('left', 'left/member'), room: null })));
    expect(html).toContain('href="/players/left%2Fmember"');
  });

  it('highlights each targeted message in a sender group using account ID, regardless of read state', () => {
    state.messages = [message('one'), message('two', 'someone-else'), message('three')];
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ChatPanel)));
    expect(html.match(/data-chat-message-id=/g)).toHaveLength(3);
    expect(html.match(/data-chat-mentioned="true"/g)).toHaveLength(2);
    expect(html).toMatch(/data-chat-message-id="two" class=/);
    expect(isMentioned('@Alice', message('same-name', 'someone-else').mentions, 'account-id')).toBe(false);
    expect(isMentioned('@Alice', message('self').mentions, 'account-id')).toBe(true);
  });
});

describe('mention viewport geometry', () => {
  const log = { top: 100, bottom: 400, left: 10, right: 300 };
  it('requires positive intersection with the log and browser viewport', () => {
    expect(intersectsChatViewport({ ...log, top: 90, bottom: 120 }, log, 800, 600)).toBe(true);
    expect(intersectsChatViewport({ ...log, top: 400, bottom: 450 }, log, 800, 600)).toBe(false);
    expect(intersectsChatViewport(log, log, 800, 80)).toBe(false);
    expect(intersectsChatViewport({ ...log, left: 310, right: 400 }, log, 800, 600)).toBe(false);
  });

  it('never treats a background document or a retained hidden dock as reading', () => {
    const foreground = { visibilityState: 'visible', hasFocus: vi.fn(() => true) };
    vi.stubGlobal('document', foreground);
    vi.stubGlobal('window', { innerWidth: 800, innerHeight: 600 });
    const hiddenParent = { hidden: false, parentElement: null, getBoundingClientRect: () => ({ ...log, bottom: 100 }),
      style: { display: 'block', visibility: 'visible', opacity: '1', overflowY: 'visible' } };
    const element = { clientHeight: 300, getBoundingClientRect: () => log, parentElement: hiddenParent,
      style: { display: 'block', visibility: 'visible', opacity: '1' } };
    vi.stubGlobal('getComputedStyle', (node: typeof element) => node.style);
    const logElement = element as unknown as HTMLElement;
    expect(chatLogShown(logElement)).toBe(true);
    expect(chatLogShown(logElement, true)).toBe(false);
    foreground.hasFocus.mockReturnValue(false);
    expect(chatLogShown(logElement)).toBe(false);
    foreground.hasFocus.mockReturnValue(true);
    foreground.visibilityState = 'hidden';
    expect(chatLogShown(logElement)).toBe(false);
    foreground.visibilityState = 'visible';
    hiddenParent.hidden = true;
    expect(chatLogShown(logElement)).toBe(false);
    hiddenParent.hidden = false;
    hiddenParent.style.visibility = 'hidden';
    expect(chatLogShown(logElement)).toBe(false);
    hiddenParent.style.visibility = 'visible';
    hiddenParent.style.opacity = '0';
    expect(chatLogShown(logElement)).toBe(false);
    hiddenParent.style.opacity = '1';
    hiddenParent.style.overflowY = 'hidden';
    expect(chatLogShown(logElement)).toBe(false);
  });
});
