import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  file: { play: vi.fn(), pause: vi.fn(), setVolume: vi.fn(), dispose: vi.fn() },
  createFile: vi.fn(),
  tracks: [] as { id: string; title: string; file: string; group?: string }[],
}));
vi.mock('../../../client/src/audio/file-music-player', () => ({
  createFileMusicPlayer: mocks.createFile,
}));
vi.mock('../../../client/src/audio/provided-music-catalog', () => ({
  PROVIDED_MUSIC_TRACKS: mocks.tracks,
  providedMusicUrl: (track: { file: string }): string => `/provided-music/${track.file}`,
}));
let storage: Map<string, string>;
let session: Map<string, string>;
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.spyOn(Math, 'random').mockReturnValue(0);
  mocks.tracks.splice(0, mocks.tracks.length,
    { id: 'owner-one', title: 'One', file: 'one.mp3' },
    { id: 'owner-two', title: 'Two', file: 'two.mp3' });
  storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string): string | null => storage.get(key) ?? null,
    setItem: (key: string, value: string): void => { storage.set(key, value); },
    removeItem: (key: string): void => { storage.delete(key); },
  });
  session = new Map();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string): string | null => session.get(key) ?? null,
    setItem: (key: string, value: string): void => { session.set(key, value); },
    removeItem: (key: string): void => { session.delete(key); },
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

