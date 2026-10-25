import type { ReplayPatchOp, ReplayPath } from './types/replay';

type Json = unknown;

/** Keys that would reach an object's prototype if a recorded path were applied blindly. */
const UNSAFE_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function equalJson(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((item, index) => equalJson(item, b[index]));
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a).filter((key) => a[key] !== undefined);
  return keys.length === Object.keys(b).filter((key) => b[key] !== undefined).length
    && keys.every((key) => Object.hasOwn(b, key) && equalJson(a[key], b[key]));
}

function collect(before: Json, after: Json, path: ReplayPath, ops: ReplayPatchOp[]): void {
  if (equalJson(before, after)) return;
  if (isRecord(before) && isRecord(after)) {
    for (const key of Object.keys(before)) {
      if (before[key] !== undefined && after[key] === undefined) ops.push({ op: 'delete', path: [...path, key] });
    }
    for (const key of Object.keys(after)) {
      if (after[key] !== undefined) collect(before[key], after[key], [...path, key], ops);
    }
    return;
  }
  // Logs only grow, so appending keeps each step proportional to what happened in it.
  if (Array.isArray(before) && Array.isArray(after) && after.length > before.length
    && before.every((item, index) => equalJson(item, after[index]))) {
    ops.push({ op: 'append', path, values: structuredClone(after.slice(before.length)) });
    return;
  }
  ops.push({ op: 'set', path, value: structuredClone(after) });
}

/** JSON-shaped differences only: `undefined` members count as absent. */
export function diffReplaySnapshot(before: Json, after: Json): ReplayPatchOp[] {
  const ops: ReplayPatchOp[] = [];
  collect(before, after, [], ops);
  return ops;
}

function update(target: Json, path: ReplayPath, depth: number, op: ReplayPatchOp): Json {
  if (depth === path.length) {
    if (op.op === 'set') return structuredClone(op.value);
    if (op.op === 'append' && Array.isArray(target)) return [...target, ...structuredClone(op.values)];
    throw new Error('Invalid replay patch.');
  }
  const key = path[depth];
  if (UNSAFE_KEYS.has(key) || !isRecord(target)) throw new Error('Invalid replay patch.');
  const copy: Record<string, unknown> = { ...target };
  if (op.op === 'delete' && depth === path.length - 1) delete copy[key];
  else copy[key] = update(target[key], path, depth + 1, op);
  return copy;
}

/** Returns a new snapshot sharing unchanged branches; the input is never mutated. */
export function applyReplayPatch<T>(snapshot: T, ops: readonly ReplayPatchOp[]): T {
  let next: Json = snapshot;
  for (const op of ops) {
    if (op.op === 'delete' && op.path.length === 0) throw new Error('Invalid replay patch.');
    next = update(next, op.path, 0, op);
  }
  return next as T;
}
