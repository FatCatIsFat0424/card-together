import { describe, expect, it, vi } from 'vitest';
import {
  installPreloadRecovery,
  PRELOAD_RELOAD_COOLDOWN_MS,
} from '../../../client/src/preload-recovery';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
}

function preloadError(target: EventTarget): Event {
  const event = new Event('vite:preloadError', { cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe('preload recovery', () => {
  it('should reload once per cooldown and leave repeated failures to the error boundary', () => {
    const target = new EventTarget();
    const reload = vi.fn();
    const clock = { value: 1_000 };
    const storage = memoryStorage();
    const remove = installPreloadRecovery({ target, storage, reload, now: () => clock.value });
    expect(preloadError(target).defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
    clock.value += PRELOAD_RELOAD_COOLDOWN_MS - 1;
    expect(preloadError(target).defaultPrevented).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
    clock.value += 1;
    expect(preloadError(target).defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
    remove();
    clock.value += PRELOAD_RELOAD_COOLDOWN_MS;
    preloadError(target);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('should not reload when the loop guard cannot be stored', () => {
    const target = new EventTarget();
    const reload = vi.fn();
    installPreloadRecovery({ target, storage: null, reload });
    installPreloadRecovery({
      target,
      storage: { getItem: () => null, setItem: () => { throw new Error('Quota exceeded'); } },
      reload,
    });
    expect(preloadError(target).defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
