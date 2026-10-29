import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  disposeCardSounds, playCardSound, playOutSound, playSlashSound, playStartSound, unlockCardSounds,
} from '../../../client/src/audio/card-sound';
import { CEILING_RANGE, EFFECTS_BOOST_DB, dbToGain } from '../../../client/src/audio/mix';
import { useAudioSettingsStore } from '../../../client/src/stores/audio-settings-store';
import { useSoundEffectsStore } from '../../../client/src/stores/sound-effects-store';

vi.mock('../../../client/src/stores/account-store', async () => {
  const { create } = await import('zustand');
  return { useAccountStore: create(() => ({ account: null })) };
});

interface FakeNode {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

interface FakeSource extends FakeNode {
  onended: (() => void) | null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  frequency: { value: number };
  buffer: null;
}

function installAudio() {
  const node = (): FakeNode => ({ connect: vi.fn(), disconnect: vi.fn() });
  const sources: Array<ReturnType<typeof source>> = [];
  const nodes: Array<ReturnType<typeof node>> = [];
  const shapers: Array<ReturnType<typeof node> & { curve: Float32Array | null; oversample: string }> = [];
  // The effects bus (master gain, channel gain, boost gain, soft ceiling) is created with the first cue and lives
  // until disposal.
  const bus: Array<ReturnType<typeof gain>> = [];
  function gain() {
    return { ...node(), gain: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } };
  }
  function source(): FakeSource {
    const value = { ...node(), onended: null as (() => void) | null,
      start: vi.fn(), stop: vi.fn(), frequency: { value: 0 }, buffer: null };
    sources.push(value);
    return value;
  }
  const context = {
    state: 'suspended', currentTime: 0, sampleRate: 100, destination: {},
    resume: vi.fn(async () => undefined), close: vi.fn(async () => undefined),
    createBuffer: vi.fn((_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) })),
    createBufferSource: vi.fn(source), createOscillator: vi.fn(source),
    createGain: vi.fn(() => {
      const value = gain();
      (bus.length < 3 ? bus : nodes).push(value);
      return value;
    }),
    createWaveShaper: vi.fn(() => {
      const value = { ...node(), curve: null as Float32Array | null, oversample: '' };
      shapers.push(value);
      return value;
    }),
    createBiquadFilter: vi.fn(() => {
      const value = { ...node(), type: '', frequency: { value: 0 }, Q: { value: 0 } };
      nodes.push(value);
      return value;
    }),
  };
  const construct = vi.fn(function () { return context; });
  vi.stubGlobal('AudioContext', construct);
  return { context, construct, sources, nodes, bus, shapers };
}

afterEach(() => {
  disposeCardSounds();
  vi.unstubAllGlobals();
  useSoundEffectsStore.setState({ enabled: true, volume: 1 });
  useAudioSettingsStore.setState({ masterEnabled: true, masterVolume: 1 });
});

