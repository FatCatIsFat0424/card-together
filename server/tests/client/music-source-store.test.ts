import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  file: { play: vi.fn(), pause: vi.fn(), setVolume: vi.fn(), dispose: vi.fn() },
  createFile: vi.fn(),
  tracks: [] as { id: string; title: string; file: string }[],
}));
vi.mock('../../../client/src/audio/file-music-player', () => ({
  createFileMusicPlayer: mocks.createFile,
}));
vi.mock('../../../client/src/audio/provided-music-catalog', () => ({
  PROVIDED_MUSIC_TRACKS: mocks.tracks,
  providedMusicUrl: (track: { file: string }): string => `/provided-music/${track.file}`,
}));
let storage: Map<string, string>;
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.tracks.splice(0, mocks.tracks.length,
    { id: 'owner-one', title: 'One', file: 'one.mp3' },
    { id: 'owner-two', title: 'Two', file: 'two.mp3' });
  storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string): string | null => storage.get(key) ?? null,
    setItem: (key: string, value: string): void => { storage.set(key, value); },
    removeItem: (key: string): void => { storage.delete(key); },
  });
  mocks.createFile.mockReturnValue(mocks.file);
  mocks.file.play.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function state(): Promise<typeof import('../../../client/src/stores/music-store').useMusicStore> {
  return (await import('../../../client/src/stores/music-store')).useMusicStore;
}

function callbacks(index = 0): {
  playing: (playing: boolean) => void;
  ended: () => void;
  error: (error: Error) => void;
} {
  const [playing, ended, error] = mocks.createFile.mock.calls[index];
  return { playing, ended, error };
}

