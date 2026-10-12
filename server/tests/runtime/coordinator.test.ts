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

  it('serializes asynchronous mutations, durable saves and inspections', async () => {
    let releaseOperation!: () => void;
    let releaseSave!: () => void;
    const operationGate = new Promise<void>((resolve) => { releaseOperation = resolve; });
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
    let signalSave!: () => void;
    const saveStarted = new Promise<void>((resolve) => { signalSave = resolve; });
    const saveRuntime = vi.fn(async () => { signalSave(); await saveGate; });
    const runtime = await createRuntimeCoordinator({ loadRuntime: async () => null, saveRuntime });
    const notified = vi.fn();
    runtime.subscribe(notified);
    const inspected = vi.fn(() => chat.exportChat());
    const later = vi.fn();
    const first = runtime.mutate(async () => {
      chat.initRoomChat('ORDER');
      await operationGate;
      return 'first';
    }, { afterCommit: notified });
    const read = runtime.inspect(inspected);
    const second = runtime.mutate(later);
    await Promise.resolve();
    expect(saveRuntime).not.toHaveBeenCalled();
    expect(inspected).not.toHaveBeenCalled();
    expect(later).not.toHaveBeenCalled();
    releaseOperation();
    await saveStarted;
    expect(saveRuntime).toHaveBeenCalledTimes(1);
    expect(notified).not.toHaveBeenCalled();
    expect(inspected).not.toHaveBeenCalled();
    expect(later).not.toHaveBeenCalled();
    releaseSave();
    await expect(first).resolves.toBe('first');
    await expect(read).resolves.toContainEqual({ roomCode: 'ORDER', messages: [] });
    await second;
    expect(inspected).toHaveBeenCalledTimes(1);
    expect(later).toHaveBeenCalledTimes(1);
    expect(notified).toHaveBeenCalledTimes(3);
  });

  it('rolls back a failed save before queued reads and recovers after rejected operations', async () => {
    let rejectSave!: (error: Error) => void;
    const saveGate = new Promise<void>((_resolve, reject) => { rejectSave = reject; });
    let signalSave!: () => void;
    const saveStarted = new Promise<void>((resolve) => { signalSave = resolve; });
    const saveRuntime = vi.fn().mockImplementationOnce(() => { signalSave(); return saveGate; }).mockResolvedValue(undefined);
    const runtime = await createRuntimeCoordinator({ loadRuntime: async () => null, saveRuntime });
    const notified = vi.fn();
    runtime.subscribe(notified);
    const failed = runtime.mutate(() => chat.initRoomChat('ROLLBACK'), { afterCommit: notified });
    const failure = expect(failed).rejects.toThrow('disk failure');
    const inspected = vi.fn(() => chat.exportChat());
    const read = runtime.inspect(inspected);
    await saveStarted;
    expect(saveRuntime).toHaveBeenCalledTimes(1);
    expect(inspected).not.toHaveBeenCalled();
    rejectSave(new Error('disk failure'));
    await failure;
    await expect(read).resolves.toEqual([]);
    expect(notified).not.toHaveBeenCalled();
    await expect(runtime.inspect(() => { throw new Error('read failure'); })).rejects.toThrow('read failure');
    await expect(runtime.mutate(() => { chat.initRoomChat('RECOVER'); return 'recovered'; })).resolves.toBe('recovered');
    expect(saveRuntime).toHaveBeenCalledTimes(2);
    expect(notified).toHaveBeenCalledTimes(1);
    expect(chat.exportChat()).toEqual([{ roomCode: 'RECOVER', messages: [] }]);
    await expect(runtime.mutate(() => { chat.initRoomChat('FAILED'); throw new Error('operation failed'); }))
      .rejects.toThrow('operation failed');
    await expect(runtime.inspect(() => chat.exportChat())).resolves.toEqual([{ roomCode: 'RECOVER', messages: [] }]);
    await expect(runtime.mutate(() => 'after failure')).resolves.toBe('after failure');
  });
});
