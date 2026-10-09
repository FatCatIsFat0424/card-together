import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Server rendering reads a store's initial snapshot, so the selector is mocked instead.
const account = vi.hoisted(() => ({ connection: 'connecting' as 'connecting' | 'ready' | 'error' }));

vi.mock('../../../client/src/socket', () => ({ reconnectSocket: vi.fn() }));
vi.mock('../../../client/src/stores/account-store', () => ({
  useAccountStore: (select: (value: typeof account) => unknown) => select(account),
}));

import { ConnectionBanner } from '../../../client/src/components/ConnectionBanner';
import { ErrorBoundary } from '../../../client/src/components/ErrorBoundary';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

afterEach(() => {
  account.connection = 'connecting';
  useI18nStore.setState({ locale: 'zh-TW' });
});

describe('connection recovery UI', () => {
  it('should show a reconnecting notice and a retry action only after failure', () => {
    useI18nStore.setState({ locale: 'en' });
    account.connection = 'ready';
    expect(renderToStaticMarkup(createElement(ConnectionBanner))).toBe('');
    account.connection = 'connecting';
    const connecting = renderToStaticMarkup(createElement(ConnectionBanner));
    expect(connecting).toContain('role="status"');
    expect(connecting).toContain('Reconnecting');
    expect(connecting).not.toContain('<button');
    account.connection = 'error';
    const failed = renderToStaticMarkup(createElement(ConnectionBanner));
    expect(failed).toContain('Retrying automatically');
    expect(failed).toContain('Try again</button>');
  });

  it('should render children until a failure and then offer a reload', () => {
    useI18nStore.setState({ locale: 'en' });
    expect(renderToStaticMarkup(createElement(ErrorBoundary, null, 'page'))).toBe('page');
    const boundary = new ErrorBoundary({ children: 'page', resetKey: '/' });
    boundary.state = ErrorBoundary.getDerivedStateFromError();
    const fallback = renderToStaticMarkup(createElement(() => boundary.render()));
    expect(fallback).toContain('role="alert"');
    expect(fallback).toContain('Reload</button>');
  });
});
