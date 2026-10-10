import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Seat } from '@shared/types';

const state = vi.hoisted(() => ({ inRoom: true, mySeat: null as Seat | null }));

vi.mock('react-router-dom', () => ({ useNavigate: () => () => undefined }));
vi.mock('../../../client/src/socket', () => ({ socket: {} }));
vi.mock('../../../client/src/games/use-connection-ready', () => ({ useConnectionReady: () => true }));
vi.mock('../../../client/src/stores/room-store', () => ({
  useRoomStore: (select: (value: { roomInfo: object | null; mySeat: Seat | null }) => unknown) =>
    select({ roomInfo: state.inRoom ? {} : null, mySeat: state.mySeat }),
}));

import { SpectatorLeaveButton } from '../../../client/src/games/SpectatorLeave';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

describe('spectator leave button', () => {
  it('should appear only for room members without a seat', () => {
    useI18nStore.getState().setLocale('en');
    state.mySeat = null;
    expect(renderToStaticMarkup(createElement(SpectatorLeaveButton))).toContain('Leave Room');
    state.mySeat = 'N';
    expect(renderToStaticMarkup(createElement(SpectatorLeaveButton))).toBe('');
    state.mySeat = null;
    state.inRoom = false;
    expect(renderToStaticMarkup(createElement(SpectatorLeaveButton))).toBe('');
  });
});
