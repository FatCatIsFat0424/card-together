import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountProfile, PlayerInfo, RoomInfo } from '@shared/types';

const BACKGROUND = `${'a'.repeat(64)}.webp`;
const CARD_BACK = `${'b'.repeat(64)}.png`;

const state = vi.hoisted(() => ({
  account: null as Partial<AccountProfile> | null,
  room: null as RoomInfo | null,
}));

vi.mock('../../../client/src/socket', () => ({ socket: {} }));
vi.mock('../../../client/src/media', () => ({ mediaUrl: (id: string) => `/api/media/${id}` }));
vi.mock('../../../client/src/components/ChatPanel', () => ({ ChatPanel: () => null }));
vi.mock('../../../client/src/components/InviteFriends', () => ({ InviteFriends: () => null }));
vi.mock('../../../client/src/components/TableSeat', () => ({ TableSeat: () => null }));
vi.mock('../../../client/src/components/TurnClock', () => ({ TurnClock: () => null }));
vi.mock('../../../client/src/games/AbortVote', () => ({
  AbortVoteBanner: () => null, AbortVoteButton: () => null,
}));
vi.mock('../../../client/src/games/SpectatorLeave', () => ({ SpectatorLeaveButton: () => null }));
vi.mock('../../../client/src/games/GamePresentation', () => ({ GamePresentation: () => null }));
vi.mock('../../../client/src/games/RoundHistory', () => ({ RoundHistory: () => null }));
vi.mock('../../../client/src/games/use-game-presentation', () => ({
  useGamePresentation: () => ({ locked: false, frame: null }),
}));
vi.mock('../../../client/src/audio/card-sound', () => ({
  playCardSound: () => undefined, playOutSound: () => undefined,
  unlockCardSounds: () => undefined, disposeCardSounds: () => undefined,
}));
vi.mock('../../../client/src/stores/account-store', () => ({
  useAccountStore: (select: (value: { account: Partial<AccountProfile> | null; connection: 'ready' }) => unknown) =>
    select({ account: state.account, connection: 'ready' }),
  selectConnectionReady: (value: { connection: string }): boolean => value.connection === 'ready',
}));
vi.mock('../../../client/src/stores/room-store', () => ({
  useRoomStore: (select: (value: { roomInfo: RoomInfo | null; mySeat: 'N' }) => unknown) =>
    select({ roomInfo: state.room, mySeat: 'N' }),
}));
vi.mock('../../../client/src/stores/player-store', () => ({
  usePlayerStore: (select: (value: { playerId: string }) => unknown) => select({ playerId: 'alice' }),
}));
vi.mock('../../../client/src/stores/chat-store', () => ({
  useChatStore: (select: (value: { messages: never[] }) => unknown) => select({ messages: [] }),
}));
vi.mock('../../../client/src/stores/game-store', () => ({
  useGameStore: (select: (value: Record<string, unknown>) => unknown) =>
    select({ phase: null, visible: null, log: [], currentTurnSeat: null }),
}));

import { cardBackStyle, tableBackgroundStyle } from '../../../client/src/account-appearance';
import { GameShell } from '../../../client/src/games/GameShell';
import { RoomPage } from '../../../client/src/pages/RoomPage';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

const alice: PlayerInfo = {
  id: 'alice', username: 'alice', nickname: 'Alice', color: '#4a9eff', avatar: 'cat', avatarImage: null,
};

function room(): RoomInfo {
  return {
    code: 'ABC123', gameType: 'bigtwo', status: 'waiting', createdAt: 123, hostId: alice.id,
    abortVote: null, abortVoteCooldownUntil: null,
    seats: {
      N: { player: alice, isReady: false }, E: { player: null, isReady: false },
      S: { player: null, isReady: false }, W: { player: null, isReady: false },
    },
  };
}

function renderRoom(): string {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/room/ABC123'] },
    createElement(Routes, null, createElement(Route, {
      path: '/room/:roomCode', element: createElement(RoomPage),
    }))));
}

function renderShell(): string {
  return renderToStaticMarkup(createElement(GameShell, { info: null, centre: null, hand: null }));
}

describe('personal account appearance', () => {
  beforeEach(() => {
    state.account = {
      id: 'alice', tableBackground: null, tableBackgroundOpacity: 100, cardBack: null, cardBackOpacity: 100,
    };
    state.room = room();
    useI18nStore.getState().setLocale('en');
  });

  it('should keep theme defaults when no custom images are set', () => {
    expect(tableBackgroundStyle(state.account)).toBeUndefined();
    expect(cardBackStyle(state.account)).toBeUndefined();
    expect(cardBackStyle(null)).toBeUndefined();
    const html = renderShell();
    expect(html).not.toContain('--card-back-image');
    expect(html).not.toContain('--table-image');
  });

  it('should map uploaded images and opacity percentages to CSS variables', () => {
    state.account = {
      ...state.account, tableBackground: BACKGROUND, tableBackgroundOpacity: 40,
      cardBack: CARD_BACK, cardBackOpacity: 65,
    };
    expect(tableBackgroundStyle(state.account)).toEqual({
      '--table-image': `url("/api/media/${BACKGROUND}")`, '--table-image-opacity': '0.4',
    });
    expect(cardBackStyle(state.account)).toMatchObject({
      '--card-back-image': `url("/api/media/${CARD_BACK}")`, '--card-back-size': 'cover',
      '--card-back-opacity': '0.65',
    });
  });

  it('should apply the owner card back and table opacity to the game table', () => {
    state.account = {
      ...state.account, tableBackground: BACKGROUND, tableBackgroundOpacity: 55,
      cardBack: CARD_BACK, cardBackOpacity: 30,
    };
    const html = renderShell();
    expect(html).toContain(`--card-back-image:url(&quot;/api/media/${CARD_BACK}&quot;)`);
    expect(html).toContain('--card-back-size:cover');
    expect(html).toContain('--card-back-opacity:0.3');
    expect(html).toContain(`--table-image:url(&quot;/api/media/${BACKGROUND}&quot;)`);
    expect(html).toContain('--table-image-opacity:0.55');
  });

  it('should apply table background opacity in the room', () => {
    state.account = { ...state.account, tableBackground: BACKGROUND, tableBackgroundOpacity: 20 };
    const html = renderRoom();
    expect(html).toContain(`--table-image:url(&quot;/api/media/${BACKGROUND}&quot;)`);
    expect(html).toContain('--table-image-opacity:0.2');
  });
});
