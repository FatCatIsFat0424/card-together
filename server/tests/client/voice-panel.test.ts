import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoiceClientState } from '../../../client/src/voice/voice-session';

const mocks = vi.hoisted(() => ({
  voice: {} as Record<string, unknown>,
  account: { id: 'me', nickname: 'Alice', avatar: 'cat', color: '#fff', avatarImage: null, avatarBorder: null },
  accountStore: { account: null as unknown, connection: 'ready' },
  roomStore: { currentRoomCode: 'ABC123', roomInfo: null as unknown },
}));

vi.mock('../../../client/src/stores/voice-store', () => ({
  useVoiceStore: (select: (state: Record<string, unknown>) => unknown) => select(mocks.voice),
  disposeVoice: vi.fn(), joinVoice: vi.fn(), leaveVoice: vi.fn(), resumeVoiceAudio: vi.fn(),
  setVoiceDeafened: vi.fn(), setVoiceInputDevice: vi.fn(), setVoiceMuted: vi.fn(),
  setVoiceOutputDevice: vi.fn(), setVoicePeerMuted: vi.fn(), setVoicePeerVolume: vi.fn(),
  voiceStreamFor: vi.fn(() => null), watchAudioDevices: vi.fn(),
}));
vi.mock('../../../client/src/stores/account-store', () => ({
  useAccountStore: (select: (state: typeof mocks.accountStore) => unknown) => select(mocks.accountStore),
}));
vi.mock('../../../client/src/stores/room-store', () => ({
  useRoomStore: (select: (state: typeof mocks.roomStore) => unknown) => select(mocks.roomStore),
}));
vi.mock('../../../client/src/api', () => ({ apiRequest: vi.fn() }));
vi.mock('../../../client/src/components/Avatar', () => ({ Avatar: () => null }));

import { VoiceParticipantRow, VoicePanel } from '../../../client/src/components/VoicePanel';
import { useI18nStore } from '../../../client/src/stores/i18n-store';
import {
  summarizeVoice, toggleExpandedRow, visibleExpandedRow,
} from '../../../client/src/voice/voice-panel-state';

function participant(peerId: string, extra: Record<string, unknown> = {}) {
  return { peerId, accountId: `account-${peerId}`, muted: false, deafened: false, ...extra };
}

function voiceState(extra: Partial<VoiceClientState> | Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 'idle', participants: [], muted: false, deafened: false, error: null, autoplayBlocked: false,
    peerPrefs: {}, peerErrors: {}, peerConnections: {}, peerId: null, silenced: [],
    inputs: [], outputs: [], inputDeviceId: null, outputDeviceId: null, ...extra,
  };
}

const JOINED = {
  status: 'joined', peerId: 'self',
  participants: [participant('self', { accountId: 'me' }), participant('a'), participant('b')],
  peerConnections: { a: 'connected', b: 'connected' },
};

function render(extra: Record<string, unknown> = {}): string {
  mocks.voice = voiceState(extra);
  return renderToStaticMarkup(createElement(VoicePanel));
}

beforeEach(() => {
  useI18nStore.getState().setLocale('zh-TW');
  mocks.accountStore = { account: mocks.account, connection: 'ready' };
  mocks.roomStore = { currentRoomCode: 'ABC123', roomInfo: null };
});

