import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GAME_TYPES } from '@shared/constants';
import type { MatchSummary, PlayerInfo, RoomInfo, Seat } from '@shared/types';

const state = vi.hoisted(() => ({
  room: null as RoomInfo | null,
  playerId: 'alice',
  mySeat: 'N' as Seat | null,
  connection: 'ready' as 'connecting' | 'ready' | 'error',
}));

vi.mock('../../../client/src/socket', () => ({ socket: {} }));
vi.mock('../../../client/src/deployment', () => ({
  APP_BASE_PATH: '/', API_BASE_URL: '', SERVER_URL: '', SOCKET_PATH: '/socket.io',
}));
vi.mock('../../../client/src/media', () => ({ mediaUrl: (id: string) => `/api/media/${id}` }));
vi.mock('../../../client/src/components/ChatPanel', () => ({ ChatPanel: () => null }));
vi.mock('../../../client/src/components/InviteFriends', () => ({ InviteFriends: () => null }));
vi.mock('../../../client/src/stores/room-store', () => ({
  useRoomStore: (select: (value: { roomInfo: RoomInfo | null; mySeat: Seat | null }) => unknown) =>
    select({ roomInfo: state.room, mySeat: state.mySeat }),
}));
vi.mock('../../../client/src/stores/player-store', () => ({
  usePlayerStore: (select: (value: { playerId: string }) => unknown) => select({ playerId: state.playerId }),
}));
vi.mock('../../../client/src/stores/account-store', () => ({
  useAccountStore: (select: (value: {
    account: { id: string; tableBackground: null }; connection: typeof state.connection;
  }) => unknown) => select({ account: { id: state.playerId, tableBackground: null }, connection: state.connection }),
  selectConnectionReady: (value: { connection: string }): boolean => value.connection === 'ready',
}));
vi.mock('../../../client/src/stores/game-store', () => ({
  useGameStore: (select: (value: { phase: null }) => unknown) => select({ phase: null }),
}));

import { PlayerLink } from '../../../client/src/components/PlayerLink';
import { MatchHistoryList } from '../../../client/src/components/MatchHistoryList';
import { RoomPage } from '../../../client/src/pages/RoomPage';
import { BotControls, EmptySeatActions } from '../../../client/src/components/RoomSeat';
import { RoomSpectators } from '../../../client/src/components/RoomSpectators';
import { AbortVoteBanner } from '../../../client/src/games/AbortVote';
import { useI18nStore } from '../../../client/src/stores/i18n-store';


const human: PlayerInfo = {
  id: 'alice', username: 'alice', nickname: 'Alice', color: '#4a9eff', avatar: 'cat', avatarImage: null,
};
const bot: PlayerInfo = { ...human, id: 'bot:synthetic', username: '', nickname: 'Bot East', isBot: true };

function room(): RoomInfo {
  return {
    code: 'ABC123', gameType: 'bigtwo', status: 'waiting', createdAt: 123, hostId: human.id,
    abortVote: null, abortVoteCooldownUntil: null,
    seats: {
      N: { player: human, isReady: false }, E: { player: bot, isReady: true },
      S: { player: null, isReady: false }, W: { player: null, isReady: false },
    },
  };
}

function render(element: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/room/ABC123'] },
    createElement(Routes, null, createElement(Route, { path: '/room/:roomCode', element }))));
}

/** The opening tag of the first button whose attributes include `marker`. */
const buttonTag = (html: string, marker: string): string | undefined =>
  [...html.matchAll(/<button[^>]*>/g)].map((match) => match[0]).find((tag) => tag.includes(marker));

const FILL = 'aria-label="Fill empty seats with bots"';
const noop = (): void => undefined;
const botControls = (extra: Partial<Parameters<typeof BotControls>[0]> = {}): string => render(createElement(BotControls, {
  player: bot, disabled: false, blocked: false, pending: false, onDifficulty: noop, onRemove: noop, ...extra,
}));

