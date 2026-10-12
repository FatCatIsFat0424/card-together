import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GAME_TYPES } from '@shared/constants';
import type {
  BlackjackVisibleState, GameType, NinetyNineVisibleState, RoomInfo, SevensVisibleState,
} from '@shared/types';
import { GameRulesContent } from '../../../client/src/components/GameRulesDialog';
import { matchRulesContext, roomRulesContext } from '../../../client/src/game-rules-context';
import type { GameRulesContext } from '../../../client/src/game-rules-context';
import { getGameRules } from '../../../client/src/game-rules-i18n';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

// Static rendering otherwise reads Zustand's initial locale rather than test updates.
vi.mock('../../../client/src/stores/i18n-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../client/src/stores/i18n-store')>();
  return { useI18nStore: Object.assign(() => actual.useI18nStore.getState(), {
    getState: actual.useI18nStore.getState,
  }) };
});

function room(gameType: GameType, overrides: Partial<RoomInfo> = {}): RoomInfo {
  return {
    code: 'ABC123', gameType, status: 'waiting', createdAt: 1, hostId: 'host',
    seats: { N: { player: null, isReady: false }, E: { player: null, isReady: false },
      S: { player: null, isReady: false }, W: { player: null, isReady: false } },
    abortVote: null, abortVoteCooldownUntil: null, ...overrides,
  };
}

const counts = { N: 0, E: 0, S: 0, W: 0 };
const sevens: SevensVisibleState = {
  gameType: 'sevens', phase: 'playing', mySeat: 'N', myHand: [], myCovered: [],
  handCounts: counts, coveredCounts: counts, validCards: [], currentTurnSeat: 'N',
  table: { spades: null, hearts: null, diamonds: null, clubs: null }, log: [], result: null,
};
const ninetyNine: NinetyNineVisibleState = {
  gameType: 'ninetynine', phase: 'playing', mySeat: 'N', myHand: [], handCounts: counts,
  total: 0, direction: 'ccw', currentTurnSeat: 'N', lastPlayed: null, stockCount: 30,
  eliminated: [], log: [], result: null,
};
const blackjack: BlackjackVisibleState = {
  gameType: 'blackjack', phase: 'betting', options: { playerDealer: true }, dealerSeat: 'N',
  totalHands: 8, mySeat: 'N', seats: ['N', 'E'], hand: 1, chips: { N: 1000, E: 1000, S: 0, W: 0 },
  myBet: null, betPlaced: { N: false, E: false, S: false, W: false }, betDeadline: null,
  hands: { N: [], E: [], S: [], W: [] }, dealer: [], holeHidden: false,
  currentTurnSeat: 'N', activeHand: 0, log: [], result: null,
};

function render(gameType: GameType, context?: GameRulesContext): string {
  return renderToStaticMarkup(createElement(GameRulesContent, { gameType, context }));
}

const requiredRule: Readonly<Record<GameType, Readonly<Record<'en' | 'zh-TW', string>>>> = {
  bridge: { en: 'Playing a trick', 'zh-TW': '出牌與牌墩' },
  bigtwo: { en: 'Legal combinations', 'zh-TW': '合法牌型' },
  redpoints: { en: 'Capturing cards', 'zh-TW': '吃牌配對' },
  ninetynine: { en: 'Every card effect', 'zh-TW': '所有牌的效果' },
  sevens: { en: 'Covering and blocked cards', 'zh-TW': '蓋牌與封鎖' },
  chinesepoker: { en: 'Front row and fouls', 'zh-TW': '前墩與倒水' },
  liarsdeck: { en: 'Calling LIAR and the next round', 'zh-TW': '質疑、開槍與下一輪' },
  blackjack: { en: 'Betting and deal', 'zh-TW': '下注與發牌' },
  holdem: { en: 'Main pot, side pots, and ties', 'zh-TW': '主池、邊池與平手' },
};

