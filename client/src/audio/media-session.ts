import { providedMusicCoverUrl } from './provided-music-catalog';
import type { ProvidedMusicTrack } from './provided-music-catalog';

/** Shows the track and its artwork in the system media controls (lock screen, notification, media keys). */
export function updateMediaSession(track: ProvidedMusicTrack): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
  const cover = providedMusicCoverUrl(track);
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.group ?? '',
      album: track.group ?? '',
      // Some platforms need an absolute URL, and the catalog URL is relative to the deployment base.
      artwork: cover ? [{ src: new URL(cover, globalThis.location.href).href, sizes: '160x160', type: 'image/webp' }] : [],
    });
  } catch {
    // Media Session is decorative; a platform that rejects the metadata must not affect playback.
  }
}
