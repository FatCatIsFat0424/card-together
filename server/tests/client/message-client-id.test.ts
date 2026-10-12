import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMessageClientId } from '../../../client/src/messages/message-client-id';

afterEach(() => vi.unstubAllGlobals());

describe('direct message client IDs', () => {
  it('works on HTTP origins where randomUUID is unavailable', () => {
    let seed = 0;
    const getRandomValues = vi.fn((bytes: Uint8Array): Uint8Array => {
      bytes.forEach((_value, index) => { bytes[index] = (seed + index) % 256; });
      seed += 1;
      return bytes;
    });
    vi.stubGlobal('crypto', { getRandomValues });
    const first = createMessageClientId();
    const second = createMessageClientId();
    expect(first).toMatch(/^[a-f0-9]{32}$/);
    expect(second).toMatch(/^[a-f0-9]{32}$/);
    expect(second).not.toBe(first);
    expect(getRandomValues).toHaveBeenCalledTimes(2);
    expect(getRandomValues.mock.calls[0][0]).toHaveLength(16);
  });
});
