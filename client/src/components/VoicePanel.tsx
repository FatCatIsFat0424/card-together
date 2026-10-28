import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { PublicAccount } from '@shared/types';
import type { TranslationKey } from '../i18n';
import { apiRequest } from '../api';
import { useAccountStore } from '../stores/account-store';
import { useRoomStore } from '../stores/room-store';
import { useAudioSettingsDialogStore } from '../stores/audio-settings-dialog-store';
import { useAudioSettingsStore, currentVoiceGain } from '../stores/audio-settings-store';
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
  voiceStreamFor,
  watchAudioDevices,
} from '../stores/voice-store';
import type { VoiceErrorCode } from '../stores/voice-store';
import { summarizeVoice, toggleExpandedRow, visibleExpandedRow } from '../voice/voice-panel-state';
import { DEFAULT_PEER_PREFERENCE, outputSelectionSupported } from '../voice/voice-session';
import { playTestTone } from '../voice/test-tone';
import { useMicTest, useStreamLevel } from '../voice/use-voice-meters';
import { createSpeakingTracker } from '../voice/voice-levels';
import type { PeerPreference } from '../voice/voice-session';
import { volumePercent } from '../audio/mix';
import { AppIcon } from './AppIcon';
import { Avatar } from './Avatar';
import { DevicePicker } from './DevicePicker';
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

/** Loudness bar: the fill scales from the left, so only a transform changes per frame. */
function LevelMeter({ stream, label, compact = false }: {
  readonly stream: MediaStream | null;
  readonly label: string;
  readonly compact?: boolean;
}): ReactNode {
  const fill = useRef<HTMLSpanElement>(null);
  useStreamLevel(stream, (level) => {
    if (fill.current) fill.current.style.transform = `scaleX(${level})`;
  });
  return <span className={`${styles.meter} ${compact ? styles.meterCompact : ''}`} role="img" aria-label={label}>
    <span ref={fill} className={styles.meterFill} />
  </span>;
}

