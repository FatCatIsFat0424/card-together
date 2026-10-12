import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/types/direct-message';

const state = vi.hoisted(() => ({ mobile: false, conversations: [] as Conversation[] }));
vi.mock('../../../client/src/socket', () => ({ socket: {} }));
vi.mock('../../../client/src/api', () => ({ apiRequest: vi.fn() }));
vi.mock('../../../client/src/deployment', () => ({ API_BASE_URL: '', APP_BASE_PATH: '/' }));
vi.mock('@mui/material/useMediaQuery', () => ({ default: () => state.mobile }));
vi.mock('../../../client/src/stores/account-store', () => ({
  useAccountStore: (select: (value: { account: { id: string } }) => unknown) => select({ account: { id: 'alice' } }),
}));
vi.mock('../../../client/src/stores/social-store', () => ({
  useSocialStore: (select: (value: { conversations: Conversation[]; status: 'ready'; error: string }) => unknown) =>
    select({ conversations: state.conversations, status: 'ready', error: '' }),
}));

import { FriendsPage } from '../../../client/src/pages/FriendsPage';
import { MessagesPage } from '../../../client/src/pages/MessagesPage';

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
    const bob = { id: 'bob', username: 'bob', nickname: 'Bob', color: '#2563eb',
      avatar: 'cat' as const, avatarImage: null, avatarBorder: null };
    state.conversations = [{ account: bob, canSend: true, unreadCount: 3,
      lastMessage: { id: 'message-1', clientId: 'request-1', sender: bob, recipientId: 'alice',
        content: 'Hello Alice', timestamp: 1_790_000_000_000 } }];
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

  it('keeps mobile chats separate with a return link to the list', () => {
    state.mobile = true;
    const html = render('/messages/bob');
    expect(html).toContain('role="log"');
    expect(html).toContain('href="/messages"');
    expect(html).not.toContain('Hello Alice');
  });
});
