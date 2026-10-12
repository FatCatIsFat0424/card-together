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
