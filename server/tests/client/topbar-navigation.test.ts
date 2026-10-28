import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ accountId: 'alice' as string | null, roomCode: 'ABC123' as string | null }));
vi.mock('../../../client/src/socket', () => ({ socket: {} }));
vi.mock('../../../client/src/api', () => ({ apiRequest: vi.fn() }));
vi.mock('../../../client/src/media', () => ({ mediaUrl: (id: string) => `/api/media/${id}` }));
vi.mock('../../../client/src/stores/social-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../client/src/stores/social-store')>();
  return {
    ...actual,
    useSocialStore: Object.assign(
      (select: (value: ReturnType<typeof actual.useSocialStore.getState>) => unknown) =>
        select(actual.useSocialStore.getState()),
      actual.useSocialStore,
    ),
  };
});
vi.mock('../../../client/src/components/MusicControl', () => ({ MusicControl: () => null }));
vi.mock('../../../client/src/hooks/use-turn-sound', () => ({ useTurnSound: () => undefined }));
vi.mock('../../../client/src/games/use-game-presentation', () => ({
  useGamePresentation: () => ({ locked: false, frame: null }),
}));
vi.mock('../../../client/src/stores/account-store', () => ({
  useAccountStore: (select: (value: { account: { id: string } | null }) => unknown) =>
    select({ account: state.accountId ? { id: state.accountId } : null }),
  clearAccount: () => undefined,
}));
vi.mock('../../../client/src/stores/room-store', () => ({
  useRoomStore: (select: (value: { currentRoomCode: string | null; mySeat: null; roomInfo: null }) => unknown) =>
    select({ currentRoomCode: state.roomCode, mySeat: null, roomInfo: null }),
}));
vi.mock('../../../client/src/stores/game-store', () => ({
  useGameStore: (select: (value: Record<string, unknown>) => unknown) => select({
    gameType: 'sevens', bidding: null, contract: null, playing: null, bigTwo: null, redPoints: null,
    ninetyNine: null, sevens: null, chinesePoker: null, liarsDeck: null, blackjack: null, holdem: null,
  }),
}));
vi.mock('../../../client/src/components/VoicePanel', () => ({ VoicePanel: () => null }));

import { TopBar } from '../../../client/src/components/TopBar';
import { VoiceButton, VoiceControls } from '../../../client/src/components/VoiceControls';
import { NotificationPanel } from '../../../client/src/components/NotificationPanel';
import { useI18nStore } from '../../../client/src/stores/i18n-store';
import { useSocialStore } from '../../../client/src/stores/social-store';

const BOB = {
  id: 'bob', username: 'bob', nickname: 'Bob', color: '#123456', avatar: 'cat', avatarImage: null,
} as const;

function setOverview(unreadCount: number, withNotifications = false): void {
  useSocialStore.setState({
    status: 'ready',
    incoming: withNotifications
      ? [{ id: 'incoming-1', requester: BOB, recipient: { ...BOB, id: 'alice' }, createdAt: 1 }] : [],
    accepted: withNotifications ? [{ id: 'accepted-1', account: BOB, createdAt: 1 }] : [],
    conversations: [{ account: BOB, canSend: true, unreadCount,
      lastMessage: { id: 'message-1', clientId: 'client-1', sender: BOB, recipientId: 'alice',
        timestamp: 1, content: 'Hello' } }],
  });
}

function render(path: string): string {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] }, createElement(TopBar)));
}

