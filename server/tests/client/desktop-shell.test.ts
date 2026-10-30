import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../client/src/socket', () => ({ socket: {} }));
vi.mock('../../../client/src/api', () => ({ apiRequest: vi.fn() }));
vi.mock('../../../client/src/media', () => ({ mediaUrl: (id: string) => `/api/media/${id}` }));
vi.mock('../../../client/src/components/MusicControl', () => ({ MusicControl: () => null }));

import { DesktopShell } from '../../../client/src/components/DesktopShell';
import type { DesktopShellProps } from '../../../client/src/components/DesktopShell';
import { DailyPanel, taskPercent } from '../../../client/src/components/DailyPanel';
import { Dock } from '../../../client/src/components/Dock';
import { PageHeader } from '../../../client/src/components/PageHeader';
import { useAccountStore } from '../../../client/src/stores/account-store';
import { useI18nStore } from '../../../client/src/stores/i18n-store';
import { useShellStore } from '../../../client/src/stores/shell-store';
import { useSocialStore } from '../../../client/src/stores/social-store';
import type { DailyRewardsStatus } from '@shared/types';

const noop = (): void => undefined;

function shell(pathname: string, overrides: Partial<DesktopShellProps> = {}): string {
  const props: DesktopShellProps = {
    pathname, accountId: 'alice', returnTo: '/friends', onlineFriends: 0,
    popovers: {
      open: null, toggle: noop, close: noop, shown: () => false,
      panelProps: (popover, className) => ({ className, 'data-popover-panel': popover, onAnimationEnd: noop }),
    },
    signOut: { request: noop, run: noop, busy: false, error: '', confirm: false },
    ...overrides,
  };
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [pathname] }, createElement(DesktopShell, props)));
}

