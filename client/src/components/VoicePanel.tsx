import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { PublicAccount } from '@shared/types';
import type { TranslationKey } from '../i18n';
import { apiRequest } from '../api';
import { useAccountStore } from '../stores/account-store';
import { useRoomStore } from '../stores/room-store';
import { useI18nStore } from '../stores/i18n-store';
import {
  disposeVoice,
  joinVoice,
  leaveVoice,
  resumeVoiceAudio,
  setVoiceDeafened,
  setVoiceInputDevice,
  setVoiceMuted,
  setVoiceOutputDevice,
  setVoicePeerMuted,
  setVoicePeerVolume,
  useVoiceStore,
  watchAudioDevices,
} from '../stores/voice-store';
import type { VoiceErrorCode } from '../stores/voice-store';
import { summarizeVoice, toggleExpandedRow, visibleExpandedRow } from '../voice/voice-panel-state';
import { DEFAULT_PEER_PREFERENCE, outputSelectionSupported } from '../voice/voice-session';
import type { PeerPreference } from '../voice/voice-session';
import { volumePercent } from '../audio/mix';
import { AppIcon } from './AppIcon';
import { AudioSettingsButton } from './AudioSettings';
import { Avatar } from './Avatar';
import styles from './VoicePanel.module.css';

const ERROR_TRANSLATIONS: Record<VoiceErrorCode, TranslationKey> = {
  unsupported: 'voice.unsupported',
  insecure: 'voice.insecure',
  permission: 'voice.permission',
  'no-microphone': 'voice.noMicrophone',
  'microphone-busy': 'voice.microphoneBusy',
  'microphone-ended': 'voice.microphoneEnded',
  configuration: 'voice.configuration',
  'join-failed': 'voice.joinFailed',
  'connection-failed': 'voice.connectionFailed',
  'signal-failed': 'voice.signalFailed',
  disconnected: 'voice.disconnected',
};

function DeviceSettings({ id }: { readonly id: string }): ReactNode {
  const { t } = useI18nStore();
  const { status, inputs, outputs, inputDeviceId, outputDeviceId } = useVoiceStore(
    useShallow((state) => ({
      status: state.status,
      inputs: state.inputs,
      outputs: state.outputs,
      inputDeviceId: state.inputDeviceId,
      outputDeviceId: state.outputDeviceId,
    })),
  );
  const outputSupported = outputSelectionSupported();

  // Device labels only appear after microphone permission, so reload once joined.
  useEffect(() => watchAudioDevices(), [status]);

  const options = (devices: MediaDeviceInfo[], key: TranslationKey): ReactNode =>
    devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>
      {device.label || t(key, { n: String(index + 1) })}
    </option>);

  return (
    <div id={id} className={styles.devices}>
      <label className={styles.field}>
        <span>{t('voice.input')}</span>
        <select value={inputDeviceId ?? ''}
          onChange={(event) => void setVoiceInputDevice(event.target.value || null)}>
          <option value="">{t('voice.defaultDevice')}</option>
          {options(inputs, 'voice.microphoneN')}
        </select>
      </label>
      <label className={styles.field}>
        <span>{t('voice.output')}</span>
        <select value={outputSupported ? outputDeviceId ?? '' : ''} disabled={!outputSupported}
          aria-describedby={outputSupported ? undefined : 'table-voice-output-hint'}
          onChange={(event) => setVoiceOutputDevice(event.target.value || null)}>
          <option value="">{t('voice.defaultDevice')}</option>
          {options(outputs, 'voice.speakerN')}
        </select>
      </label>
      {!outputSupported && <p id="table-voice-output-hint" className={styles.hint}>
        {t('voice.outputUnsupported')}</p>}
      <AudioSettingsButton label={t('voice.volumeSettings')} className={styles.volumeSettings} />
    </div>
  );
}

function leaveActiveVoice(): void {
  const { status } = useVoiceStore.getState();
  if (status === 'joined' || status === 'joining') leaveVoice();
}

interface ParticipantRowProps {
  readonly person: PublicAccount | undefined;
  readonly self: boolean;
  readonly muted: boolean;
  readonly deafened: boolean;
  /** Remote connection state; undefined for the local player. */
  readonly connection: 'connecting' | 'connected' | 'failed' | undefined;
  readonly preference: PeerPreference;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onPeerMuted: (muted: boolean) => void;
  readonly onPeerVolume: (volume: number) => void;
}

