import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFileMusicPlayer } from '../../../client/src/audio/file-music-player';
import type { FileMusicTrack } from '../../../client/src/audio/file-music-player';

const FIRST_TRACK: FileMusicTrack = { id: 'first', title: 'First', file: '/music/first.ogg' };
const SECOND_TRACK: FileMusicTrack = { id: 'second', title: 'Second', file: '/music/second.mp3' };

interface MockAudio {
  src: string;
  preload: string;
  volume: number;
  currentTime: number;
  duration: number;
  readyState: number;
  ended: boolean;
  error: { message: string } | null;
  play: ReturnType<typeof vi.fn<() => Promise<void>>>;
  pause: ReturnType<typeof vi.fn>;
  load: ReturnType<typeof vi.fn>;
  removeAttribute: ReturnType<typeof vi.fn>;
  addEventListener: (event: string, listener: () => void) => void;
  removeEventListener: (event: string, listener: () => void) => void;
  emit: (event: string) => void;
  listeners: Map<string, Set<() => void>>;
}

function mockAudio(): MockAudio {
  const listeners = new Map<string, Set<() => void>>();
  return {
    src: '', preload: '', volume: 1, currentTime: 0, duration: 100,
    readyState: 1, ended: false, error: null,
    play: vi.fn(async (): Promise<void> => undefined),
    pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn(), listeners,
    addEventListener(event: string, listener: () => void): void {
      const handlers = listeners.get(event) ?? new Set<() => void>();
      handlers.add(listener);
      listeners.set(event, handlers);
    },
    removeEventListener(event: string, listener: () => void): void {
      listeners.get(event)?.delete(listener);
    },
    emit(event: string): void {
      for (const listener of listeners.get(event) ?? []) listener();
    },
  };
}