function link(html: string, label: string): string {
  return html.match(new RegExp(`<a[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? '';
}

describe('desktop shell', () => {
  beforeEach(() => {
    useI18nStore.getState().setLocale('zh-TW');
    useSocialStore.getState().reset();
    useShellStore.setState({ lobbyCategory: null });
    useAccountStore.setState({ account: null });
  });

  it('shows every destination with a 12px label and highlights the current page', () => {
    const html = shell('/shop');
    for (const label of ['大廳', '好友', '商店', '成就', '戰績']) expect(html).toContain(`>${label}</span>`);
    expect(html).toContain('>訊息</span>');
    expect(link(html, '商店')).toContain('aria-current="page"');
    expect(link(html, '商店')).toContain('href="/shop"');
    for (const other of ['大廳', '好友', '成就']) expect(link(html, other)).not.toContain('aria-current');
    expect(link(html, '戰績')).toContain('href="/players/alice#match-history"');
  });

  it('turns the messages and achievements items into links back out while open', () => {
    expect(link(shell('/messages'), '私人訊息')).toContain('href="/friends"');
    expect(link(shell('/messages'), '私人訊息')).toContain('aria-current="page"');
    expect(link(shell('/achievements'), '成就')).toContain('href="/friends"');
    expect(link(shell('/shop'), '私人訊息')).toContain('href="/messages"');
  });

  it('marks online friends on the rail and keeps the count in the accessible name', () => {
    expect(link(shell('/'), '好友')).toBeTruthy();
    const html = shell('/', { onlineFriends: 2 });
    expect(link(html, '好友，2 位在線上')).toContain('href="/friends"');
    expect(html).toContain('aria-hidden="true"></span>');
  });

  it('has no top bar: coins, notifications, music and the account menu sit under the rail divider', () => {
    for (const path of ['/', '/shop', '/game/ABC123']) {
      const html = shell(path);
      expect(html).not.toContain('<header');
      expect(html).toContain('data-desktop-shell');
      expect(html).not.toContain('role="tablist"');
      const footer = html.slice(html.indexOf('data-popover="notifications"'));
      expect(footer).toContain('data-popover-trigger="music"');
      expect(footer).toContain('data-popover-trigger="menu"');
      expect(footer).toContain('aria-label="個人選單"');
      expect(html.indexOf('aria-label="0 枚金幣"')).toBeLessThan(html.indexOf('data-popover="notifications"'));
      // The avatar replaces the old "Me" item.
      expect(link(html, '我')).toBe('');
    }
  });

  it('marks the avatar button on the account page only', () => {
    expect(shell('/account')).toContain('data-current="true"');
    expect(shell('/shop')).not.toContain('data-current');
  });

  it('leads the rail with the table item while the viewer is in a room or game', () => {
    const atTable = shell('/game/ABC123', { tableHref: '/game/ABC123' });
    expect(link(atTable, '牌桌')).toContain('href="/game/ABC123"');
    expect(link(atTable, '牌桌')).toContain('aria-current="page"');
    expect(atTable.indexOf('aria-label="牌桌"')).toBeLessThan(atTable.indexOf('aria-label="大廳"'));
    expect(link(atTable, '大廳')).not.toContain('aria-current');
    const away = shell('/shop', { tableHref: '/room/ABC123' });
    expect(link(away, '牌桌')).toContain('href="/room/ABC123"');
    expect(link(away, '牌桌')).not.toContain('aria-current');
    expect(link(shell('/shop'), '牌桌')).toBe('');
  });
});

describe('page header', () => {
  it('renders the title, tabs, both summary forms and the actions as one row in the page', () => {
    const html = renderToStaticMarkup(createElement(PageHeader, {
      title: 'Awards', icon: 'trophy', tabs: createElement('div', { role: 'tablist' }),
      summary: 'Completed 3/23', compactSummary: '3/23', actions: createElement('button', null, 'Refresh'),
    }));
    expect(html).toMatch(/^<header[^>]*><h1[^>]*>.*Awards<\/span><\/h1>/);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('>Completed 3/23</span>');
    expect(html).toContain('aria-hidden="true">3/23</span>');
    expect(html).toContain('<button>Refresh</button>');
  });

  it('keeps a hidden title as a heading for screen readers', () => {
    const html = renderToStaticMarkup(createElement(PageHeader, { title: 'Lobby', titleHidden: true }));
    expect(html).toMatch(/<h1 class="[^"]*hidden[^"]*">/);
    expect(html).toContain('>Lobby</span>');
  });
});

describe('dock', () => {
  it('keeps every panel mounted and shows only the selected one', () => {
    const html = renderToStaticMarkup(createElement(Dock, {
      id: 'test-dock', label: 'Dock', value: 'b', onChange: noop, onCollapse: noop,
      tabs: [{ id: 'a', label: 'First', panel: 'panel-a' }, { id: 'b', label: 'Second', panel: 'panel-b' }],
    }));
    expect(html).toContain('id="test-dock-tab-b"');
    expect(html.match(/role="tab"/g)).toHaveLength(2);
    expect(html).toMatch(/aria-selected="true"[^>]*>Second/);
    expect(html).toMatch(/aria-labelledby="test-dock-tab-b"/);
    expect(html).toMatch(/<div class="[^"]*" hidden="">panel-a<\/div>/);
    expect(html).toMatch(/<div class="[^"]*">panel-b<\/div>/);
  });
});

describe('daily panel', () => {
  const status = (overrides: Partial<DailyRewardsStatus> = {}): DailyRewardsStatus => ({
    day: '2026-10-15', serverTime: 0, resetsAt: 1, gameTypes: [], wins: 0, claimedTasks: [],
    checkInDays: [], swapsRemaining: 1,
    tasks: [{ id: 'play-any-3', progress: 0, replaceable: true }, { id: 'win-two', progress: 1, replaceable: false },
      { id: 'play-bigtwo', progress: 2, replaceable: false, favorite: true }],
    ...overrides,
  });
  const render = (value: DailyRewardsStatus | null, error = false): string => renderToStaticMarkup(createElement(DailyPanel, {
    status: value, error, pending: false, onClaim: noop, onReplace: noop, onOpenTasks: noop, onOpenCheckIn: noop, onRetry: noop,
  }));

  beforeEach(() => { useI18nStore.getState().setLocale('zh-TW'); });

  it('clamps task progress to a percentage', () => {
    expect([taskPercent(0, 2), taskPercent(1, 2), taskPercent(5, 2), taskPercent(-1, 2), taskPercent(1, 0)]).toEqual([0, 50, 100, 0, 0]);
  });

  it('shows a progress bar per task and claims only finished ones', () => {
    const html = render(status());
    expect(html.match(/role="progressbar"/g)).toHaveLength(3);
    expect(html).toContain('aria-valuenow="1"');
    expect(html.match(/aria-label="領取[^"]*"|aria-label="[^"]*領取[^"]*"/g)).toHaveLength(1);
    expect(html).toContain('width:100%');
  });

  it('offers swaps only on unfinished tasks, enabled while unstarted, with the daily allowance', () => {
    const html = render(status());
    const swaps = html.match(/<button[^>]*aria-label="換一個：[^"]*"[^>]*>/g)!;
    expect(swaps).toHaveLength(2);
    expect(swaps.map((button) => button.includes('disabled'))).toEqual([false, true]);
    expect(html).toContain('今日剩 1 次');
    expect(html).toContain('你常玩');
    expect(render(status({ swapsRemaining: 0 }))).not.toContain('aria-label="換一個：');
  });

  it('offers the check-in with its reward until the day is claimed', () => {
    const checkIn = (value: DailyRewardsStatus): string => render(value).match(/<button[^>]*aria-haspopup="dialog"[^>]*>(?:(?!<\/button>)[\s\S])*每日簽到[\s\S]*?<\/button>/)?.[0] ?? '';
    expect(checkIn(status())).toContain('+10 金幣');
    const done = checkIn(status({ checkInDays: ['2026-10-15'] }));
    expect(done).toContain('已簽到');
    expect(done).not.toContain('+10 金幣');
  });

  it('shows loading and error states without task rows', () => {
    expect(render(null)).toContain('role="status"');
    expect(render(null, true)).toContain('role="alert"');
    expect(render(null)).not.toContain('progressbar');
  });
});
