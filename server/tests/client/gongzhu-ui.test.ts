import { createElement } from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Card, PlayerInfo } from '@shared/types';
import type { GongZhuVisibleState } from '@shared/games/gongzhu/types';
import { getPresentationFrames } from '@shared/game-presentation';
import { gongZhuSeatMap } from '@shared/rules/gongzhu';
import { gongZhuClient } from '../../../client/src/games/gongzhu/gongzhu-client';
import { createRoundBuilder } from '../../../client/src/games/round-builder';
import { sortHand } from '../../../client/src/games/hand-sort';
import { spectatorGame } from '../../../client/src/games/table-perspective';
import { HIDDEN_GOD_VIEW } from '../../../client/src/stores/god-view-store';
import { isOwnTurn } from '../../../client/src/games/observer-view';
import { useI18nStore } from '../../../client/src/stores/i18n-store';
import * as game from '../../src/managers/games/gongzhu-game';

const state = vi.hoisted(() => ({ gongzhu: null as GongZhuVisibleState | null, gameType: 'gongzhu',
  visible: null as GongZhuVisibleState | null, napoleon: null, locked: false }));
vi.mock('../../../client/src/socket', () => ({ socket: {} }));
vi.mock('../../../client/src/deployment', () => ({ APP_BASE_PATH: '/', API_BASE_URL: '', SERVER_URL: '', SOCKET_PATH: '/socket.io' }));
vi.mock('../../../client/src/stores/game-store', () => ({
  useGameStore: (select: (value: typeof state) => unknown) => select(state),
}));
vi.mock('../../../client/src/cosmetics/card-faces/use-card-face', () => ({
  useCardFaceUrl: () => () => '/card.svg', useCardOrJokerFaceUrl: () => () => '/card.svg',
}));
vi.mock('../../../client/src/games/GameShell', () => ({
  GameShell: (props: { info: ReactNode; centre: ReactNode; hand: ReactNode; overlay?: ReactNode; prompt?: ReactNode }) =>
    createElement('main', null, props.info, props.centre, props.hand, props.overlay, props.prompt),
}));
vi.mock('../../../client/src/games/use-game-presentation', () => ({ useGamePresentation: () => ({ locked: state.locked }) }));
vi.mock('../../../client/src/games/use-connection-ready', () => ({ useConnectionReady: () => true }));
vi.mock('../../../client/src/games/use-table-perspective', () => ({ useViewedGame: (value: unknown) => value }));
vi.mock('../../../client/src/games/RoundHistory', () => ({ useResultRoundHistory: () => null }));

import { GongZhuTable } from '../../../client/src/games/gongzhu/GongZhuTable';
import { GongZhuFrame, GongZhuRounds } from '../../../client/src/games/gongzhu/GongZhuHistory';
import { createDeck } from '../../src/engine/deck';

const CODE = 'GONGUI';
function start(): GongZhuVisibleState {
  const players = gongZhuSeatMap<PlayerInfo>((seat) => ({ id: seat, username: seat, nickname: seat,
    color: '#123456', avatar: 'cat', avatarImage: null }));
  game.startGame(CODE, players, createDeck());
  return game.getPlayerVisibleState(CODE, game.getGameState(CODE)!.currentTurnSeat)!;
}
afterEach(() => { game.abortGame(CODE); state.gongzhu = null; state.visible = null; state.locked = false; });

describe('Gong Zhu table integration', () => {
  it.each(['en', 'zh-TW'] as const)('renders playable cards, scores and captures with translated text (%s)', (locale) => {
    useI18nStore.setState({ locale });
    state.gongzhu = state.visible = start();
    const html = renderToStaticMarkup(createElement(GongZhuTable));
    expect(html).toContain(locale === 'en' ? 'Captured scoring cards' : '已收分數牌');
    expect(html).toContain('aria-label="2♣"');
    expect(html).toContain('♣2');
    expect(html).not.toContain('gongzhu.');
    // Only the forced opening C2 is enabled; every other card is unavailable.
    const cards = [...html.matchAll(/<button[^>]*aria-label="[^"]*[♣♦♥♠][^"]*"[^>]*>/g)].map((match) => match[0]);
    expect(cards).toHaveLength(13);
    expect(cards.filter((card) => card.includes('aria-disabled="false"'))).toHaveLength(1);
    state.locked = true;
    const locked = renderToStaticMarkup(createElement(GongZhuTable));
    expect([...locked.matchAll(/<button[^>]*aria-label="[^"]*[♣♦♥♠][^"]*"[^>]*>/g)]
      .every((match) => match[0].includes('aria-disabled="true"'))).toBe(true);
  });

  it('sorts hands high to low without mutating them and prevents spectator actions after changing perspective', () => {
    const view = start();
    const hand: Card[] = [{ suit: 'clubs', rank: 2 }, { suit: 'spades', rank: 14 }, { suit: 'hearts', rank: 11 }];
    expect(sortHand(hand, gongZhuClient.handSort.initial, 'gongzhu').map((card) => card.rank)).toEqual([14, 11, 2]);
    expect(hand.map((card) => card.rank)).toEqual([2, 14, 11]);
    const watched = spectatorGame({ ...view, observer: 'spectator' }, 'W', { ...HIDDEN_GOD_VIEW,
      role: 'spectator', hands: { W: hand } });
    expect(watched.mySeat).toBe('W');
    expect(watched.myHand).toEqual(hand);
    expect(isOwnTurn({ ...watched, currentTurnSeat: 'W' })).toBe(false);
  });

  it('reconstructs all hands and trick awards and shows the settling hand before the next deal', () => {
    useI18nStore.setState({ locale: 'en' });
    start();
    for (let index = 0; index < 52; index++) {
      const stored = game.getGameState(CODE)!;
      const view = game.getPlayerVisibleState(CODE, stored.currentTurnSeat)!;
      expect(game.playCard(CODE, stored.currentTurnSeat, view.validCards[0]).success).toBe(true);
    }
    state.gongzhu = state.visible = game.getPlayerVisibleState(CODE, 'N');
    const view = state.gongzhu!;
    const builder = createRoundBuilder();
    gongZhuClient.roundHistory!.derive(view, builder);
    expect(builder.rounds).toHaveLength(2);
    expect(builder.rounds[0].complete).toBe(true);
    expect(builder.rounds[0].actions.filter((action) => action.kind === 'award')).toHaveLength(13);
    const logStart = view.log.findIndex((entry) => entry.type === 'settle');
    const frames = getPresentationFrames({ ...view, presentation: { id: 'ui', startedAt: 0, logStart, timingVersion: 3 } });
    const html = renderToStaticMarkup(createElement(GongZhuFrame, { frame: frames[0], name: (seat) => seat }));
    expect(html).toContain('Hand 1 / 4');
    expect(html).not.toContain('Hand 2 / 4');
    const history = renderToStaticMarkup(createElement(GongZhuRounds, { rounds: [builder.rounds[0]], mySeat: 'N' }));
    expect(history).toContain('Wins the trick');
    expect(history).toContain('Hand score:');
  });
});
