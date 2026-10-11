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

describe('contextual game rules', () => {
  beforeEach(() => useI18nStore.getState().setLocale('en'));

  it.each(GAME_TYPES)('renders complete rules for %s in both languages without lobby room status', (gameType) => {
    for (const locale of ['en', 'zh-TW'] as const) {
      useI18nStore.getState().setLocale(locale);
      const html = render(gameType);
      for (const section of getGameRules(gameType, locale)) {
        expect(html).toContain(`<h3>${section.title}</h3>`);
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
