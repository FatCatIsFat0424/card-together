import { describe, expect, it } from 'vitest';
import { parsePreviewArgs, previewLayout, storageState } from '../../../scripts/dev/preview';

describe('dev preview script', () => {
  it('parses commands with slot, host and reset options', () => {
    expect(parsePreviewArgs(['start'])).toEqual({ command: 'start', slot: 0, host: '127.0.0.1', reset: false });
    expect(parsePreviewArgs(['start', '--slot', '7', '--host', '100.68.111.111', '--reset']))
      .toEqual({ command: 'start', slot: 7, host: '100.68.111.111', reset: true });
  });

  it.each([[[]], [['restart']], [['start', '--slot', '50']], [['start', '--slot']], [['start', '--host', 'evil.example']],
    [['stop', '--wat', '1']]])('rejects %j', (args) => {
    expect(() => parsePreviewArgs(args)).toThrow();
  });

  it('keeps slots on separate ports and state directories', () => {
    expect(previewLayout({ slot: 3, host: '127.0.0.1' }, '/tmp')).toEqual({
      clientPort: 6203, serverPort: 4203, clientOrigin: 'http://127.0.0.1:6203', stateDir: '/tmp/card-together-preview-3',
    });
  });

  it('turns a session cookie into a Playwright storage state for the preview host', () => {
    const state = storageState('card_together_session=abc.def; Path=/; Expires=Thu, 01 Jan 2032 00:00:00 GMT; HttpOnly; SameSite=Lax',
      '127.0.0.1');
    expect(state).toEqual({
      cookies: [{ name: 'card_together_session', value: 'abc.def', domain: '127.0.0.1', path: '/', expires: 1956528000,
        httpOnly: true, secure: false, sameSite: 'Lax' }],
      origins: [],
    });
  });
});
