export interface ProvidedMusicTrack {
  readonly id: string;
  readonly title: string;
  /** File name inside public/provided-music; not an arbitrary URL. */
  readonly file: string;
  /** First-level source folder; absent for files at the music root. */
  readonly group?: string;
  /** Thumbnail file name inside public/provided-music; absent when the track has no artwork. */
  readonly cover?: string;
}

const COVER_FILE = /^imported-cover-[a-f0-9]{24}\.webp$/;

export function validateProvidedMusicCatalog(tracks: readonly ProvidedMusicTrack[]): void {
  const ids = new Set<string>();
  const files = new Set<string>();
  for (const track of tracks) {
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(track.id) || ids.has(track.id)
      || !track.title.trim() || !/^[\p{L}\p{N}_ -]+\.(mp3|ogg|wav|m4a|aac|flac|opus)$/iu.test(track.file)
      || files.has(track.file) || (track.group !== undefined && !track.group.trim())
      || (track.cover !== undefined && !COVER_FILE.test(track.cover))) {
      throw new Error('Invalid or duplicate provided music catalog entry');
    }
    ids.add(track.id);
    files.add(track.file);
  }
}
