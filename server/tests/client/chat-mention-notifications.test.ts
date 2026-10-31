import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@shared/types';
import { MENTION_SOUND_COOLDOWN_MS, useChatMentionStore } from '../../../client/src/stores/chat-mention-store';
import { startChatMentionSound } from '../../../client/src/audio/chat-mention-sound';

function message(id: string, patch: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id, content: '@Alice ready?', timestamp: 100,
    sender: { id: 'bob', username: 'bob', nickname: 'Bob', avatar: 'cat', avatarImage: null, color: '#4a9eff' },
    mentions: [{ playerId: 'alice', nickname: 'Alice', start: 0, end: 6 }],
    ...patch,
  };
}

beforeEach(() => {
  useChatMentionStore.getState().reset();
  useChatMentionStore.getState().setMode('sound');
});

describe('room mention alerts', () => {
  it('tracks live mentions once by message ID and target account, not nickname text', () => {
    const store = useChatMentionStore.getState();
    store.receive(message('one'), 'alice', true, 0);
    store.receive(message('one'), 'alice', true, 100);
    store.receive(message('literal', { mentions: undefined }), 'alice', true, 200);
    store.receive(message('other', { mentions: [{ playerId: 'another-alice', nickname: 'Alice', start: 0, end: 6 }] }),
      'alice', true, 300);
    expect(useChatMentionStore.getState()).toMatchObject({ unreadIds: ['one'], soundCueId: 'one', notice: { id: 'one' } });
  });

  it('suppresses self and system notifications', () => {
    const own = message('own');
    useChatMentionStore.getState().receive({ ...own, sender: { ...own.sender, id: 'alice' } }, 'alice', false);
    useChatMentionStore.getState().receive(message('system', { system: true }), 'alice', false);
    expect(useChatMentionStore.getState()).toMatchObject({ unreadIds: [], notice: null, soundCueId: null });
  });

  it('never alerts from initial or reconnect history, including an overlapping delta', () => {
    const store = useChatMentionStore.getState();
    store.syncHistory([message('old')]);
    store.receive(message('old'), 'alice', false, 0);
    expect(useChatMentionStore.getState()).toMatchObject({ unreadIds: [], soundCueId: null });
    store.receive(message('live'), 'alice', false, 100);
    store.syncHistory([message('old'), message('live'), message('missed')]);
    store.receive(message('missed'), 'alice', false, 10_000);
    expect(useChatMentionStore.getState()).toMatchObject({ unreadIds: ['live'], soundCueId: 'live' });
  });

  it('waits for actual row visibility to mark read while suppressing alerts for a reader at the bottom', () => {
    const store = useChatMentionStore.getState();
    store.setReading(true, true);
    store.receive(message('visible'), 'alice', true, 0);
    expect(useChatMentionStore.getState()).toMatchObject({ unreadIds: ['visible'], notice: null, soundCueId: null });
    store.markRead(['visible']);
    expect(useChatMentionStore.getState().unreadIds).toEqual([]);
  });

  it.each(['scrolled', 'hidden', 'background'] as const)('alerts when chat is %s', (situation) => {
    const store = useChatMentionStore.getState();
    store.setReading(situation !== 'hidden', situation !== 'scrolled');
    store.receive(message('one'), 'alice', situation !== 'background', 0);
    expect(useChatMentionStore.getState()).toMatchObject({ unreadIds: ['one'], notice: { id: 'one' }, soundCueId: 'one' });
  });

  it('throttles only sound while retaining every unread mention and the latest notice', () => {
    const store = useChatMentionStore.getState();
    store.receive(message('one'), 'alice', false, 0);
    store.receive(message('two'), 'alice', false, MENTION_SOUND_COOLDOWN_MS - 1);
    expect(useChatMentionStore.getState()).toMatchObject({ unreadIds: ['one', 'two'], notice: { id: 'two' }, soundCueId: 'one' });
    store.receive(message('three'), 'alice', false, MENTION_SOUND_COOLDOWN_MS);
    expect(useChatMentionStore.getState().soundCueId).toBe('three');
  });

  it('keeps visual-only alerts silent and does not replay after enabling sound', () => {
    const store = useChatMentionStore.getState();
    store.setMode('visual');
    store.receive(message('one'), 'alice', false, 0);
    expect(useChatMentionStore.getState()).toMatchObject({ unreadIds: ['one'], notice: { id: 'one' }, soundCueId: null });
    store.setMode('sound');
    store.receive(message('one'), 'alice', false, 10_000);
    expect(useChatMentionStore.getState().soundCueId).toBeNull();
  });

  it('turns off badges and transient notices without replaying messages received while off', () => {
    const store = useChatMentionStore.getState();
    store.receive(message('one'), 'alice', false, 0);
    store.setMode('off');
    store.receive(message('two'), 'alice', false, 10_000);
    expect(useChatMentionStore.getState()).toMatchObject({ unreadIds: [], notice: null, soundCueId: null });
    store.setMode('sound');
    store.receive(message('two'), 'alice', false, 20_000);
    expect(useChatMentionStore.getState().unreadIds).toEqual([]);
  });

  it('keeps unrelated mentions unread when one is viewed or an alert is dismissed', () => {
    const store = useChatMentionStore.getState();
    store.receive(message('one'), 'alice', false, 0);
    store.receive(message('two'), 'alice', false, 100);
    store.dismissNotice('two');
    expect(useChatMentionStore.getState().unreadIds).toEqual(['one', 'two']);
    store.requestJump('one');
    expect(useChatMentionStore.getState().targetMessageId).toBe('one');
    store.finishJump('two');
    expect(useChatMentionStore.getState().targetMessageId).toBe('one');
    store.markRead(['one']);
    store.finishJump('one');
    expect(useChatMentionStore.getState()).toMatchObject({ unreadIds: ['two'], targetMessageId: null });
  });

  it('prunes revoked history and resets deduplication and sound cooldown between rooms', () => {
    const store = useChatMentionStore.getState();
    store.receive(message('one'), 'alice', false, 0);
    store.requestJump('one');
    store.syncHistory([]);
    expect(useChatMentionStore.getState()).toMatchObject({ unreadIds: [], notice: null, targetMessageId: null });
    store.reset();
    store.receive(message('one'), 'alice', false, 1);
    expect(useChatMentionStore.getState()).toMatchObject({ unreadIds: ['one'], soundCueId: 'one' });
  });

  it('does not publish redundant updates for unchanged reader state and history', () => {
    const notify = vi.fn();
    const stop = useChatMentionStore.subscribe(notify);
    const store = useChatMentionStore.getState();
    store.setReading(false, false);
    store.syncHistory([]);
    store.markRead(['absent']);
    store.finishJump('absent');
    expect(notify).not.toHaveBeenCalled();
    stop();
  });
});

describe('mention sound lifecycle', () => {
  it('drops locked cues, plays new cues once, stops on mute, and disposes listeners', () => {
    const gestures = new EventTarget();
    const audio = { ready: vi.fn(() => false), play: vi.fn(), unlock: vi.fn(), stop: vi.fn(), dispose: vi.fn() };
    const stop = startChatMentionSound(audio, gestures);
    const store = useChatMentionStore.getState();
    store.receive(message('locked'), 'alice', false, 0);
    audio.ready.mockReturnValue(true);
    gestures.dispatchEvent(new Event('click'));
    expect(audio.unlock).not.toHaveBeenCalled();
    store.setReading(true, true);
    expect(audio.play).not.toHaveBeenCalled();
    store.receive(message('live'), 'alice', false, 5000);
    store.receive(message('live'), 'alice', false, 10_000);
    expect(audio.play).toHaveBeenCalledOnce();
    store.setMode('off');
    expect(audio.stop).toHaveBeenCalled();
    stop();
    expect(audio.dispose).toHaveBeenCalledOnce();
    store.setMode('sound');
    store.receive(message('after-dispose'), 'alice', false, 15_000);
    expect(audio.play).toHaveBeenCalledOnce();
  });
});
