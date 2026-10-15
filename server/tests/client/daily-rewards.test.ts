import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { DailyRewardsStatus } from '@shared/types';
vi.mock('../../../client/src/api', () => ({ apiRequest: vi.fn() }));
vi.mock('../../../client/src/socket', () => ({ socket: {} }));
import { CheckInCalendar, DailyTaskList, needsAutoCheckIn } from '../../../client/src/components/DailyRewards';
import { DAILY_TASKS } from '@shared/constants/daily-rewards';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

function render(day: string, checkInDays: readonly string[] = [], pending = false, celebrate = false): string {
  const status: DailyRewardsStatus = { day, serverTime: 0, resetsAt: 1, gameTypes: [], wins: 0, claimedTasks: [], checkInDays, tasks: [], swapsRemaining: 1 };
  return renderToStaticMarkup(createElement(CheckInCalendar, { status, pending, onCheckIn: () => undefined, celebrate }));
}

describe('check-in calendar', () => {
  it.each(['en', 'zh-TW'] as const)('marks today and enables only its date in %s', (locale) => {
    useI18nStore.getState().setLocale(locale);
    const html = render('2026-10-15', ['2026-10-14']);
    const buttons = html.match(/<button[^>]*>/g)!;
    expect(buttons).toHaveLength(31);
    expect(buttons.filter((button) => !button.includes('disabled'))).toHaveLength(1);
    expect(buttons.find((button) => !button.includes('disabled'))).toContain('aria-current="date"');
    expect(html).toContain('2026-10-15');
    expect(html).not.toContain('daily.');
  });
  it('disables today during a claim and after check-in', () => {
    for (const html of [render('2026-10-15', [], true), render('2026-10-15', ['2026-10-15'])]) {
      expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(31);
      expect(html).toContain('aria-current="date"');
    }
  });
  it('animates only today after a claim in this session', () => {
    const burst = /<span class="[^"]*coinBurst[^"]*" aria-hidden="true">/g;
    expect(render('2026-10-15', ['2026-10-14', '2026-10-15'], false, true).match(burst)).toHaveLength(1);
    expect(render('2026-10-15', ['2026-10-14', '2026-10-15'])).not.toMatch(burst);
    expect(render('2026-10-15', ['2026-10-14'], false, true)).not.toMatch(burst);
  });
  it.each([['2028-02-29', 29], ['2026-02-28', 28], ['2026-04-01', 30]] as const)('renders the exact month length for %s', (day, count) => {
    expect(render(day).match(/<button/g)).toHaveLength(count);
  });
});

describe('automatic check-in', () => {
  const status = (checkInDays: readonly string[]): DailyRewardsStatus => ({ day: '2026-10-15', serverTime: 0, resetsAt: 1,
    gameTypes: [], wins: 0, claimedTasks: [], checkInDays, tasks: [], swapsRemaining: 1 });
  it('claims only the first time an unchecked day loads', () => {
    expect(needsAutoCheckIn(status([]), '')).toBe(true);
    expect(needsAutoCheckIn(status([]), '2026-10-14')).toBe(true);
    expect(needsAutoCheckIn(status([]), '2026-10-15')).toBe(false);
    expect(needsAutoCheckIn(status(['2026-10-15']), '')).toBe(false);
  });
});

describe('daily task pool presentation', () => {
  const status: DailyRewardsStatus = { day: '2026-10-15', serverTime: 0, resetsAt: 1, gameTypes: [], wins: 0,
    claimedTasks: ['play-bridge'], checkInDays: [], swapsRemaining: 1,
    tasks: [{ id: 'play-bridge', progress: 1 }, { id: 'play-bigtwo', progress: 1 }, { id: 'play-casino', progress: 1 }] };
  const renderTasks = (value: DailyRewardsStatus): string => renderToStaticMarkup(createElement(DailyTaskList, {
    status: value, pending: false, onClaim: () => undefined, onReplace: () => undefined,
  }));
  it('shows only assigned tasks, their rewards and progress, with eligible controls', () => {
    useI18nStore.getState().setLocale('en');
    const html = renderTasks(status);
    expect(html.match(/<li /g)).toHaveLength(3);
    expect(html).toContain('1/2');
    expect(html).toContain('+20 coins');
    expect(html).not.toContain('Win two games');
    const buttons = html.match(/<button[^>]*>/g)!;
    expect(buttons.filter((button) => button.includes('Replace:'))).toHaveLength(2);
    expect(buttons.filter((button) => button.includes('disabled'))).toHaveLength(1);
    expect((renderTasks({ ...status, swapsRemaining: 0 }).match(/<button[^>]*disabled/g) ?? [])).toHaveLength(3);
  });
  it.each(['en', 'zh-TW'] as const)('translates every pool task in %s', (locale) => {
    useI18nStore.getState().setLocale(locale);
    const html = renderTasks({ ...status, claimedTasks: [], tasks: DAILY_TASKS.map((task) => ({ id: task.id, progress: 0 })) });
    expect(html).not.toContain('daily.');
    expect(html.match(/<li /g)).toHaveLength(10);
  });
});
