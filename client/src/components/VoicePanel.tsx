import { useEffect, useState } from 'react';
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
import { DEFAULT_PEER_PREFERENCE, outputSelectionSupported } from '../voice/voice-session';
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

function DeviceSettings(): ReactNode {
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
    <div className={styles.devices}>
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
    </div>
  );
}

function leaveActiveVoice(): void {
  const { status } = useVoiceStore.getState();
  if (status === 'joined' || status === 'joining') leaveVoice();
}

export function VoicePanel(): ReactNode {
  const { t } = useI18nStore();
  const account = useAccountStore((state) => state.account);
  const connection = useAccountStore((state) => state.connection);
  const roomCode = useRoomStore((state) => state.currentRoomCode);
  const roomInfo = useRoomStore((state) => state.roomInfo);
  const accountId = account?.id;
  const { status, participants, muted, deafened, error, autoplayBlocked, peerPrefs,
    peerErrors, peerConnections, peerId, silenced } =
    useVoiceStore(useShallow((state) => ({
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
  const [profiles, setProfiles] = useState<Record<string, PublicAccount>>({});
  const [showDevices, setShowDevices] = useState(false);

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
  const remoteParticipants = participants.filter((participant) => participant.peerId !== peerId);
  const hasPeerErrors = Object.keys(peerErrors).length > 0;
  const allConnected = remoteParticipants.length > 0 && remoteParticipants.every(
    (participant) => peerConnections[participant.peerId] === 'connected',
  );

  return (
    <section className={styles.panel} aria-labelledby="table-voice-title">
      <div className={styles.header}>
        <div className={styles.heading}>
          <h2 id="table-voice-title">{t('voice.title')}</h2>
          <span className={styles.roomCode}>{roomCode}</span>
          <span className={joined && allConnected ? styles.connected : styles.status} role="status">
            {t(joined ? hasPeerErrors ? 'voice.partial' : allConnected ? 'voice.connected'
              : 'voice.joined' : joining ? 'common.loading' : 'voice.off')}
          </span>
        </div>
        <div className={styles.controls}>
          {joined ? <>
            <button type="button" className={`btn btn-outline ${styles.toggle}`}
              aria-pressed={muted} onClick={() => setVoiceMuted(!muted)}>
              {t('voice.mute')}
            </button>
            <button type="button" className={`btn btn-outline ${styles.toggle}`}
              aria-pressed={deafened} aria-describedby="table-voice-hint"
              onClick={() => setVoiceDeafened(!deafened)}>
              {t('voice.deafen')}
            </button>
            <button type="button" className="btn btn-outline" onClick={leaveVoice}>
              {t('voice.leave')}
            </button>
            <button type="button" className="btn btn-outline" disabled={!canJoin}
              onClick={() => { leaveVoice(); void joinVoice(roomCode, account.id); }}>
              {t('voice.rejoin')}
            </button>
          </> : joining ? <button type="button" className="btn btn-outline" onClick={leaveVoice}>
            {t('common.cancel')}
          </button> : <button type="button" className="btn btn-primary" disabled={!canJoin}
            onClick={() => void joinVoice(roomCode, account.id)}>
            {t(error ? 'voice.retry' : 'voice.join')}
          </button>}
          <button type="button" className={`btn btn-outline ${styles.toggle}`}
            aria-pressed={showDevices} aria-expanded={showDevices}
            onClick={() => setShowDevices(!showDevices)}>
            {t('voice.devices')}
          </button>
        </div>
      </div>
      {showDevices && <DeviceSettings />}
      {joining && <p className={styles.hint} role="status">{t('voice.joining')}</p>}
      {error && <p className={styles.error} role="alert">{t(ERROR_TRANSLATIONS[error])}</p>}
      {joined && <>
        <p id="table-voice-hint" className={styles.hint}>{t('voice.hint')}</p>
        {roomInfo?.observerIds?.includes(account.id) && <p className={styles.hint}>{t('voice.observerMuted')}</p>}
        {silenced.length > 0 && <p className={styles.hint}>{t('voice.observersSilenced')}</p>}
        <ul className={styles.participants} aria-label={t('voice.participants')}>
          {participants.map((participant) => {
            const person = participant.accountId === account.id ? account
              : Object.values(roomInfo?.seats ?? {})
                .find((seat) => seat.player?.id === participant.accountId)?.player
                ?? profiles[participant.accountId];
            return <li key={participant.peerId} className={styles.participant}>
              {person && <Avatar avatar={person.avatar} image={person.avatarImage} color={person.color} size="small" />}
              <span className={styles.name}>{person?.nickname ?? t('voice.player')}
                {participant.accountId === account.id && ` ${t('common.me')}`}</span>
              <span className={participant.muted ? styles.muted : styles.status}>
                {t(participant.muted ? 'voice.muted' : 'voice.microphoneOn')}</span>
              {participant.deafened && <span className={styles.muted}>{t('voice.deafened')}</span>}
              {participant.peerId !== peerId && <span
                className={`${styles.peerStatus} ${peerErrors[participant.peerId] ? styles.error : styles.status}`}
                role={peerErrors[participant.peerId] ? 'alert' : 'status'}>
                {t(peerErrors[participant.peerId] ? 'voice.peerFailed'
                  : peerConnections[participant.peerId] === 'connected'
                    ? 'voice.peerConnected' : 'voice.peerConnecting')}
              </span>}
              {participant.accountId !== account.id && (() => {
                const preference = peerPrefs[participant.accountId] ?? DEFAULT_PEER_PREFERENCE;
                return <div className={styles.peerControls}>
                  <button type="button" className={`btn btn-outline ${styles.toggle}`}
                    aria-pressed={preference.muted}
                    onClick={() => setVoicePeerMuted(participant.accountId, !preference.muted)}>
                    {t('voice.peerMute')}
                  </button>
                  <input type="range" min={0} max={100} value={Math.round(preference.volume * 100)}
                    aria-label={`${t('voice.peerVolume')} ${person?.nickname ?? t('voice.player')}`}
                    onChange={(event) =>
                      setVoicePeerVolume(participant.accountId, Number(event.target.value) / 100)} />
                </div>;
              })()}
            </li>;
          })}
        </ul>
        {participants.length === 1 && <p className={styles.hint}>{t('voice.empty')}</p>}
        {autoplayBlocked && !deafened && <div className={styles.playback}>
          <p role="status">{t('voice.autoplay')}</p>
          <button type="button" className="btn btn-primary"
            onClick={() => void resumeVoiceAudio()}>{t('voice.enableAudio')}</button>
        </div>}
      </>}
    </section>
  );
}