function autoplayTarget(): {
  target: Document;
  gesture: (name: string, trusted?: boolean, target?: Element, path?: readonly EventTarget[]) => void;
  listeners: Map<string, (event: Event) => void>;
} {
  const listeners = new Map<string, (event: Event) => void>();
  const target = {
    addEventListener: (name: string, listener: (event: Event) => void): void => {
      listeners.set(name, listener);
    },
    removeEventListener: (name: string): void => { listeners.delete(name); },
  } as unknown as Document;
  vi.stubGlobal('Element', class {
    closest(): null { return null; }
  });
  return { target, listeners, gesture: (name, trusted = true, target, path): void => {
    listeners.get(name)?.({ isTrusted: trusted, target: target ?? null,
      composedPath: () => path ?? (target ? [target] : []) } as unknown as Event);
  } };
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
  it('should choose a random first track for new visitors', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const store = await state();
    expect(store.getState()).toMatchObject({ providedTrackId: 'owner-two', mode: 'shuffle', volume: 0.5 });
    await store.getState().play();
    expect(mocks.file.setVolume).toHaveBeenLastCalledWith(0.5);
    expect(mocks.file.play).toHaveBeenLastCalledWith({
      id: 'owner-two', title: 'Two', file: '/provided-music/two.mp3',
    });
  });

  it('should retain sequential mode and a saved silent volume', async () => {
    storage.set('card-together.music.mode', 'sequential');
    storage.set('card-together.music.volume', '0');
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const store = await state();
    expect(store.getState()).toMatchObject({ providedTrackId: 'owner-one', mode: 'sequential', volume: 0 });
  });

  it('should start autoplay once and preserve pause across effect remounts', async () => {
    const store = await state();
    const { startMusicAutoplay } = await import('../../../client/src/stores/music-store');
    const { target, gesture, listeners } = autoplayTarget();
    const cleanup = startMusicAutoplay(target);
    await Promise.resolve();
    expect(mocks.file.play).toHaveBeenCalledOnce();
    cleanup();
    expect(listeners.size).toBe(0);
    const cleanupAgain = startMusicAutoplay(target);
    callbacks().playing(true);
    await store.getState().pause();
    gesture('click');
    expect(mocks.file.play).toHaveBeenCalledOnce();
    cleanupAgain();
  });

  it('should keep a pause made in this tab across reloads', async () => {
    const store = await state();
    await store.getState().pause();
    expect(session.get('card-together.music.paused')).toBe('true');
    vi.resetModules();
    const { startMusicAutoplay } = await import('../../../client/src/stores/music-store');
    const { target, gesture } = autoplayTarget();
    const cleanup = startMusicAutoplay(target);
    gesture('click');
    expect(mocks.file.play).not.toHaveBeenCalled();
    cleanup();
  });

  it('should autoplay again after the player resumes in this tab', async () => {
    const store = await state();
    await store.getState().pause();
    await store.getState().play();
    expect(session.has('card-together.music.paused')).toBe(false);
    vi.resetModules();
    const { startMusicAutoplay } = await import('../../../client/src/stores/music-store');
    const cleanup = startMusicAutoplay(autoplayTarget().target);
    expect(mocks.file.play).toHaveBeenCalledTimes(2);
    cleanup();
  });

  it('should not treat a blocked autoplay as a pause', async () => {
    const { startMusicAutoplay } = await import('../../../client/src/stores/music-store');
    mocks.file.play.mockRejectedValueOnce(new DOMException('Blocked', 'NotAllowedError'));
    const cleanup = startMusicAutoplay(autoplayTarget().target);
    await Promise.resolve();
    expect(session.has('card-together.music.paused')).toBe(false);
    cleanup();
  });

  it.each(['pointerdown', 'keydown', 'click', 'touchend'])(
    'should retry blocked autoplay on trusted %s without reporting a media error', async (event) => {
      const store = await state();
      const { startMusicAutoplay } = await import('../../../client/src/stores/music-store');
      const { target, gesture } = autoplayTarget();
      const denied = new DOMException('User activation required', 'NotAllowedError');
      mocks.file.play.mockImplementationOnce(() => {
        callbacks().error(denied);
        return Promise.reject(denied);
      });
      const cleanup = startMusicAutoplay(target);
      await Promise.resolve();
      expect(store.getState()).toMatchObject({ busy: false, playing: false, error: false });
      gesture(event, false);
      expect(mocks.file.play).toHaveBeenCalledOnce();
      gesture(event);
      await Promise.resolve();
      expect(mocks.file.play).toHaveBeenCalledTimes(2);
      expect(mocks.file.dispose).toHaveBeenCalledOnce();
      gesture('click');
      expect(mocks.file.play).toHaveBeenCalledTimes(2);
      cleanup();
    },
  );

  it('should cancel blocked autoplay when paused', async () => {
    const store = await state();
    const { startMusicAutoplay } = await import('../../../client/src/stores/music-store');
    const { target, gesture } = autoplayTarget();
    mocks.file.play.mockRejectedValueOnce(new DOMException('Blocked', 'NotAllowedError'));
    const cleanup = startMusicAutoplay(target);
    await Promise.resolve();
    await store.getState().pause();
    gesture('touchend');
    gesture('click');
    expect(mocks.file.play).toHaveBeenCalledOnce();
    cleanup();
  });

  it('should ignore an autoplay denial that arrives after pause', async () => {
    const store = await state();
    const { startMusicAutoplay } = await import('../../../client/src/stores/music-store');
    const { target, gesture } = autoplayTarget();
    let reject: (error: Error) => void = () => undefined;
    mocks.file.play.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    const cleanup = startMusicAutoplay(target);
    const stale = callbacks();
    await store.getState().pause();
    const denied = new DOMException('Blocked', 'NotAllowedError');
    stale.error(denied);
    reject(denied);
    await Promise.resolve();
    gesture('click');
    expect(store.getState()).toMatchObject({ busy: false, playing: false, error: false });
    expect(mocks.file.play).toHaveBeenCalledOnce();
    cleanup();
  });

  it('should leave transport gestures to the manual click handler', async () => {
    const store = await state();
    const { startMusicAutoplay } = await import('../../../client/src/stores/music-store');
    const { target, gesture } = autoplayTarget();
    const button = new Element();
    vi.spyOn(button, 'closest').mockReturnValue(button);
    mocks.file.play.mockRejectedValueOnce(new DOMException('Blocked', 'NotAllowedError'));
    const cleanup = startMusicAutoplay(target);
    await Promise.resolve();
    gesture('pointerdown', true, button);
    gesture('touchend', true, button);
    gesture('keydown', true, button);
    expect(mocks.file.play).toHaveBeenCalledOnce();
    await store.getState().toggle();
    const removedIcon = new Element();
    gesture('click', true, removedIcon, [removedIcon, button]);
    expect(mocks.file.play).toHaveBeenCalledTimes(2);
    expect(mocks.file.pause).not.toHaveBeenCalled();
    cleanup();
  });

  it('should report media failures without retrying them on unrelated gestures', async () => {
    const store = await state();
    const { startMusicAutoplay } = await import('../../../client/src/stores/music-store');
    const { target, gesture } = autoplayTarget();
    mocks.file.play.mockRejectedValueOnce(new Error('Missing file'));
    const cleanup = startMusicAutoplay(target);
    await Promise.resolve();
    expect(store.getState().error).toBe(true);
    gesture('click');
    expect(mocks.file.play).toHaveBeenCalledOnce();
    cleanup();
  });

  it('should select provided files without allocating or playing audio', async () => {
    const store = await state();
    expect(store.getState()).toMatchObject({ playing: false, busy: false, error: false,
      providedTrackId: 'owner-one', mode: 'shuffle', volume: 0.5 });
    for (const retired of ['source', 'trackId', 'setSource', 'seekBy']) {
      expect(store.getState()).not.toHaveProperty(retired);
    }
    expect(mocks.createFile).not.toHaveBeenCalled();
  });

  it.each(['midnight-postcard'])(
    'should ignore the saved original source and track %s', async (id) => {
      storage.set('bridge.music.source', 'local');
      storage.set('bridge.music.track', id);
      const store = await state();
      expect(store.getState()).toMatchObject({ providedTrackId: 'owner-one', mode: 'shuffle' });
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
      providedTrackId: 'owner-one', mode: 'shuffle', volume: 0.5,
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
    store.getState().setMode('sequential');
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
    await store.getState().play('owner-one');
    callbacks().ended();
    expect(store.getState().providedTrackId).toBe('owner-three');
    callbacks().ended();
    expect(store.getState().providedTrackId).toBe('owner-two');
  });

  it('should play only selected groups while keeping deselected tracks directly playable', async () => {
    mocks.tracks.splice(0, mocks.tracks.length,
      { id: 'root', title: 'Root', file: 'root.mp3' },
      { id: 'a-one', title: 'A1', file: 'a1.mp3', group: 'A' },
      { id: 'a-two', title: 'A2', file: 'a2.mp3', group: 'A' },
      { id: 'b-one', title: 'B1', file: 'b1.mp3', group: 'B' });
    const store = await state();
    store.getState().setMode('sequential');
    store.getState().setGroupEnabled('A', false);
    expect(store.getState().disabledGroups).toEqual(['A']);
    expect(storage.get('card-together.music.disabledGroups')).toBe('["A"]');
    await store.getState().play('root');
    await store.getState().next();
    expect(store.getState().providedTrackId).toBe('b-one');
    await store.getState().play('a-one');
    expect(store.getState().providedTrackId).toBe('a-one');
    callbacks().ended();
    expect(store.getState().providedTrackId).toBe('b-one');
    store.getState().setGroupEnabled('A', true);
    expect(store.getState().disabledGroups).toEqual([]);
    expect(storage.has('card-together.music.disabledGroups')).toBe(false);
  });

  it('should keep at least one group playable and ignore unknown groups', async () => {
    mocks.tracks.splice(0, mocks.tracks.length,
      { id: 'a-one', title: 'A1', file: 'a1.mp3', group: 'A' },
      { id: 'b-one', title: 'B1', file: 'b1.mp3', group: 'B' });
    const store = await state();
    store.getState().setGroupEnabled('missing', false);
    store.getState().setGroupEnabled('A', false);
    store.getState().setGroupEnabled('B', false);
    expect(store.getState().disabledGroups).toEqual(['A']);
  });

  it('should restore saved group selection and start from a selected group', async () => {
    mocks.tracks.splice(0, mocks.tracks.length,
      { id: 'a-one', title: 'A1', file: 'a1.mp3', group: 'A' },
      { id: 'b-one', title: 'B1', file: 'b1.mp3', group: 'B' });
    storage.set('card-together.music.disabledGroups', '["A","removed",3]');
    storage.set('card-together.music.provided.track', 'a-one');
    const store = await state();
    expect(store.getState()).toMatchObject({ disabledGroups: ['A'], providedTrackId: 'b-one' });
  });

  it.each(['not json', '{"A":true}', '["A","B"]'])(
    'should ignore an unusable saved group selection %s', async (saved) => {
      mocks.tracks.splice(0, mocks.tracks.length,
        { id: 'a-one', title: 'A1', file: 'a1.mp3', group: 'A' },
        { id: 'b-one', title: 'B1', file: 'b1.mp3', group: 'B' });
      storage.set('card-together.music.disabledGroups', saved);
      const store = await state();
      expect(store.getState().disabledGroups).toEqual([]);
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
    expect(store.getState()).toMatchObject({ volume: 1, mode: 'shuffle' });
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
    for (const name of ['localStorage', 'sessionStorage']) {
      vi.stubGlobal(name, {
        getItem: (): never => { throw new Error('disabled'); },
        setItem: (): never => { throw new Error('disabled'); },
        removeItem: (): never => { throw new Error('disabled'); },
      });
    }
    const store = await state();
    const { startMusicAutoplay } = await import('../../../client/src/stores/music-store');
    const cleanup = startMusicAutoplay(autoplayTarget().target);
    expect(mocks.file.play).toHaveBeenCalledOnce();
    cleanup();
    await store.getState().pause();
    await store.getState().play();
    store.getState().setVolume(0.4);
    store.getState().setMode('shuffle');
    expect(store.getState()).toMatchObject({ volume: 0.4, mode: 'shuffle', error: false });
  });
});
