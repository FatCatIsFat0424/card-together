import { useCallback, useState } from 'react';

/**
 * Value whose exit animation should run after `previous` changes to `next`.
 * Only one value exits at a time; reopening the exiting value cancels its exit.
 */
export function nextExiting<T>(previous: T | null, next: T | null, exiting: T | null): T | null {
  if (previous !== null && previous !== next) return previous;
  return exiting === next ? null : exiting;
}

export interface ExitPresence<T> {
  /** Value that is closed but still rendered until its exit animation ends. */
  readonly exiting: T | null;
  /** Call from the exiting element's `animationend` to unmount it. */
  readonly finishExit: (value: T) => void;
}

/** Keeps the previously open value rendered while it animates out. */
export function useExitPresence<T extends string>(value: T | null): ExitPresence<T> {
  const [previous, setPrevious] = useState(value);
  const [exiting, setExiting] = useState<T | null>(null);
  let current = exiting;
  // Adjust during render so the closing panel never disappears for a frame.
  if (previous !== value) {
    current = nextExiting(previous, value, exiting);
    setPrevious(value);
    setExiting(current);
  }
  const finishExit = useCallback((done: T): void => {
    setExiting((active) => active === done ? null : active);
  }, []);
  return { exiting: current, finishExit };
}