describe('topbar navigation', () => {
  beforeEach(() => {
    state.accountId = 'alice';
    state.roomCode = 'ABC123';
    useI18nStore.getState().setLocale('zh-TW');
    useSocialStore.getState().reset();
  });

  it.each(['/room/ABC123', '/game/ABC123'])('puts voice controls outside the header on %s', (path) => {
    expect(render(path)).not.toContain('data-popover="voice"');
    expect(render(path)).not.toContain('data-testid="MicNoneIcon"');
    const button = (): string => renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] },
      createElement(VoiceControls, null, createElement(VoiceButton))));
    expect(button()).toContain('data-voice-control');
    expect(button()).toContain('aria-controls="table-voice-controls"');
    state.roomCode = null;
    expect(button()).not.toContain('data-voice-control');
  });

  it.each(['/game/ABC123', '/room/ABC123', '/friends', '/messages', '/messages/bob', '/account', '/shop', '/achievements'])('keeps account navigation on %s', (path) => {
    const html = render(path);
    for (const label of ['大廳', '好友', '我的個人頁面', '我的帳號']) expect(html).toContain(label);
    expect(html).toContain('href="/players/alice"');
    expect(html).toContain('href="/shop"');
    // The open page's button links back instead; without history that is the lobby.
    if (!path.startsWith('/messages')) expect(html).toContain('href="/messages"');
    if (path !== '/achievements') expect(html).toContain('href="/achievements"');
    expect(html.indexOf('aria-label="成就"')).toBeLessThan(html.indexOf('data-popover="notifications"'));
    expect(html).toContain('aria-label="私人訊息"');
    expect(html).not.toContain('>私人訊息<');
    if (path.startsWith('/game/')) expect(html).toContain('ABC123');
  });

  it('leaves room return controls to the lobby and game results', () => {
    const back = 'aria-label="返回房間"';
    for (const path of ['/friends', '/shop', '/account', '/messages', '/players/alice', '/achievements']) {
      const html = render(path);
      expect(html).not.toContain(back);
      expect(html).not.toContain('href="/room/ABC123"');
    }
    expect(render('/')).not.toContain(back);
    expect(render('/room/ABC123')).not.toContain(back);
    expect(render('/game/ABC123')).not.toContain(back);
    state.roomCode = null;
    expect(render('/friends')).not.toContain(back);
  });

  it.each([
    ['/messages', '私人訊息'],
    ['/messages/bob', '私人訊息'],
    ['/achievements', '成就'],
  ])('marks the %s button as current and links it back out', (path, label) => {
    const html = render(path);
    const button = html.match(new RegExp(`<a[^>]*aria-label="${label}"[^>]*>`))?.[0];
    expect(button).toContain('href="/"');
    expect(button).toContain('aria-current="page"');
    const other = path === '/achievements' ? '私人訊息' : '成就';
    const otherButton = html.match(new RegExp(`<a[^>]*aria-label="${other}"[^>]*>`))?.[0];
    expect(otherButton).not.toContain('aria-current');
  });

  it.each([['/', '大廳'], ['/friends', '好友'], ['/shop', '商店']])('marks the %s rail shortcut as the current page', (path, label) => {
    const html = render(path);
    const current = html.match(new RegExp(`<a[^>]*aria-label="${label}"[^>]*>`))?.[0];
    expect(current).toContain('aria-current="page"');
    for (const other of ['大廳', '好友', '商店'].filter((name) => name !== label)) {
      expect(html.match(new RegExp(`<a[^>]*aria-label="${other}"[^>]*>`))?.[0]).not.toContain('aria-current');
    }
  });

  it('keeps the menu, notification and music triggers that the rail layout reaches through the menu', () => {
    const html = render('/shop');
    expect(html).toContain('aria-label="選單"');
    expect(html).toContain('data-popover-trigger="menu"');
    expect(html).toContain('data-popover-trigger="notifications"');
    expect(html).toContain('data-popover-trigger="music"');
  });

  it('leaves the message and achievement buttons unpressed elsewhere', () => {
    const html = render('/shop');
    expect(html.match(/<a[^>]*aria-label="私人訊息"[^>]*>/)?.[0]).not.toContain('aria-current');
    expect(html.match(/<a[^>]*aria-label="成就"[^>]*>/)?.[0]).not.toContain('aria-current');
  });

  it('hides account links before sign-in', () => {
    state.accountId = null;
    state.roomCode = null;
    const html = render('/login');
    expect(html).not.toContain('我的帳號');
    expect(html).not.toContain('href="/friends"');
    expect(html).not.toContain('href="/shop"');
    expect(html).not.toContain('href="/messages"');
    expect(html).not.toContain('href="/achievements"');
    expect(html).not.toContain('枚金幣');
  });

  it('shows the legacy zero balance with the completed-game reward hint', () => {
    const html = render('/account');
    expect(html).toContain('aria-label="0 枚金幣"');
    expect(html).toContain('title="每完成一場對局，可獲得 10 枚金幣。"');
  });

  it.each([0, 3, 100])('puts %i unread messages on the chat link only', (count) => {
    setOverview(count);
    const html = render('/');
    const chat = html.match(/<a[^>]*href="\/messages"[\s\S]*?<\/a>/)?.[0];
    const notifications = html.match(/<button[^>]*aria-controls="social-notifications"[\s\S]*?<\/button>/)?.[0];
    expect(notifications).toContain('aria-label="通知（0 則未讀）"');
    expect(notifications).not.toContain('<span');
    expect(chat).toContain(`aria-label="${count > 0 ? `私人訊息（${count} 則未讀）` : '私人訊息'}"`);
    if (count > 0) expect(chat).toContain(`aria-hidden="true">${count > 99 ? '99+' : count}</span>`);
    else expect(chat).not.toContain('<span');
  });

  it.each(['en', 'zh-TW'] as const)('keeps friend notifications separate from messages in %s', (locale) => {
    useI18nStore.getState().setLocale(locale);
    setOverview(4, true);
    const html = render('/');
    const { t } = useI18nStore.getState();
    expect(html).toContain(`aria-label="${t('social.notificationCount', { n: '2' })}"`);
    expect(html).toContain(`aria-label="${t('messages.unreadCount', { n: '4' })}"`);
    const panel = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(NotificationPanel)));
    expect(panel).toContain(t('social.incoming', { nickname: 'Bob' }));
    expect(panel).toContain(t('social.accepted', { nickname: 'Bob' }));
    expect(panel).not.toContain(t('social.message', { nickname: 'Bob' }));
    expect(panel).not.toContain(t('social.unread', { n: '4' }));
  });

  it('shows an empty notification panel when only private messages are unread', () => {
    setOverview(3);
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(NotificationPanel)));
    expect(html).toContain('沒有新通知。');
    expect(html).not.toContain('href="/messages/bob"');
  });
});
