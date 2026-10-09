import { create } from 'zustand';
import { socket } from '../socket';
import { parseIceServers } from '../voice/ice-servers';
import {
  createVoiceSession,
  DEFAULT_PEER_PREFERENCE,
  initialVoiceState,
  listAudioDevices,
  parsePeerPrefs,
} from '../voice/voice-session';
import type { PeerPreference, VoiceClientState, VoiceSession } from '../voice/voice-session';
import { readPreference, writePreference } from '../utils/preference-storage';

export type { VoiceErrorCode } from '../voice/voice-session';

const PEERS_KEY = 'voice.peers';
const INPUT_KEY = 'voice.input';
const OUTPUT_KEY = 'voice.output';

interface VoiceStoreState extends VoiceClientState {
  inputs: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
}

/** Stored per-player preferences; older entries are dropped once the limit is exceeded. */
export const MAX_STORED_PEER_PREFS = 50;

/** Drops default-valued entries and keeps the most recently added remaining ones. */
export function prunePeerPrefs(
  prefs: Readonly<Record<string, PeerPreference>>,
  limit = MAX_STORED_PEER_PREFS,
): Record<string, PeerPreference> {
  const entries = Object.entries(prefs).filter(([, preference]) =>
    preference.muted !== DEFAULT_PEER_PREFERENCE.muted
    || preference.volume !== DEFAULT_PEER_PREFERENCE.volume);
  return Object.fromEntries(entries.slice(Math.max(0, entries.length - limit)));
}

const initialPeerPrefs = prunePeerPrefs(parsePeerPrefs(readPreference(PEERS_KEY)));
const initialInputDeviceId = readPreference(INPUT_KEY);
const initialOutputDeviceId = readPreference(OUTPUT_KEY);
// Session updates arrive for every voice state change; write storage only when stored values change.
let storedPeers = JSON.stringify(initialPeerPrefs);
let storedInput = initialInputDeviceId;
let storedOutput = initialOutputDeviceId;

function persist(state: VoiceClientState): void {
  const peers = JSON.stringify(prunePeerPrefs(state.peerPrefs));
  if (peers !== storedPeers) {
    storedPeers = peers;
    writePreference(PEERS_KEY, peers);
  }
  if (state.inputDeviceId !== storedInput) {
    storedInput = state.inputDeviceId;
    writePreference(INPUT_KEY, state.inputDeviceId);
  }
  if (state.outputDeviceId !== storedOutput) {
    storedOutput = state.outputDeviceId;
    writePreference(OUTPUT_KEY, state.outputDeviceId);
  }
}

export const useVoiceStore = create<VoiceStoreState>(() => ({
  ...initialVoiceState(),
  inputDeviceId: initialInputDeviceId,
  outputDeviceId: initialOutputDeviceId,
  peerPrefs: initialPeerPrefs,
  inputs: [],
  outputs: [],
}));
let session: VoiceSession | null = null;

function update(state: Partial<VoiceClientState>): void {
  useVoiceStore.setState(state);
  persist(useVoiceStore.getState());
}

function currentSession(): VoiceSession {
  if (!session) {
    const { muted, deafened, inputDeviceId, outputDeviceId, peerPrefs } = useVoiceStore.getState();
    session = createVoiceSession(socket, update, {
      muted,
      deafened,
      inputDeviceId,
      outputDeviceId,
      peerPrefs,
      iceServers: () => parseIceServers(import.meta.env.VITE_WEBRTC_ICE_SERVERS),
    });
  }
  return session;
}

export async function joinVoice(roomCode: string, accountId: string): Promise<void> {
  await currentSession().join(roomCode, accountId);
}

export function leaveVoice(): void {
  session?.leave();
}

export function setVoiceMuted(muted: boolean): void {
  if (session) session.setMuted(muted);
  else useVoiceStore.setState({ muted });
}

export function setVoiceDeafened(deafened: boolean): void {
  if (session) session.setDeafened(deafened);
  else useVoiceStore.setState({ deafened });
}

export async function setVoiceInputDevice(deviceId: string | null): Promise<void> {
  if (session) await session.setInputDevice(deviceId);
  else update({ inputDeviceId: deviceId });
}

export function setVoiceOutputDevice(deviceId: string | null): void {
  if (session) session.setOutputDevice(deviceId);
  else update({ outputDeviceId: deviceId });
}

// Per-player controls only render while joined, so a session always exists here.
export function setVoicePeerMuted(accountId: string, muted: boolean): void {
  session?.setPeerMuted(accountId, muted);
}

export function setVoicePeerVolume(accountId: string, volume: number): void {
  session?.setPeerVolume(accountId, volume);
}

/** Loads the device lists now and whenever devices change; returns the unsubscribe. */
export function watchAudioDevices(): () => void {
  const refresh = (): void => {
    void listAudioDevices().then(({ inputs, outputs }) => useVoiceStore.setState({ inputs, outputs }))
      .catch(() => undefined);
  };
  refresh();
  navigator.mediaDevices?.addEventListener('devicechange', refresh);
  return () => navigator.mediaDevices?.removeEventListener('devicechange', refresh);
}

export async function resumeVoiceAudio(): Promise<void> {
  await session?.resumeAudio();
}

export function disposeVoice(): void {
  session?.dispose();
  session = null;
}
