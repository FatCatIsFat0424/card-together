import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { PROVIDED_MUSIC_TRACKS, groupProvidedMusicTracks } from '../audio/provided-music-catalog';
import type { ProvidedMusicTrack } from '../audio/provided-music-catalog';
import { coverGradient } from '../audio/music-cover';
import { useShallow } from 'zustand/react/shallow';
import type { MusicMode } from '../audio/music-playlist';
import { useAudioSettingsDialogStore } from '../stores/audio-settings-dialog-store';
import { useI18nStore } from '../stores/i18n-store';
import { useMusicStore } from '../stores/music-store';
import type { AppIconName } from './AppIcon';
import { AppCheckbox } from './AppCheckbox';
import { AppIcon } from './AppIcon';
import styles from './MusicControl.module.css';

const MODE_ICONS: Record<MusicMode, AppIconName> = { 'loop-one': 'repeatOne', sequential: 'repeat', shuffle: 'shuffle' };
const NEXT_MODE: Record<MusicMode, MusicMode> = { 'loop-one': 'sequential', sequential: 'shuffle', shuffle: 'loop-one' };
const TRACK_GROUPS = groupProvidedMusicTracks(PROVIDED_MUSIC_TRACKS);
const HAS_UNGROUPED_TRACKS = TRACK_GROUPS.some((group) => group.name === undefined);

/** Place of a track inside its album, or inside the whole list for loose tracks. */
function trackPosition(track: ProvidedMusicTrack): { readonly n: number; readonly total: number } {
  const siblings = PROVIDED_MUSIC_TRACKS.filter((candidate) => candidate.group === track.group);
  return { n: siblings.indexOf(track) + 1, total: siblings.length };
}

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
  const openAudioSettings = useAudioSettingsDialogStore((state) => state.openDialog);
  const groupId = useId();
  const list = useRef<HTMLUListElement>(null);
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

  // Playback moving on to another album opens it, and the playing track is brought into view.
  const currentGroup = providedTrack?.group;
  useEffect(() => {
    if (currentGroup === undefined) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacts to an external playback change
    setExpandedGroups((current) => current.has(currentGroup) ? current : new Set(current).add(currentGroup));
  }, [currentGroup]);
  useEffect(() => {
    list.current?.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [providedTrackId, expandedGroups]);

  const position = providedTrack ? trackPosition(providedTrack) : null;
  const renderTrack = (track: ProvidedMusicTrack): ReactNode => {
    const current = track.id === providedTrackId;
    return <button type="button" data-music-transport className={styles.track} aria-current={current}
      onClick={() => void play(track.id)}>
      <span className={styles.trackNumber} aria-hidden="true">
        {current ? <span className={styles.bars} data-playing={playing}><i /><i /><i /></span>
          : trackPosition(track).n}
      </span>
      <span className={styles.trackTitle}>{track.title}</span>
    </button>;
  };

  return (
    <section className={styles.panel} aria-label={t('music.title')}>
      <div className={styles.header}>
        <span className={styles.title}><AppIcon name="music" /> {t('music.title')}</span>
        <button type="button" className={styles.settingsButton} aria-label={t('audio.title')} title={t('audio.title')}
          onClick={openAudioSettings}><AppIcon name="tune" /></button>
      </div>
      <div className={styles.now}>
        <span className={styles.cover} style={{ background: coverGradient(providedTrack?.group ?? providedTrack?.id ?? '') }}
          aria-hidden="true"><AppIcon name="music" /></span>
        <div className={styles.nowText} aria-live="polite">
          <span className={styles.nowTitle}>
            {busy ? t('music.loading') : providedTrack ? providedTrack.title : t('music.noTracks')}
          </span>
          {providedTrack && position && <span className={styles.nowSub}>
            {providedTrack.group !== undefined && <span className={styles.nowPlayingGroup}>{providedTrack.group}</span>}
            <span className={styles.nowPosition}>{providedTrack.group !== undefined ? ' · ' : ''}
              {t('music.position', { n: String(position.n), total: String(position.total) })}</span>
          </span>}
        </div>
        <div className={styles.controls}>
          <button type="button" data-music-transport className={styles.control} aria-label={t('music.prev')}
            title={t('music.prev')} disabled={busy || !hasTracks} onClick={() => void prev()}>
            <AppIcon name="previous" /></button>
          <button type="button" data-music-transport className={`${styles.control} ${styles.playControl}`}
            aria-pressed={playing} aria-label={playing || busy ? t('music.pause') : t('music.play')}
            title={playing || busy ? t('music.pause') : t('music.play')} disabled={!hasTracks}
            onClick={() => void toggle()}><AppIcon name={playing || busy ? 'pause' : 'play'} /></button>
          <button type="button" data-music-transport className={styles.control} aria-label={t('music.next')}
            title={t('music.next')} disabled={busy || !hasTracks} onClick={() => void next()}>
            <AppIcon name="next" /></button>
          <button type="button" className={`${styles.control} ${mode === 'sequential' ? '' : styles.modeActive}`}
            aria-label={t(`music.${mode}`)} title={t(`music.${mode}`)} disabled={busy}
            onClick={() => setMode(NEXT_MODE[mode])}><AppIcon name={MODE_ICONS[mode]} /></button>
        </div>
      </div>
      <ul ref={list} className={styles.tracks} aria-label={t('music.tracks')}>
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
                <span className={styles.groupName}>{name}</span>
                <span className={styles.groupCount}>{t('music.trackCount', { n: String(group.tracks.length) })}</span>
                <AppIcon name="nextPage" className={styles.chevron} />
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
