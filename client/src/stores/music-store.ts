import { create } from 'zustand';
import { createFileMusicPlayer } from '../audio/file-music-player';
import type { FileMusicPlayer } from '../audio/file-music-player';
import { nextTrackIndex } from '../audio/music-playlist';
import type { MusicMode } from '../audio/music-playlist';
import { PROVIDED_MUSIC_TRACKS, providedMusicUrl } from '../audio/provided-music-catalog';
import { readPreference, writePreference } from '../utils/preference-storage';

const VOLUME_KEY = 'music.volume';
const PROVIDED_TRACK_KEY = 'music.provided.track';
const MODE_KEY = 'music.mode';
const DEFAULT_VOLUME = 0.25;
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

function savedVolume(): number {
  const value = Number(readPreference(VOLUME_KEY) ?? DEFAULT_VOLUME);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : DEFAULT_VOLUME;
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
  const fail = (): void => {
    releasePlayer();
    set({ playing: false, busy: false, error: true });
  };

  return {
    playing: false,
    busy: false,
    error: false,
    volume: savedVolume(),
    providedTrackId: PROVIDED_MUSIC_TRACKS[providedIndex(readPreference(PROVIDED_TRACK_KEY))]?.id ?? null,
    mode: MODES.find((mode) => mode === readPreference(MODE_KEY)) ?? 'sequential',
    toggle: async () => get().playing || get().busy ? get().pause() : get().play(),
    pause: async () => {
      playRequest += 1;
      wantsPlayback = false;
      set({ playing: false, busy: false, error: false });
      try {
        player?.pause();
      } catch {
        fail();
      }
    },
    play: async (requestedId) => {
      if (!PROVIDED_MUSIC_TRACKS.length) return;
      const id = requestedId ?? get().providedTrackId;
      const track = PROVIDED_MUSIC_TRACKS.find((candidate) => candidate.id === id);
      if (!track) {
        set({ error: true });
        return;
      }
      const request = ++playRequest;
      wantsPlayback = true;
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
          }, () => {
            if (current()) fail();
          });
        }
        player.setVolume(get().volume);
        await player.play({ ...track, file: providedMusicUrl(track) });
      } catch {
        if (request === playRequest) fail();
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
