import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountProfile, PlayerInfo, RoomInfo } from '@shared/types';
import { CARD_BACKS, EQUIPMENT_SLOTS, NAMEPLATES, SEAT_BACKGROUNDS, TABLE_BACKGROUNDS } from '@shared/constants';

const BACKGROUND = `${'a'.repeat(64)}.webp`;
const CARD_BACK = `${'b'.repeat(64)}.png`;

const state = vi.hoisted(() => ({
  account: null as Partial<AccountProfile> | null,
  room: null as RoomInfo | null,
  systemReducedMotion: false,
}));

// Server rendering otherwise reports every media query as unmatched.
vi.mock('@mui/material/useMediaQuery', () => ({
  default: (query: string): boolean => query.includes('prefers-reduced-motion') && state.systemReducedMotion,
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
import { EQUIPMENT_GROUPS, EquipmentSettings, equipmentSlots } from '../../../client/src/components/EquipmentSettings';
import { AccountProfilePreview } from '../../../client/src/components/AccountProfilePreview';
import borderStyles from '../../../client/src/components/AvatarBorder.module.css';
import { GameShell } from '../../../client/src/games/GameShell';
import { RoomPage } from '../../../client/src/pages/RoomPage';
import seatStyles from '../../../client/src/components/RoomSeat.module.css';
import botSeatBackground from '../../../client/src/assets/room-backgrounds/bot-seat.webp';
import { useI18nStore } from '../../../client/src/stores/i18n-store';
import { layeredShopArt } from '../../../client/src/cosmetics/art-layers/shop-art-layers';

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
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/game/ABC123'] },
    createElement(GameShell, { info: null, centre: null, hand: null })));
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

  it('selects still artwork without changing uploads or opacity', () => {
    const appearance = { cardBackStyle: 'card-back-starfleet', tableBackgroundStyle: 'table-shrine',
      seatBackgroundStyle: 'seat-neoncity', tableBackgroundOpacity: 45, cardBackOpacity: 70 } as const;
    expect(cardBackStyle(appearance, true)).toMatchObject({
      '--card-back-image': `url("${shopArtworkUrl('card-back-starfleet')}#still")`, '--card-back-opacity': '0.7',
    });
    expect(tableBackgroundStyle(appearance, true)).toEqual({
      '--table-image': `url("${shopArtworkUrl('table-shrine')}#still")`, '--table-image-opacity': '0.45',
    });
    expect(seatBackgroundStyle(appearance, true)).toEqual({
      '--seat-image': `url("${shopArtworkUrl('seat-neoncity')}#still")`,
    });
    expect(cardBackStyle({ cardBack: CARD_BACK }, true)).toEqual(cardBackStyle({ cardBack: CARD_BACK }));
    expect(tableBackgroundStyle({ tableBackground: BACKGROUND }, true))
      .toEqual(tableBackgroundStyle({ tableBackground: BACKGROUND }));
    expect(seatBackgroundStyle({ seatBackground: BACKGROUND }, true))
      .toEqual(seatBackgroundStyle({ seatBackground: BACKGROUND }));
  });

  it('resolves every series to distinct artwork in the correct equipment slot', () => {
    const cosmetics = [...CARD_BACKS, ...TABLE_BACKGROUNDS, ...SEAT_BACKGROUNDS];
    expect(new Set(cosmetics.map(({ id }) => shopArtworkUrl(id))).size).toBe(cosmetics.length);
    for (const item of cosmetics) {
      const url = shopArtworkUrl(item.id);
      expect(url).toMatch(/^(?:data:image\/svg\+xml,|.*\.svg$)/);
      if (item.type === 'cardBack') {
        expect(cardBackStyle({ cardBackStyle: item.id })).toMatchObject({ '--card-back-image': `url("${url}")` });
      } else if (item.type === 'tableBackground') {
        expect(tableBackgroundStyle({ tableBackgroundStyle: item.id })).toMatchObject({ '--table-image': `url("${url}")` });
      } else {
        expect(seatBackgroundStyle({ seatBackgroundStyle: item.id })).toEqual({ '--seat-image': `url("${url}")` });
      }
    }
  });

  it.each(['en', 'zh-TW'] as const)('renders every localized nameplate with its own mark and style (%s)', (locale) => {
    useI18nStore.getState().setLocale(locale);
    for (const { id } of NAMEPLATES) {
      const html = renderToStaticMarkup(createElement(Nameplate, { id }));
      expect(html).toContain(`data-nameplate="${id}"`);
      expect(html).toContain(useI18nStore.getState().t(`shop.title.${id}`));
      expect(html).not.toContain('undefined');
      expect(html).not.toContain('shop.title.');
      // A glyph or one image; animated collection emblems are a stack of image layers.
      expect(html).toMatch(/aria-hidden="true">(?:[^<]+|<img[^>]+\/>?|<span class="[^"]*seriesMark[^"]*" aria-hidden="true">(?:<span[^>]*>|<img[^>]*\/>|<\/span>)+)<\/span>/);
    }
  });

  it('draws animated tables and card backs as layers unless motion is reduced', () => {
    state.account = { ...state.account, cardBackStyle: 'card-back-starfleet', tableBackgroundStyle: 'table-neoncity' };
    const layers = (id: 'table-neoncity'): number => JSON.stringify(layeredShopArt(id)).match(/"image"/g)!.length;
    for (const html of [renderShell(), renderRoom()]) {
      expect(html).toContain('--table-image:none');
      expect(html).not.toContain(shopArtworkUrl('table-neoncity')!.replaceAll("'", '&#x27;'));
      expect(html.match(/<img [^>]*src="data:image\/svg\+xml,%3Csvg/g)).toHaveLength(layers('table-neoncity'));
    }
    expect(renderShell()).toContain('--card-back-image:none');
    state.systemReducedMotion = true;
    try {
      // The original files stop their own animation under the system setting.
      const still = renderShell().replaceAll('&#x27;', "'");
      expect(still).toContain(shopArtworkUrl('table-neoncity'));
      expect(still).toContain(shopArtworkUrl('card-back-starfleet'));
      expect(still).not.toContain('%3Csvg');
      expect(renderRoom().replaceAll('&#x27;', "'")).toContain(`${shopArtworkUrl('table-neoncity')}#still`);
    } finally {
      state.systemReducedMotion = false;
    }
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

  it('should group every slot, offer only owned products, and keep uploaded images available', () => {
    useI18nStore.getState().setLocale('en');
    const account = {
      ...state.account, ownedShopItems: ['card-back-aurora', 'table-tide', 'nameplate-sakura'],
      ownedAchievementNameplates: ['nameplate-table-traveler'], cardBackStyle: 'card-back-aurora', chipStyle: 'chips-tide',
      ownedAvatarBorders: ['copper'], avatarBorder: 'copper', tableBackground: 'media-table', seatBackground: 'media-seat',
    } as AccountProfile;
    const slots = equipmentSlots(account);
    const targets = EQUIPMENT_GROUPS.flatMap((group) => group.slots);
    expect(slots.map((slot) => slot.target)).toEqual(targets);
    expect([...targets].sort()).toEqual([...Object.keys(EQUIPMENT_SLOTS), 'avatarBorder'].sort());
    expect(EQUIPMENT_GROUPS.map((group) => [group.id, group.visibility])).toEqual([
      ['personal', 'public'], ['table', null], ['cards', 'private'],
    ]);
    const slot = (target: string) => slots.find((entry) => entry.target === target)!;
    expect(slot('cardBackStyle').owned).toEqual(['card-back-aurora']);
    expect(slot('cardBackStyle').current).toEqual({ kind: 'item', id: 'card-back-aurora' });
    expect(slot('nameplate').owned).toEqual(['nameplate-table-traveler', 'nameplate-sakura']);
    expect(slot('avatarBorder')).toMatchObject({ owned: ['copper'], current: { kind: 'item', id: 'copper' } });
    // An uploaded image stands in while no product is equipped; otherwise the built-in look does.
    expect(slot('tableBackgroundStyle').current).toEqual({ kind: 'custom' });
    expect(slot('seatBackgroundStyle')).toMatchObject({ current: { kind: 'custom' }, hasUpload: true, owned: [] });
    expect(slot('soundPack').current).toEqual({ kind: 'default' });
    // An equipped but unowned value is shown as unequipped instead of an invalid selection.
    expect(slot('chipStyle').current).toEqual({ kind: 'default' });
    expect(slot('tableBackgroundStyle').more).toBe(14);
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(EquipmentSettings, { account })));
    expect(html.match(/data-slot=/g)).toHaveLength(targets.length);
    expect(html).toContain('Custom · 100%');
    expect(html).toContain('Everyone sees these');
    expect(html).toContain('Only you see these');
    expect(html).toContain('href="/shop"');
  });

  it('should preview every equippable type with its visibility', () => {
    useI18nStore.getState().setLocale('en');
    const render = (equipment: Partial<AccountProfile>): string => renderToStaticMarkup(createElement(MemoryRouter, null,
      createElement(AccountProfilePreview, {
        account: { ...state.account, ...equipment } as AccountProfile, nickname: 'Alice', color: '#123456',
        appearance: {},
      })));
    const equipped = render({ seatFrame: 'seat-frame-tide', chatFrame: 'chat-frame-lotus', victoryEffect: 'victory-frost',
      nameplate: 'nameplate-tide' });
    for (const heading of ['Your table', 'Waiting-room seat', 'Chat message', 'Victory effect', 'Sounds']) {
      expect(equipped).toContain(`<h3>${heading}</h3>`);
    }
    expect(equipped.match(/>Public</g)).toHaveLength(3);
    expect(equipped.match(/>Private</g)).toHaveLength(2);
    expect(equipped.match(/data-seat-frame="tide"/g)).toHaveLength(2);
    expect(equipped).toContain('data-chat-frame="chat-frame-lotus"');
    expect(equipped).not.toContain('No victory effect equipped');
    const plain = render({});
    expect(plain).not.toContain('data-seat-frame');
    expect(plain).not.toContain('data-chat-frame');
    expect(plain).toContain('No victory effect equipped');
    expect(plain).toContain('href="/shop?type=victoryEffect"');    // Every avatar in the preview wears the equipped border, as it does at the table and in chat.
    const bordered = render({ avatarBorder: 'gold', victoryEffect: 'victory-frost' });
    const avatars = bordered.match(/data-avatar-size=/g)?.length ?? 0;
    expect(avatars).toBe(4);
    expect(bordered.split(` ${borderStyles.equipped} `)).toHaveLength(avatars + 1);
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
    // Compact lists such as the room's spectator area leave the title out.
    const compact = renderToStaticMarkup(createElement(MemoryRouter, null,
      createElement(PlayerLink, { player: { ...alice, nameplate: 'nameplate-tide' }, showTitle: false })));
    expect(compact).toContain(alice.nickname);
    expect(compact).not.toContain('data-nameplate');
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
    expect(html.split(seatStyles.hasArt)).toHaveLength(4);
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