/** One person in the call. Remote rows are buttons that reveal that player's own mute and volume. */
export function VoiceParticipantRow({
  person, self, muted, deafened, connection, preference, expanded, onToggle, onPeerMuted, onPeerVolume,
}: ParticipantRowProps): ReactNode {
  const { t } = useI18nStore();
  const detailsId = useId();
  const name = person?.nickname ?? t('voice.player');
  const content = <>
    {person && <Avatar avatar={person.avatar} image={person.avatarImage} border={person.avatarBorder}
      color={person.color} size="compact" />}
    <span className={styles.name}>
      {name}
      {self && <span className={styles.me}>{` ${t('common.me')}`}</span>}
    </span>
    {muted && <span className={styles.stateIcon} role="img" aria-label={t('voice.muted')} title={t('voice.muted')}>
      <AppIcon name="microphoneOff" /></span>}
    {deafened && <span className={styles.stateIcon} role="img" aria-label={t('voice.deafened')}
      title={t('voice.deafened')}><AppIcon name="headsetOff" /></span>}
    {!self && preference.muted && <span className={styles.stateIcon} role="img" aria-label={t('voice.mutedByYou')}
      title={t('voice.mutedByYou')}><AppIcon name="volumeOff" /></span>}
    {connection === 'failed' && <span className={`${styles.connection} ${styles.error}`} role="alert">
      {t('voice.peerFailed')}</span>}
    {connection === 'connecting' && <span className={styles.connection} role="status">
      {t('voice.peerConnecting')}</span>}
    {!self && <AppIcon name="nextPage" className={styles.chevron} />}
  </>;
  return <li className={styles.participant} data-expanded={expanded}>
    {self ? <div className={styles.row}>{content}</div>
      : <button type="button" className={`${styles.row} ${styles.rowButton}`} aria-expanded={expanded}
        aria-controls={detailsId} onClick={onToggle}>{content}</button>}
    {!self && expanded && <div id={detailsId} className={styles.peerControls}>
      <button type="button" className={styles.iconButton} aria-pressed={preference.muted}
        aria-label={`${t('voice.peerMute')}: ${name}`} title={t('voice.peerMute')}
        onClick={() => onPeerMuted(!preference.muted)}>
        <AppIcon name={preference.muted ? 'volumeOff' : 'volume'} />
      </button>
      <input type="range" min={0} max={100} value={volumePercent(preference.volume)}
        aria-label={`${t('voice.peerVolume')}: ${name}`}
        onChange={(event) => onPeerVolume(Number(event.target.value) / 100)} />
      <output className={styles.volumeValue}>{volumePercent(preference.volume)}</output>
    </div>}
  </li>;
}