describe('voice panel states', () => {
  it('should show the status card, a join button and the device check when not joined, without the room code', () => {
    const html = render();
    expect(html).toContain('尚未加入語音');
    expect(html).toContain('加入後可與同桌的人語音');
    expect(html).toContain('加入語音');
    expect(html).toContain('加入前先確認裝置');
    expect(html).not.toContain('ABC123');
    expect(html).not.toContain('aria-pressed="true"');
    expect(html).not.toContain('重新加入');
    expect(html).not.toContain('離開語音');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('<ul');
  });

  it('should offer the dark device pickers, a mic test, a test tone and the voice volume before joining', () => {
    const html = render();
    expect(html.match(/aria-haspopup="listbox"/g)).toHaveLength(2);
    expect(html).not.toContain('<select');
    expect(html).toContain('>測試</button>');
    expect(html).toContain('aria-label="播放測試音"');
    expect(html).toMatch(/<input[^>]*type="range"[^>]*value="100"/);
    expect(html).toContain('更多音量設定 ›');
    expect(html).toContain('aria-label="麥克風音量"');
  });

  it('should disable joining while the connection is not ready', () => {
    mocks.accountStore.connection = 'connecting';
    expect(render()).toMatch(/<button[^>]*disabled=""[^>]*>加入語音/);
  });

  it('should offer cancel instead of join while joining', () => {
    const html = render({ status: 'joining' });
    expect(html).toContain('正在連線…');
    expect(html).toContain('取消');
    expect(html).not.toContain('加入語音');
    expect(html).not.toContain('<span>麥克風</span>');
  });

  it('should show the reason in the card and a reconnect button after a failed join', () => {
    const html = render({ status: 'error', error: 'permission' });
    expect(html).toMatch(/role="alert"[^>]*>麥克風權限遭拒/);
    expect(html).toContain('重新連線');
    expect(html).toContain('連線失敗');
    expect(html).toContain('data-state="bad"');
    expect(html).not.toContain('加入語音');
  });

  it('should show status with the participant count, a leave action, two toggles and the gear when joined', () => {
    const html = render(JOINED);
    expect(html).toContain('語音已連線');
    expect(html).toContain('3 人在線 · 連線正常');
    expect(html).toContain('data-state="ok"');
    expect(html).toContain('aria-label="裝置"');
    expect(html).toContain('離開語音');
    expect(html).toContain('<span>麥克風</span>');
    expect(html).toContain('<span>聲音</span>');
    // Two toggles and one mute button per remote player.
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(4);
    expect(html).not.toContain('加入前先確認裝置');
    expect(html).not.toContain('重新加入');
    expect(html).not.toContain('role="alert"');
  });

  it('should turn the toggles red and relabel them when the microphone and sound are off', () => {
    const html = render({ ...JOINED, muted: true, deafened: true });
    expect(html).toContain('<span>麥克風已關</span>');
    expect(html).toContain('<span>聲音已關</span>');
    expect(html.match(/data-off="true"/g)).toHaveLength(2);
  });

  it('should keep a lone participant joined rather than connected', () => {
    const html = render({ status: 'joined', peerId: 'self', participants: [participant('self', { accountId: 'me' })] });
    expect(html).toContain('已加入語音');
    expect(html).toContain('1 人在線');
    expect(html).not.toContain('語音已連線');
  });

  it('should offer rejoin inline only when a peer connection failed', () => {
    const html = render({ ...JOINED, peerErrors: { b: 'connection-failed' }, peerConnections: { a: 'connected' } });
    expect(html).toContain('部分連線失敗');
    expect(html).toContain('data-state="bad"');
    expect(html).toMatch(/role="alert"[^>]*>.*部分語音連線失敗.*重新加入/);
    expect(html).toMatch(/role="alert">連線失敗/);
  });

  it('should not offer rejoin while peers are only still connecting', () => {
    const html = render({ ...JOINED, peerConnections: { a: 'connected' } });
    expect(html).toContain('已加入語音');
    expect(html).toContain('連線中…');
    expect(html).not.toContain('重新加入');
  });

  it('should make remote rows expandable buttons while the local row is plain', () => {
    const html = render(JOINED);
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(3);
    expect(html.match(/class="[^"]*rowButton[^"]*"[^>]*aria-expanded="false"/g)).toHaveLength(2);
    expect(html).toContain('（我）');
    expect(html).not.toContain('type="range"');
  });

  it('should show muted and deafened icons per participant', () => {
    const html = render({
      ...JOINED,
      participants: [participant('self', { accountId: 'me' }), participant('a', { muted: true, deafened: true }), participant('b')],
      peerPrefs: { 'account-b': { muted: true, volume: 1 } },
    });
    expect(html).toContain('aria-label="麥克風已靜音"');
    expect(html).toContain('aria-label="聲音已關"');
    // The one-tap mute button carries the state.
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toContain('title="已被你靜音"');
  });

  it('should show compact banners for observers, silenced observers, and blocked playback', () => {
    mocks.roomStore.roomInfo = { observerIds: ['me'], seats: {} };
    const html = render({ ...JOINED, silenced: ['x'], autoplayBlocked: true });
    expect(html).toContain('牌局結束前，場上玩家聽不到你。');
    expect(html).toContain('旁觀者與出局玩家已靜音');
    expect(html).toContain('開啟播放');
    expect(render({ ...JOINED, deafened: true, autoplayBlocked: true })).not.toContain('開啟播放');
  });

  it('should render English labels', () => {
    useI18nStore.getState().setLocale('en');
    const html = render(JOINED);
    expect(html).toContain('Voice connected');
    expect(html).toContain('3 in voice');
    expect(html).toContain('<span>Microphone</span>');
    expect(html).toContain('<span>Sound</span>');
  });
});

