import { afterEach, describe, expect, it, vi } from 'vitest';
import * as chat from '../../src/managers/chat-manager';
import { createRuntimeCoordinator } from '../../src/runtime/coordinator';
import type { RuntimeSnapshot } from '../../src/runtime/types';

describe('runtime coordinator notifications', () => {
  afterEach(() => vi.restoreAllMocks());

  it('should resolve a committed mutation even when post-commit notifiers throw', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const saveRuntime = vi.fn(async (_state: RuntimeSnapshot): Promise<void> => {});
    const runtime = await createRuntimeCoordinator({ loadRuntime: async () => null, saveRuntime });
    const listener = vi.fn(() => { throw new Error('listener failed'); });
    const later = vi.fn();
    runtime.subscribe(listener);
    runtime.subscribe(later);
    await expect(runtime.mutate(() => {
      chat.initRoomChat('NOTIFY');
      return 'committed';
    }, { afterCommit: () => { throw new Error('broadcast failed'); } })).resolves.toBe('committed');
    expect(saveRuntime).toHaveBeenCalledTimes(1);
    expect(chat.exportChat()).toContainEqual({ roomCode: 'NOTIFY', messages: [] });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(later).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(2);
    await expect(runtime.mutate(() => 'next')).resolves.toBe('next');
    chat.clearRoomChat('NOTIFY');
  });
});
