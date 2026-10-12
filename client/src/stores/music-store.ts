import { create } from 'zustand';
import { AUDIO_UNLOCK_EVENTS } from '../audio/audio-unlock';
import { createFileMusicPlayer } from '../audio/file-music-player';
import type { FileMusicPlayer } from '../audio/file-music-player';
import { nextTrackIndex } from '../audio/music-playlist';
import type { MusicMode } from '../audio/music-playlist';
import { PROVIDED_MUSIC_TRACKS, providedMusicUrl } from '../audio/provided-music-catalog';
import { readPreference, writePreference } from '../utils/preference-storage';

const VOLUME_KEY = 'music.volume';
const PROVIDED_TRACK_KEY = 'music.provided.track';
const MODE_KEY = 'music.mode';
// Tab-scoped so a reload keeps the player's pause while a new tab autoplays again.
const SESSION_PAUSED_KEY = 'card-together.music.paused';
const DEFAULT_VOLUME = 0.5;
const MODES: readonly MusicMode[] = ['loop-one', 'sequential', 'shuffle'];

interface MusicState {
  playing: boolean;
  busy: boolean;
  error: boolean;
  volume: number;
  providedTrackId: string | null;
  mode: MusicMode;
  toggle: () => Promise<void>;
  pause: () => Promise<void>;
  play: (trackId?: string) => Promise<void>;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  setMode: (mode: MusicMode) => void;
  setVolume: (volume: number) => void;
}

let player: FileMusicPlayer | null = null;
let playRequest = 0;
let transportGeneration = 0;
let wantsPlayback = false;
let autoplayStarted = false;
let awaitingAutoplayUnlock = false;

function savedVolume(): number {
  const value = Number(readPreference(VOLUME_KEY) ?? DEFAULT_VOLUME);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : DEFAULT_VOLUME;
}

function setSessionPaused(paused: boolean): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (paused) sessionStorage.setItem(SESSION_PAUSED_KEY, 'true');
    else sessionStorage.removeItem(SESSION_PAUSED_KEY);
  } catch {
    // Storage is optional; without it every page load autoplays.
  }
}

function sessionPaused(): boolean {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(SESSION_PAUSED_KEY) === 'true';
  } catch {
    return false;
  }
}

function providedIndex(trackId: string | null): number {
  return Math.max(0, PROVIDED_MUSIC_TRACKS.findIndex((track) => track.id === trackId));
}

/** Invalidate pending requests and callbacks before disposing the failed transport. */
function releasePlayer(): void {
  playRequest += 1;
  transportGeneration += 1;
  wantsPlayback = false;
  const previous = player;
  player = null;
  previous?.dispose();
}

export const useMusicStore = create<MusicState>((set, get) => {
  const mode = MODES.find((candidate) => candidate === readPreference(MODE_KEY)) ?? 'shuffle';
  const savedTrackId = readPreference(PROVIDED_TRACK_KEY);
  const savedTrack = PROVIDED_MUSIC_TRACKS.find((track) => track.id === savedTrackId);
  const initialTrack = savedTrack ?? PROVIDED_MUSIC_TRACKS[
    mode === 'shuffle' ? Math.floor(Math.random() * PROVIDED_MUSIC_TRACKS.length) : 0
  ];
  const step = (direction: 1 | -1, automatic = false): Promise<void> => {
    if (!PROVIDED_MUSIC_TRACKS.length) return Promise.resolve();
    const { providedTrackId, mode } = get();
    const index = nextTrackIndex(
      providedIndex(providedTrackId),
      PROVIDED_MUSIC_TRACKS.length,
      !automatic && mode === 'loop-one' ? 'sequential' : mode,
      Math.random,
      direction,
    );
    return get().play(PROVIDED_MUSIC_TRACKS[index].id);
  };
  const fail = (error?: Error): void => {
    releasePlayer();
    awaitingAutoplayUnlock = error?.name === 'NotAllowedError';
    set({ playing: false, busy: false, error: !awaitingAutoplayUnlock });
  };

  return {
    playing: false,
    busy: false,
    error: false,
    volume: savedVolume(),
    providedTrackId: initialTrack?.id ?? null,
    mode,
    toggle: async () => get().playing || get().busy ? get().pause() : get().play(),
    pause: async () => {
      awaitingAutoplayUnlock = false;
      playRequest += 1;
      wantsPlayback = false;
      setSessionPaused(true);
      set({ playing: false, busy: false, error: false });
      try {
        player?.pause();
      } catch {
        fail();
      }
    },
    play: async (requestedId) => {
      awaitingAutoplayUnlock = false;
      if (!PROVIDED_MUSIC_TRACKS.length) return;
      const id = requestedId ?? get().providedTrackId;
      const track = PROVIDED_MUSIC_TRACKS.find((candidate) => candidate.id === id);
      if (!track) {
        set({ error: true });
        return;
      }
      const request = ++playRequest;
      wantsPlayback = true;
      setSessionPaused(false);
      set({ providedTrackId: track.id, busy: true, error: false });
      writePreference(PROVIDED_TRACK_KEY, track.id);
      try {
        if (!player) {
          const generation = transportGeneration;
          const current = (): boolean => generation === transportGeneration && wantsPlayback;
          player = createFileMusicPlayer((playing) => {
            if (current()) {
              set({ playing, ...(playing ? { busy: false, error: false } : {}) });
            }
          }, () => {
            if (current()) void step(1, true);
          }, (error) => {
            if (current()) fail(error);
          });
        }
        player.setVolume(get().volume);
        await player.play({ ...track, file: providedMusicUrl(track) });
      } catch (error: unknown) {
        if (request === playRequest) fail(error instanceof Error ? error : undefined);
      } finally {
        if (request === playRequest) set({ busy: false });
      }
    },
    next: () => step(1),
    prev: () => step(-1),
    setMode: (mode) => {
      if (!MODES.includes(mode)) return;
      set({ mode });
      writePreference(MODE_KEY, mode);
    },
    setVolume: (value) => {
      if (!Number.isFinite(value)) return;
      const volume = Math.max(0, Math.min(1, value));
      set({ volume });
      player?.setVolume(volume);
      writePreference(VOLUME_KEY, String(volume));
    },
  };
});

/**
 * Autoplay unless the player paused earlier in this tab, and retry browser-blocked
 * playback in a trusted gesture without restarting paused music.
 */
export function startMusicAutoplay(target: Document = document): () => void {
  const unlock = (event: Event): void => {
    // Let transport buttons handle their own click, including clicks after touchend.
    if (event.composedPath().some((target) => target instanceof Element
      && target.closest('[data-music-transport]'))) return;
    if (event.isTrusted && awaitingAutoplayUnlock) void useMusicStore.getState().play();
  };
  for (const event of AUDIO_UNLOCK_EVENTS) target.addEventListener(event, unlock);
  // The player outlives React effects, including StrictMode's setup/cleanup cycle.
  if (!autoplayStarted) {
    autoplayStarted = true;
    if (!sessionPaused()) void useMusicStore.getState().play();
  }
  return (): void => {
    for (const event of AUDIO_UNLOCK_EVENTS) target.removeEventListener(event, unlock);
  };
}
