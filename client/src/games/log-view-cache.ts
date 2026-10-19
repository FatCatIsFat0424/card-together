// ─── Memoized log replays: one result per snapshot and log position, shared by every caller ───

/**
 * Caches values derived from an immutable snapshot object such as a game log. The store keeps a
 * snapshot's identity while its content is unchanged, so the table, every seat, and the frame body
 * reuse one replay per presentation frame instead of each replaying the log on every render.
 * Entries are released with the snapshot. Callers must not mutate returned values.
 */
export interface LogViewCache<Owner extends object, Value> {
  get(owner: Owner, key: string | number, compute: () => Value): Value;
}

export function createLogViewCache<Owner extends object, Value>(): LogViewCache<Owner, Value> {
  const cache = new WeakMap<Owner, Map<string | number, Value>>();
  return {
    get(owner, key, compute) {
      let values = cache.get(owner);
      if (!values) {
        values = new Map();
        cache.set(owner, values);
      }
      if (values.has(key)) return values.get(key) as Value;
      const value = compute();
      values.set(key, value);
      return value;
    },
  };
}
