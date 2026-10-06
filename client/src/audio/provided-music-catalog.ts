export interface ProvidedMusicTrack {
  readonly id: string;
  readonly title: string;
  /** File name inside public/provided-music; not an arbitrary URL. */
  readonly file: string;
}

/** An absent generated file means a fresh checkout with no supplied audio. */
const generated = import.meta.glob<readonly ProvidedMusicTrack[]>(
  './provided-music.generated.json', { eager: true, import: 'default' },
);
export const PROVIDED_MUSIC_TRACKS: readonly ProvidedMusicTrack[] = Object.values(generated).flat();

export function validateProvidedMusicCatalog(tracks: readonly ProvidedMusicTrack[]): void {
  const ids = new Set<string>();
  const files = new Set<string>();
  for (const track of tracks) {
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(track.id) || ids.has(track.id)
      || !track.title.trim() || !/^[\p{L}\p{N}_ -]+\.(mp3|ogg|wav|m4a|aac|flac)$/iu.test(track.file)
      || files.has(track.file)) {
      throw new Error('Invalid or duplicate provided music catalog entry');
    }
    ids.add(track.id);
    files.add(track.file);
  }
}

validateProvidedMusicCatalog(PROVIDED_MUSIC_TRACKS);

export function providedMusicUrl(track: ProvidedMusicTrack): string {
  return `${import.meta.env.BASE_URL}provided-music/${encodeURIComponent(track.file)}`;
}
