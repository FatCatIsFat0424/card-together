import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchSummary, PublicAccount } from '@shared/types';

const state = vi.hoisted(() => ({ compact: false }));

vi.mock('../../../client/src/socket', () => ({ socket: {} }));
vi.mock('../../../client/src/api', () => ({ apiRequest: vi.fn() }));
vi.mock('../../../client/src/deployment', () => ({ API_BASE_URL: '', APP_BASE_PATH: '/' }));
vi.mock('@mui/material/useMediaQuery', () => ({ default: () => state.compact }));
vi.mock('../../../client/src/stores/account-store', () => ({
  useAccountStore: (select: (value: { account: { id: string } }) => unknown) => select({ account: { id: 'north' } }),
}));

import { MatchHistoryList } from '../../../client/src/components/MatchHistoryList';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

const participants = ['north', 'east', 'south', 'west'];
const win: MatchSummary = {
  id: 'win', roomCode: 'ROOM10', accountIds: participants, finishedAt: 300, hasReplay: true,
  result: { gameType: 'bridge', contract: { level: 4, suit: 'spades', declarer: 'N' },
    declarerTeamTricks: 10, defenderTeamTricks: 3, requiredTricks: 10, declarerTeamWins: true },
};
const tie: MatchSummary = {
  id: 'tie', roomCode: 'ROOM2', accountIds: participants, finishedAt: 200,
  result: { gameType: 'redpoints', points: { N: 80, E: 80, S: 24, W: 24 }, winners: ['N', 'E'] },
};
const loss: MatchSummary = {
  id: 'loss', roomCode: 'ROOM1', accountIds: participants, finishedAt: 100,
  result: { gameType: 'ninetynine', winnerSeat: 'W', eliminationOrder: ['N', 'E', 'S'], finalTotal: 99 },
};
const players: Record<string, PublicAccount> = Object.fromEntries(participants.map((id) => [id,
  { id, username: id, nickname: id.toUpperCase(), avatar: 'cat', color: '#abcdef', avatarImage: null }]));

function render(matches: MatchSummary[]): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(MatchHistoryList, { matches, players, accountId: 'north' })));
}

describe('match history list', () => {
  beforeEach(() => {
    state.compact = false;
    useI18nStore.getState().setLocale('zh-TW');
  });

  it('turns every match into a one-line row with a result badge on compact screens', () => {
    state.compact = true;
    const html = render([win, tie, loss]);
    expect(html.match(/data-match-row/g)).toHaveLength(3);
    expect(html).not.toContain('<table');
    for (const label of ['勝利', '平手', '落敗']) expect(html).toContain(label);
    expect(html).toContain('ROOM10');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('data-stats-toggle');
    // The statistics dialog stays closed until the toolbar button opens it.
    expect(html).not.toContain('<h3');
  });

  it('keeps the table with players and replay entries on wide screens', () => {
    const html = render([win, loss]);
    expect(html).toContain('<table');
    expect(html).not.toContain('data-match-row');
    expect(html).toContain('href="/players/east"');
    expect(html).toContain('回放');
    expect(html).toContain('此對局未保存過程紀錄');
  });

  it('pages compact rows in steps of eight', () => {
    state.compact = true;
    const many = Array.from({ length: 11 }, (_, index) => ({ ...loss, id: `m${index}`, roomCode: `R${index}`, finishedAt: index }));
    const html = render(many);
    expect(html.match(/data-match-row/g)).toHaveLength(8);
    expect(html).toContain('顯示更多（還有 3 場）');
  });
});