function DeviceSettings({ id, joined, stream }: {
  readonly id: string;
  readonly joined: boolean;
  /** The call's own microphone while joined. */
  readonly stream: MediaStream | null;
}): ReactNode {
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
  const voiceVolume = useAudioSettingsStore((state) => state.voiceVolume);
  const setVoiceVolume = useAudioSettingsStore((state) => state.setVoiceVolume);
  const openAudioSettings = useAudioSettingsDialogStore((state) => state.openDialog);
  const outputSupported = outputSelectionSupported();
  const mic = useMicTest(joined ? stream : null, inputDeviceId);
  const [tonePlaying, setTonePlaying] = useState(false);
  const volumeId = useId();

  // Device labels only appear after microphone permission, so reload once joined.
  useEffect(() => watchAudioDevices(), [status]);

  const options = (devices: MediaDeviceInfo[], key: TranslationKey): { value: string; label: string }[] => [
    { value: '', label: t('voice.defaultDevice') },
    ...devices.map((device, index) => ({
      value: device.deviceId, label: device.label || t(key, { n: String(index + 1) }),
    })),
  ];

  return (
    <div id={id} className={styles.devices}>
      <div className={styles.deviceRow}>
        <span className={styles.deviceIcon}><AppIcon name="microphone" /></span>
        <DevicePicker label={t('voice.input')} value={inputDeviceId ?? ''} options={options(inputs, 'voice.microphoneN')}
          onChange={(value) => void setVoiceInputDevice(value || null)} />
      </div>
      <div className={styles.testRow}>
        <LevelMeter stream={mic.stream} label={t('voice.micLevel')} />
        <button type="button" className={styles.pill} aria-pressed={mic.testing} onClick={mic.toggle}>
          {t(mic.testing ? 'voice.testing' : 'voice.test')}
        </button>
      </div>
      <p className={styles.hint} role={mic.failed ? 'alert' : undefined}>
        {mic.failed ? t('voice.testFailed') : t('voice.testHint')}</p>
      <div className={styles.deviceRow}>
        <span className={styles.deviceIcon}><AppIcon name="headset" /></span>
        <DevicePicker label={t('voice.output')} value={outputSupported ? outputDeviceId ?? '' : ''}
          options={options(outputs, 'voice.speakerN')} disabled={!outputSupported}
          describedBy={outputSupported ? undefined : 'table-voice-output-hint'}
          onChange={(value) => setVoiceOutputDevice(value || null)} />
        <button type="button" className={styles.iconButton} aria-label={t('voice.playTone')} title={t('voice.playTone')}
          disabled={tonePlaying} onClick={() => {
            setTonePlaying(true);
            void playTestTone(outputSupported ? outputDeviceId : null, currentVoiceGain())
              .finally(() => setTonePlaying(false));
          }}><AppIcon name="play" /></button>
      </div>
      {!outputSupported && <p id="table-voice-output-hint" className={styles.hint}>
        {t('voice.outputUnsupported')}</p>}
      <div className={styles.volumeRow}>
        <label htmlFor={volumeId}>{t('voice.volume')}</label>
        <input id={volumeId} type="range" min={0} max={100} value={volumePercent(voiceVolume)}
          onChange={(event) => setVoiceVolume(Number(event.target.value) / 100)} />
        <output htmlFor={volumeId} className={styles.volumeValue}>{volumePercent(voiceVolume)}</output>
      </div>
      <button type="button" className={styles.link} onClick={openAudioSettings}>{t('voice.moreVolume')} ›</button>
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
  /** Audio to meter for the speaking ring. */
  readonly stream?: MediaStream | null;
  readonly onToggle: () => void;
  readonly onPeerMuted: (muted: boolean) => void;
  readonly onPeerVolume: (volume: number) => void;
}

/**
 * One person in the call. A green ring marks who is speaking; remote rows expand to that player's volume and
 * carry a one-tap mute.
 */
export function VoiceParticipantRow({
  person, self, muted, deafened, connection, preference, expanded, stream = null, onToggle, onPeerMuted, onPeerVolume,
}: ParticipantRowProps): ReactNode {
  const { t } = useI18nStore();
  const detailsId = useId();
  const name = person?.nickname ?? t('voice.player');
  const ring = useRef<HTMLSpanElement>(null);
  const [tracker] = useState(createSpeakingTracker);
  useStreamLevel(stream, (level) => {
    const speaking = tracker(level);
    const element = ring.current;
    if (element && (element.dataset.speaking === 'true') !== speaking) element.dataset.speaking = String(speaking);
  });
  const content = <>
    <span ref={ring} className={styles.avatarRing} data-speaking="false">
      {person && <Avatar avatar={person.avatar} image={person.avatarImage} border={person.avatarBorder}
        color={person.color} size="compact" />}
    </span>
    <span className={styles.name}>
      {name}
      {self && <span className={styles.me}>{` ${t('common.me')}`}</span>}
    </span>
    {muted && <span className={styles.stateIcon} role="img" aria-label={t('voice.muted')} title={t('voice.muted')}>
      <AppIcon name="microphoneOff" /></span>}
    {deafened && <span className={styles.stateIcon} role="img" aria-label={t('voice.deafened')}
      title={t('voice.deafened')}><AppIcon name="headsetOff" /></span>}
    {connection === 'failed' && <span className={`${styles.connection} ${styles.error}`} role="alert">
      {t('voice.peerFailed')}</span>}
    {connection === 'connecting' && <span className={styles.connection} role="status">
      {t('voice.peerConnecting')}</span>}
    {self && <LevelMeter stream={stream} label={t('voice.micLevel')} compact />}
    {!self && <AppIcon name="nextPage" className={styles.chevron} />}
  </>;
  return <li className={styles.participant} data-expanded={expanded}>
    <div className={styles.row}>
      {self ? <div className={styles.rowMain}>{content}</div>
        : <button type="button" className={`${styles.rowMain} ${styles.rowButton}`} aria-expanded={expanded}
          aria-controls={detailsId} onClick={onToggle}>{content}</button>}
      {!self && <button type="button" className={styles.iconButton} data-muted={preference.muted}
        aria-pressed={preference.muted} aria-label={`${t('voice.peerMute')}: ${name}`}
        title={t(preference.muted ? 'voice.mutedByYou' : 'voice.peerMute')}
        onClick={() => onPeerMuted(!preference.muted)}>
        <AppIcon name={preference.muted ? 'volumeOff' : 'volume'} />
      </button>}
    </div>
    {!self && expanded && <div id={detailsId} className={styles.peerControls}>
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
  const openAudioSettings = useAudioSettingsDialogStore((state) => state.openDialog);

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
  const observer = Boolean(roomInfo?.observerIds?.includes(account.id));
  const stream = joined ? voiceStreamFor(account.id) : null;
  const cardTitle = summary.kind === 'off' ? t('voice.cardOff')
    : summary.kind === 'error' ? t('voice.cardError')
    : summary.kind === 'joining' ? t('voice.cardJoining')
    : summary.kind === 'partial' ? t('voice.cardPartial')
    : t(summary.kind === 'connected' ? 'voice.cardConnected' : 'voice.cardJoined');
  const cardReason = summary.kind === 'off' ? t('voice.reasonOff')
    : summary.kind === 'error' ? (error ? t(ERROR_TRANSLATIONS[error]) : t('voice.cardError'))
    : summary.kind === 'joining' ? t('voice.joining')
    : summary.kind === 'partial' ? t('voice.partial')
    : t(summary.kind === 'connected' ? 'voice.reasonConnected' : 'voice.reasonJoined', { n: String(summary.count) });

  return (
    <section className={styles.panel} aria-labelledby="table-voice-title">
      <h2 id="table-voice-title" className={styles.srOnly}>{t('voice.title')}</h2>
      <div className={styles.statusCard} data-tone={summary.dot}>
        <span className={styles.dot} data-state={summary.dot} aria-hidden="true" />
        <div className={styles.statusText} role="status">
          <strong>{cardTitle}</strong>
          <span role={summary.kind === 'error' ? 'alert' : undefined}>{cardReason}</span>
        </div>
        {joined && <button type="button" className={styles.leave} onClick={leaveVoice}>
          <AppIcon name="hangUp" />{t('voice.leave')}
        </button>}
        {joining && <button type="button" className={styles.pill} onClick={leaveVoice}>{t('common.cancel')}</button>}
      </div>
      {!joined && !joining && <button type="button" className={`btn btn-primary ${styles.primaryAction}`}
        disabled={!canJoin} onClick={() => void joinVoice(roomCode, account.id)}>
        {t(error ? 'voice.reconnect' : 'voice.join')}
      </button>}
      {!joined && !joining && <>
        <h3 className={styles.sectionTitle}>{t('voice.checkDevices')}</h3>
        <DeviceSettings id={devicesId} joined={false} stream={null} />
      </>}
      {joined && <>
        <div className={styles.toggles}>
          <button type="button" className={styles.toggle} aria-pressed={muted} data-off={muted}
            onClick={() => setVoiceMuted(!muted)}>
            <AppIcon name={muted ? 'microphoneOff' : 'microphone'} />
            <span>{t(muted ? 'voice.microphoneOff' : 'voice.microphone')}</span>
            <LevelMeter stream={stream} label={t('voice.micLevel')} compact />
          </button>
          <button type="button" className={styles.toggle} aria-pressed={deafened} data-off={deafened}
            onClick={() => setVoiceDeafened(!deafened)}>
            <AppIcon name={deafened ? 'headsetOff' : 'headset'} />
            <span>{t(deafened ? 'voice.soundOff' : 'voice.sound')}</span>
          </button>
          <button type="button" className={styles.iconButton} aria-expanded={showDevices} aria-controls={devicesId}
            aria-label={t('voice.devices')} title={t('voice.devices')} onClick={() => setShowDevices(!showDevices)}>
            <AppIcon name="settings" />
          </button>
        </div>
        {showDevices && <DeviceSettings id={devicesId} joined stream={stream} />}
        {error && summary.kind !== 'error' && <p className={styles.banner} data-tone="error" role="alert">
          {t(ERROR_TRANSLATIONS[error])}</p>}
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
        <div className={styles.membersHead}>
          <h3 className={styles.sectionTitle}>{t('voice.members')}</h3>
          {!showDevices && <button type="button" className={styles.link} onClick={openAudioSettings}>
            {t('voice.moreVolume')} ›</button>}
        </div>
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
              stream={voiceStreamFor(participant.accountId)}
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
