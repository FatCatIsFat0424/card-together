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

vi.mock('../../../client/src/api', () => ({ apiRequest: vi.fn() }));
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

import { cardBackStyle, seatBackgroundStyle, tableBackgroundStyle } from '../../../client/src/account-appearance';
import { shopArtworkUrl } from '../../../client/src/shop-art';
import { Nameplate } from '../../../client/src/components/Nameplate';
import { PlayerLink } from '../../../client/src/components/PlayerLink';
import { EquipmentSettings } from '../../../client/src/components/EquipmentSettings';
import { GameShell } from '../../../client/src/games/GameShell';
import { RoomPage } from '../../../client/src/pages/RoomPage';
import roomStyles from '../../../client/src/pages/RoomPage.module.css';
import botSeatBackground from '../../../client/src/assets/room-backgrounds/bot-seat.webp';
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

  it('should prioritize official artwork without discarding uploaded fallbacks', () => {
    const appearance: Partial<AccountProfile> = {
      seatBackground: BACKGROUND, seatBackgroundStyle: 'seat-sakura',
      tableBackground: BACKGROUND, tableBackgroundStyle: 'table-tide', tableBackgroundOpacity: 45,
      cardBack: CARD_BACK, cardBackStyle: 'card-back-aurora', cardBackOpacity: 70,
    };
    expect(seatBackgroundStyle(appearance)).toEqual({
      '--seat-image': `url("${shopArtworkUrl('seat-sakura')}")`,
    });
    expect(tableBackgroundStyle(appearance)).toEqual({
      '--table-image': `url("${shopArtworkUrl('table-tide')}")`, '--table-image-opacity': '0.45',
    });
    expect(cardBackStyle(appearance)).toMatchObject({
      '--card-back-image': `url("${shopArtworkUrl('card-back-aurora')}")`, '--card-back-opacity': '0.7',
    });
    expect(seatBackgroundStyle({ ...appearance, seatBackgroundStyle: null })).toEqual({
      '--seat-image': `url("/api/media/${BACKGROUND}")`,
    });
    expect(tableBackgroundStyle({ ...appearance, tableBackgroundStyle: null })).toMatchObject({
      '--table-image': `url("/api/media/${BACKGROUND}")`,
    });
    expect(cardBackStyle({ ...appearance, cardBackStyle: null })).toMatchObject({
      '--card-back-image': `url("/api/media/${CARD_BACK}")`,
    });
    expect(cardBackStyle({ cardBackStyle: null, cardBack: null })).toBeUndefined();
    expect(tableBackgroundStyle({ tableBackgroundStyle: null })).toBeUndefined();
    expect(seatBackgroundStyle({ seatBackgroundStyle: null })).toBeUndefined();
  });

  it('should render official styles in the game and other players waiting seats', () => {
    state.account = { ...state.account, cardBackStyle: 'card-back-sakura', tableBackgroundStyle: 'table-aurora' };
    state.room = { ...room(), seats: { ...room().seats,
      N: { player: { ...alice, seatBackgroundStyle: 'seat-tide' }, isReady: false },
    } };
    expect(renderShell().replaceAll('&#x27;', "'")).toContain(shopArtworkUrl('card-back-sakura'));
    expect(renderShell().replaceAll('&#x27;', "'")).toContain(shopArtworkUrl('table-aurora'));
    expect(renderRoom().replaceAll('&#x27;', "'")).toContain(shopArtworkUrl('seat-tide'));
  });

  it('should show only owned equipment and keep uploaded images available', () => {
    const html = renderToStaticMarkup(createElement(EquipmentSettings, { account: {
      ...state.account, ownedShopItems: ['card-back-aurora', 'table-tide', 'nameplate-sakura'],
      cardBackStyle: 'card-back-aurora',
    } as AccountProfile }));
    expect(html).toContain('value="card-back-aurora" selected=""');
    expect(html).toContain('value="table-tide"');
    expect(html).toContain('value="nameplate-sakura"');
    expect(html).not.toContain('value="card-back-tide"');
    expect(html).not.toContain('value="seat-sakura"');
    expect(html.match(/<option value=""/g)).toHaveLength(4);
  });

  it('should display cosmetic titles beside public player identities and hide unequipped titles', () => {
    expect(renderToStaticMarkup(createElement(Nameplate, { id: null }))).toBe('');
    for (const locale of ['en', 'zh-TW'] as const) {
      useI18nStore.getState().setLocale(locale);
      const html = renderToStaticMarkup(createElement(MemoryRouter, null,
        createElement(PlayerLink, { player: { ...alice, nameplate: 'nameplate-tide' } })));
      expect(html).toContain('data-nameplate="nameplate-tide"');
      expect(html).toContain(useI18nStore.getState().t('shop.title.nameplate-tide'));
      expect(html).not.toContain('shop.title.nameplate-tide');
    }
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

  it('should use the default bot artwork while preserving human artwork and empty seats', () => {
    state.account = { ...state.account, seatBackground: BACKGROUND };
    state.room = { ...room(), seats: { ...room().seats,
      N: { player: { ...alice, seatBackground: CARD_BACK }, isReady: false },
      E: { player: { ...alice, id: 'bot-e', isBot: true }, isReady: true },
      S: { player: { ...alice, id: 'bot-s', isBot: true, seatBackground: BACKGROUND }, isReady: true },
    } };
    const html = renderRoom();
    expect(html.split(`--seat-image:url(&quot;${botSeatBackground}&quot;)`)).toHaveLength(3);
    expect(html.split(roomStyles.customSeat)).toHaveLength(4);
    expect(html.match(/--seat-image:/g)).toHaveLength(3);
    expect(html).toContain(`--seat-image:url(&quot;/api/media/${CARD_BACK}&quot;)`);
    expect(html).not.toContain(BACKGROUND);
    expect(html).toContain('West');
  });

  it('should render each player seat artwork instead of the viewing account background', () => {
    const otherBackground = `${'c'.repeat(64)}.jpg`;
    state.account = { ...state.account, seatBackground: BACKGROUND };
    state.room = { ...room(), seats: { ...room().seats,
      N: { player: { ...alice, seatBackground: CARD_BACK }, isReady: false },
      E: { player: { ...alice, id: 'bob', seatBackground: otherBackground }, isReady: false },
    } };
    const html = renderRoom();
    expect(html.match(/--seat-image:/g)).toHaveLength(2);
    expect(html).toContain(`--seat-image:url(&quot;/api/media/${CARD_BACK}&quot;)`);
    expect(html).toContain(`--seat-image:url(&quot;/api/media/${otherBackground}&quot;)`);
    expect(html).not.toContain(BACKGROUND);
    expect(seatBackgroundStyle({})).toBeUndefined();
    expect(seatBackgroundStyle({ seatBackground: null })).toBeUndefined();
    state.room = room();
    expect(renderRoom()).not.toContain('--seat-image:');
  });
});
