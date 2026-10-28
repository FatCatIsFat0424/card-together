import { validateProvidedMusicCatalog } from './validate-provided-music-catalog';
import type { ProvidedMusicTrack } from './validate-provided-music-catalog';
export { validateProvidedMusicCatalog } from './validate-provided-music-catalog';
export type { ProvidedMusicTrack } from './validate-provided-music-catalog';

/** An absent generated file means a fresh checkout with no supplied audio. */
const generated = import.meta.glob<readonly ProvidedMusicTrack[]>(
  './provided-music.generated.json', { eager: true, import: 'default' },
);
export const PROVIDED_MUSIC_TRACKS: readonly ProvidedMusicTrack[] = Object.values(generated).flat();


validateProvidedMusicCatalog(PROVIDED_MUSIC_TRACKS);

export function providedMusicUrl(track: ProvidedMusicTrack): string {
  return `${import.meta.env.BASE_URL}provided-music/${encodeURIComponent(track.file)}`;
}

/** Thumbnail URL for a track, or null when it has no artwork. */
export function providedMusicCoverUrl(track: ProvidedMusicTrack): string | null {
  return track.cover === undefined ? null : `${import.meta.env.BASE_URL}provided-music/${encodeURIComponent(track.cover)}`;
}

/** An album shows the artwork of its first track that has any. */
export function albumCoverUrl(tracks: readonly ProvidedMusicTrack[]): string | null {
  for (const track of tracks) {
    const url = providedMusicCoverUrl(track);
    if (url) return url;
  }
  return null;
}

export interface ProvidedMusicGroup {
  /** Undefined for tracks at the music root. */
  readonly name?: string;
  readonly tracks: readonly ProvidedMusicTrack[];
}

/** Groups consecutive tracks so the displayed order matches playback order. */
export function groupProvidedMusicTracks(tracks: readonly ProvidedMusicTrack[]): ProvidedMusicGroup[] {
  const groups: { name?: string; tracks: ProvidedMusicTrack[] }[] = [];
  for (const track of tracks) {
    const last = groups.at(-1);
    if (last && last.name === track.group) last.tracks.push(track);
    else groups.push({ name: track.group, tracks: [track] });
  }
  return groups;
}
