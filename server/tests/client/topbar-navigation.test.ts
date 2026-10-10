import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ accountId: 'alice' as string | null, roomCode: 'ABC123' as string | null }));
vi.mock('../../../client/src/socket', () => ({ socket: {} }));
vi.mock('../../../client/src/api', () => ({ apiRequest: vi.fn() }));
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
import { useI18nStore } from '../../../client/src/stores/i18n-store';

function render(path: string): string {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] }, createElement(TopBar)));
}

describe('topbar navigation', () => {
  beforeEach(() => {
    state.accountId = 'alice';
    state.roomCode = 'ABC123';
    useI18nStore.getState().setLocale('zh-TW');
  });

  it.each(['/game/ABC123', '/room/ABC123', '/friends', '/account'])('keeps account navigation on %s', (path) => {
    const html = render(path);
    for (const label of ['大廳', '好友', '我的個人頁面', '我的帳號']) expect(html).toContain(label);
    expect(html).toContain('href="/players/alice"');
    if (path.startsWith('/game/')) expect(html).toContain('ABC123');
  });

  it('hides account links before sign-in', () => {
    state.accountId = null;
    state.roomCode = null;
    const html = render('/login');
    expect(html).not.toContain('我的帳號');
    expect(html).not.toContain('href="/friends"');
  });
});
