import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerInfo, RoomInfo, Seat } from '@shared/types';

const state = vi.hoisted(() => ({
  room: null as unknown,
  turnSeat: null as string | null,
}));

vi.mock('../../../client/src/cosmetics/card-faces/use-card-face', () => ({
  useCardFaceUrl: () => () => '/card.svg', useJokerFaceUrl: () => null, useNapoleonJokerFaceUrls: () => null,
}));
vi.mock('../../../client/src/cosmetics/chip-styles/use-chip-style', () => ({ useChipStyle: () => null }));
vi.mock('../../../client/src/media', () => ({ mediaUrl: (id: string) => `/api/media/${id}` }));
vi.mock('../../../client/src/stores/room-store', () => ({
  useRoomStore: (select: (value: { roomInfo: unknown; mySeat: string | null }) => unknown) =>
    select({ roomInfo: state.room, mySeat: 'S' }),
}));
vi.mock('../../../client/src/stores/game-store', () => ({
  useGameStore: (select: (value: Record<string, unknown>) => unknown) => select({
    visible: null, presentationReceivedAt: 0, bigTwo: null, redPoints: null, ninetyNine: null, sevens: null,
    chinesePoker: null, phase: 'playing', currentTurnSeat: state.turnSeat, contract: null, dealerSeat: null,
    playing: null,
  }),
}));
vi.mock('../../../client/src/stores/god-view-store', () => ({
  useGodViewStore: (select: (value: Record<string, unknown>) => unknown) => select({ role: null, covered: null }),
}));

import { TableSeat } from '../../../client/src/components/TableSeat';
import { seatFrameHostClass } from '../../../client/src/cosmetics/seat-frames/SeatFrame';

const player = (id: string, extra: Partial<PlayerInfo> = {}): PlayerInfo => ({
  id, username: id, nickname: id, color: '#4a9eff', avatar: 'cat', avatarImage: null, ...extra,
});

function room(framed: PlayerInfo | null): RoomInfo {
  return {
    code: 'ABC123', gameType: 'redpoints', status: 'playing', createdAt: 1, hostId: 'alice',
    abortVote: null, abortVoteCooldownUntil: null,
    seats: {
      N: { player: player('bot', { isBot: true, seatFrame: 'seat-frame-ember' }), isReady: true },
      E: { player: player('bob'), isReady: true },
      S: { player: framed, isReady: true },
      W: { player: player('carol'), isReady: true },
    },
  };
}

const render = (seat: Seat): string => renderToStaticMarkup(
  createElement(MemoryRouter, null, createElement(TableSeat, { seat, position: 'bottom' })));

describe('table seat frame', () => {
  beforeEach(() => { state.turnSeat = null; });

  it('keeps the plain plate for players without a frame', () => {
    state.room = room(player('alice'));
    const html = render('S');
    expect(html).not.toContain('data-seat-frame');
    expect(html).toMatch(/<div class="[^"]*" data-seat-plate="true"><div/);
  });

  it('draws the equipped frame inside the plate and marks the host', () => {
    state.room = room(player('alice', { seatFrame: 'seat-frame-gilded' }));
    const html = render('S');
    expect(html).toContain('data-seat-frame="gilded"');
    expect(html).toMatch(/data-seat-plate="true"><span[^>]*data-seat-frame="gilded"/);
    expect(html).toContain(seatFrameHostClass('seat-frame-gilded'));
    expect(html).not.toContain('data-turn');
  });

  it('switches the frame to its turn glow on the seat that is on turn', () => {
    state.room = room(player('alice', { seatFrame: 'seat-frame-frost' }));
    state.turnSeat = 'S';
    expect(render('S')).toContain('data-turn="true"');
    state.turnSeat = 'E';
    expect(render('S')).not.toContain('data-turn');
  });

  it('ignores an unknown frame id sent by an older or newer server', () => {
    state.room = room(player('alice', { seatFrame: 'seat-frame-retired' as never }));
    expect(render('S')).not.toContain('data-seat-frame');
  });
});
