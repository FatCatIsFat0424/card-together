import { create } from 'zustand';
import { AUDIO_UNLOCK_EVENTS } from '../audio/audio-unlock';
import { createFileMusicPlayer } from '../audio/file-music-player';
import type { FileMusicPlayer } from '../audio/file-music-player';
import { nextTrackIndex } from '../audio/music-playlist';
import type { MusicMode } from '../audio/music-playlist';
import { PROVIDED_MUSIC_TRACKS, providedMusicUrl } from '../audio/provided-music-catalog';
import type { ProvidedMusicTrack } from '../audio/provided-music-catalog';
import { readPreference, writePreference } from '../utils/preference-storage';

const VOLUME_KEY = 'music.volume';
const PROVIDED_TRACK_KEY = 'music.provided.track';
const MODE_KEY = 'music.mode';
const DISABLED_GROUPS_KEY = 'music.disabledGroups';
const ENABLED_KEY = 'music.enabled';
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
  /** Groups left out of automatic and previous/next selection; tracks stay directly playable. */
  disabledGroups: readonly string[];
  /** Device-wide music switch: off never autoplays; pressing play turns it back on. */
  enabled: boolean;
  toggle: () => Promise<void>;
  pause: () => Promise<void>;
  play: (trackId?: string) => Promise<void>;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  setMode: (mode: MusicMode) => void;
  setVolume: (volume: number) => void;
  setGroupEnabled: (group: string, enabled: boolean) => void;
  setEnabled: (enabled: boolean) => void;
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

function isPlayable(track: ProvidedMusicTrack, disabledGroups: readonly string[]): boolean {
  return track.group === undefined || !disabledGroups.includes(track.group);
}

/** Saved exclusions for current groups, ignored when they would leave nothing to play. */
function savedDisabledGroups(): string[] {
  let saved: unknown;
  try {
    saved = JSON.parse(readPreference(DISABLED_GROUPS_KEY) ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(saved)) return [];
  const groups = new Set(PROVIDED_MUSIC_TRACKS.map((track) => track.group));
  const disabled = [...new Set(saved.filter((group): group is string =>
    typeof group === 'string' && groups.has(group)))];
  return PROVIDED_MUSIC_TRACKS.some((track) => isPlayable(track, disabled)) ? disabled : [];
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
  const disabledGroups = savedDisabledGroups();
  const playableTracks = PROVIDED_MUSIC_TRACKS.filter((track) => isPlayable(track, disabledGroups));
  const savedTrack = playableTracks.find((track) => track.id === savedTrackId);
  const initialTrack = savedTrack ?? playableTracks[
    mode === 'shuffle' ? Math.floor(Math.random() * playableTracks.length) : 0
  ];
  const step = (direction: 1 | -1, automatic = false): Promise<void> => {
    if (!PROVIDED_MUSIC_TRACKS.length) return Promise.resolve();
    const { providedTrackId, mode, disabledGroups } = get();
    const index = nextTrackIndex(
      providedIndex(providedTrackId),
      PROVIDED_MUSIC_TRACKS.map((track) => isPlayable(track, disabledGroups)),
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
    disabledGroups,
    enabled: readPreference(ENABLED_KEY) !== 'false',
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
      if (!get().enabled) {
        set({ enabled: true });
        writePreference(ENABLED_KEY, null);
      }
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
    setGroupEnabled: (group, enabled) => {
      if (!PROVIDED_MUSIC_TRACKS.some((track) => track.group === group)) return;
      const current = get().disabledGroups;
      if (enabled !== current.includes(group)) return;
      const disabledGroups = enabled ? current.filter((candidate) => candidate !== group) : [...current, group];
      if (!PROVIDED_MUSIC_TRACKS.some((track) => isPlayable(track, disabledGroups))) return;
      set({ disabledGroups });
      writePreference(DISABLED_GROUPS_KEY, disabledGroups.length ? JSON.stringify(disabledGroups) : null);
    },
    setEnabled: (enabled) => {
      if (enabled === get().enabled) return;
      if (enabled) {
        void get().play();
        return;
      }
      set({ enabled: false });
      writePreference(ENABLED_KEY, 'false');
      void get().pause();
    },
  };
});

/**
 * Autoplay unless music is switched off or the player paused earlier in this tab, and retry browser-blocked
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
    if (!sessionPaused() && useMusicStore.getState().enabled) void useMusicStore.getState().play();
  }
  return (): void => {
    for (const event of AUDIO_UNLOCK_EVENTS) target.removeEventListener(event, unlock);
  };
}
