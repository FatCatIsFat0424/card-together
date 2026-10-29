import { createElement } from 'react';
import type { ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerInfo, RoomInfo } from '@shared/types';

const state = vi.hoisted(() => ({ roomInfo: null as RoomInfo | null, playerId: 'host' as string | null }));
vi.mock('../../../client/src/stores/room-store', () => ({
  useRoomStore: (select: (value: { roomInfo: RoomInfo | null }) => unknown) => select(state),
}));
vi.mock('../../../client/src/stores/player-store', () => ({
  usePlayerStore: (select: (value: { playerId: string | null }) => unknown) => select(state),
}));
vi.mock('../../../client/src/media', () => ({ mediaUrl: (id: string) => `/api/media/${id}` }));
import { GameSpectators, SpectatorsTabLabel } from '../../../client/src/games/GameSpectators';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

function player(id: string, extra: Partial<PlayerInfo> = {}): PlayerInfo {
  return { id, username: id, nickname: `Nick ${id}`, avatar: 'cat', avatarImage: null, color: '#123456', ...extra };
}
function room(spectators: readonly PlayerInfo[] | undefined): RoomInfo {
  return { code: 'ABC123', hostId: 'host', status: 'playing', spectators } as unknown as RoomInfo;
}
const renderList = (layout: 'dock' | 'sheet'): string =>
  renderToStaticMarkup(createElement(MemoryRouter, null, createElement(GameSpectators as ComponentType<{ layout: string }>, { layout })));

describe('in-game spectator list', () => {
  beforeEach(() => {
    useI18nStore.getState().setLocale('en');
    state.playerId = 'host';
  });

  it('should list each spectator with a player card link and mark the viewer', () => {
    state.roomInfo = room([player('ann'), player('host')]);
    const html = renderList('dock');
    expect(html).toContain('Spectator area (2/');
    expect(html).toContain('Nick ann');
    expect(html).toContain('href="/players/ann"');
    expect(html).toContain('(me)');
  });

  it('should stay read-only during a match', () => {
    state.roomInfo = room([player('ann'), player('host')]);
    const html = renderList('sheet');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('draggable');
  });

  it('should show the empty note and render nothing outside a room', () => {
    state.roomInfo = room(undefined);
    expect(renderList('dock')).toContain('No spectators yet.');
    state.roomInfo = null;
    expect(renderList('dock')).toBe('');
  });

  it('should show the live spectator count on the tab', () => {
    state.roomInfo = room([player('ann'), player('bob'), player('cy')]);
    const html = renderToStaticMarkup(createElement(SpectatorsTabLabel));
    expect(html).toContain('Spectators');
    expect(html).toMatch(/>3<\/span>/);
    state.roomInfo = room([]);
    expect(renderToStaticMarkup(createElement(SpectatorsTabLabel))).toMatch(/>0<\/span>/);
  });
});
