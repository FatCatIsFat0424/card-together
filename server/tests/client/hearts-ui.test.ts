import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HeartsVisibleState } from '@shared/games/hearts/types';
import { heartsClient } from '../../../client/src/games/hearts/hearts-client';
import { t } from '../../../client/src/i18n';
import { heartsView } from '../helpers/hearts';
const mocked = vi.hoisted(() => ({ hearts: null as HeartsVisibleState | null }));
vi.mock('../../../client/src/stores/game-store', () => ({
  useGameStore: (select: (value: typeof mocked) => unknown) => select(mocked),
}));
import { HeartsFrame } from '../../../client/src/games/hearts/HeartsFrame';
import { useI18nStore } from '../../../client/src/stores/i18n-store';
afterEach(() => { mocked.hearts = null; });
describe('Hearts client and settlement presentation', () => {
  it('uses descending standard ranks for desktop and mobile and clears spectator choices', () => {
    expect(heartsClient.handSort.initial).toBe('rank');
    expect(heartsClient.handSort.order.rank({ suit: 'clubs', rank: 14 })).toBeGreaterThan(heartsClient.handSort.order.rank({ suit: 'clubs', rank: 2 }));
    expect(heartsClient.spectatorPatch({ hands: { E: [{ suit: 'hearts', rank: 3 }] } } as never, 'E'))
      .toEqual({ myHand: [{ suit: 'hearts', rank: 3 }], myPass: [], validCards: [] });
    expect(t('gameType.hearts', 'en')).toBe('Hearts');
    expect(t('gameType.hearts', 'zh-TW')).toBe('紅心');
  });
  it.each(['en', 'zh-TW'] as const)('presents the settled hand and moon from its own log entry in %s', (locale) => {
    useI18nStore.getState().setLocale(locale);
    const score = { penalties: { N: 26, E: 0, S: 0, W: 0 }, added: { N: 0, E: 26, S: 26, W: 26 }, moon: 'N' as const };
    mocked.hearts = heartsView([], { hand: 2, phase: 'passing', log: [
      { type: 'hand_end', hand: 1, score, totals: score.added, timestamp: 1000 },
      { type: 'deal', hand: 2, timestamp: 1000 },
    ] });
    const html = renderToStaticMarkup(createElement(HeartsFrame, {
      frame: { key: 'commit:0', kind: 'settle', cards: [], durationMs: 3200 }, name: (seat) => `Player ${seat}`,
    }));
    expect(html).toContain(t('hearts.moon', locale, { name: 'Player N' }));
    expect(html.match(/\+26/g)).toHaveLength(3);
    expect(html).toContain('+0');
    expect(renderToStaticMarkup(createElement(HeartsFrame, {
      frame: { key: 'commit:1', kind: 'deal', cards: [], durationMs: 1500 }, name: String,
    }))).toBe('');
  });
});