describe('contextual game rules', () => {
  beforeEach(() => useI18nStore.getState().setLocale('en'));

  it.each(GAME_TYPES)('renders complete rules for %s in both languages without lobby room status', (gameType) => {
    for (const locale of ['en', 'zh-TW'] as const) {
      useI18nStore.getState().setLocale(locale);
      const html = render(gameType);
      const sections = getGameRules(gameType, locale);
      expect(sections.length).toBeGreaterThanOrEqual(3);
      expect(sections.map((section) => section.title)).toContain(requiredRule[gameType][locale]);
      for (const section of sections) {
        expect(section.title.trim()).not.toBe('');
        expect(section.paragraphs.length + (section.table?.rows.length ?? 0)).toBeGreaterThan(0);
        expect(html).toContain(`<h3>${section.title}</h3>`);
        for (const paragraph of section.paragraphs) {
          expect(paragraph.trim()).not.toBe('');
          expect(html).toContain(renderToStaticMarkup(createElement('li', null, paragraph)));
        }
        if (section.table) {
          expect(section.table.headers.length).toBeGreaterThan(0);
          expect(section.table.rows.length).toBeGreaterThan(0);
          for (const header of section.table.headers) expect(header.trim()).not.toBe('');
          for (const row of section.table.rows) {
            expect(row).toHaveLength(section.table.headers.length);
            for (const cell of row) {
              expect(cell.trim()).not.toBe('');
              expect(html).toContain(renderToStaticMarkup(createElement('span', null, cell)).slice(6, -7));
            }
          }
        }
      }
      expect(html).not.toContain(useI18nStore.getState().t('rules.roomSettings'));
      expect(html).not.toContain(useI18nStore.getState().t('rules.playContinues'));
    }
  });

  it('defaults legacy room options to off and limits status to the selected game', () => {
    for (const gameType of ['sevens', 'ninetynine', 'blackjack'] as const) {
      const context = roomRulesContext(room(gameType));
      expect(context.option?.enabled).toBe(false);
      expect(render(gameType, context)).toContain('<dd>Off</dd>');
      expect(context.active).toBe(false);
    }
    for (const gameType of GAME_TYPES.filter((type) => !['sevens', 'ninetynine', 'blackjack'].includes(type))) {
      expect(roomRulesContext(room(gameType, { sevensOptions: { closeOnEnd: true } })).option).toBeNull();
    }
  });

  it('reflects current room mode and option changes without modifying room data', () => {
    const original = room('sevens', { sevensOptions: { closeOnEnd: true } });
    const before = structuredClone(original);
    expect(roomRulesContext(original).option).toEqual({ label: 'sevens.closeOnEnd', enabled: true });
    expect(roomRulesContext({ ...original, sevensOptions: { closeOnEnd: false } }).option?.enabled).toBe(false);
    expect(roomRulesContext({ ...original, gameType: 'ninetynine', ninetyNineOptions: { twoDecks: true } }).option)
      .toEqual({ label: 'ninetynine.twoDecks', enabled: true });
    expect(roomRulesContext(room('blackjack', { blackjackOptions: { playerDealer: true } })).option)
      .toEqual({ label: 'blackjack.playerDealer', enabled: true });
    expect(original).toEqual(before);
  });

  it('reads each match option from the current match, including legacy defaults and settlement', () => {
    expect(matchRulesContext(sevens).option?.enabled).toBe(false);
    expect(matchRulesContext(ninetyNine).option?.enabled).toBe(false);
    for (const game of [
      { ...sevens, options: { closeOnEnd: true } },
      { ...ninetyNine, options: { twoDecks: true } }, blackjack,
    ]) {
      const context = matchRulesContext(game);
      expect(context.option?.enabled).toBe(true);
      expect(context.active).toBe(true);
      const scored = matchRulesContext({ ...game, phase: 'scoring' });
      expect(scored.option).toEqual(context.option);
      expect(scored.active).toBe(false);
    }
    expect(matchRulesContext({ ...blackjack, options: { playerDealer: false } }).option?.enabled).toBe(false);
  });

  it('renders translated option status and a notice only while a match is active', () => {
    for (const locale of ['en', 'zh-TW'] as const) {
      useI18nStore.getState().setLocale(locale);
      const { t } = useI18nStore.getState();
      const context = matchRulesContext(blackjack);
      const html = render('blackjack', context);
      expect(html).toContain(`<dt>${t('blackjack.playerDealer')}</dt>`);
      expect(html).toContain(`<dd>${t('rules.enabled')}</dd>`);
      expect(html).toContain(t('rules.playContinues'));
      expect(render('blackjack', { ...context, active: false })).not.toContain(t('rules.playContinues'));
    }
  });
});
