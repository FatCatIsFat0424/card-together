import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountProfile } from '@shared/types';

const state = vi.hoisted(() => ({
  currentRoomCode: null as string | null,
  phase: null as string | null,
}));

// Static rendering skips effects, so expose the redirect target directly.
vi.mock('react-router-dom', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-router-dom')>(),
  Navigate: ({ to }: { to: string }) => `redirect:${to}`,
}));
vi.mock('../../../client/src/socket', () => ({ socket: {} }));
vi.mock('../../../client/src/media', () => ({ mediaUrl: (id: string) => `/api/media/${id}` }));
vi.mock('../../../client/src/stores/account-store', () => ({
  useAccountStore: (select: (value: { account: Partial<AccountProfile> }) => unknown) => select({
    account: { id: 'alice', username: 'alice', nickname: 'Alice', avatar: 'cat', avatarImage: null, color: '#4a9eff' },
  }),
}));
vi.mock('../../../client/src/stores/room-store', () => ({
  useRoomStore: (select: (value: { currentRoomCode: string | null }) => unknown) =>
    select({ currentRoomCode: state.currentRoomCode }),
}));
vi.mock('../../../client/src/stores/game-store', () => ({
  useGameStore: (select: (value: { phase: string | null }) => unknown) => select({ phase: state.phase }),
}));

import { LobbyPage } from '../../../client/src/pages/LobbyPage';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

function render(): string {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/'] },
    createElement(Routes, null, createElement(Route, { path: '/', element: createElement(LobbyPage) }))));
}

describe('lobby page', () => {
  beforeEach(() => {
    state.currentRoomCode = null;
    state.phase = null;
    useI18nStore.getState().setLocale('en');
  });

  it('offers create and join only when the player is not in a room', () => {
    const html = render();
    expect(html).toContain('Create Room');
    expect(html).toContain('Join Room');
  });

  it('goes straight back to the current room or game', () => {
    state.currentRoomCode = 'ABC123';
    expect(render()).toBe('redirect:/room/ABC123');
    state.phase = 'playing';
    expect(render()).toBe('redirect:/game/ABC123');
  });
});
