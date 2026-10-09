const RELOAD_KEY = 'card-together.preloadReloadAt';
export const PRELOAD_RELOAD_COOLDOWN_MS = 30_000;

interface EventSource {
  addEventListener: (type: string, listener: (event: Event) => void) => void;
  removeEventListener: (type: string, listener: (event: Event) => void) => void;
}

export interface PreloadRecoveryOptions {
  readonly target: EventSource;
  /** Without storage a reload loop cannot be ruled out, so recovery is skipped. */
  readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  readonly reload: () => void;
  readonly now?: () => number;
}

/**
 * Reloads once when a deployment removed a lazily loaded chunk this page still references.
 * A second failure within the cooldown is left to the error boundary instead of looping.
 */
export function installPreloadRecovery(options: PreloadRecoveryOptions): () => void {
  const now = options.now ?? Date.now;
  const handle = (event: Event): void => {
    const { storage } = options;
    if (!storage) return;
    const current = now();
    try {
      const previous = Number(storage.getItem(RELOAD_KEY));
      if (previous > 0 && current >= previous && current - previous < PRELOAD_RELOAD_COOLDOWN_MS) return;
      storage.setItem(RELOAD_KEY, String(current));
    } catch {
      return;
    }
    event.preventDefault();
    options.reload();
  };
  options.target.addEventListener('vite:preloadError', handle);
  return () => options.target.removeEventListener('vite:preloadError', handle);
}
