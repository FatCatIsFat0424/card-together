import { createElement } from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameSeat, PlayerInfo, RoomInfo } from '@shared/types';

const state = vi.hoisted(() => ({
  notice: null as { id: number; key: 'abortVote.passedToast' } | null,
  /** Which layout media queries match: the desktop dock or the phone sheet. */
  layout: 'desktop' as 'desktop' | 'phone',
  room: null as RoomInfo | null,
  mySeat: 'N' as GameSeat | null,
  observer: undefined as 'spectator' | undefined,
}));

vi.mock('@mui/material/useMediaQuery', () => ({
  default: (query: string): boolean => state.layout === 'desktop'
    ? query === '(min-width: 768px) and (min-height: 501px)'
    : query.includes('max-height: 500px'),
}));
// Server rendering reads a store's initial state, so the notice comes from the test state.
vi.mock('../../../client/src/stores/room-notice-store', () => ({
  useRoomNoticeStore: Object.assign(
    (select: (value: object) => unknown) => select({ notice: state.notice, headers: 0 }),
    { getState: () => ({ attachHeader: () => () => undefined }) },
  ),
}));
vi.mock('../../../client/src/api', () => ({ apiRequest: vi.fn() }));
vi.mock('../../../client/src/socket', () => ({ socket: {} }));
vi.mock('../../../client/src/media', () => ({ mediaUrl: (id: string) => `/api/media/${id}` }));
vi.mock('../../../client/src/components/ChatPanel', () => ({
  ChatPanel: ({ captioned = false }: { captioned?: boolean }): ReactNode =>
    createElement('div', { 'data-chat-panel': captioned ? 'captioned' : 'plain' }),
}));
vi.mock('../../../client/src/components/TableSeat', () => ({ TableSeat: () => null }));
vi.mock('../../../client/src/components/TurnClock', () => ({ TurnClock: () => null }));
vi.mock('../../../client/src/games/GameSpectators', () => ({
  GameSpectators: () => null, SpectatorsTabLabel: () => 'Spectators',
}));
vi.mock('../../../client/src/games/GamePresentation', () => ({ GamePresentation: () => null }));
vi.mock('../../../client/src/games/RoundHistory', () => ({ RoundHistory: () => null }));
vi.mock('../../../client/src/games/GameMenuLinks', () => ({ GameMenuLinks: () => null, useGameMenuUnread: () => 0 }));
vi.mock('../../../client/src/games/use-game-presentation', () => ({
  useGamePresentation: () => ({ locked: false, frame: null }),
}));
vi.mock('../../../client/src/audio/card-sound', () => ({
  playCardSound: () => undefined, playOutSound: () => undefined, playBoardSound: () => undefined,
  playDiceRevealSound: () => undefined, playDiceRollSound: () => undefined,
  unlockCardSounds: () => undefined, disposeCardSounds: () => undefined,
}));
vi.mock('../../../client/src/stores/account-store', () => ({
  useAccountStore: (select: (value: { account: { id: string }; connection: 'ready' }) => unknown) =>
    select({ account: { id: 'alice' }, connection: 'ready' }),
  selectConnectionReady: (value: { connection: string }): boolean => value.connection === 'ready',
}));
vi.mock('../../../client/src/stores/room-store', () => ({
  useRoomStore: (select: (value: object) => unknown) =>
    select({ roomInfo: state.room, mySeat: state.mySeat, currentRoomCode: state.room?.code ?? null }),
}));
vi.mock('../../../client/src/stores/player-store', () => ({
  usePlayerStore: (select: (value: { playerId: string }) => unknown) => select({ playerId: 'alice' }),
}));
vi.mock('../../../client/src/stores/chat-store', () => ({
  useChatStore: (select: (value: { messages: never[] }) => unknown) => select({ messages: [] }),
}));
vi.mock('../../../client/src/stores/game-store', () => ({
  useGameStore: (select: (value: Record<string, unknown>) => unknown) => select({
    phase: 'playing', currentTurnSeat: 'E', log: [],
    visible: { gameType: 'bigtwo', phase: 'playing', observer: state.observer },
  }),
}));

import { GameShell } from '../../../client/src/games/GameShell';
import { RoomHeader } from '../../../client/src/components/RoomHeader';
import { VoiceControls } from '../../../client/src/components/VoiceControls';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

const alice: PlayerInfo = {
  id: 'alice', username: 'alice', nickname: 'Alice', color: '#4a9eff', avatar: 'cat', avatarImage: null,
};

function room(): RoomInfo {
  return {
    code: 'ABC123', gameType: 'bigtwo', status: 'playing', createdAt: 123, hostId: alice.id,
    abortVote: null, abortVoteCooldownUntil: null,
    seats: {
      N: { player: alice, isReady: true }, E: { player: null, isReady: false },
      S: { player: null, isReady: false }, W: { player: null, isReady: false },
    },
  };
}