describe('voice participant row', () => {
  const baseProps = {
    person: undefined, self: false, muted: false, deafened: false, connection: 'connected' as const,
    preference: { muted: false, volume: 0.8 }, expanded: false,
    onToggle: vi.fn(), onPeerMuted: vi.fn(), onPeerVolume: vi.fn(),
  };

  it('should reveal per-player mute and volume only when expanded', () => {
    const collapsed = renderToStaticMarkup(createElement(VoiceParticipantRow, baseProps));
    expect(collapsed).toContain('aria-expanded="false"');
    expect(collapsed).not.toContain('type="range"');
    const expanded = renderToStaticMarkup(createElement(VoiceParticipantRow, { ...baseProps, expanded: true }));
    expect(expanded).toContain('aria-expanded="true"');
    expect(expanded).toMatch(/type="range"[^>]*value="80"|value="80"[^>]*type="range"/);
    expect(expanded).toContain('aria-pressed="false"');
    expect(expanded).toContain('靜音此玩家');
  });

  it('should reflect a muted player on the mute button', () => {
    const html = renderToStaticMarkup(createElement(VoiceParticipantRow, {
      ...baseProps, expanded: true, preference: { muted: true, volume: 0.5 },
    }));
    expect(html).toContain('aria-pressed="true"');
  });

  it('should never expand the local row', () => {
    const html = renderToStaticMarkup(createElement(VoiceParticipantRow, {
      ...baseProps, self: true, expanded: true, connection: undefined,
    }));
    expect(html).not.toContain('aria-expanded');
    expect(html).not.toContain('type="range"');
  });
});

describe('voice panel state', () => {
  it('should expand one row at a time and collapse on a second activation', () => {
    expect(toggleExpandedRow(null, 'a')).toBe('a');
    expect(toggleExpandedRow('a', 'b')).toBe('b');
    expect(toggleExpandedRow('b', 'b')).toBeNull();
  });

  it('should close an expanded row whose participant left', () => {
    expect(visibleExpandedRow('a', ['me', 'a'])).toBe('a');
    expect(visibleExpandedRow('a', ['me'])).toBeNull();
    expect(visibleExpandedRow(null, ['me'])).toBeNull();
  });

  it('should summarize connection health for the header', () => {
    const state = (extra: Record<string, unknown>) => summarizeVoice({
      ...voiceState(JOINED), ...extra,
    } as unknown as Parameters<typeof summarizeVoice>[0]);
    expect(state({})).toMatchObject({ kind: 'connected', dot: 'ok', count: 3, needsRejoin: false });
    expect(state({ peerConnections: { a: 'connected' } })).toMatchObject({ kind: 'joined', dot: 'busy' });
    expect(state({ peerErrors: { a: 'signal-failed' } })).toMatchObject({ kind: 'partial', dot: 'bad', needsRejoin: true });
    expect(state({ status: 'joining' })).toMatchObject({ kind: 'joining', dot: 'busy', needsRejoin: false });
    expect(state({ status: 'error', error: 'join-failed' })).toMatchObject({ kind: 'error', dot: 'bad' });
    expect(state({ status: 'idle', error: null })).toMatchObject({ kind: 'off', dot: 'idle' });
  });
});
