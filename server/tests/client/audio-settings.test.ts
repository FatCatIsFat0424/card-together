import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  channelGain, clampVolume, mixedGain, parseVolume, peerOutputVolume, volumePercent,
} from '../../../client/src/audio/mix';

describe('volume parsing', () => {
  it.each([
    ['0.3', 0.3], ['0', 0], ['1', 1], ['1.7', 1], ['-4', 0],
    [null, 0.5], ['', 0.5], ['  ', 0.5], ['loud', 0.5], ['NaN', 0.5], ['Infinity', 0.5],
  ])('should restore %j as %s', (stored, expected) => {
    expect(parseVolume(stored, 0.5)).toBe(expected);
  });

  it('should clamp and round for display', () => {
    expect(clampVolume(2)).toBe(1);
    expect(clampVolume(-1)).toBe(0);
    expect(volumePercent(0.456)).toBe(46);
    expect(volumePercent(9)).toBe(100);
  });
});

describe('channel gain math', () => {
  it('should silence a channel that is switched off whatever its volume', () => {
    expect(channelGain({ enabled: false, volume: 0.8 })).toBe(0);
    expect(channelGain({ enabled: true, volume: 0.8 })).toBe(0.8);
  });

  it('should multiply master and channel so either can silence it', () => {
    const master = { enabled: true, volume: 0.5 };
    expect(mixedGain(master, { enabled: true, volume: 0.4 })).toBeCloseTo(0.2);
    expect(mixedGain(master, { enabled: false, volume: 0.4 })).toBe(0);
    expect(mixedGain({ enabled: false, volume: 1 }, { enabled: true, volume: 1 })).toBe(0);
    expect(mixedGain({ enabled: true, volume: 0 }, { enabled: true, volume: 1 })).toBe(0);
  });

  it('should multiply the voice output gain with the per-player volume', () => {
    expect(peerOutputVolume(0.5, 0.5)).toBe(0.25);
    expect(peerOutputVolume(1, 1)).toBe(1);
    expect(peerOutputVolume(1, 0)).toBe(0);
    expect(peerOutputVolume(2, 3)).toBe(1);
  });
});

describe('audio preferences', () => {
  let values: Map<string, string>;

  beforeEach(() => {
    vi.resetModules();
    values = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (key: string): string | null => values.get(key) ?? null,
      setItem: (key: string, value: string): void => { values.set(key, value); },
      removeItem: (key: string): void => { values.delete(key); },
    });
    vi.stubGlobal('sessionStorage', undefined);
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function stores() {
    const [master, effects, turn, music] = await Promise.all([
      import('../../../client/src/stores/audio-settings-store'),
      import('../../../client/src/stores/sound-effects-store'),
      import('../../../client/src/stores/turn-sound-store'),
      import('../../../client/src/stores/music-store'),
    ]);
    return {
      master: master.useAudioSettingsStore, effects: effects.useSoundEffectsStore,
      turn: turn.useTurnSoundStore, music: music.useMusicStore, masterModule: master,
    };
  }

  it('should start every channel at full volume, except music at its existing default', async () => {
    const { master, effects, turn, music } = await stores();
    expect(master.getState()).toMatchObject({
      masterEnabled: true, masterVolume: 1, voiceEnabled: true, voiceVolume: 1,
    });
    expect(effects.getState()).toMatchObject({ enabled: true, volume: 1 });
    expect(turn.getState().enabled).toBe(true);
    expect(music.getState()).toMatchObject({ enabled: true, volume: 0.5 });
  });

  it('should carry the existing switches and music volume over, including legacy keys', async () => {
    values.set('card-together.sound.effects', 'false');
    values.set('bridge.sound.turn', 'false');
    values.set('card-together.music.enabled', 'false');
    values.set('bridge.music.volume', '0.3');
    const { master, effects, turn, music } = await stores();
    expect(effects.getState()).toMatchObject({ enabled: false, volume: 1 });
    expect(turn.getState().enabled).toBe(false);
    expect(music.getState()).toMatchObject({ enabled: false, volume: 0.3 });
    expect(master.getState()).toMatchObject({ masterEnabled: true, masterVolume: 1 });
    // New channel settings did not exist before, so they must not disturb the carried-over ones.
    expect(values.get('card-together.music.volume')).toBe('0.3');
  });

  it('should clamp or ignore invalid stored volumes', async () => {
    values.set('card-together.audio.master.volume', '4');
    values.set('card-together.audio.voice.volume', '-1');
    values.set('card-together.sound.effects.volume', 'loud');
    values.set('card-together.music.volume', '');
    const { master, effects, music } = await stores();
    expect(master.getState()).toMatchObject({ masterVolume: 1, voiceVolume: 0 });
    expect(effects.getState().volume).toBe(1);
    expect(music.getState().volume).toBe(0.5);
  });

  it('should persist channel changes and reject non-finite volumes', async () => {
    const { master, effects } = await stores();
    master.getState().setMasterVolume(0.4);
    master.getState().setMasterEnabled(false);
    master.getState().setVoiceVolume(9);
    master.getState().setVoiceEnabled(false);
    master.getState().setVoiceVolume(Number.NaN);
    effects.getState().setVolume(0.25);
    effects.getState().setVolume(Number.POSITIVE_INFINITY);
    expect(values.get('card-together.audio.master.volume')).toBe('0.4');
    expect(values.get('card-together.audio.master.enabled')).toBe('false');
    expect(values.get('card-together.audio.voice.volume')).toBe('1');
    expect(values.get('card-together.audio.voice.enabled')).toBe('false');
    expect(values.get('card-together.sound.effects.volume')).toBe('0.25');
    expect(effects.getState().volume).toBe(0.25);
  });

  it('should restore saved channel settings after a reload', async () => {
    values.set('card-together.audio.master.volume', '0.6');
    values.set('card-together.audio.voice.volume', '0.5');
    const { masterModule } = await stores();
    expect(masterModule.currentMasterGain()).toBe(0.6);
    expect(masterModule.currentVoiceGain()).toBeCloseTo(0.3);
    masterModule.useAudioSettingsStore.getState().setVoiceEnabled(false);
    expect(masterModule.currentVoiceGain()).toBe(0);
    masterModule.useAudioSettingsStore.getState().setVoiceEnabled(true);
    masterModule.useAudioSettingsStore.getState().setMasterEnabled(false);
    expect(masterModule.currentMasterGain()).toBe(0);
    expect(masterModule.currentVoiceGain()).toBe(0);
  });
});

