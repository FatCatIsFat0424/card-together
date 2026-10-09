import { afterEach, describe, expect, it, vi } from 'vitest';
import { SOCKET_RATE_LIMITS } from '../../src/socket/connection';
import { createSocketHarness } from './socket-harness';
import type { SocketHarness, TestClient } from './socket-harness';

let harness: SocketHarness | undefined;

afterEach(async (): Promise<void> => {
  vi.restoreAllMocks();
  await harness?.close();
  harness = undefined;
});

function chat(client: TestClient, message: string): Promise<{ success: boolean; error?: string }> {
  return client.timeout(5_000).emitWithAck('chat:send', { message });
}

describe('socket rate limits', () => {
  it('should share the chat budget across an account\'s tabs and reset it after the window', async () => {
    const app = await (harness = await createSocketHarness(1));
    const firstTab = app.clients[0][0];
    const secondTab = await app.connect(app.cookies[0][0]);
    expect(await secondTab.timeout(5_000).emitWithAck('player:resume')).toMatchObject({ success: true });
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const { limit, windowMs } = SOCKET_RATE_LIMITS.chat;
    for (let index = 0; index < limit; index += 1) {
      expect(await chat(index % 2 === 0 ? firstTab : secondTab, `message ${index}`)).toEqual({ success: true });
    }
    expect(await chat(secondTab, 'one too many'))
      .toEqual({ success: false, error: 'Too many actions. Please slow down.' });
    expect(await chat(firstTab, 'still too many')).toMatchObject({ success: false });
    expect(await firstTab.timeout(5_000).emitWithAck('player:resume')).toMatchObject({ success: true });
    expect(await chat(app.clients[0][1], 'another account')).toEqual({ success: true });
    now += windowMs;
    expect(await chat(firstTab, 'after the window')).toEqual({ success: true });
  });
});
