import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerInfo, RoomInfo } from '@shared/types';

const state = vi.hoisted(() => ({ room: null as RoomInfo | null }));

vi.mock('../../../client/src/stores/room-store', () => ({
  useRoomStore: (select: (value: { roomInfo: RoomInfo | null }) => unknown) => select({ roomInfo: state.room }),
}));

import { joinNames, seatDisplayName } from '../../../client/src/games/seat-names';
import { ResultDialog } from '../../../client/src/games/ResultDialog';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

const human = (id: string): PlayerInfo => ({
  id, username: id, nickname: id.toUpperCase(), color: '#4a9eff', avatar: 'cat', avatarImage: null,
});

function seats(): RoomInfo['seats'] {
  return {
    N: { player: human('ann'), isReady: true },
    E: { player: { ...human('bot'), isBot: true }, isReady: true },
    S: { player: human('cat'), isReady: true },
    W: { player: null, isReady: false },
  };
}

describe('seat names', () => {
  it('should join names with the locale separator', () => {
    expect(joinNames(['A', 'B'], 'en')).toBe('A, B');
    expect(joinNames(['甲', '乙'], 'zh-TW')).toBe('甲、乙');
  });

  it('should fall back to the seat label for empty seats', () => {
    expect(seatDisplayName(seats(), 'N', (seat) => seat)).toBe('ANN');
    expect(seatDisplayName(seats(), 'W', (seat) => `seat ${seat}`)).toBe('seat W');
    expect(seatDisplayName(undefined, 'S', (seat) => seat)).toBe('S');
  });
});

describe('result dialog', () => {
  beforeEach(() => {
    state.room = null;
    useI18nStore.setState({ locale: 'en' });
  });

  it('should render a labelled modal dialog with the primary action', () => {
    const html = renderToStaticMarkup(createElement(ResultDialog, {
      title: 'North wins!', pending: false, error: '', onBack: () => undefined,
    }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(labelledBy).toBeTruthy();
    expect(html).toContain(`id="${labelledBy}"`);
    expect(html).toContain('Back to Room');
  });

  it('should report a pending return', () => {
    expect(renderToStaticMarkup(createElement(ResultDialog, {
      title: 'x', pending: true, error: '', onBack: () => undefined,
    }))).toContain('Returning to the room');
  });
});