describe('provided music store', () => {
  it('should select provided files without allocating or playing audio', async () => {
    const store = await state();
    expect(store.getState()).toMatchObject({ playing: false, busy: false, error: false,
      providedTrackId: 'owner-one', mode: 'sequential' });
    for (const retired of ['source', 'trackId', 'setSource', 'seekBy']) {
      expect(store.getState()).not.toHaveProperty(retired);
    }
    expect(mocks.createFile).not.toHaveBeenCalled();
  });

  it.each(['midnight-postcard', 'scarlet-bridge-matsuri', 'skyline-drive', 'ember-highway'])(
    'should ignore the saved original source and track %s', async (id) => {
      storage.set('bridge.music.source', 'local');
      storage.set('bridge.music.track', id);
      const store = await state();
      expect(store.getState()).toMatchObject({ providedTrackId: 'owner-one', mode: 'sequential' });
      await store.getState().play();
      expect(mocks.file.play).toHaveBeenLastCalledWith({
        id: 'owner-one', title: 'One', file: '/provided-music/one.mp3',
      });
      expect(storage.get('card-together.music.provided.track')).toBe('owner-one');
    });

  it('should restore a valid provided selection and shared preferences without autoplay', async () => {
    storage.set('bridge.music.provided.track', 'owner-two');
    storage.set('bridge.music.volume', '0.6');
    storage.set('bridge.music.mode', 'shuffle');
    const store = await state();
    expect(store.getState()).toMatchObject({
      providedTrackId: 'owner-two', volume: 0.6, mode: 'shuffle', playing: false,
    });
    expect(mocks.createFile).not.toHaveBeenCalled();
    await store.getState().play();
    expect(mocks.file.setVolume).toHaveBeenLastCalledWith(0.6);
  });

  it('should fall back safely when saved preferences are invalid', async () => {
    storage.set('bridge.music.provided.track', 'removed');
    storage.set('bridge.music.mode', 'invalid');
    storage.set('bridge.music.volume', 'invalid');
    const store = await state();
    expect(store.getState()).toMatchObject({
      providedTrackId: 'owner-one', mode: 'sequential', volume: 0.25,
    });
  });

  it('should keep an empty playlist safe without creating an audio player', async () => {
    mocks.tracks.splice(0);
    storage.set('bridge.music.source', 'local');
    const store = await state();
    await store.getState().play();
    await store.getState().toggle();
    await store.getState().next();
    await store.getState().prev();
    await store.getState().pause();
    expect(store.getState()).toMatchObject({ providedTrackId: null,
      playing: false, busy: false, error: false });
    expect(mocks.createFile).not.toHaveBeenCalled();
  });

  it('should reject arbitrary paths and original IDs without changing the selection', async () => {
    const store = await state();
    await store.getState().play('https://example.com/audio.mp3');
    await store.getState().play('midnight-postcard');
    expect(mocks.createFile).not.toHaveBeenCalled();
    expect(store.getState()).toMatchObject({ providedTrackId: 'owner-one', error: true });
    await store.getState().play();
    expect(store.getState().error).toBe(false);
  });

  it('should wrap automatically and manually through provided tracks in sequential mode', async () => {
    const store = await state();
    await store.getState().play();
    callbacks().ended();
    expect(store.getState().providedTrackId).toBe('owner-two');
    callbacks().ended();
    expect(store.getState().providedTrackId).toBe('owner-one');
    await store.getState().prev();
    expect(store.getState().providedTrackId).toBe('owner-two');
    await store.getState().next();
    expect(store.getState().providedTrackId).toBe('owner-one');
  });

  it('should repeat the ended track in loop-one mode but allow manual navigation', async () => {
    const store = await state();
    store.getState().setMode('loop-one');
    await store.getState().play('owner-two');
    callbacks().ended();
    expect(store.getState().providedTrackId).toBe('owner-two');
    expect(mocks.file.play).toHaveBeenCalledTimes(2);
    await store.getState().next();
    expect(store.getState().providedTrackId).toBe('owner-one');
    await store.getState().prev();
    expect(store.getState().providedTrackId).toBe('owner-two');
    expect(storage.get('card-together.music.mode')).toBe('loop-one');
  });

  it('should shuffle to a different provided track after playback ends', async () => {
    mocks.tracks.push({ id: 'owner-three', title: 'Three', file: 'three.mp3' });
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const store = await state();
    store.getState().setMode('shuffle');
    await store.getState().play();
    callbacks().ended();
    expect(store.getState().providedTrackId).toBe('owner-three');
    callbacks().ended();
    expect(store.getState().providedTrackId).toBe('owner-two');
  });

  it('should clamp volume and ignore invalid volume or mode changes', async () => {
    const store = await state();
    store.getState().setVolume(-1);
    expect(store.getState().volume).toBe(0);
    await store.getState().play();
    expect(mocks.file.setVolume).toHaveBeenLastCalledWith(0);
    store.getState().setVolume(2);
    store.getState().setVolume(NaN);
    store.getState().setVolume(Infinity);
    store.getState().setMode('invalid' as 'sequential');
    expect(store.getState()).toMatchObject({ volume: 1, mode: 'sequential' });
    expect(mocks.file.setVolume).toHaveBeenLastCalledWith(1);
    expect(storage.get('card-together.music.volume')).toBe('1');
  });

  it('should pause and resume the same file player through toggle', async () => {
    const store = await state();
    await store.getState().toggle();
    callbacks().playing(true);
    expect(store.getState().playing).toBe(true);
    await store.getState().toggle();
    expect(mocks.file.pause).toHaveBeenCalledOnce();
    expect(store.getState().playing).toBe(false);
    await store.getState().toggle();
    expect(mocks.createFile).toHaveBeenCalledOnce();
    expect(mocks.file.play).toHaveBeenCalledTimes(2);
  });

  it('should cancel pending playback and ignore late promises and events after pause', async () => {
    const store = await state();
    let reject: (error: Error) => void = () => undefined;
    mocks.file.play.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => {
      reject = fail;
    }));
    const pending = store.getState().play();
    const stale = callbacks();
    await store.getState().toggle();
    stale.playing(true);
    stale.ended();
    stale.error(new Error('stale'));
    reject(new Error('stale'));
    await pending;
    expect(mocks.file.pause).toHaveBeenCalledOnce();
    expect(mocks.file.play).toHaveBeenCalledOnce();
    expect(store.getState()).toMatchObject({
      busy: false, playing: false, error: false, providedTrackId: 'owner-one',
    });
  });

  it('should keep a newer request busy when an earlier play promise rejects', async () => {
    const store = await state();
    let reject: (error: Error) => void = () => undefined;
    let finish: () => void = () => undefined;
    mocks.file.play.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => {
      reject = fail;
    })).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const first = store.getState().play();
    const second = store.getState().play('owner-two');
    reject(new Error('superseded'));
    await first;
    expect(store.getState()).toMatchObject({ busy: true, error: false, providedTrackId: 'owner-two' });
    finish();
    await second;
    expect(store.getState()).toMatchObject({ busy: false, error: false });
    expect(mocks.file.dispose).not.toHaveBeenCalled();
  });

  it('should release a failed player and ignore its callbacks when playback is retried', async () => {
    const store = await state();
    await store.getState().play();
    const stale = callbacks();
    stale.error(new Error('unavailable'));
    expect(store.getState()).toMatchObject({ playing: false, busy: false, error: true });
    expect(mocks.file.dispose).toHaveBeenCalledOnce();
    await store.getState().play('owner-two');
    stale.playing(true);
    stale.ended();
    stale.error(new Error('stale'));
    expect(mocks.createFile).toHaveBeenCalledTimes(2);
    expect(mocks.file.play).toHaveBeenCalledTimes(2);
    expect(store.getState()).toMatchObject({
      playing: false, busy: false, error: false, providedTrackId: 'owner-two',
    });
  });

  it('should report a rejected play request and permit a retry', async () => {
    const store = await state();
    mocks.file.play.mockRejectedValueOnce(new Error('denied'));
    await store.getState().play();
    expect(store.getState()).toMatchObject({ playing: false, busy: false, error: true });
    expect(mocks.file.dispose).toHaveBeenCalledOnce();
    await store.getState().play();
    expect(store.getState().error).toBe(false);
  });

  it('should remain usable when browser storage is unavailable', async () => {
    vi.stubGlobal('localStorage', {
      getItem: (): never => { throw new Error('disabled'); },
      setItem: (): never => { throw new Error('disabled'); },
    });
    const store = await state();
    await store.getState().play();
    store.getState().setVolume(0.4);
    store.getState().setMode('shuffle');
    expect(store.getState()).toMatchObject({ volume: 0.4, mode: 'shuffle', error: false });
  });
});