function renderShell(): string {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/game/ABC123'] },
    createElement(VoiceControls, null, createElement(GameShell, { info: 'GAME-INFO', centre: null, hand: null }))));
}

/** Visible names of the buttons in a fragment, in document order. */
function buttonNames(html: string): string[] {
  return [...html.matchAll(/<button[^>]*aria-label="([^"]*)"/g)].map((match) => match[1]);
}

function section(html: string, start: string, end: string): string {
  const from = html.indexOf(start);
  return html.slice(from, html.indexOf(end, from));
}

describe('room header', () => {
  beforeEach(() => {
    useI18nStore.getState().setLocale('en');
    state.notice = null;
  });

  it('puts the status in the middle, then rules, voice, chat, a divider, and the phase actions', () => {
    const html = renderToStaticMarkup(createElement(RoomHeader, {
      title: 'Big Two', code: 'ABC123', status: { text: 'Waiting to start · 2/4 seated' },
      voice: createElement('button', { 'aria-label': 'VOICE' }),
      chat: { unread: 3, expanded: false, controls: 'room-dock', onToggle: () => undefined },
      actions: createElement('button', { 'aria-label': 'PHASE' }),
      onBack: () => undefined, onRules: () => undefined,
    }));
    expect(buttonNames(html)).toEqual(['Back to lobby', 'Copy ABC123', 'Game rules', 'VOICE', 'Chat 3 unread messages', 'PHASE']);
    expect(html.indexOf('Waiting to start · 2/4 seated')).toBeLessThan(html.indexOf('Game rules'));
    expect(html.indexOf('data-phase-actions')).toBeGreaterThan(html.indexOf('aria-hidden="true"></span>'));
  });

  it('shows a room notice in place of the status', () => {
    state.notice = { id: 1, key: 'abortVote.passedToast' };
    const html = renderToStaticMarkup(createElement(RoomHeader, {
      title: 'Big Two', code: 'ABC123', status: { text: 'Waiting to start · 2/4 seated' }, voice: null, chat: null,
      actions: null, onBack: () => undefined, onRules: () => undefined,
    }));
    expect(html).toContain('data-tone="notice"');
    expect(html).toContain('Vote passed — back to the room.');
    expect(html).not.toContain('2/4 seated');
  });
});

describe('table header and dock', () => {
  beforeEach(() => {
    useI18nStore.getState().setLocale('en');
    state.layout = 'desktop';
    state.notice = null;
    state.room = room();
    state.mySeat = 'N';
    state.observer = undefined;
  });

  it('gives the live table the room header with the vote and early leave last', () => {
    const header = section(renderShell(), '<header', '</header>');
    expect(header).toContain('>Big Two<');
    expect(header).toMatch(/data-room-status[^>]*>[^<]*s turn</);
    const names = buttonNames(header);
    expect(names.slice(2)).toEqual(['Game rules', 'Table voice', 'Chat', 'Vote to abort', 'Leave early']);
    expect(header).toMatch(/aria-label="Leave early"[^>]*class="[^"]*danger/);
  });

  it('gives spectators the leave action instead of the vote', () => {
    state.mySeat = null;
    state.observer = 'spectator';
    const names = buttonNames(section(renderShell(), '<header', '</header>'));
    expect(names.slice(-2)).toEqual(['Chat', 'Leave Room']);
  });

  it('docks the game info above the chat, with no separate chat tab or table controls', () => {
    const html = renderShell();
    const tabs = [...section(html, 'role="tablist"', '</div>').matchAll(/role="tab"[^>]*>(.*?)<\/button>/g)]
      .map((match) => match[1].replace(/<[^>]+>/g, ''));
    expect(tabs).toEqual(['Game', 'Spectators', 'Voice']);
    const dock = section(html, 'id="game-dock"', '</aside>');
    expect(dock.indexOf('GAME-INFO')).toBeLessThan(dock.indexOf('data-chat-panel="captioned"'));
    expect(dock).not.toContain('Vote to abort');
    expect(dock).not.toContain('Copy ABC123');
    expect(dock).not.toContain('>Game rules<');
  });

  it('lists the header controls in the same order in the phone menu', () => {
    state.layout = 'phone';
    const html = renderShell();
    expect(html).not.toContain('<header');
    const sheet = section(html, 'id="game-info-panel"', 'GAME-INFO');
    const order = ['Copy ABC123', '> Game rules', 'Table voice', '"Chat"', 'Vote to abort', 'Leave early']
      .map((text) => sheet.indexOf(text));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
