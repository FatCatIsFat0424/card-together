import { afterEach, describe, expect, it, vi } from 'vitest';
import { disposeCardSounds, playCardSound, playOutSound, unlockCardSounds } from '../../../client/src/audio/card-sound';

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
      const value = { ...node(), gain: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } };
      nodes.push(value);
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
  return { context, construct, sources, nodes };
}

afterEach(() => { disposeCardSounds(); vi.unstubAllGlobals(); });

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
