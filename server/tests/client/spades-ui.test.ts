import { createElement } from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpadesVisibleState } from '@shared/games/spades/types';
import { newSpadesHand, scoreSpadesHand, spadesSeatMap } from '@shared/rules/spades';

const state = vi.hoisted(() => ({ spades: null as SpadesVisibleState | null, locked: false, connected: true }));
vi.mock('../../../client/src/socket', () => ({ socket: {} }));
vi.mock('../../../client/src/deployment', () => ({ APP_BASE_PATH: '/', SERVER_URL: '', SOCKET_PATH: '/socket.io' }));
vi.mock('../../../client/src/stores/game-store', () => ({
  useGameStore: (select: (value: { spades: SpadesVisibleState | null }) => unknown) => select(state),
}));
vi.mock('../../../client/src/games/use-table-perspective', () => ({
  useViewedGame: (game: SpadesVisibleState | null) => game, useTablePerspective: () => 'N',
}));
vi.mock('../../../client/src/games/use-game-presentation', () => ({ useGamePresentation: () => ({ locked: state.locked }) }));
vi.mock('../../../client/src/games/use-connection-ready', () => ({ useConnectionReady: () => state.connected }));
vi.mock('../../../client/src/games/seat-names', () => ({ useSeatName: () => (seat: string) => `Player ${seat}` }));
vi.mock('../../../client/src/games/GameShell', () => ({
  GameShell: ({ info, centre, panel, hand, overlay, prompt }: { info: ReactNode; centre: ReactNode; panel?: ReactNode; hand: ReactNode; overlay?: ReactNode; prompt?: string }) =>
    createElement('main', null, info, centre, panel && createElement('section', { 'data-action-panel': true }, panel), hand, overlay, prompt),
}));
vi.mock('../../../client/src/components/CardHand', () => ({
  CardHand: ({ cards, playableCards, disabled }: { cards: readonly unknown[]; playableCards: readonly unknown[]; disabled: boolean }) =>
    createElement('div', { 'data-cards': cards.length, 'data-legal': playableCards.length, 'data-disabled': disabled }),
}));
vi.mock('../../../client/src/games/ResultDialog', () => ({
  resultStyles: { table: '', winnerRow: '', note: '' },
  ResultDialog: ({ title, children }: { title: ReactNode; children: ReactNode }) => createElement('dialog', { open: true }, title, children),
}));
import { SpadesTable } from '../../../client/src/games/spades/SpadesTable';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

function game(): SpadesVisibleState {
  return { gameType: 'spades', phase: 'bidding', mySeat: 'N', myHand: [{ suit: 'clubs', rank: 14 }],
    handCounts: spadesSeatMap(() => 13), position: newSpadesHand('W'), currentTurnSeat: 'N', dealerSeat: 'W',
    validCards: [], scores: { NS: 0, EW: 0 }, bags: { NS: 0, EW: 0 }, handResults: [], log: [], result: null };
}
function render(): string { return renderToStaticMarkup(createElement(SpadesTable)); }
beforeEach(() => { state.spades = game(); state.connected = true; state.locked = false; useI18nStore.setState({ locale: 'en' }); });
afterEach(() => { state.spades = null; });
describe('Spades table', () => {
  it('offers all fourteen bid choices and requires confirmation before sending', () => {
    const html = render();
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(14);
    expect(html).toContain('data-action-panel="true"');
    expect(html).toContain('Nil (0)');
    expect(html).toMatch(/disabled=""[^>]*>Confirm bid/);
    expect(html).toContain('Spades not broken');
    expect(html).toContain('data-disabled="true"');
  });
  it('disables bidding for observers, inactive seats, presentation locks and disconnected clients', () => {
    for (const change of [() => { state.spades = { ...game(), observer: 'spectator' }; },
      () => { state.spades = { ...game(), currentTurnSeat: 'E' }; },
      () => { state.locked = true; }, () => { state.connected = false; }]) {
      state.spades = game(); state.locked = false; state.connected = true;
      change();
      expect(render().match(/disabled=""/g)).toHaveLength(15);
    }
  });
  it('shows legal plays, nil progress, scores, bags and per-hand scoring components', () => {
    const hand = scoreSpadesHand({ N: 0, S: 4, E: 3, W: 3 }, { N: 2, S: 3, E: 4, W: 4 }, { NS: 0, EW: 0 });
    const current = game();
    state.spades = { ...current, phase: 'playing', position: { ...current.position, phase: 'playing', broken: true,
      bids: hand.bids, taken: hand.taken }, validCards: current.myHand,
      scores: { NS: -138, EW: 62 }, bags: { NS: 2, EW: 2 }, handResults: [hand] };
    const html = render();
    expect(html).toContain('Spades broken');
    expect(html).toContain('data-legal="1" data-disabled="false"');
    expect(html).toContain('Nil (0) / 2');
    expect(html).toContain('3/4 (-40)');
    expect(html).toContain('>-138<');
    expect(html).toContain('Bag penalty');
    useI18nStore.setState({ locale: 'zh-TW' });
    expect(render()).toContain('逐手計分');
    expect(render()).toContain('黑桃已解禁');
  });
  it('shows the winning partnership and complete score breakdown at settlement', () => {
    const hand = scoreSpadesHand({ N: 0, S: 4, E: 3, W: 3 }, { N: 0, S: 5, E: 4, W: 4 }, { NS: 0, EW: 0 });
    state.spades = { ...game(), phase: 'scoring', currentTurnSeat: null, result: { gameType: 'spades',
      scores: { NS: 541, EW: 462 }, bags: { NS: 1, EW: 2 }, hands: [hand], winners: ['N', 'S'] } };
    const html = render();
    expect(html).toContain('NS wins');
    expect(html).toContain('NS 541 · EW 462');
    expect(html).toContain('5/4 (40)');
    useI18nStore.setState({ locale: 'zh-TW' });
    expect(render()).toContain('南北 獲勝');
    expect(render()).toContain('南北 541 · 東西 462');
  });
});
