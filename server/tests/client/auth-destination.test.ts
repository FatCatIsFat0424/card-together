import { describe, expect, it } from 'vitest';
import { authDestination } from '../../../client/src/auth-destination';

describe('authentication return destinations', () => {
  it.each(['/room/ABC234', '/room/abc234', '/room/ABC234/replay', '/game/ABC234', '/account', '/messages/player'])('preserves the internal destination %s through login and registration', (from) => {
    expect(authDestination({ from })).toBe(from);
  });

  it.each([
    null, {}, { from: 123 }, { from: 'https://outside.example/room/ABC234' }, { from: '//outside.example' },
    { from: '/\\outside.example' }, { from: '/%5coutside.example' }, { from: '/%2foutside.example' },
    { from: '/\noutside.example' }, { from: '/%0aoutside.example' }, { from: '/room/../account' },
    { from: '/room/%2e%2e/account' }, { from: '/room/%invalid' }, { from: '/login' }, { from: '/register' },
  ])('falls back to the lobby for unsafe or invalid state: %j', (state) => {
    expect(authDestination(state)).toBe('/');
  });
});
