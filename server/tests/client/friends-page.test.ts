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

function render(path: string): string {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] },
    createElement(Routes, null,
      createElement(Route, { path: '/friends', element: createElement(FriendsPage) }),
      createElement(Route, { path: '/friends/messages/:accountId', element: createElement(FriendsPage) }),
    )));
}

describe('friends private-message tab', () => {
  beforeEach(() => {
    state.mobile = false;
    const bob = { id: 'bob', username: 'bob', nickname: 'Bob', color: '#2563eb',
      avatar: 'cat' as const, avatarImage: null, avatarBorder: null };
    state.conversations = [{ account: bob, canSend: true, unreadCount: 3,
      lastMessage: { id: 'message-1', clientId: 'request-1', sender: bob, recipientId: 'alice',
        content: 'Hello Alice', timestamp: 1_790_000_000_000 } }];
  });

  it('opens a linked message tab in place and shows existing conversations with unread counts', () => {
    const html = render('/friends?tab=messages');
    const tabs = ['accepted', 'messages', 'outgoing', 'incoming'].map((tab) => html.indexOf(`id="friends-tab-${tab}"`));
    expect(tabs.every((position) => position >= 0)).toBe(true);
    expect([...tabs].sort((first, second) => first - second)).toEqual(tabs);
    const selected = html.match(/<button[^>]*id="friends-tab-messages"[^>]*>/)?.[0];
    expect(selected).toContain('aria-selected="true"');
    expect(html).toContain('aria-label="3 則未讀訊息"');
    expect(html).toContain('href="/friends/messages/bob"');
    expect(html).toContain('Hello Alice');
    expect(html).not.toContain('選擇好友');
    const panel = html.match(/<section[^>]*id="friends-panel-messages"[\s\S]*?<\/section>/)?.[0];
    const refresh = panel?.match(/<button[^>]*aria-label="重新整理"[\s\S]*?<\/button>/)?.[0];
    expect(refresh).toContain('data-testid="RefreshIcon"');
    expect(refresh?.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '')).toBe('');
    expect(html).not.toContain('href="/messages"');
  });

  it('keeps the message list inactive on the default friends tab', () => {
    const html = render('/friends');
    const selected = html.match(/<button[^>]*id="friends-tab-accepted"[^>]*>/)?.[0];
    expect(selected).toContain('aria-selected="true"');
    expect(html).not.toContain('Hello Alice');
    expect(html).not.toContain('href="/friends/messages/bob"');
  });

  it('keeps private conversations accessible in the existing stacked mobile layout', () => {
    state.mobile = true;
    const html = render('/friends');
    expect(html).not.toContain('role="tablist"');
    expect(html).toContain('id="friends-panel-messages"');
    expect(html).toContain('href="/friends/messages/bob"');
    expect(html).toContain('Hello Alice');
  });

  it('keeps a direct conversation within the friends message tab with a return link to its list', () => {
    const html = render('/friends/messages/bob');
    const selected = html.match(/<button[^>]*id="friends-tab-messages"[^>]*>/)?.[0];
    expect(selected).toContain('aria-selected="true"');
    expect(html).toContain('role="log"');
    expect(html).toContain('href="/friends?tab=messages"');
    expect(html).not.toContain('Hello Alice');
    expect(html).not.toContain('href="/messages"');
  });
});