export function VoicePanel(): ReactNode {
  const { t } = useI18nStore();
  const account = useAccountStore((state) => state.account);
  const connection = useAccountStore((state) => state.connection);
  const roomCode = useRoomStore((state) => state.currentRoomCode);
  const roomInfo = useRoomStore((state) => state.roomInfo);
  const accountId = account?.id;
  const voice = useVoiceStore(
    useShallow((state) => ({
      status: state.status,
      participants: state.participants,
      muted: state.muted,
      deafened: state.deafened,
      error: state.error,
      autoplayBlocked: state.autoplayBlocked,
      peerPrefs: state.peerPrefs,
      peerErrors: state.peerErrors,
      peerConnections: state.peerConnections,
      peerId: state.peerId,
      silenced: state.silenced,
    })));
  const { status, participants, muted, deafened, error, autoplayBlocked, peerPrefs,
    peerErrors, peerConnections, peerId, silenced } = voice;
  const [profiles, setProfiles] = useState<Record<string, PublicAccount>>({});
  const [showDevices, setShowDevices] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const devicesId = useId();

  // Membership controls the media lifetime; navigating between pages does not.
  useEffect(() => {
    if (!accountId || !roomCode || connection !== 'ready') leaveActiveVoice();
    return leaveActiveVoice;
  }, [accountId, roomCode, connection]);

  useEffect(() => () => { disposeVoice(); }, []);

  useEffect(() => {
    const missingIds = [...new Set(participants.map((participant) => participant.accountId))]
      .filter((id) => id !== accountId && !profiles[id] &&
        !Object.values(roomInfo?.seats ?? {}).some((seat) => seat.player?.id === id));
    if (missingIds.length === 0) return;
    let active = true;
    void Promise.all(missingIds.map((id) =>
      apiRequest<{ account: PublicAccount }>(`/api/players/${encodeURIComponent(id)}`),
    )).then((results) => {
      if (!active) return;
      const found = results.flatMap((result) => result.success ? [result.account] : []);
      if (found.length === 0) return;
      setProfiles((current) => ({
        ...current,
        ...Object.fromEntries(found.map((profile) => [profile.id, profile])),
      }));
    });
    return () => { active = false; };
  }, [participants, roomInfo, accountId, profiles]);

  if (!account || !roomCode) return null;
  const joined = status === 'joined';
  const joining = status === 'joining';
  const canJoin = connection === 'ready';
  const summary = summarizeVoice(voice);
  const expandedId = visibleExpandedRow(expandedRow, participants.map((participant) => participant.accountId));
  const statusText = summary.kind === 'off' ? t('voice.off')
    : summary.kind === 'error' ? t('voice.statusError')
    : summary.kind === 'joining' ? t('voice.statusJoining')
    : t(summary.kind === 'connected' ? 'voice.statusConnected'
      : summary.kind === 'partial' ? 'voice.statusPartial' : 'voice.statusJoined', { n: String(summary.count) });
  const observer = Boolean(roomInfo?.observerIds?.includes(account.id));

  return (
    <section className={styles.panel} aria-labelledby="table-voice-title">
      <header className={styles.header}>
        <span className={styles.dot} data-state={summary.dot} aria-hidden="true" />
        <h2 id="table-voice-title" className={styles.title}>{t('voice.title')}</h2>
        <span className={styles.statusText} role="status">{statusText}</span>
        <button type="button" className={`${styles.iconButton} ${styles.headerFirst}`}
          aria-expanded={showDevices} aria-controls={devicesId} aria-label={t('voice.devices')}
          title={t('voice.devices')} onClick={() => setShowDevices(!showDevices)}>
          <AppIcon name="settings" />
        </button>
        {joined && <button type="button" className={`${styles.iconButton} ${styles.danger}`}
          aria-label={t('voice.leave')} title={t('voice.leave')} onClick={leaveVoice}>
          <AppIcon name="hangUp" />
        </button>}
      </header>
      {showDevices && <DeviceSettings id={devicesId} />}
      {!joined && !joining && <>
        {error && <p className={styles.banner} data-tone="error" role="alert">{t(ERROR_TRANSLATIONS[error])}</p>}
        <button type="button" className={`btn btn-primary ${styles.primaryAction}`} disabled={!canJoin}
          onClick={() => void joinVoice(roomCode, account.id)}>
          {t(error ? 'voice.retry' : 'voice.join')}
        </button>
      </>}
      {joining && <>
        <p className={styles.banner} role="status">{t('voice.joining')}</p>
        <button type="button" className={`btn btn-outline ${styles.primaryAction}`} onClick={leaveVoice}>
          {t('common.cancel')}
        </button>
      </>}
      {joined && <>
        <div className={styles.toggles}>
          <button type="button" className={styles.toggle} aria-pressed={muted} data-off={muted}
            onClick={() => setVoiceMuted(!muted)}>
            <AppIcon name={muted ? 'microphoneOff' : 'microphone'} />
            <span>{t(muted ? 'voice.microphoneOff' : 'voice.microphone')}</span>
          </button>
          <button type="button" className={styles.toggle} aria-pressed={deafened} data-off={deafened}
            onClick={() => setVoiceDeafened(!deafened)}>
            <AppIcon name={deafened ? 'headsetOff' : 'headset'} />
            <span>{t(deafened ? 'voice.soundOff' : 'voice.sound')}</span>
          </button>
        </div>
        {error && <p className={styles.banner} data-tone="error" role="alert">{t(ERROR_TRANSLATIONS[error])}</p>}
        {summary.needsRejoin && <div className={styles.banner} data-tone="error" role="alert">
          <span className={styles.bannerText}>{t('voice.partial')}</span>
          <button type="button" className={styles.bannerAction} disabled={!canJoin}
            onClick={() => { leaveVoice(); void joinVoice(roomCode, account.id); }}>
            {t('voice.rejoin')}
          </button>
        </div>}
        {observer && <p className={styles.banner}>{t('voice.observerMuted')}</p>}
        {silenced.length > 0 && <p className={styles.banner}>{t('voice.observersSilenced')}</p>}
        {autoplayBlocked && !deafened && <div className={styles.banner} role="status">
          <span className={styles.bannerText}>{t('voice.autoplay')}</span>
          <button type="button" className={styles.bannerAction}
            onClick={() => void resumeVoiceAudio()}>{t('voice.enableAudio')}</button>
        </div>}
        <ul className={styles.participants} aria-label={t('voice.participants')}>
          {participants.map((participant) => {
            const self = participant.accountId === account.id;
            const person = self ? account
              : Object.values(roomInfo?.seats ?? {})
                .find((seat) => seat.player?.id === participant.accountId)?.player
                ?? profiles[participant.accountId];
            return <VoiceParticipantRow key={participant.peerId} person={person} self={self}
              muted={participant.muted} deafened={participant.deafened}
              connection={participant.peerId === peerId ? undefined
                : peerErrors[participant.peerId] ? 'failed'
                  : peerConnections[participant.peerId] === 'connected' ? 'connected' : 'connecting'}
              preference={peerPrefs[participant.accountId] ?? DEFAULT_PEER_PREFERENCE}
              expanded={expandedId === participant.accountId}
              onToggle={() => setExpandedRow(toggleExpandedRow(expandedId, participant.accountId))}
              onPeerMuted={(value) => setVoicePeerMuted(participant.accountId, value)}
              onPeerVolume={(value) => setVoicePeerVolume(participant.accountId, value)} />;
          })}
        </ul>
      </>}
    </section>
  );
}