function deferred(): {
  promise: Promise<void>; resolve: () => void; reject: (error: Error) => void;
} {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((success, failure): void => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}

function setup(): {
  player: ReturnType<typeof createFileMusicPlayer>;
  elements: MockAudio[];
  createAudio: ReturnType<typeof vi.fn>;
  changed: ReturnType<typeof vi.fn>;
  ended: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  const elements: MockAudio[] = [];
  const createAudio = vi.fn((): HTMLAudioElement => {
    const element = mockAudio();
    elements.push(element);
    return element as unknown as HTMLAudioElement;
  });
  const changed = vi.fn();
  const ended = vi.fn();
  const error = vi.fn();
  return {
    elements, createAudio, changed, ended, error,
    player: createFileMusicPlayer(changed, ended, error, { createAudio, loadTimeoutMs: 100 }),
  };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

afterEach((): void => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('file music player', (): void => {
  it('should allocate audio only on play and retain its position across pause and resume', async () => {
    const { player, elements, createAudio, changed } = setup();
    player.setVolume(0.4);
    player.pause();
    player.seekBy(10);
    expect(createAudio).not.toHaveBeenCalled();
    await player.play(FIRST_TRACK);
    const audio = elements[0];
    expect(audio.src).toBe(FIRST_TRACK.file);
    expect(audio.preload).toBe('metadata');
    expect(audio.volume).toBe(0.4);
    expect(changed).toHaveBeenLastCalledWith(true);
    audio.currentTime = 35;
    player.pause();
    expect(changed).toHaveBeenLastCalledWith(false);
    await player.play(FIRST_TRACK);
    expect(createAudio).toHaveBeenCalledOnce();
    expect(audio.currentTime).toBe(35);
    expect(audio.play).toHaveBeenCalledTimes(2);
    player.dispose();
  });

  it('should report buffering and resumed playback without ending the track', async () => {
    const { player, elements, changed, ended } = setup();
    await player.play(FIRST_TRACK);
    elements[0].emit('waiting');
    expect(changed).toHaveBeenLastCalledWith(false);
    elements[0].emit('playing');
    expect(changed).toHaveBeenLastCalledWith(true);
    elements[0].emit('playing');
    expect(changed).toHaveBeenCalledTimes(3);
    expect(ended).not.toHaveBeenCalled();
    player.dispose();
  });

  it('should clamp seeks and defer them until metadata becomes available', async () => {
    const { player, elements } = setup();
    await player.play(FIRST_TRACK);
    const audio = elements[0];
    audio.currentTime = 95;
    player.seekBy(10);
    expect(audio.currentTime).toBe(100);
    player.seekBy(-200);
    expect(audio.currentTime).toBe(0);
    player.seekBy(Number.NaN);
    expect(audio.currentTime).toBe(0);
    audio.readyState = 0;
    audio.duration = Number.NaN;
    player.seekBy(10);
    player.seekBy(10);
    expect(audio.currentTime).toBe(0);
    audio.readyState = 1;
    audio.duration = 15;
    audio.emit('loadedmetadata');
    expect(audio.currentTime).toBe(15);
    player.dispose();
  });

  it('should notify each track end once and restart an ended track from zero', async () => {
    const { player, elements, changed, ended } = setup();
    await player.play(FIRST_TRACK);
    const audio = elements[0];
    audio.currentTime = 100;
    audio.ended = true;
    audio.emit('ended');
    audio.emit('ended');
    expect(ended).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenLastCalledWith(false);
    await player.play(FIRST_TRACK);
    expect(audio.currentTime).toBe(0);
    audio.ended = false;
    audio.emit('ended');
    expect(ended).toHaveBeenCalledOnce();
    audio.ended = true;
    audio.emit('ended');
    expect(ended).toHaveBeenCalledTimes(2);
    player.dispose();
  });

  it('should release replaced sources and ignore their late playback and error events', async () => {
    const { player, elements, changed, error } = setup();
    await player.play(FIRST_TRACK);
    const old = elements[0];
    const stalePlaying = [...old.listeners.get('playing')!][0];
    const staleError = [...old.listeners.get('error')!][0];
    await player.play(SECOND_TRACK);
    expect(old.pause).toHaveBeenCalledOnce();
    expect(old.removeAttribute).toHaveBeenCalledExactlyOnceWith('src');
    expect(old.load).toHaveBeenCalledOnce();
    expect([...old.listeners.values()].every((listeners): boolean => listeners.size === 0)).toBe(true);
    changed.mockClear();
    stalePlaying();
    staleError();
    expect(changed).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(elements[1].src).toBe(SECOND_TRACK.file);
    player.dispose();
  });

  it('should replace a changed file even when its track ID stays the same', async () => {
    const { player, elements } = setup();
    await player.play(FIRST_TRACK);
    await player.play({ ...FIRST_TRACK, file: '/music/replacement.ogg' });
    expect(elements).toHaveLength(2);
    expect(elements[1].src).toBe('/music/replacement.ogg');
    player.dispose();
  });

  it('should settle superseded plays and ignore their late rejections', async () => {
    const { player, elements, changed, error } = setup();
    await player.play(FIRST_TRACK);
    const old = elements[0];
    const loading = deferred();
    old.play.mockReturnValueOnce(loading.promise);
    const first = player.play(FIRST_TRACK);
    await player.play(SECOND_TRACK);
    await first;
    changed.mockClear();
    loading.reject(new Error('Old source failed'));
    await flush();
    expect(error).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    player.dispose();
  });

  it('should pause a late successful play after cancellation', async () => {
    const { player, elements, changed } = setup();
    await player.play(FIRST_TRACK);
    const loading = deferred();
    elements[0].play.mockReturnValueOnce(loading.promise);
    const request = player.play(FIRST_TRACK);
    player.pause();
    await request;
    changed.mockClear();
    loading.resolve();
    await flush();
    expect(elements[0].pause).toHaveBeenCalledTimes(2);
    expect(changed).not.toHaveBeenCalled();
    elements[0].emit('playing');
    expect(elements[0].pause).toHaveBeenCalledTimes(3);
    player.dispose();
  });

  it('should keep a resumed request playing when a cancelled request settles late', async () => {
    const { player, elements, changed } = setup();
    await player.play(FIRST_TRACK);
    const old = deferred();
    elements[0].play.mockReturnValueOnce(old.promise);
    const first = player.play(FIRST_TRACK);
    player.pause();
    await player.play(FIRST_TRACK);
    await first;
    old.resolve();
    await flush();
    expect(elements[0].pause).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenLastCalledWith(true);
    player.dispose();
  });

  it('should reject browser playback failures and retry with a fresh element', async () => {
    const { player, elements, error, changed } = setup();
    await player.play(FIRST_TRACK);
    elements[0].play.mockRejectedValueOnce(new Error('Playback denied'));
    await expect(player.play(FIRST_TRACK)).rejects.toThrow('Playback denied');
    expect(error).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'Playback denied' }));
    expect(changed).toHaveBeenLastCalledWith(false);
    await player.play(FIRST_TRACK);
    expect(elements).toHaveLength(2);
    player.dispose();
  });

  it('should reject media errors once and ignore errors after pausing', async () => {
    const { player, elements, error } = setup();
    await player.play(FIRST_TRACK);
    const loading = deferred();
    elements[0].play.mockReturnValueOnce(loading.promise);
    const failed = expect(player.play(FIRST_TRACK)).rejects.toThrow('Unsupported file');
    elements[0].error = { message: 'Unsupported file' };
    elements[0].emit('error');
    elements[0].emit('error');
    await failed;
    loading.reject(new Error('Already reported'));
    await flush();
    expect(error).toHaveBeenCalledOnce();
    await player.play(FIRST_TRACK);
    player.pause();
    elements[1].emit('error');
    expect(error).toHaveBeenCalledOnce();
    player.dispose();
  });

  it('should bound stalled startup and permit retry after timing out', async () => {
    vi.useFakeTimers();
    const { player, elements, error } = setup();
    await player.play(FIRST_TRACK);
    elements[0].play.mockReturnValueOnce(new Promise<void>((): void => undefined));
    const failed = expect(player.play(FIRST_TRACK)).rejects.toThrow('Audio playback timed out');
    await vi.advanceTimersByTimeAsync(100);
    await failed;
    expect(error).toHaveBeenCalledOnce();
    expect(elements[0].removeAttribute).toHaveBeenCalledExactlyOnceWith('src');
    expect(elements[0].load).toHaveBeenCalledOnce();
    await player.play(FIRST_TRACK);
    expect(elements).toHaveLength(2);
    player.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('should clamp finite volume values and preserve volume when given invalid values', async () => {
    const { player, elements } = setup();
    player.setVolume(2);
    player.setVolume(Number.NaN);
    await player.play(FIRST_TRACK);
    expect(elements[0].volume).toBe(1);
    player.setVolume(-1);
    expect(elements[0].volume).toBe(0);
    player.setVolume(Number.POSITIVE_INFINITY);
    expect(elements[0].volume).toBe(0);
    player.dispose();
  });

  it('should remove listeners and settle pending playback when disposed', async () => {
    vi.useFakeTimers();
    const { player, elements, createAudio, changed, error, ended } = setup();
    await player.play(FIRST_TRACK);
    const loading = deferred();
    elements[0].play.mockReturnValueOnce(loading.promise);
    const request = player.play(FIRST_TRACK);
    const staleEnded = [...elements[0].listeners.get('ended')!][0];
    player.dispose();
    player.dispose();
    await request;
    changed.mockClear();
    loading.resolve();
    await flush();
    staleEnded();
    await player.play(SECOND_TRACK);
    player.pause();
    player.seekBy(10);
    player.setVolume(0.9);
    expect(createAudio).toHaveBeenCalledOnce();
    expect(elements[0].removeAttribute).toHaveBeenCalledOnce();
    expect(changed).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(ended).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('should report audio creation failures without leaking a pending request', async () => {
    const error = vi.fn();
    const player = createFileMusicPlayer(vi.fn(), vi.fn(), error, {
      createAudio: (): HTMLAudioElement => { throw new Error('Audio unavailable'); },
    });
    await expect(player.play(FIRST_TRACK)).rejects.toThrow('Audio unavailable');
    expect(error).toHaveBeenCalledOnce();
    player.dispose();
  });
});