describe('music route', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  function gainNode() {
    return { gain: { value: 1, setTargetAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
  }

  function installContext(state: string) {
    const source = { connect: vi.fn(), disconnect: vi.fn() };
    const gains: Array<ReturnType<typeof gainNode>> = [];
    const context = {
      state, currentTime: 2, destination: {},
      resume: vi.fn(async () => undefined),
      createMediaElementSource: vi.fn(() => source),
      createGain: vi.fn(() => {
        const node = gainNode();
        gains.push(node);
        return node;
      }),
    };
    const construct = vi.fn(function () { return context; });
    vi.stubGlobal('AudioContext', construct);
    return { context, construct, source, gains };
  }

  it('should chain element, music gain, master gain, and speakers so volume works without element.volume', async () => {
    const { context, source, gains } = installContext('running');
    const { createMusicRoute } = await import('../../../client/src/audio/music-route');
    const element = {} as HTMLAudioElement;
    const route = createMusicRoute(element);
    expect(route).not.toBeNull();
    expect(context.createMediaElementSource).toHaveBeenCalledWith(element);
    const [music, master] = gains;
    expect(source.connect).toHaveBeenCalledWith(music);
    expect(music.connect).toHaveBeenCalledWith(master);
    expect(master.connect).toHaveBeenCalledWith(context.destination);
    route?.setLevels(0.5, 0.25);
    expect(master.gain.setTargetAtTime).toHaveBeenCalledWith(0.5, 2, expect.any(Number));
    expect(music.gain.setTargetAtTime).toHaveBeenCalledWith(0.25, 2, expect.any(Number));
    route?.dispose();
    expect([source, music, master].every((node) => node.disconnect.mock.calls.length === 1)).toBe(true);
  });

  it('should fall back to plain element playback while the context is not running', async () => {
    const { context } = installContext('suspended');
    const { createMusicRoute, resumeMusicRoute } = await import('../../../client/src/audio/music-route');
    expect(createMusicRoute({} as HTMLAudioElement)).toBeNull();
    expect(context.createMediaElementSource).not.toHaveBeenCalled();
    expect(context.resume).toHaveBeenCalled();
    context.state = 'running';
    resumeMusicRoute();
    expect(createMusicRoute({} as HTMLAudioElement)).not.toBeNull();
  });

  it('should fall back when Web Audio is missing or capturing the element fails', async () => {
    vi.stubGlobal('AudioContext', undefined);
    const missing = await import('../../../client/src/audio/music-route');
    expect(missing.createMusicRoute({} as HTMLAudioElement)).toBeNull();
    expect(() => missing.resumeMusicRoute()).not.toThrow();
    vi.resetModules();
    const { context } = installContext('running');
    context.createMediaElementSource.mockImplementation(() => { throw new Error('already captured'); });
    const failing = await import('../../../client/src/audio/music-route');
    expect(failing.createMusicRoute({} as HTMLAudioElement)).toBeNull();
  });
});
