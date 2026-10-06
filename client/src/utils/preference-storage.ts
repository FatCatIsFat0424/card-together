export function readPreference(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const current = localStorage.getItem(`card-together.${key}`);
    if (current !== null) return current;
    const legacy = localStorage.getItem(`bridge.${key}`);
    if (legacy !== null) writePreference(key, legacy);
    return legacy;
  } catch {
    return null;
  }
}

export function writePreference(key: string, value: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (value === null) localStorage.removeItem(`card-together.${key}`);
    else localStorage.setItem(`card-together.${key}`, value);
    // Retire the old value only after the new preference is safely persisted.
    localStorage.removeItem(`bridge.${key}`);
  } catch {
    // Storage is optional; keep the legacy value when migration cannot persist it.
  }
}