describe('card sounds', () => {
  it('should skip locked sounds without creating audio or replaying after unlock', async () => {
    const { context, construct, sources } = installAudio();
    playCardSound();
    playOutSound();
    expect(construct).not.toHaveBeenCalled();
    unlockCardSounds();
    playCardSound();
    playOutSound();
    context.state = 'running';
    await Promise.resolve();
    expect(sources).toHaveLength(0);
    playCardSound();
    expect(sources).toHaveLength(1);
  });

  it('should stay silent while game sound effects are switched off', () => {
    const { context, sources } = installAudio();
    unlockCardSounds();
    context.state = 'running';
    useSoundEffectsStore.setState({ enabled: false });
    playCardSound();
    playOutSound();
    playStartSound();
    playSlashSound({ fireStart: 0.3, fireEnd: 1.85, strike: 1.85, cut: 0.12 });
    expect(sources).toHaveLength(0);
    useSoundEffectsStore.setState({ enabled: true });
    playCardSound();
    expect(sources).toHaveLength(1);
  });

  it('should release card and elimination nodes when each source ends', () => {
    const { context, sources, nodes } = installAudio();
    unlockCardSounds();
    context.state = 'running';
    playCardSound(true);
    playOutSound();
    expect(sources).toHaveLength(4);
    expect(context.createBiquadFilter.mock.results[0].value.frequency.value).toBe(700);
    for (const source of sources) source.onended?.();
    expect([...sources, ...nodes].every((node) => node.disconnect.mock.calls.length === 1)).toBe(true);
    disposeCardSounds();
    expect(sources.every((source) => source.onended === null)).toBe(true);
    expect(context.close).toHaveBeenCalledOnce();
  });

  it('should play the Dragon Slaying breath, whoosh and impact only while audio runs, releasing every voice', () => {
    const { context, sources, nodes } = installAudio();
    const timing = { fireStart: 0.3, fireEnd: 1.85, strike: 1.85, cut: 0.12 };
    playSlashSound(timing);
    unlockCardSounds();
    playSlashSound(timing);
    expect(sources).toHaveLength(0);
    context.state = 'running';
    playSlashSound(timing);
    expect(sources).toHaveLength(3);
    // Roar from the first flames, whoosh just before the strike, crash after the 120 ms sweep.
    for (const [index, at] of [0.3, 1.83, 1.97].entries()) expect(sources[index].start.mock.calls[0][0]).toBeCloseTo(at);
    expect(context.createBiquadFilter.mock.results.map((result) => result.value.type))
      .toEqual(['lowpass', 'bandpass', 'lowpass']);
    for (const source of sources) source.onended?.();
    expect([...sources, ...nodes].every((node) => node.disconnect.mock.calls.length === 1)).toBe(true);
  });

  it('plays one simultaneous impact only after a gesture unlocks audio and releases its nodes', () => {
    const { context, sources, nodes } = installAudio();
    playStartSound();
    unlockCardSounds();
    playStartSound();
    expect(sources).toHaveLength(0);
    context.state = 'running';
    playStartSound();
    expect(sources).toHaveLength(2);
    for (const source of sources) expect(source.start).toHaveBeenCalledWith(context.currentTime);
    for (const source of sources) source.onended?.();
    expect([...sources, ...nodes].every((node) => node.disconnect.mock.calls.length === 1)).toBe(true);
  });

  it('should route cues through the effects gain under the master gain and follow settings', () => {
    const { context, sources, bus, shapers } = installAudio();
    useSoundEffectsStore.setState({ enabled: true, volume: 0.5 });
    useAudioSettingsStore.setState({ masterEnabled: true, masterVolume: 0.8 });
    unlockCardSounds();
    context.state = 'running';
    playCardSound();
    const [master, effects, boost] = bus;
    expect(sources).toHaveLength(1);
    expect(effects.gain.value).toBe(0.5);
    expect(master.gain.value).toBe(0.8);
    expect(effects.connect).toHaveBeenCalledWith(master);
    expect(master.connect).toHaveBeenCalledWith(context.destination);
    // Voices enter the boost, which feeds the soft ceiling ahead of the sliders so overlapping cues cannot clip.
    expect(shapers).toHaveLength(1);
    expect(boost.connect).toHaveBeenCalledWith(shapers[0]);
    expect(shapers[0].connect).toHaveBeenCalledWith(effects);
    expect(shapers[0].oversample).toBe('none');
    useSoundEffectsStore.setState({ volume: 0.25 });
    useAudioSettingsStore.setState({ masterEnabled: false });
    expect(effects.gain.value).toBe(0.25);
    expect(master.gain.value).toBe(0);
    disposeCardSounds();
    useSoundEffectsStore.setState({ volume: 1 });
    expect(effects.gain.value).toBe(0.25);
    expect(bus.every((node) => node.disconnect.mock.calls.length === 1)).toBe(true);
  });

  it('should boost effects by a fixed amount and hold the mix under full scale', () => {
    const { context, bus, shapers } = installAudio();
    unlockCardSounds();
    context.state = 'running';
    playCardSound();
    const [, , boost] = bus;
    const curve = shapers[0].curve as Float32Array;
    const input = (index: number): number => ((2 * index) / (curve.length - 1) - 1) * CEILING_RANGE;
    // The curve is linear below its knee, so the boost is exact for ordinary cues.
    expect(boost.gain.value * CEILING_RANGE).toBeCloseTo(dbToGain(EFFECTS_BOOST_DB), 10);
    const small = Math.round(((0.1 / CEILING_RANGE + 1) / 2) * (curve.length - 1));
    expect(curve[small]).toBeCloseTo(input(small), 6);
    // Stacked cues saturate smoothly: monotonic, symmetric, and never above full scale.
    for (let i = 1; i < curve.length; i++) expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1]);
    expect(Math.max(...curve)).toBeLessThanOrEqual(1);
    expect(Math.min(...curve)).toBeGreaterThanOrEqual(-1);
    expect(curve[0]).toBeCloseTo(-curve[curve.length - 1], 10);
    expect(curve[curve.length - 1]).toBeGreaterThan(0.99);
  });

  it('should fall back to the plain boost when the context has no wave shaper', () => {
    const { context, bus } = installAudio();
    delete (context as { createWaveShaper?: unknown }).createWaveShaper;
    unlockCardSounds();
    context.state = 'running';
    playCardSound();
    const [, effects, boost] = bus;
    expect(boost.gain.value).toBeCloseTo(dbToGain(EFFECTS_BOOST_DB), 10);
    expect(boost.connect).toHaveBeenCalledWith(effects);
  });

  it('should stop pending tones on disposal and require another gesture to reopen', () => {
    const { context, construct, sources, nodes } = installAudio();
    unlockCardSounds();
    context.state = 'running';
    playOutSound();
    disposeCardSounds();
    expect([...sources, ...nodes].every((node) => node.disconnect.mock.calls.length === 1)).toBe(true);
    expect(sources.every((source) => source.stop.mock.calls.length === 2)).toBe(true);
    playCardSound();
    expect(construct).toHaveBeenCalledOnce();
    unlockCardSounds();
    expect(construct).toHaveBeenCalledTimes(2);
  });

  it('should tolerate unsupported audio and denied resume without queued sounds', async () => {
    vi.stubGlobal('AudioContext', undefined);
    expect(unlockCardSounds).not.toThrow();
    const { context, sources } = installAudio();
    context.resume.mockRejectedValue(new Error('blocked'));
    unlockCardSounds();
    await Promise.resolve();
    playCardSound();
    playOutSound();
    expect(sources).toHaveLength(0);
    expect(disposeCardSounds).not.toThrow();
  });
});
