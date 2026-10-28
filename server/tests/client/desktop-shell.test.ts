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
    for (const label of ['大廳', '好友', '商店', '成就', '戰績', '我']) expect(html).toContain(`>${label}</span>`);
    expect(html).toContain('>訊息</span>');
    expect(link(html, '商店')).toContain('aria-current="page"');
    expect(link(html, '商店')).toContain('href="/shop"');
    for (const other of ['大廳', '好友', '成就', '我']) expect(link(html, other)).not.toContain('aria-current');
    expect(link(html, '我')).toContain('href="/account"');
    expect(link(html, '戰績')).toContain('href="/players/alice"');
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

  it('keeps notifications, music, gold coins and the account menu in the top bar', () => {
    const html = shell('/shop');
    expect(html).toContain('data-popover-trigger="notifications"');
    expect(html).toContain('data-popover-trigger="music"');
    expect(html).toContain('aria-label="0 枚金幣"');
    expect(html).toContain('aria-label="帳號選單"');
    expect(html).toContain('data-popover-trigger="menu"');
    expect(html).not.toContain('role="tablist"');
  });

  it('drops the top bar on table pages and moves its controls to the bottom of the rail', () => {
    const html = shell('/game/ABC123', { tableRoute: true, tableHref: '/game/ABC123' });
    expect(html).not.toContain('<header');
    expect(html).toContain('data-desktop-shell="table"');
    const footer = html.slice(html.indexOf('data-popover="notifications"'));
    expect(footer).toContain('data-popover-trigger="music"');
    expect(footer).toContain('aria-label="帳號選單"');
    // The account menu replaces the bottom "Me" item, and the coins move into that menu.
    expect(link(html, '我')).toBe('');
    expect(html).not.toContain('枚金幣');
  });

  it('leads the rail with the table item while the viewer is in a room or game', () => {
    const atTable = shell('/game/ABC123', { tableRoute: true, tableHref: '/game/ABC123' });
    expect(link(atTable, '牌桌')).toContain('href="/game/ABC123"');
    expect(link(atTable, '牌桌')).toContain('aria-current="page"');
    expect(atTable.indexOf('aria-label="牌桌"')).toBeLessThan(atTable.indexOf('aria-label="大廳"'));
    expect(link(atTable, '大廳')).not.toContain('aria-current');
    const away = shell('/shop', { tableHref: '/room/ABC123' });
    expect(link(away, '牌桌')).toContain('href="/room/ABC123"');
    expect(link(away, '牌桌')).not.toContain('aria-current');
    expect(link(shell('/shop'), '牌桌')).toBe('');
  });

  it('shows the category tabs on the lobby only, for categories that have games', () => {
    const html = shell('/');
    expect(html).toContain('role="tablist"');
    expect(html.match(/role="tab"/g)).toHaveLength(1);
    expect(html).toContain('>撲克牌</button>');
    expect(html).toContain('aria-selected="true"');
    expect(html).not.toContain('骰子');
    expect(shell('/friends')).not.toContain('role="tablist"');
  });
});

describe('page header', () => {
  it('renders the title, tabs and both summary forms in the page outside the desktop top bar', () => {
    const html = renderToStaticMarkup(createElement(PageHeader, {
      title: 'Awards', icon: 'trophy', tabs: createElement('div', { role: 'tablist' }),
      summary: 'Completed 3/23', compactSummary: '3/23',
    }));
    expect(html).toMatch(/^<header[^>]*><h1[^>]*>.*Awards<\/span><\/h1>/);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('>Completed 3/23</span>');
    expect(html).toContain('aria-hidden="true">3/23</span>');
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
    tasks: [{ id: 'play-bridge', progress: 0 }, { id: 'win-two', progress: 1 }, { id: 'play-bigtwo', progress: 2 }],
    ...overrides,
  });
  const render = (value: DailyRewardsStatus | null, error = false): string => renderToStaticMarkup(createElement(DailyPanel, {
    status: value, error, pending: false, onClaim: noop, onOpenTasks: noop, onOpenCheckIn: noop, onRetry: noop,
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
