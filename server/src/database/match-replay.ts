import { applyReplayPatch } from '@shared/replay-patch';
import type { GameType, MatchReplay, MatchResult, ReplayRecording } from '@shared/types';

/** Generous bounds for the longest matches; anything larger is corrupt or hostile. */
const MAX_STEPS = 50_000;
const MAX_OPS_PER_STEP = 2_000;
const MAX_PATH_DEPTH = 32;
const MAX_KEY_LENGTH = 128;
const MAX_VALUE_DEPTH = 64;
const UNSAFE_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function natural(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/** Plain JSON data only, without keys that could reach a prototype once applied or spread. */
function safeJson(value: unknown, depth = 0): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (depth >= MAX_VALUE_DEPTH) return false;
  if (Array.isArray(value)) return value.every((item) => safeJson(item, depth + 1));
  if (!object(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.entries(value).every(([key, child]) => !UNSAFE_KEYS.has(key) && safeJson(child, depth + 1));
}

function path(value: unknown, allowRoot: boolean): boolean {
  return Array.isArray(value) && value.length <= MAX_PATH_DEPTH && (allowRoot || value.length > 0)
    && value.every((key) => typeof key === 'string' && key.length > 0 && key.length <= MAX_KEY_LENGTH
      && !UNSAFE_KEYS.has(key));
}

function patchOp(value: unknown): boolean {
  if (!object(value)) return false;
  switch (value.op) {
    case 'set': return hasOnlyKeys(value, ['op', 'path', 'value']) && path(value.path, true) && safeJson(value.value);
    case 'append': return hasOnlyKeys(value, ['op', 'path', 'values']) && path(value.path, true)
      && Array.isArray(value.values) && value.values.length > 0 && safeJson(value.values);
    case 'delete': return hasOnlyKeys(value, ['op', 'path']) && path(value.path, false);
    default: return false;
  }
}

/** A recorded spectator snapshot of this game, never carrying the clock or a server time. */
function snapshot(value: unknown, gameType: GameType): boolean {
  return object(value) && value.gameType === gameType && !Object.hasOwn(value, 'clock')
    && (value.presentation === undefined || (object(value.presentation) && !Object.hasOwn(value.presentation, 'serverNow')));
}

/**
 * Validates the recording's structure and, unless `applySteps` is false, that every step applies
 * to the snapshot before it. Structure-only checks keep frequent runtime writes cheap; loading
 * and reading archives apply every step. Snapshot contents are not checked against game rules.
 */
export function isReplayRecording(value: unknown, gameType: GameType, applySteps = true): value is ReplayRecording {
  if (!object(value) || !hasOnlyKeys(value, ['initial', 'steps']) || !snapshot(value.initial, gameType)
    || !safeJson(value.initial) || !Array.isArray(value.steps) || value.steps.length > MAX_STEPS
    || !value.steps.every((step: unknown) => Array.isArray(step) && step.length > 0
      && step.length <= MAX_OPS_PER_STEP && step.every(patchOp))) return false;
  if (!applySteps) return true;
  let current: unknown = value.initial;
  try {
    for (const step of value.steps as ReplayRecording['steps']) {
      current = applyReplayPatch(current, step);
      if (!snapshot(current, gameType)) return false;
    }
  } catch {
    return false;
  }
  return true;
}

export function isMatchReplay(value: unknown, result: MatchResult, finishedAt: number): value is MatchReplay {
  return object(value) && hasOnlyKeys(value, ['version', 'gameType', 'startedAt', 'initial', 'steps'])
    && value.version === 1 && value.gameType === result.gameType
    && natural(value.startedAt) && value.startedAt <= finishedAt
    && isReplayRecording({ initial: value.initial, steps: value.steps }, result.gameType);
}

/**
 * Drops well-formed in-progress recordings whose steps no longer apply, so a damaged recording costs only
 * that match's replay instead of stopping the server from loading. Returns the affected game IDs.
 */
export function dropUnplayableRecordings(document: unknown): string[] {
  if (!object(document) || !object(document.runtime) || !Array.isArray(document.runtime.games)) return [];
  const dropped: string[] = [];
  for (const game of document.runtime.games as unknown[]) {
    if (!object(game) || game.replayRecording === undefined || typeof game.gameType !== 'string') continue;
    const gameType = game.gameType as GameType;
    // Malformed structure is real corruption and still fails validation; only stale steps are dropped.
    if (!isReplayRecording(game.replayRecording, gameType, false) || isReplayRecording(game.replayRecording, gameType)) continue;
    delete game.replayRecording;
    dropped.push(String(game.id));
  }
  return dropped;
}
