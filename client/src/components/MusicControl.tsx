import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { PROVIDED_MUSIC_TRACKS, groupProvidedMusicTracks } from '../audio/provided-music-catalog';
import type { ProvidedMusicTrack } from '../audio/provided-music-catalog';
import { useShallow } from 'zustand/react/shallow';
import type { MusicMode } from '../audio/music-playlist';
import { useI18nStore } from '../stores/i18n-store';
import { useMusicStore } from '../stores/music-store';
import type { AppIconName } from './AppIcon';
import { AppCheckbox } from './AppCheckbox';
import { AppIcon } from './AppIcon';
import { AudioSettingsButton } from './AudioSettings';
import styles from './MusicControl.module.css';

const MODE_ICONS: Record<MusicMode, AppIconName> = { 'loop-one': 'repeatOne', sequential: 'repeat', shuffle: 'shuffle' };
const NEXT_MODE: Record<MusicMode, MusicMode> = { 'loop-one': 'sequential', sequential: 'shuffle', shuffle: 'loop-one' };
const TRACK_GROUPS = groupProvidedMusicTracks(PROVIDED_MUSIC_TRACKS);
const HAS_UNGROUPED_TRACKS = TRACK_GROUPS.some((group) => group.name === undefined);

export function MusicControl(): ReactNode {
  const { t } = useI18nStore();
  const {
    providedTrackId, playing, busy, error, mode, disabledGroups,
    toggle, play, next, prev, setMode, setGroupEnabled,
  } = useMusicStore(
    useShallow((state) => ({
      providedTrackId: state.providedTrackId,
      playing: state.playing,
      busy: state.busy,
      error: state.error,
      mode: state.mode,
      disabledGroups: state.disabledGroups,
      toggle: state.toggle,
      play: state.play,
      next: state.next,
      prev: state.prev,
      setMode: state.setMode,
      setGroupEnabled: state.setGroupEnabled,
    })),
  );
  const groupId = useId();
  const providedTrack = PROVIDED_MUSIC_TRACKS.find((track) => track.id === providedTrackId);
  // Open only the current group so a long catalog starts at what is playing.
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(
    () => new Set(providedTrack?.group === undefined ? [] : [providedTrack.group]),
  );
  const hasTracks = PROVIDED_MUSIC_TRACKS.length > 0;
  const enabledGroupCount = TRACK_GROUPS.filter((group) =>
    group.name !== undefined && !disabledGroups.includes(group.name)).length;
  const toggleExpanded = (name: string): void => setExpandedGroups((current) => {
    const expanded = new Set(current);
    if (!expanded.delete(name)) expanded.add(name);
    return expanded;
  });
  const renderTrack = (track: ProvidedMusicTrack): ReactNode => (
    <button type="button" data-music-transport className={styles.track} aria-current={track.id === providedTrackId}
      onClick={() => void play(track.id)}>
      <span>{track.title}</span>
    </button>
  );

  return (
    <section className={styles.panel} aria-label={t('music.title')}>
      <span className={styles.title}><AppIcon name="music" /> {t('music.title')}</span>
      <p className={styles.nowPlaying} aria-live="polite">
        {busy ? t('music.loading') : providedTrack ? <>
          {providedTrack.group !== undefined && <span className={styles.nowPlayingGroup}>{providedTrack.group} · </span>}
          {providedTrack.title}
        </> : t('music.noTracks')}
      </p>
      <div className={styles.controls}>
        <button type="button" data-music-transport className={styles.control} aria-label={t('music.prev')} title={t('music.prev')}
          disabled={busy || !hasTracks} onClick={() => void prev()}><AppIcon name="previous" /></button>
        <button type="button" data-music-transport className={styles.control} aria-pressed={playing}
          aria-label={playing || busy ? t('music.pause') : t('music.play')} title={playing || busy ? t('music.pause') : t('music.play')} disabled={!hasTracks} onClick={() => void toggle()}><AppIcon name={playing || busy ? 'pause' : 'play'} /></button>
        <button type="button" data-music-transport className={styles.control} aria-label={t('music.next')} title={t('music.next')}
          disabled={busy || !hasTracks} onClick={() => void next()}><AppIcon name="next" /></button>
        <button type="button" className={styles.control} aria-label={t(`music.${mode}`)} title={t(`music.${mode}`)}
          disabled={busy} onClick={() => setMode(NEXT_MODE[mode])}><AppIcon name={MODE_ICONS[mode]} /></button>
      </div>
      <AudioSettingsButton className={styles.audioSettings} />
      <ul className={styles.tracks} aria-label={t('music.tracks')}>
        {TRACK_GROUPS.map((group, index) => {
          if (group.name === undefined) return group.tracks.map((track) => <li key={track.id}>{renderTrack(track)}</li>);
          const name = group.name;
          const enabled = !disabledGroups.includes(name);
          const expanded = expandedGroups.has(name);
          const listId = `${groupId}-${index}`;
          return <li key={`group:${name}`} className={styles.group} data-enabled={enabled}>
            <div className={styles.groupHeader}>
              <AppCheckbox checked={enabled} disabled={enabled && enabledGroupCount === 1 && !HAS_UNGROUPED_TRACKS}
                slotProps={{ input: { 'aria-label': t('music.includeGroup', { group: name }) } }}
                onChange={(event) => setGroupEnabled(name, event.target.checked)} />
              <button type="button" className={styles.groupToggle} aria-expanded={expanded} aria-controls={listId}
                onClick={() => toggleExpanded(name)}>
                <AppIcon name="nextPage" className={styles.chevron} />
                <span className={styles.groupName}>{name}</span>
                <span className={styles.groupCount}>{group.tracks.length}</span>
              </button>
            </div>
            {expanded && <ul id={listId} aria-label={name}>
              {group.tracks.map((track) => <li key={track.id}>{renderTrack(track)}</li>)}
            </ul>}
          </li>;
        })}
      </ul>
      {error && <p className={styles.error} role="alert">{t('music.error')}</p>}
    </section>
  );
}