describe('bot player interface', () => {
  beforeEach(() => {
    state.room = room();
    state.playerId = human.id;
    state.mySeat = 'N';
    state.connection = 'ready';
    useI18nStore.getState().setLocale('en');
  });

  it('identifies bots without creating profile links or account usernames', () => {
    const html = render(createElement(PlayerLink, { player: bot, showUsername: true }));
    expect(html).toContain('Bot East');
    expect(html).toContain('Bot</span>');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('/players/');
    expect(html).not.toContain('@');
    expect(render(createElement(PlayerLink, { player: human }))).toContain('href="/players/alice"');
  });

  it('offers only the host add, remove, and fill controls while preserving seat selection', () => {
    const hostHtml = render(createElement(RoomPage));
    // Empty seats open a sit-or-add-bot menu for the host; the bot seat opens its management panel.
    expect(buttonTag(hostHtml, 'aria-label="Empty seat South"')).toContain('aria-haspopup="menu"');
    expect(buttonTag(hostHtml, 'aria-label="Manage Bot East"')).toContain('aria-haspopup="dialog"');
    expect(hostHtml).toContain(FILL);
    expect(hostHtml.match(/>Empty</g)).toHaveLength(2);
    // The host is implicitly ready.
    expect(hostHtml).toContain('>Ready<');
    expect(hostHtml).not.toContain('>Not ready<');
    expect(hostHtml).not.toContain('/players/bot');
    const menu = render(createElement(EmptySeatActions, { removable: true, onSit: noop, onAddBot: noop, onRemoveSeat: noop }));
    expect(menu).toContain('>Sit here<');
    expect(menu).toContain('>Add bot<');
    expect(menu).toContain('>Remove last empty seat<');
    expect(botControls()).toContain('>Remove bot<');

    state.playerId = 'visitor';
    const visitorHtml = render(createElement(RoomPage));
    expect(buttonTag(visitorHtml, 'aria-label="Empty seat South"')).toBeDefined();
    expect(buttonTag(visitorHtml, 'aria-label="Empty seat South"')).not.toContain('aria-haspopup');
    expect(visitorHtml).not.toContain('Manage Bot East');
    expect(visitorHtml).not.toContain(FILL);
    expect(visitorHtml.match(/>Empty</g)).toHaveLength(2);
  });

  it('shows every room action as a labelled button, with no overflow menu', () => {
    const header = (html: string): string => html.slice(html.indexOf('<header'), html.indexOf('</header>'));
    const host = header(render(createElement(RoomPage)));
    expect(host).not.toContain('aria-haspopup="menu"');
    for (const text of ['>Rules<', '>Chat<', '>Watch a replay<', '>Leave Room<']) expect(host).toContain(text);
    // Rules and chat may collapse to icons (voice and invite do too); replay and leave always keep their text.
    expect(buttonTag(host, 'aria-label="Game rules"')).toContain('collapsible');
    expect(buttonTag(host, 'aria-label="Leave Room"')).not.toContain('collapsible');
    expect(buttonTag(host, 'title="Watch a replay"')).not.toContain('collapsible');
    state.playerId = 'visitor';
    const guest = header(render(createElement(RoomPage)));
    expect(guest).toContain('>Leave Room<');
    expect(guest).not.toContain('Watch a replay');
  });

  it('disables the shared replay button outside waiting rooms but keeps leaving available', () => {
    state.room = { ...room(), status: 'playing' };
    const html = render(createElement(RoomPage));
    expect(buttonTag(html, 'title="Watch a replay"')).toContain('disabled=""');
    expect(buttonTag(html, 'aria-label="Leave Room"')).not.toContain('disabled');
  });

  it('keeps rules access available to hosts, guests, and disconnected spectators', () => {
    for (const gameType of GAME_TYPES) {
      state.room = { ...room(), gameType };
      for (const playerId of ['alice', 'visitor']) {
        state.playerId = playerId;
        state.mySeat = null;
        state.connection = 'connecting';
        const trigger = render(createElement(RoomPage)).match(/<button[^>]*aria-label="Game rules"[^>]*>[\s\S]*?<\/button>/)?.[0];
        expect(trigger).toBeDefined();
        expect(trigger).toContain('aria-haspopup="dialog"');
        expect(trigger).not.toContain('disabled');
      }
    }
  });

  it('shows per-bot difficulty, defaults legacy bots to hard, and restricts editing to connected hosts', () => {
    const html = render(createElement(RoomPage));
    expect(html).toMatch(/>Hard<\/span>/);
    expect(botControls()).toContain('aria-label="Difficulty for Bot East"');
    expect(botControls()).toMatch(/role="combobox"[^>]*>Hard<\/div>/);
    expect(botControls({ player: { ...bot, botDifficulty: 'easy' } })).toMatch(/role="combobox"[^>]*>Easy<\/div>/);
    // A lost connection or a room that no longer waits locks the select.
    expect(botControls({ disabled: true, blocked: true })).toMatch(/role="combobox"[^>]*aria-disabled="true"[^>]*aria-label="Difficulty for Bot East"/);
    expect(botControls({ disabled: true })).toMatch(/role="combobox"[^>]*aria-disabled="true"/);
    state.connection = 'connecting';
    expect(buttonTag(render(createElement(RoomPage)), 'aria-label="Manage Bot East"')).toBeDefined();
    state.connection = 'ready';
    state.room = { ...state.room!, status: 'playing' };
    expect(buttonTag(render(createElement(RoomPage)), 'aria-label="Manage Bot East"')).toContain('disabled=""');
    state.room = { ...state.room, status: 'waiting' };
    state.room!.seats.E = { player: { ...bot, botDifficulty: 'easy' }, isReady: true };
    state.playerId = 'visitor';
    const visitorHtml = render(createElement(RoomPage));
    expect(visitorHtml).not.toContain('Manage Bot East');
    expect(visitorHtml).toMatch(/>Easy<\/span>/);
    useI18nStore.getState().setLocale('zh-TW');
    expect(render(createElement(RoomPage))).toMatch(/>簡單<\/span>/);
  });

  it('disables room actions until the connection is ready', () => {
    state.room = { ...room(), seats: { ...room().seats,
      S: { player: { ...bot, id: 'bot:south' }, isReady: true },
      W: { player: { ...bot, id: 'bot:west' }, isReady: true },
    } };
    expect(render(createElement(RoomPage))).not.toMatch(/<button[^>]*disabled=""[^>]*>Start game<\/button>/);
    state.connection = 'connecting';
    const html = render(createElement(RoomPage));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Start game<\/button>/);
    expect(buttonTag(html, FILL)).toContain('disabled=""');
  });

  it('offers dragging and the move menu only for humans managed by a connected waiting-room host', () => {
    state.room = { ...room(), spectators: [{ ...human, id: 'spectator', nickname: 'Visitor' }] };
    const html = render(createElement(RoomPage));
    expect(html).toContain('aria-label="Actions for Alice"');
    expect(html).not.toContain('aria-label="Actions for Bot East"');
    expect(html).toContain('data-no-drag');
    expect(html).toContain('draggable');
    expect(html).toContain('data-room-drop="spectator"');
    const panel = (canManage: boolean): string => render(createElement(RoomSpectators, {
      spectators: [{ ...human, id: 'spectator', nickname: 'Visitor' }], hostId: human.id, playerId: human.id,
      seated: true, canSpectate: true, canManage, isHost: true, blocked: false, pending: false,
      onStandUp: noop, onKick: noop, renderMenu: (player) => createElement('button', { 'aria-label': `Menu ${player.nickname}` }),
    }));
    expect(panel(true)).toContain('aria-label="Menu Visitor"');
    expect(panel(true)).toContain('grip');
    expect(panel(false)).not.toContain('aria-label="Menu Visitor"');
    expect(panel(false)).not.toContain('grip');
    state.playerId = 'visitor';
    expect(render(createElement(RoomPage))).not.toContain('Actions for');
    state.playerId = human.id;
    state.connection = 'connecting';
    const offline = render(createElement(RoomPage));
    expect(offline).not.toContain('grip');
    expect(offline).toMatch(/<button[^>]*aria-label="Actions for Alice"[^>]*disabled=""/);
    state.connection = 'ready';
    state.room = { ...state.room!, status: 'playing' };
    expect(render(createElement(RoomPage))).not.toContain('Actions for');
  });

  it('keeps Ready clickable without permanent player-count notices', () => {
    expect(render(createElement(RoomPage))).not.toMatch(/disabled="">Ready<\/button>/);
    state.room = { ...room(), gameType: 'holdem', additionalSeats: [{ player: null, isReady: false }] };
    const html = render(createElement(RoomPage));
    expect(html).toContain('Seat 5');
    expect(html).not.toMatch(/disabled="">Ready<\/button>/);
    expect(html).not.toContain('Only four-player matches are currently supported');
    // The summary card counts the seated players of the five visible seats.
    expect(html).toMatch(/\d\/5 seated/);
    expect(html).not.toMatch(/\d\/\d ready/);
    state.mySeat = null;
    expect(render(createElement(RoomPage))).not.toMatch(/disabled="">Ready<\/button>/);
  });

  it('shows the host only Start game and every other player the ready toggle', () => {
    const disabledStart = /<button[^>]*disabled=""[^>]*>Start game<\/button>/;
    // Two of four seats are filled: the host's button stays "Start game", disabled, with no ready toggle.
    let html = render(createElement(RoomPage));
    expect(html).toMatch(disabledStart);
    expect(html).not.toMatch(/>(Ready|Unready)<\/button>/);
    // The host never needs to be marked ready: bots and the host's own implicit state are enough.
    state.room = { ...room(), seats: { ...room().seats,
      S: { player: { ...bot, id: 'bot:south' }, isReady: true }, W: { player: { ...bot, id: 'bot:west' }, isReady: true },
    } };
    html = render(createElement(RoomPage));
    expect(html).toMatch(/>Start game<\/button>/);
    expect(html).not.toMatch(disabledStart);
    expect(html).not.toMatch(/>(Ready|Unready)<\/button>/);
    // A host who spectates still only sees Start game.
    state.mySeat = null;
    html = render(createElement(RoomPage));
    expect(html).toMatch(/>Start game<\/button>/);
    expect(html).not.toMatch(/>(Ready|Unready)<\/button>/);
    state.mySeat = 'N';
    // Other players toggle between Ready and Unready and never see Start game.
    state.playerId = 'visitor';
    html = render(createElement(RoomPage));
    expect(html).toMatch(/>Ready<\/button>/);
    expect(html).not.toMatch(/>Start game<\/button>/);
    state.room = { ...state.room!, seats: { ...state.room!.seats, N: { player: human, isReady: true } } };
    expect(render(createElement(RoomPage))).toMatch(/>Unready<\/button>/);
  });

  it('shows an explicit spectator entry for standard and additional seated players', () => {
    const panel = (props: Partial<Parameters<typeof RoomSpectators>[0]> = {}): string => render(createElement(RoomSpectators, {
      spectators: [], hostId: human.id, playerId: human.id, seated: true, canSpectate: true, canManage: true,
      isHost: true, blocked: false, pending: false, onStandUp: noop, onKick: noop, ...props,
    }));
    const entry = (html: string): string | undefined => html.match(/<button[^>]*>Enter spectator area<\/button>/)?.[0];
    expect(entry(panel())).toBeDefined();
    expect(entry(panel())).not.toContain('disabled');
    expect(entry(panel({ isHost: false, canManage: false }))).not.toContain('disabled');
    expect(entry(panel({ seated: false }))).toBeUndefined();
    // The room shows how many watch and opens the list from one footer control: the dock's tab on desktop.
    state.room = { ...room(), spectators: [human] };
    const html = render(createElement(RoomPage));
    expect(html).toMatch(/aria-controls="room-dock"[^>]*>Spectators 1\/8<\/button>/);
    expect(html).toContain('id="room-dock-tab-spectators"');
  });

  it('disables spectator entry when disconnected or no longer waiting and translates its visible label', () => {
    const panel = (canSpectate: boolean): string => render(createElement(RoomSpectators, {
      spectators: [], hostId: human.id, playerId: human.id, seated: true, canSpectate, canManage: true,
      isHost: true, blocked: false, pending: false, onStandUp: noop, onKick: noop,
    }));
    expect(panel(false)).toMatch(/<button[^>]*disabled=""[^>]*>Enter spectator area<\/button>/);
    useI18nStore.getState().setLocale('zh-TW');
    expect(panel(true)).toMatch(/<button[^>]*>進入旁觀區<\/button>/);
    expect(render(createElement(RoomPage))).toContain('旁觀 0/8');
  });

  it('shows the seat expansion control only to hosts of Ninety-Nine, Blackjack, Hold\'em, Napoleon, Ten and a Half, Liar\'s Dice, Crazy Eights, Stud, Old Maid, Go Fish, and Chinese Checkers', () => {
    for (const gameType of GAME_TYPES) {
      state.room = { ...room(), gameType };
      const expandable = gameType === 'ninetynine' || gameType === 'blackjack' || gameType === 'holdem'
        || gameType === 'napoleon' || gameType === 'tenhalf' || gameType === 'liarsdice'
        || gameType === 'crazyeights' || gameType === 'stud' || gameType === 'oldmaid' || gameType === 'gofish'
        || gameType === 'chinesecheckers';
      const html = render(createElement(RoomPage));
      expect(html.includes('aria-label="Add seat"')).toBe(expandable);
    }
    state.room = { ...room(), gameType: 'holdem', hostId: 'another-player' };
    expect(render(createElement(RoomPage))).not.toContain('aria-label="Add seat"');
  });

  it('disables filling when every seat is occupied', () => {
    state.room = {
      ...room(), seats: { ...room().seats, S: { player: bot, isReady: true }, W: { player: bot, isReady: true } },
    };
    expect(buttonTag(render(createElement(RoomPage)), FILL)).toContain('disabled=""');
  });

  it('offers the eighth seat and hides the add control at eight seats', () => {
    state.room = { ...room(), gameType: 'holdem',
      additionalSeats: Array.from({ length: 3 }, () => ({ player: null, isReady: false })),
    };
    const addButton = (): string | undefined => render(createElement(RoomPage))
      .match(/<button[^>]*aria-label="Add seat"[^>]*>/)?.[0];
    expect(addButton()).toBeDefined();
    expect(addButton()).not.toContain('disabled');
    state.room = { ...state.room, additionalSeats: [
      ...state.room.additionalSeats!, { player: null, isReady: false },
    ] };
    expect(addButton()).toBeUndefined();
    // Napoleon stops at six seats.
    state.room = { ...room(), gameType: 'napoleon', additionalSeats: [{ player: null, isReady: false }] };
    expect(addButton()).toBeDefined();
    state.room = { ...state.room, additionalSeats: [
      ...state.room.additionalSeats!, { player: null, isReady: false },
    ] };
    expect(addButton()).toBeUndefined();
  });

  it('manages bots in additional seats and counts them for filling', () => {
    state.room = {
      ...room(), gameType: 'holdem',
      seats: { ...room().seats, S: { player: bot, isReady: true }, W: { player: bot, isReady: true } },
      additionalSeats: [{ player: null, isReady: false }],
    };
    let html = render(createElement(RoomPage));
    expect(html.match(/aria-label="Empty seat/g)).toHaveLength(1);
    expect(buttonTag(html, FILL)).not.toContain('disabled=""');
    state.room = { ...state.room, additionalSeats: [{ player: { ...bot, nickname: 'Bot P5' }, isReady: true }] };
    html = render(createElement(RoomPage));
    expect(html).toContain('aria-label="Manage Bot P5"');
    expect(html.match(/aria-label="Manage Bot/g)).toHaveLength(4);
    expect(buttonTag(html, FILL)).toContain('disabled=""');
  });

  it('keeps bot participants and bot winners visible in match history without profile links', () => {
    const match: MatchSummary = {
      id: 'match', roomCode: 'ABC123', accountIds: [human.id, bot.id, 'bot:south', 'bot:west'], finishedAt: 123,
      result: {
        gameType: 'bigtwo', winnerSeat: 'E', dragon: false,
        cardsLeft: { N: 1, E: 0, S: 1, W: 1 }, twosLeft: { N: 0, E: 0, S: 0, W: 0 },
        scores: { N: 1, E: 0, S: 1, W: 1 },
      },
    };
    const html = render(createElement(MatchHistoryList, { matches: [match], players: { [human.id]: human } }));
    expect(html.match(/Bot \(East\)/g)).toHaveLength(2);
    expect(html).toContain('Bot (South)');
    expect(html).toContain('Bot (West)');
    expect(html).toContain('href="/players/alice"');
    expect(html).not.toContain('/players/bot');
  });

  it('displays the abort threshold using seated humans rather than bots', () => {
    state.room = {
      ...room(), status: 'playing',
      seats: { ...room().seats, S: { player: { ...human, id: 'bob' }, isReady: true } },
      abortVote: { startedBy: human.id, startedAt: Date.now(), expiresAt: Date.now() + 60000, yes: [human.id], no: [] },
    };
    const html = render(createElement(AbortVoteBanner));
    expect(html).toContain('Ends when 2 players agree; bots do not vote');
    expect(html).toContain('role="region"');
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('aria-live');
  });

  it('renders the bot controls and labels in Traditional Chinese', () => {
    useI18nStore.getState().setLocale('zh-TW');
    const html = render(createElement(RoomPage));
    expect(html).toContain('用 bot 補滿空位');
    expect(html).toContain('>bot 補滿<');
    expect(html).toMatch(/>困難<\/span>/);
    expect(botControls()).toContain('移除 bot');
    expect(render(createElement(EmptySeatActions, { removable: false, onSit: noop, onAddBot: noop, onRemoveSeat: noop })))
      .toContain('加入 bot');
  });
});
