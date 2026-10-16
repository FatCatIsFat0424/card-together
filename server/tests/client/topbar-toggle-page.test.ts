import { describe, expect, it } from 'vitest';
import { nextReturnLocation, togglePageHref, togglePageOf } from '../../../client/src/components/topbar-toggle-page';
import { nextExiting } from '../../../client/src/hooks/use-exit-presence';
import { sameIndicatorFrame } from '../../../client/src/hooks/use-active-indicator';

describe('topbar toggle pages', () => {
  it.each([
    ['/messages', 'messages'],
    ['/messages/bob', 'messages'],
    ['/achievements', 'achievements'],
    ['/', null],
    ['/shop', null],
    ['/messagesx', null],
    ['/players/alice', null],
  ] as const)('classifies %s', (pathname, page) => {
    expect(togglePageOf(pathname)).toBe(page);
  });

  it('remembers the last location outside toggle pages, including its query', () => {
    let returnTo = nextReturnLocation('/', '/shop', '?tab=borders');
    expect(returnTo).toBe('/shop?tab=borders');
    returnTo = nextReturnLocation(returnTo, '/messages', '');
    returnTo = nextReturnLocation(returnTo, '/messages/bob', '');
    returnTo = nextReturnLocation(returnTo, '/achievements', '');
    expect(returnTo).toBe('/shop?tab=borders');
    expect(nextReturnLocation(returnTo, '/friends', '')).toBe('/friends');
  });

  it('links the open page back to the remembered location and others forward', () => {
    expect(togglePageHref('messages', null, '/shop')).toBe('/messages');
    expect(togglePageHref('messages', 'messages', '/shop')).toBe('/shop');
    expect(togglePageHref('achievements', 'messages', '/shop')).toBe('/achievements');
    expect(togglePageHref('achievements', 'achievements', '/game/ABC123')).toBe('/game/ABC123');
  });
});

describe('popover exit presence', () => {
  it('keeps a closed popover exiting until it reopens or another closes', () => {
    expect(nextExiting(null, 'menu', null)).toBeNull();
    expect(nextExiting('menu', null, null)).toBe('menu');
    expect(nextExiting('menu', 'music', null)).toBe('menu');
    expect(nextExiting(null, 'menu', 'menu')).toBeNull();
    expect(nextExiting(null, 'music', 'menu')).toBe('menu');
    expect(nextExiting('music', null, 'menu')).toBe('music');
  });
});

describe('active indicator frames', () => {
  it('compares measured frames by value', () => {
    const frame = { x: 4, y: 2, width: 40, height: 24 };
    expect(sameIndicatorFrame(frame, { ...frame })).toBe(true);
    expect(sameIndicatorFrame(frame, { ...frame, x: 5 })).toBe(false);
    expect(sameIndicatorFrame(null, frame)).toBe(false);
    expect(sameIndicatorFrame(null, null)).toBe(true);
  });
});
