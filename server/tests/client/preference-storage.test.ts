import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPreference, writePreference } from '../../../client/src/utils/preference-storage';

const PREFERENCES = [
  'theme', 'ui.reducedMotion', 'music.volume', 'music.provided.track', 'music.mode',
  'voice.peers', 'voice.input', 'voice.output', 'sound.turn',
];

let values: Map<string, string>;

beforeEach(() => {
  values = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string): string | null => values.get(key) ?? null,
    setItem: (key: string, value: string): void => { values.set(key, value); },
    removeItem: (key: string): void => { values.delete(key); },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('preference storage migration', () => {
  it.each(PREFERENCES)('should migrate the legacy %s preference only after copying it', (key) => {
    values.set(`bridge.${key}`, 'saved-value');
    values.set('bridge.unrelated', 'keep');
    expect(readPreference(key)).toBe('saved-value');
    expect(values.get(`card-together.${key}`)).toBe('saved-value');
    expect(values.has(`bridge.${key}`)).toBe(false);
    expect(values.get('bridge.unrelated')).toBe('keep');
  });

  it.each(['paper', ''])('should preserve the current preference %j over legacy data', (value) => {
    values.set('bridge.theme', 'felt');
    values.set('card-together.theme', value);
    expect(readPreference('theme')).toBe(value);
    expect(values.get('card-together.theme')).toBe(value);
  });

  it('should retain and use legacy data when migration cannot persist it', () => {
    values.set('bridge.theme', 'paper');
    localStorage.setItem = (): never => { throw new Error('quota'); };
    expect(readPreference('theme')).toBe('paper');
    expect(values.get('bridge.theme')).toBe('paper');
    expect(values.has('card-together.theme')).toBe(false);
  });

  it('should persist changes in the current namespace and retire legacy data', () => {
    values.set('bridge.sound.turn', 'true');
    writePreference('sound.turn', 'false');
    expect(readPreference('sound.turn')).toBe('false');
    expect(values.get('card-together.sound.turn')).toBe('false');
    expect(values.has('bridge.sound.turn')).toBe(false);
  });

  it('should remove both device preferences so the old selection cannot reappear', () => {
    values.set('bridge.voice.input', 'old-microphone');
    values.set('card-together.voice.input', 'new-microphone');
    writePreference('voice.input', null);
    expect(readPreference('voice.input')).toBeNull();
    expect(values.has('bridge.voice.input')).toBe(false);
    expect(values.has('card-together.voice.input')).toBe(false);
  });

  it('should tolerate unavailable or blocked browser storage', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(readPreference('theme')).toBeNull();
    expect(() => writePreference('theme', 'felt')).not.toThrow();
    vi.stubGlobal('localStorage', {
      getItem: (): never => { throw new Error('disabled'); },
      setItem: (): never => { throw new Error('disabled'); },
      removeItem: (): never => { throw new Error('disabled'); },
    });
    expect(readPreference('theme')).toBeNull();
    expect(() => writePreference('theme', 'felt')).not.toThrow();
  });

  it('should restore theme, motion, and turn-sound stores from legacy preferences', async () => {
    vi.resetModules();
    values.set('bridge.theme', 'paper');
    values.set('bridge.ui.reducedMotion', 'true');
    values.set('bridge.sound.turn', 'false');
    const { useThemeStore } = await import('../../../client/src/stores/theme-store');
    const { useMotionStore } = await import('../../../client/src/stores/motion-store');
    const { useTurnSoundStore } = await import('../../../client/src/stores/turn-sound-store');
    expect(useThemeStore.getState().theme).toBe('paper');
    expect(useMotionStore.getState().reducedMotion).toBe(true);
    expect(useTurnSoundStore.getState().enabled).toBe(false);
    useThemeStore.getState().setTheme('felt');
    useMotionStore.getState().setReducedMotion(false);
    useTurnSoundStore.getState().setEnabled(true);
    expect(values.get('card-together.theme')).toBe('felt');
    expect(values.get('card-together.ui.reducedMotion')).toBe('false');
    expect(values.get('card-together.sound.turn')).toBe('true');
  });
});
