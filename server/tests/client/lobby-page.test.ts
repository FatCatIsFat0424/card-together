import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountProfile, FriendEntry } from '@shared/types';

const state = vi.hoisted(() => ({
  currentRoomCode: null as string | null,
  phase: null as string | null,
  connection: 'ready',
}));

vi.mock('../../../client/src/socket', () => ({ socket: {} }));
vi.mock('../../../client/src/api', () => ({ apiRequest: vi.fn() }));
vi.mock('../../../client/src/media', () => ({ mediaUrl: (id: string) => `/api/media/${id}` }));
vi.mock('../../../client/src/stores/account-store', () => ({
  useAccountStore: (select: (value: { account: Partial<AccountProfile>; connection: string }) => unknown) => select({
    account: { id: 'alice', username: 'alice', nickname: 'Alice', avatar: 'cat', avatarImage: null, color: '#4a9eff' },
    connection: state.connection,
  }),
  selectConnectionReady: (value: { connection: string }) => value.connection === 'ready',
}));
vi.mock('../../../client/src/stores/room-store', () => ({
  useRoomStore: (select: (value: { currentRoomCode: string | null }) => unknown) =>
    select({ currentRoomCode: state.currentRoomCode }),
}));
vi.mock('../../../client/src/stores/game-store', () => ({
  useGameStore: (select: (value: { phase: string | null }) => unknown) => select({ phase: state.phase }),
}));

import { LobbyPage } from '../../../client/src/pages/LobbyPage';
import { onlineLobbyFriends } from '../../../client/src/components/LobbyFriends';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

function render(): string {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/'] },
    createElement(Routes, null, createElement(Route, { path: '/', element: createElement(LobbyPage) }))));
}

describe('lobby page', () => {
  beforeEach(() => {
    state.currentRoomCode = null;
    state.phase = null;
    state.connection = 'ready';
    useI18nStore.getState().setLocale('en');
  });

  it('groups desktop room actions and keeps mobile code joining above game selection', () => {
    const html = render();
    expect(html).toContain('Create Room');
    expect(html).toContain('Join Room');
    expect(html.indexOf('id="room-code-input-mobile"')).toBeLessThan(html.indexOf('role="group" aria-label="Choose a game"'));
    const selectedPanel = html.slice(html.indexOf('id="lobby-selected-game"'));
    expect(selectedPanel.indexOf('>Create Room</button>')).toBeLessThan(selectedPanel.indexOf('<hr'));
    expect(selectedPanel.indexOf('<hr')).toBeLessThan(selectedPanel.indexOf('id="lobby-desktop-join-title"'));
    expect(selectedPanel).toMatch(/<label[^>]*for="room-code-input-desktop">Room Code<\/label>/);
    expect(html).not.toContain('id="lobby-games-title"');
    expect(html).not.toContain('Choose a game to preview the rules, then create your table.');
    expect(html.match(/aria-controls="lobby-selected-game"/g)).toHaveLength(9);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toContain('id="lobby-create-title"');
    expect(html).toContain('id="lobby-selected-game-title">Bridge</h3>');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toMatch(/disabled=""[^>]*>Create Room/);
    expect(html).toContain('Friends online');
  });

  it('keeps the lobby available and links back to the current room or game', () => {
    state.currentRoomCode = 'ABC123';
    const waiting = render();
    expect(waiting).toContain('href="/room/ABC123"');
    expect(waiting).toContain('Choose a game');
    expect(waiting).toMatch(/disabled=""[^>]*>Create Room/);
    expect(waiting).toContain('aria-describedby="lobby-current-room-hint"');
    state.phase = 'playing';
    expect(render()).toContain('href="/game/ABC123"');
  });

  it('disables room creation while disconnected but still allows game browsing', () => {
    state.connection = 'connecting';
    const html = render();
    expect(html).toMatch(/disabled=""[^>]*>Create Room/);
    const choices = html.match(/<button[^>]*aria-controls="lobby-selected-game"[^>]*>/g) ?? [];
    expect(choices).toHaveLength(9);
    expect(choices.every((choice) => !choice.includes('disabled'))).toBe(true);
  });

  it('shows online hosts first without mutating the supplied friend list', () => {
    const friend = (id: string, online: boolean, hostedRoomCode: string | null): FriendEntry => ({
      id, username: id, nickname: id, avatar: 'cat', avatarImage: null, color: '#4a9eff',
      online, hostedRoomCode, inRoom: Boolean(hostedRoomCode),
    });
    const friends = Object.freeze([
      friend('available', true, null), friend('offline', false, 'OLD123'),
      friend('host', true, 'ABC123'), friend('other', true, null),
    ]);
    expect(onlineLobbyFriends(friends).map(({ id }) => id)).toEqual(['host', 'available', 'other']);
    expect(friends.map(({ id }) => id)).toEqual(['available', 'offline', 'host', 'other']);
  });
});
