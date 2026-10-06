const DEFAULT_LOAD_TIMEOUT_MS = 15_000;

export interface FileMusicTrack {
  readonly id: string;
  readonly title: string;
  readonly file: string;
}

export interface FileMusicPlayerOptions {
  readonly createAudio?: () => HTMLAudioElement;
  readonly loadTimeoutMs?: number;
}

export interface FileMusicPlayer {
  play: (track: FileMusicTrack) => Promise<void>;
  pause: () => void;
  seekBy: (seconds: number) => void;
  setVolume: (volume: number) => void;
  dispose: () => void;
}

interface PlayRequest {
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

function asPlaybackError(error: unknown): Error {
  return error instanceof Error ? error : new Error('Audio playback failed');
}

/** Keep this transport at application scope so closing its controls preserves playback. */
export function createFileMusicPlayer(
  onPlayingChange: (playing: boolean) => void,
  onTrackEnd: () => void,
  onError: (error: Error) => void = (): void => undefined,
  options: FileMusicPlayerOptions = {},
): FileMusicPlayer {
  const createAudio = options.createAudio ?? ((): HTMLAudioElement => new Audio());
  const configuredTimeout = options.loadTimeoutMs;
  const timeoutMs = configuredTimeout !== undefined && Number.isFinite(configuredTimeout)
    && configuredTimeout > 0 ? configuredTimeout : DEFAULT_LOAD_TIMEOUT_MS;
  let audio: HTMLAudioElement | null = null;
  let selected: FileMusicTrack | null = null;
  let removeListeners: (() => void) | null = null;
  let pending: PlayRequest | null = null;
  let pendingSeek: number | null = null;
  let volume = 0.25;
  let wantsPlayback = false;
  let playing = false;
  let ended = false;
  let failed = false;
  let disposed = false;

  const notifyPlaying = (value: boolean): void => {
    if (playing === value || disposed) return;
    playing = value;
    onPlayingChange(value);
  };

  const finish = (error?: Error): void => {
    const request = pending;
    pending = null;
    if (!request) return;
    if (request.timer !== null) clearTimeout(request.timer);
    if (error) request.reject(error);
    else request.resolve();
  };

  const releaseAudio = (): void => {
    removeListeners?.();
    removeListeners = null;
    const previous = audio;
    audio = null;
    if (!previous) return;
    previous.pause();
    previous.removeAttribute('src');
    previous.load();
  };

  const fail = (error: Error): void => {
    if (disposed) return;
    wantsPlayback = false;
    failed = true;
    pendingSeek = null;
    releaseAudio();
    notifyPlaying(false);
    finish(error);
    onError(error);
  };

  const applySeek = (): void => {
    if (!audio || pendingSeek === null || audio.readyState === 0
      || Number.isNaN(audio.duration)) return;
    const target = Math.max(0, Math.min(audio.duration, pendingSeek));
    try {
      audio.currentTime = target;
      pendingSeek = null;
    } catch {
      // Some browsers defer seeking until enough metadata has arrived.
    }
  };

  const initialize = (track: FileMusicTrack): HTMLAudioElement => {
    releaseAudio();
    pendingSeek = null;
    const element = createAudio();
    audio = element;
    selected = { ...track };
    failed = false;
    ended = false;
    element.preload = 'metadata';
    element.volume = volume;
    const active = (): boolean => !disposed && audio === element;
    const listeners: ReadonlyArray<readonly [string, () => void]> = [
      ['playing', (): void => {
        if (!active()) return;
        if (!wantsPlayback) {
          element.pause();
          return;
        }
        notifyPlaying(true);
      }],
      ['pause', (): void => { if (active()) notifyPlaying(false); }],
      ['waiting', (): void => { if (active()) notifyPlaying(false); }],
      ['loadedmetadata', (): void => { if (active()) applySeek(); }],
      ['canplay', (): void => { if (active()) applySeek(); }],
      ['ended', (): void => {
        if (!active() || !wantsPlayback || ended || !element.ended) return;
        ended = true;
        wantsPlayback = false;
        notifyPlaying(false);
        finish();
        onTrackEnd();
      }],
      ['error', (): void => {
        if (!active() || (!wantsPlayback && !pending)) return;
        fail(new Error(element.error?.message || 'Audio file could not be loaded'));
      }],
    ];
    for (const [event, listener] of listeners) element.addEventListener(event, listener);
    removeListeners = (): void => {
      for (const [event, listener] of listeners) element.removeEventListener(event, listener);
    };
    element.src = track.file;
    return element;
  };

  return {
    play(track: FileMusicTrack): Promise<void> {
      if (disposed) return Promise.resolve();
      finish();
      wantsPlayback = false;
      let element: HTMLAudioElement;
      try {
        const switching = !audio || failed || selected?.id !== track.id
          || selected.file !== track.file;
        if (switching) notifyPlaying(false);
        element = switching ? initialize(track) : audio!;
        if (ended || element.ended) {
          element.currentTime = 0;
          pendingSeek = null;
        }
        ended = false;
      } catch (error: unknown) {
        const playbackError = asPlaybackError(error);
        fail(playbackError);
        return Promise.reject(playbackError);
      }
      wantsPlayback = true;
      return new Promise<void>((resolve, reject): void => {
        const request: PlayRequest = { resolve, reject, timer: null };
        pending = request;
        request.timer = setTimeout((): void => {
          if (pending === request) fail(new Error('Audio playback timed out'));
        }, timeoutMs);
        try {
          void Promise.resolve(element.play()).then((): void => {
            if (disposed || audio !== element || !wantsPlayback) {
              element.pause();
              return;
            }
            if (pending !== request) return;
            notifyPlaying(true);
            finish();
          }).catch((error: unknown): void => {
            if (!disposed && audio === element && pending === request) {
              fail(asPlaybackError(error));
            }
          });
        } catch (error: unknown) {
          fail(asPlaybackError(error));
        }
      });
    },
    pause(): void {
      if (disposed) return;
      wantsPlayback = false;
      finish();
      audio?.pause();
      notifyPlaying(false);
    },
    seekBy(seconds: number): void {
      if (disposed || !audio || !Number.isFinite(seconds)) return;
      const position = pendingSeek ?? audio.currentTime;
      pendingSeek = Math.max(0, position + seconds);
      applySeek();
    },
    setVolume(value: number): void {
      if (disposed || !Number.isFinite(value)) return;
      volume = Math.max(0, Math.min(1, value));
      if (audio) audio.volume = volume;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      wantsPlayback = false;
      finish();
      releaseAudio();
      selected = null;
      pendingSeek = null;
    },
  };
}
