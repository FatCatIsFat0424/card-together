import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/types/direct-message';

const state = vi.hoisted(() => ({ mobile: false, conversations: [] as Conversation[],
  roomCode: null as string | null, roomStatus: 'waiting' as 'waiting' | 'playing',
  socialStatus: 'ready' as 'ready' | 'loading' | 'error', socialError: '' }));
vi.mock('../../../client/src/socket', () => ({ socket: {} }));
vi.mock('../../../client/src/api', () => ({ apiRequest: vi.fn() }));
vi.mock('../../../client/src/deployment', () => ({ API_BASE_URL: '', APP_BASE_PATH: '/' }));
vi.mock('@mui/material/useMediaQuery', () => ({ default: () => state.mobile }));
vi.mock('../../../client/src/stores/account-store', () => ({
  useAccountStore: (select: (value: { account: { id: string } }) => unknown) => select({ account: { id: 'alice' } }),
}));
vi.mock('../../../client/src/stores/social-store', () => ({
  useSocialStore: (select: (value: { conversations: Conversation[]; status: 'ready' | 'loading' | 'error'; error: string }) => unknown) =>
    select({ conversations: state.conversations, status: state.socialStatus, error: state.socialError }),
}));
vi.mock('../../../client/src/stores/room-store', () => ({
  useRoomStore: (select: (value: { currentRoomCode: string | null; roomInfo: { status: 'waiting' | 'playing' } | null }) => unknown) =>
    select({ currentRoomCode: state.roomCode, roomInfo: state.roomCode ? { status: state.roomStatus } : null }),
}));

import { FriendsPage } from '../../../client/src/pages/FriendsPage';
import { MessagesPage } from '../../../client/src/pages/MessagesPage';
import { listTime } from '../../../client/src/components/MessageConversations';

function render(path: string): string {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] },
    createElement(Routes, null,
      createElement(Route, { path: '/friends', element: createElement(FriendsPage) }),
      createElement(Route, { path: '/messages', element: createElement(MessagesPage) }),
      createElement(Route, { path: '/messages/:accountId', element: createElement(MessagesPage) }),
    )));
}

