import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  values: new Map<string, string>(),
  writes: [] as [string, string | null][],
}));

vi.mock('../../../client/src/socket', () => ({ socket: {} }));
vi.mock('../../../client/src/utils/preference-storage', () => ({
  readPreference: (key: string): string | null => storage.values.get(key) ?? null,
  writePreference: (key: string, value: string | null): void => { storage.writes.push([key, value]); },
}));

beforeEach(() => {
  vi.resetModules();
  storage.values.clear();
  storage.writes = [];
});

describe('voice preference storage', () => {
  it('should prune default and excess peer preferences, keeping the newest entries', async () => {
    const { prunePeerPrefs } = await import('../../../client/src/stores/voice-store');
    expect(prunePeerPrefs({
      a: { muted: true, volume: 1 },
      b: { muted: false, volume: 1 },
      c: { muted: false, volume: 0.5 },
      d: { muted: true, volume: 0.2 },
    }, 2)).toEqual({ c: { muted: false, volume: 0.5 }, d: { muted: true, volume: 0.2 } });
  });

  it('should load pruned preferences and write storage only when stored values change', async () => {
    const stored = Object.fromEntries(Array.from({ length: 60 }, (_, index) =>
      [`player-${index}`, { muted: true, volume: 1 }]));
    storage.values.set('voice.peers', JSON.stringify(stored));
    storage.values.set('voice.output', 'speaker');
    const { setVoiceOutputDevice, setVoiceMuted, useVoiceStore, MAX_STORED_PEER_PREFS } =
      await import('../../../client/src/stores/voice-store');
    const prefs = Object.keys(useVoiceStore.getState().peerPrefs);
    expect(prefs).toHaveLength(MAX_STORED_PEER_PREFS);
    expect(prefs[0]).toBe('player-10');
    setVoiceOutputDevice('speaker');
    setVoiceMuted(true);
    expect(storage.writes).toEqual([]);
    setVoiceOutputDevice('headphones');
    setVoiceOutputDevice('headphones');
    expect(storage.writes).toEqual([['voice.output', 'headphones']]);
  });
});
