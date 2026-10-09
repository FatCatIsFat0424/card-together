import type { ReactNode } from 'react';
import { PROVIDED_MUSIC_TRACKS } from '../audio/provided-music-catalog';
import { useShallow } from 'zustand/react/shallow';
import type { MusicMode } from '../audio/music-playlist';
import { useI18nStore } from '../stores/i18n-store';
import { useMusicStore } from '../stores/music-store';
import { useTurnSoundStore } from '../stores/turn-sound-store';
import styles from './MusicControl.module.css';

const MODE_ICONS: Record<MusicMode, string> = { 'loop-one': '🔂', sequential: '🔁', shuffle: '🔀' };
const NEXT_MODE: Record<MusicMode, MusicMode> = { 'loop-one': 'sequential', sequential: 'shuffle', shuffle: 'loop-one' };

export function MusicControl(): ReactNode {
  const turnSoundEnabled = useTurnSoundStore((state) => state.enabled);
  const setTurnSoundEnabled = useTurnSoundStore((state) => state.setEnabled);
  const { t } = useI18nStore();
  const { providedTrackId, playing, busy, error, volume, mode, toggle, play, next, prev, setMode, setVolume } = useMusicStore(
    useShallow((state) => ({
      providedTrackId: state.providedTrackId,
      playing: state.playing,
      busy: state.busy,
      error: state.error,
      volume: state.volume,
      mode: state.mode,
      toggle: state.toggle,
      play: state.play,
      next: state.next,
      prev: state.prev,
      setMode: state.setMode,
      setVolume: state.setVolume,
    })),
  );
  const providedTrack = PROVIDED_MUSIC_TRACKS.find((track) => track.id === providedTrackId);
  const hasTracks = PROVIDED_MUSIC_TRACKS.length > 0;

  return (
    <section className={styles.panel} aria-label={t('music.title')}>
      <span className={styles.title}><span aria-hidden="true">♫ </span>{t('music.title')}</span>
      <p className={styles.nowPlaying} aria-live="polite">
        {busy ? t('music.loading') : providedTrack?.title ?? t('music.noTracks')}
      </p>
      <div className={styles.controls}>
        <button type="button" className={styles.control} aria-label={t('music.prev')} title={t('music.prev')}
          disabled={busy || !hasTracks} onClick={() => void prev()}>⏮</button>
        <button type="button" className={styles.control} aria-pressed={playing}
          aria-label={playing || busy ? t('music.pause') : t('music.play')} title={playing || busy ? t('music.pause') : t('music.play')} disabled={!hasTracks} onClick={() => void toggle()}>⏯</button>
        <button type="button" className={styles.control} aria-label={t('music.next')} title={t('music.next')}
          disabled={busy || !hasTracks} onClick={() => void next()}>⏭</button>
        <button type="button" className={styles.control} aria-label={t(`music.${mode}`)} title={t(`music.${mode}`)}
          disabled={busy} onClick={() => setMode(NEXT_MODE[mode])}>{MODE_ICONS[mode]}</button>
      </div>
      <label htmlFor="music-volume" className={styles.volume}>
        <span>{t('music.volume')}</span>
        <input id="music-volume" type="range" min="0" max="100" step="1"
          value={Math.round(volume * 100)} onChange={(event) => setVolume(Number(event.target.value) / 100)} />
        <output htmlFor="music-volume">{Math.round(volume * 100)}%</output>
      </label>
      <ul className={styles.tracks} aria-label={t('music.tracks')}>
        {PROVIDED_MUSIC_TRACKS.map((track) => <li key={track.id}>
          <button type="button" className={styles.track} aria-current={track.id === providedTrackId}
            onClick={() => void play(track.id)}>
            <span>{track.title}</span>
          </button>
        </li>)}
      </ul>
      <div className={styles.soundSetting}>
        <label className={styles.soundToggle}>
          <input type="checkbox" checked={turnSoundEnabled}
            onChange={(event) => setTurnSoundEnabled(event.target.checked)} />
          <span>{t('music.turnSound')}</span>
        </label>
        <p className={styles.attributes}>{t('music.turnSoundHint')}</p>
      </div>
      {error && <p className={styles.error} role="alert">{t('music.error')}</p>}
    </section>
  );
}