describe('independent private messages', () => {
  beforeEach(() => {
    state.mobile = false;
    state.roomCode = null;
    state.roomStatus = 'waiting';
    state.socialStatus = 'ready';
    state.socialError = '';
    const bob = { id: 'bob', username: 'bob', nickname: 'Bob', color: '#2563eb',
      avatar: 'cat' as const, avatarImage: null, avatarBorder: null };
    state.conversations = [{ account: bob, canSend: true, unreadCount: 3,
      lastMessage: { id: 'message-1', clientId: 'request-1', sender: bob, recipientId: 'alice',
        content: 'Hello Alice', timestamp: 1_790_000_000_000 } }];
  });

  it.each([false, true])('offers a close link on the list and chat (mobile: %s)', (mobile) => {
    state.mobile = mobile;
    for (const path of ['/messages', '/messages/bob']) {
      const html = render(path);
      const close = html.match(/<a[^>]*aria-label="關閉"[\s\S]*?<\/a>/)?.[0];
      expect(close).toContain('href="/"');
      expect(close).toContain('data-testid="CloseIcon"');
      expect(html.match(/<h1\b/g)).toHaveLength(1);
    }
  });

  it.each(['waiting', 'playing'] as const)('closes messages back to the %s room', (status) => {
    state.roomCode = 'ABC123';
    state.roomStatus = status;
    const close = render('/messages/bob').match(/<a[^>]*aria-label="關閉"[\s\S]*?<\/a>/)?.[0];
    expect(close).toContain(`href="/${status === 'playing' ? 'game' : 'room'}/ABC123"`);
  });

  it.each([false, true])('keeps shared controls and errors in the title bar (mobile: %s)', (mobile) => {
    state.mobile = mobile;
    state.roomCode = 'ABC123';
    state.socialStatus = 'error';
    state.socialError = 'Unable to reach the server. Please try again.';
    for (const path of ['/messages', '/messages/bob']) {
      const html = render(path);
      const toolbar = html.match(/<header\b[\s\S]*?<\/header>/)?.[0];
      expect(toolbar).toContain('aria-label="重新整理"');
      expect(toolbar).toContain('href="/room/ABC123"');
      expect(toolbar).not.toContain('返回房間');
      expect(toolbar).not.toContain('返回遊戲');
      expect(toolbar).toContain('訊息保留 90 天。');
      expect(toolbar).toContain('role="alert"');
      expect(toolbar).toContain(state.socialError);
      expect(html.match(/aria-label="重新整理"/g)).toHaveLength(1);
      expect(html.match(/訊息保留 90 天。/g)).toHaveLength(1);
      expect(html.match(/Unable to reach the server/g)).toHaveLength(1);
      const sidebar = html.match(/<aside\b[\s\S]*?<\/aside>/)?.[0];
      expect(sidebar).not.toContain(state.socialError);
      expect(sidebar).not.toContain('訊息保留');
      expect(sidebar).not.toContain('返回房間');
    }
  });

  it.each([false, true])('shows independent conversations with unread counts (mobile: %s)', (mobile) => {
    state.mobile = mobile;
    const html = render('/messages');
    expect(html).toContain('<h1');
    expect(html).toContain('3 則未讀訊息');
    expect(html).toContain('href="/messages/bob"');
    expect(html).toContain('Hello Alice');
    expect(html).not.toContain('friend-username');
    expect(html).not.toContain('role="tablist"');
    const refresh = html.match(/<button[^>]*aria-label="重新整理"[\s\S]*?<\/button>/)?.[0];
    expect(refresh).toContain('data-testid="RefreshIcon"');
  });

  it('keeps only friend-management tabs on the friends page', () => {
    const html = render('/friends');
    const tabs = ['accepted', 'outgoing', 'incoming'].map((tab) => html.indexOf(`id="friends-tab-${tab}"`));
    expect(tabs.every((position) => position >= 0)).toBe(true);
    expect([...tabs].sort((first, second) => first - second)).toEqual(tabs);
    const selected = html.match(/<button[^>]*id="friends-tab-accepted"[^>]*>/)?.[0];
    expect(selected).toContain('aria-selected="true"');
    expect(html).not.toContain('friends-tab-messages');
    expect(html).not.toContain('friends-panel-messages');
    expect(html).not.toContain('Hello Alice');
  });

  it('removes the message section from the stacked mobile friends page', () => {
    state.mobile = true;
    const html = render('/friends');
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain('friends-panel-messages');
    expect(html).not.toContain('Hello Alice');
  });

  it('keeps the conversation list beside the selected desktop chat', () => {
    const html = render('/messages/bob');
    expect(html).toContain('role="log"');
    const selected = html.match(/<a[^>]*href="\/messages\/bob"[^>]*>/)?.[0];
    expect(selected).toContain('aria-current="page"');
    expect(html).toContain('Hello Alice');
    expect(html).toContain('role="img"');
    expect(html).toContain('<time');
    expect(html).not.toContain('href="/messages"');
    expect(html).not.toContain('friend-username');
    expect(html).not.toContain('friends-tab-');
  });

  it('shortens desktop list times to fit beside the name and keeps the full time as a title', () => {
    const today = new Date(2026, 9, 14, 13, 45).getTime();
    expect(listTime(today, 'en', new Date(2026, 9, 14, 20, 0).getTime())).toBe('1:45 PM');
    expect(listTime(today, 'en', new Date(2026, 9, 15, 9, 0).getTime())).toBe('10/14');
    const time = render('/messages/bob').match(/<time[^>]*>[^<]*<\/time>/)?.[0];
    expect(time).toMatch(/title="[^"]*\d{4}[^"]*"/);
  });

  it('keeps mobile chats separate with a return link to the list', () => {
    state.mobile = true;
    const html = render('/messages/bob');
    expect(html).toContain('role="log"');
    expect(html).toContain('href="/messages"');
    expect(html).not.toContain('Hello Alice');
  });
});
