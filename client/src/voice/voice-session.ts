import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@shared/types';
import type {
  VoiceIncomingSignal,
  VoiceParticipant,
  VoiceRoomState,
  VoiceSignal,
} from '@shared/types/voice';
import { parseIceServers } from './ice-servers';

export type VoiceErrorCode =
  | 'unsupported'
  | 'insecure'
  | 'permission'
  | 'no-microphone'
  | 'microphone-busy'
  | 'microphone-ended'
  | 'configuration'
  | 'join-failed'
  | 'connection-failed'
  | 'signal-failed'
  | 'disconnected';

export type VoicePeerConnection = 'connecting' | 'connected' | 'failed';

export type VoicePeerError = 'connection-failed' | 'signal-failed';

export interface VoiceClientState {
  status: 'idle' | 'joining' | 'joined' | 'error';
  roomCode: string | null;
  peerId: string | null;
  participants: VoiceParticipant[];
  muted: boolean;
  deafened: boolean;
  error: VoiceErrorCode | null;
  autoplayBlocked: boolean;
  peerErrors: Record<string, VoicePeerError>;
  peerConnections: Record<string, VoicePeerConnection>;
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  peerPrefs: Record<string, PeerPreference>;
  /** Accounts held silent during a match: observers, for a player still in it */
  silenced: string[];
}

/** Local listening preference for one remote player, keyed by account ID. */
export interface PeerPreference {
  muted: boolean;
  volume: number;
}

export interface VoiceSession {
  join(roomCode: string, accountId: string): Promise<void>;
  leave(): void;
  setMuted(muted: boolean): void;
  setDeafened(deafened: boolean): void;
  resumeAudio(): Promise<void>;
  setInputDevice(deviceId: string | null): Promise<void>;
  setOutputDevice(deviceId: string | null): void;
  setPeerMuted(accountId: string, muted: boolean): void;
  setPeerVolume(accountId: string, volume: number): void;
  setSilenced(accountIds: readonly string[]): void;
  dispose(): void;
}

export type VoiceSocket = Pick<
  Socket<ServerToClientEvents, ClientToServerEvents>,
  'id' | 'connected' | 'on' | 'off' | 'timeout'
>;

// Disposed controllers may still await an acknowledgment. Keep membership operations
// ordered across replacement controllers sharing the same connected socket.
const socketControls = new WeakMap<VoiceSocket, Promise<void>>();

interface Peer {
  id: string;
  connection: RTCPeerConnection;
  audio: HTMLAudioElement;
  queue: Promise<void>;
  queued: number;
  candidates: RTCIceCandidateInit[];
  closed: boolean;
  blocked: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

export function initialVoiceState(): VoiceClientState {
  return {
    status: 'idle',
    roomCode: null,
    peerId: null,
    participants: [],
    muted: false,
    deafened: false,
    error: null,
    autoplayBlocked: false,
    peerErrors: {},
    peerConnections: {},
    inputDeviceId: null,
    outputDeviceId: null,
    peerPrefs: {},
    silenced: [],
  };
}

export const DEFAULT_PEER_PREFERENCE: PeerPreference = { muted: false, volume: 1 };

/** Parses stored per-account peer preferences, dropping malformed entries. */
export function parsePeerPrefs(raw: string | null): Record<string, PeerPreference> {
  let value: unknown;
  try {
    value = JSON.parse(raw ?? '{}');
  } catch {
    return {};
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const prefs: Record<string, PeerPreference> = {};
  for (const [id, entry] of Object.entries(value)) {
    if (
      typeof entry === 'object' &&
      entry !== null &&
      typeof entry.muted === 'boolean' &&
      typeof entry.volume === 'number' &&
      entry.volume >= 0 &&
      entry.volume <= 1
    )
      prefs[id] = { muted: entry.muted, volume: entry.volume };
  }
  return prefs;
}

export function outputSelectionSupported(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}

export async function listAudioDevices(): Promise<{
  inputs: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
}> {
  const devices = (await navigator.mediaDevices?.enumerateDevices?.()) ?? [];
  const usable = devices.filter((device) => device.deviceId !== '');
  return {
    inputs: usable.filter((device) => device.kind === 'audioinput'),
    outputs: usable.filter((device) => device.kind === 'audiooutput'),
  };
}

function errorName(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'name' in error ? error.name : '';
}

function mediaError(error: unknown): VoiceErrorCode {
  const name = errorName(error);
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'permission';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-microphone';
  return 'microphone-busy';
}

/** One explicit microphone session, at most three remote audio peers, and no automatic rejoin. */
export function createVoiceSession(
  socket: VoiceSocket,
  onChange: (state: VoiceClientState) => void,
  options: {
    iceServers?: () => RTCIceServer[];
    muted?: boolean;
    deafened?: boolean;
    inputDeviceId?: string | null;
    outputDeviceId?: string | null;
    peerPrefs?: Record<string, PeerPreference>;
    silenced?: readonly string[];
  } = {},
): VoiceSession {
  let state = {
    ...initialVoiceState(),
    muted: options.muted ?? false,
    deafened: options.deafened ?? false,
    inputDeviceId: options.inputDeviceId ?? null,
    outputDeviceId: options.outputDeviceId ?? null,
    peerPrefs: { ...options.peerPrefs },
    silenced: [...options.silenced ?? []],
  };
  let inputSwitch = 0;
  let generation = 0;
  let disposed = false;
  let localStream: MediaStream | null = null;
  let currentAccount: string | null = null;
  let configuration: RTCConfiguration = {};
  let latestState: VoiceRoomState | null = null;
  let pendingSignals: VoiceIncomingSignal[] = [];
  let cancelJoinRetry: (() => void) | null = null;
  let membershipPossible = false;
  let membershipGeneration = -1;
  let membershipSocketId: string | undefined;
  const peers = new Map<string, Peer>();
  const trackListeners = new Map<MediaStreamTrack, () => void>();

  function publish(update: Partial<VoiceClientState>): void {
    state = { ...state, ...update };
    if (!disposed)
      onChange({
        ...state,
        participants: state.participants.map((participant) => ({ ...participant })),
        peerPrefs: { ...state.peerPrefs },
        peerErrors: { ...state.peerErrors },
        peerConnections: { ...state.peerConnections },
        silenced: [...state.silenced],
      });
  }

  function audioConstraints(): MediaStreamConstraints {
    return {
      audio: {
        ...(state.inputDeviceId ? { deviceId: { exact: state.inputDeviceId } } : {}),
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    };
  }

  function watchTrack(track: MediaStreamTrack, currentGeneration: number): void {
    const ended = (): void => {
      if (currentGeneration === generation) release('microphone-ended');
    };
    track.addEventListener('ended', ended);
    trackListeners.set(track, ended);
  }

  /** Effective playback: global deafen and match silencing always win over the per-player preference. */
  function applyPeerAudio(peer: Peer): void {
    const accountId = state.participants.find(
      (participant) => participant.peerId === peer.id,
    )?.accountId;
    const preference = (accountId && state.peerPrefs[accountId]) || DEFAULT_PEER_PREFERENCE;
    // An unknown peer stays silent while silencing applies, since it may be an observer.
    const silenced = state.silenced.length > 0 && (!accountId || state.silenced.includes(accountId));
    peer.audio.muted = state.deafened || preference.muted || silenced;
    peer.audio.volume = preference.volume;
  }

  function applySink(peer: Peer): void {
    if (outputSelectionSupported())
      peer.audio.setSinkId(state.outputDeviceId ?? '').catch(() => undefined);
  }

  function setPeerPreference(accountId: string, update: Partial<PeerPreference>): void {
    const preference = { ...DEFAULT_PEER_PREFERENCE, ...state.peerPrefs[accountId], ...update };
    publish({ peerPrefs: { ...state.peerPrefs, [accountId]: preference } });
    for (const peer of peers.values()) applyPeerAudio(peer);
  }

  function control<T>(operation: () => Promise<T>): Promise<T> {
    const result = (socketControls.get(socket) ?? Promise.resolve()).then(operation);
    socketControls.set(
      socket,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  }

  function active(peer: Peer): boolean {
    return !disposed && state.status === 'joined' && !peer.closed && peers.get(peer.id) === peer;
  }

  function playbackState(): void {
    publish({ autoplayBlocked: [...peers.values()].some((peer) => !peer.closed && peer.blocked) });
  }

  async function playAudio(peer: Peer): Promise<void> {
    if (!active(peer) || !peer.audio.srcObject) return;
    try {
      await peer.audio.play();
      if (active(peer)) peer.blocked = false;
    } catch {
      if (active(peer)) peer.blocked = true;
    }
    if (active(peer)) playbackState();
  }

  function closePeer(peer: Peer): void {
    if (peer.closed) return;
    peer.closed = true;
    if (peer.timer) clearTimeout(peer.timer);
    peer.connection.onicecandidate = null;
    peer.connection.ontrack = null;
    peer.connection.onconnectionstatechange = null;
    peer.connection.close();
    peer.audio.pause();
    peer.audio.srcObject = null;
    peer.audio.remove();
    peer.candidates = [];
  }

  function release(error: VoiceErrorCode | null = null, notify = true): void {
    generation += 1;
    cancelJoinRetry?.();
    cancelJoinRetry = null;
    for (const [track, listener] of trackListeners) track.removeEventListener('ended', listener);
    trackListeners.clear();
    localStream?.getTracks().forEach((track) => track.stop());
    localStream = null;
    for (const peer of peers.values()) closePeer(peer);
    peers.clear();
    currentAccount = null;
    latestState = null;
    pendingSignals = [];
    if (notify && membershipPossible && socket.connected) {
      const previousSocketId = membershipSocketId;
      void control(async () => {
        if (socket.connected && socket.id === previousSocketId)
          await socket.timeout(10_000).emitWithAck('voice:leave');
        membershipPossible = false;
      }).catch(() => undefined);
    } else if (!notify || !socket.connected) membershipPossible = false;
    publish({
      status: error ? 'error' : 'idle',
      roomCode: null,
      peerId: null,
      participants: [],
      error,
      peerErrors: {},
      peerConnections: {},
      autoplayBlocked: false,
    });
  }

  function failPeer(peer: Peer, error: VoicePeerError): void {
    if (!active(peer)) return;
    closePeer(peer);
    publish({
      peerErrors: { ...state.peerErrors, [peer.id]: error },
      peerConnections: { ...state.peerConnections, [peer.id]: 'failed' },
    });
    playbackState();
  }

  function enqueue(peer: Peer, operation: () => Promise<void>): void {
    if (!active(peer)) return;
    if (peer.queued >= 128) {
      failPeer(peer, 'signal-failed');
      return;
    }
    peer.queued += 1;
    peer.queue = peer.queue
      .then(async () => {
        if (active(peer)) await operation();
      })
      .catch(() => {
        failPeer(peer, 'connection-failed');
      })
      .finally(() => {
        peer.queued -= 1;
      });
  }

  async function sendSignal(peer: Peer, signal: Omit<VoiceSignal, 'targetPeerId'>): Promise<void> {
    if (!active(peer) || !socket.connected) return;
    try {
      const response = await socket
        .timeout(10_000)
        .emitWithAck('voice:signal', { targetPeerId: peer.id, ...signal });
      if (!response.success) failPeer(peer, 'signal-failed');
    } catch {
      failPeer(peer, 'signal-failed');
    }
  }

  async function sendDescription(peer: Peer): Promise<void> {
    const description = peer.connection.localDescription;
    if (
      active(peer) &&
      description &&
      (description.type === 'offer' || description.type === 'answer')
    ) {
      await sendSignal(peer, { description: { type: description.type, sdp: description.sdp } });
    }
  }

  function createPeer(id: string): Peer {
    const connection = new RTCPeerConnection(configuration);
    let audio: HTMLAudioElement;
    try {
      audio = new Audio();
    } catch (error) {
      connection.close();
      throw error;
    }
    const peer: Peer = {
      id,
      connection,
      audio,
      queue: Promise.resolve(),
      queued: 0,
      candidates: [],
      closed: false,
      blocked: false,
      timer: null,
    };
    peers.set(id, peer);
    publish({ peerConnections: { ...state.peerConnections, [id]: 'connecting' } });
    audio.hidden = true;
    applyPeerAudio(peer);
    if (state.outputDeviceId) applySink(peer);
    audio.setAttribute('playsinline', '');
    audio.setAttribute('data-voice-peer', id);
    document.body.appendChild(audio);
    connection.onicecandidate = (event): void => {
      if (event.candidate && active(peer)) {
        const candidate = event.candidate.toJSON();
        void sendSignal(peer, {
          candidate: {
            candidate: candidate.candidate ?? '',
            sdpMid: candidate.sdpMid ?? null,
            sdpMLineIndex: candidate.sdpMLineIndex ?? null,
            usernameFragment: candidate.usernameFragment,
          },
        });
      }
    };
    connection.ontrack = (event): void => {
      if (!active(peer) || event.track.kind !== 'audio') return;
      applyPeerAudio(peer);
      audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      void playAudio(peer);
    };
    connection.onconnectionstatechange = (): void => {
      if (!active(peer)) return;
      if (connection.connectionState === 'failed') {
        failPeer(peer, 'connection-failed');
        return;
      }
      publish({
        peerConnections: {
          ...state.peerConnections,
          [id]: connection.connectionState === 'connected' ? 'connected' : 'connecting',
        },
      });
      if (connection.connectionState === 'connected' && peer.timer) {
        clearTimeout(peer.timer);
        peer.timer = null;
      }
      if (connection.connectionState === 'disconnected' && !peer.timer) {
        peer.timer = setTimeout(() => {
          if (connection.connectionState !== 'connected') failPeer(peer, 'connection-failed');
        }, 30_000);
      }
    };
    peer.timer = setTimeout(() => {
      if (connection.connectionState !== 'connected') failPeer(peer, 'connection-failed');
    }, 30_000);
    for (const track of localStream!.getAudioTracks()) connection.addTrack(track, localStream!);
    // The smaller fresh peer ID is the only offerer; mute/deafen never renegotiate tracks.
    if (state.peerId! < id)
      enqueue(peer, async () => {
        const offer = await connection.createOffer();
        if (!active(peer)) return;
        await connection.setLocalDescription(offer);
        if (active(peer)) await sendDescription(peer);
      });
    return peer;
  }

  function applyState(room: VoiceRoomState): void {
    if (state.status !== 'joined' || room.roomCode !== state.roomCode) return;
    if (
      !room.participants.some(
        (participant) =>
          participant.peerId === state.peerId && participant.accountId === currentAccount,
      )
    ) {
      release('join-failed');
      return;
    }
    const participants = room.participants
      .slice(0, 4)
      .map((participant) =>
        participant.peerId === state.peerId
          ? { ...participant, muted: state.muted, deafened: state.deafened }
          : { ...participant },
      );
    const remoteIds = new Set(
      participants
        .filter((participant) => participant.peerId !== state.peerId)
        .map((participant) => participant.peerId),
    );
    for (const [id, peer] of peers)
      if (!remoteIds.has(id)) {
        closePeer(peer);
        peers.delete(id);
      }
    const peerErrors = Object.fromEntries(
      Object.entries(state.peerErrors).filter(([id]) => remoteIds.has(id)),
    );
    const peerConnections = Object.fromEntries(
      Object.entries(state.peerConnections).filter(([id]) => remoteIds.has(id)),
    );
    publish({ participants, peerErrors, peerConnections });
    for (const id of remoteIds) {
      if (peers.has(id) || state.peerErrors[id]) continue;
      try {
        createPeer(id);
      } catch {
        const peer = peers.get(id);
        if (peer) closePeer(peer);
        publish({
          peerErrors: { ...state.peerErrors, [id]: 'connection-failed' },
          peerConnections: { ...state.peerConnections, [id]: 'failed' },
        });
      }
    }
    playbackState();
  }

  function receiveSignal(signal: VoiceIncomingSignal): void {
    if (state.status === 'joining') {
      if (membershipGeneration === generation && pendingSignals.length < 128)
        pendingSignals.push(signal);
      return;
    }
    const peer = peers.get(signal.fromPeerId);
    if (!peer || !active(peer)) return;
    enqueue(peer, async () => {
      const connection = peer.connection;
      if (signal.description) {
        const description = signal.description;
        if (description.type === 'offer' && signal.fromPeerId > state.peerId!) return;
        if (description.type === 'answer' && connection.signalingState !== 'have-local-offer')
          return;
        await connection.setRemoteDescription(description);
        if (!active(peer)) return;
        while (peer.candidates.length > 0 && active(peer))
          await connection.addIceCandidate(peer.candidates.shift()!);
        if (description.type === 'offer' && active(peer)) {
          const answer = await connection.createAnswer();
          if (!active(peer)) return;
          await connection.setLocalDescription(answer);
          if (active(peer)) await sendDescription(peer);
        }
      } else if (signal.candidate) {
        if (connection.remoteDescription) await connection.addIceCandidate(signal.candidate);
        else if (peer.candidates.length < 128) peer.candidates.push(signal.candidate);
        else failPeer(peer, 'signal-failed');
      }
    });
  }

  function receiveState(room: VoiceRoomState): void {
    if (room.roomCode !== state.roomCode) return;
    if (state.status === 'joining' && membershipGeneration === generation) latestState = room;
    else applyState(room);
  }

  function handleDisconnect(): void {
    if (state.status === 'joined' || state.status === 'joining') release('disconnected', false);
  }

  function handleLeft(): void {
    if (state.status === 'joining' && membershipGeneration !== generation) return;
    if (state.status === 'joined' || state.status === 'joining') release('join-failed', false);
  }

  function sendSettings(): void {
    if (state.status !== 'joined') return;
    const currentGeneration = generation;
    void control(async () => {
      if (currentGeneration !== generation || state.status !== 'joined') return;
      const response = await socket
        .timeout(10_000)
        .emitWithAck('voice:settings', { muted: state.muted, deafened: state.deafened });
      if (currentGeneration === generation && !response.success) release('signal-failed');
    }).catch(() => {
      if (currentGeneration === generation) release('signal-failed');
    });
  }

  socket.on('voice:state', receiveState);
  socket.on('voice:signal', receiveSignal);
  socket.on('voice:left', handleLeft);
  socket.on('disconnect', handleDisconnect);

  return {
    async join(roomCode, accountId): Promise<void> {
      if (disposed || state.status === 'joining' || state.status === 'joined') return;
      if (!globalThis.isSecureContext) {
        publish({ status: 'error', error: 'insecure' });
        return;
      }
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof RTCPeerConnection === 'undefined' ||
        typeof Audio === 'undefined'
      ) {
        publish({ status: 'error', error: 'unsupported' });
        return;
      }
      if (!socket.connected) {
        publish({ status: 'error', error: 'disconnected' });
        return;
      }
      try {
        configuration = { iceServers: options.iceServers?.() ?? parseIceServers() };
      } catch {
        publish({ status: 'error', error: 'configuration' });
        return;
      }
      const currentGeneration = ++generation;
      currentAccount = accountId;
      publish({ status: 'joining', roomCode, peerId: null, error: null, autoplayBlocked: false });
      let stream: MediaStream;
      try {
        try {
          stream = await navigator.mediaDevices.getUserMedia(audioConstraints());
        } catch (error) {
          // A remembered microphone may have been unplugged; fall back to the default device.
          const name = errorName(error);
          if (
            !state.inputDeviceId ||
            (name !== 'OverconstrainedError' && name !== 'NotFoundError') ||
            currentGeneration !== generation ||
            disposed
          )
            throw error;
          publish({ inputDeviceId: null });
          stream = await navigator.mediaDevices.getUserMedia(audioConstraints());
        }
      } catch (error) {
        if (currentGeneration === generation && !disposed) release(mediaError(error));
        return;
      }
      if (currentGeneration !== generation || disposed) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      localStream = stream;
      if (
        stream.getAudioTracks().length === 0 ||
        stream.getAudioTracks().some((track) => track.readyState === 'ended')
      ) {
        release('no-microphone');
        return;
      }
      for (const track of stream.getAudioTracks()) {
        track.enabled = !state.muted;
        watchTrack(track, currentGeneration);
      }
      try {
        await control(async () => {
          if (currentGeneration !== generation || disposed) return;
          membershipPossible = true;
          membershipGeneration = currentGeneration;
          membershipSocketId = socket.id;
          const settings = { muted: state.muted, deafened: state.deafened };
          const joinSocketId = socket.id;
          const deadline = Date.now() + 45_000;
          let result = await socket.timeout(10_000).emitWithAck('voice:join', settings);
          // A refreshed page can reconnect before the server observes the old socket closing.
          while (
            !result.success &&
            result.error === 'Voice is already active in another tab. Leave it there first.' &&
            currentGeneration === generation &&
            !disposed &&
            socket.connected &&
            socket.id === joinSocketId &&
            Date.now() < deadline
          ) {
            await new Promise<void>((resolve) => {
              const finish = (): void => {
                clearTimeout(timer);
                cancelJoinRetry = null;
                resolve();
              };
              const timer = setTimeout(finish, Math.min(1_000, deadline - Date.now()));
              cancelJoinRetry = finish;
            });
            if (
              currentGeneration !== generation ||
              disposed ||
              !socket.connected ||
              socket.id !== joinSocketId
            )
              return;
            if (Date.now() >= deadline) break;
            result = await socket
              .timeout(Math.min(10_000, deadline - Date.now()))
              .emitWithAck('voice:join', settings);
          }
          if (currentGeneration !== generation || disposed) return;
          if (
            !result.success ||
            !result.peerId ||
            !result.state ||
            result.state.roomCode !== roomCode
          ) {
            release('join-failed');
            return;
          }
          publish({ status: 'joined', peerId: result.peerId });
          const room = latestState?.participants.some(
            (participant) => participant.peerId === result.peerId,
          )
            ? latestState
            : result.state;
          latestState = null;
          applyState(room);
          const signals = pendingSignals;
          pendingSignals = [];
          for (const signal of signals) receiveSignal(signal);
          if (state.muted !== settings.muted || state.deafened !== settings.deafened)
            sendSettings();
        });
      } catch {
        if (currentGeneration === generation && !disposed) release('join-failed');
      }
    },
    leave: () => release(),
    setMuted(muted): void {
      localStream?.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
      publish({ muted });
      sendSettings();
    },
    setDeafened(deafened): void {
      publish({ deafened });
      for (const peer of peers.values()) {
        applyPeerAudio(peer);
        if (!deafened) void playAudio(peer);
      }
      sendSettings();
    },
    async resumeAudio(): Promise<void> {
      await Promise.all([...peers.values()].map(playAudio));
    },
    async setInputDevice(deviceId): Promise<void> {
      publish({ inputDeviceId: deviceId });
      if (!localStream || disposed) return;
      const currentGeneration = generation;
      const currentSwitch = ++inputSwitch;
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(audioConstraints());
      } catch (error) {
        if (currentGeneration === generation && currentSwitch === inputSwitch && !disposed)
          publish({ error: mediaError(error) });
        return;
      }
      const track = stream.getAudioTracks()[0];
      if (
        !track ||
        !localStream ||
        disposed ||
        currentGeneration !== generation ||
        currentSwitch !== inputSwitch
      ) {
        stream.getTracks().forEach((stale) => stale.stop());
        return;
      }
      const oldTracks = localStream.getTracks();
      track.enabled = !state.muted;
      watchTrack(track, currentGeneration);
      for (const peer of peers.values())
        for (const sender of peer.connection.getSenders())
          if (sender.track && oldTracks.includes(sender.track))
            sender.replaceTrack(track).catch(() => failPeer(peer, 'connection-failed'));
      for (const old of oldTracks) {
        const listener = trackListeners.get(old);
        if (listener) old.removeEventListener('ended', listener);
        trackListeners.delete(old);
        old.stop();
      }
      localStream = stream;
      if (
        state.error === 'permission' ||
        state.error === 'no-microphone' ||
        state.error === 'microphone-busy'
      )
        publish({ error: null });
    },
    setOutputDevice(deviceId): void {
      publish({ outputDeviceId: deviceId });
      for (const peer of peers.values()) applySink(peer);
    },
    setPeerMuted(accountId, muted): void {
      setPeerPreference(accountId, { muted });
    },
    setPeerVolume(accountId, volume): void {
      setPeerPreference(accountId, { volume: Math.max(0, Math.min(1, volume)) });
    },
    setSilenced(accountIds): void {
      if (accountIds.length === state.silenced.length && accountIds.every((id) => state.silenced.includes(id))) return;
      publish({ silenced: [...accountIds] });
      for (const peer of peers.values()) applyPeerAudio(peer);
    },
    dispose(): void {
      if (disposed) return;
      release();
      disposed = true;
      socket.off('voice:state', receiveState);
      socket.off('voice:signal', receiveSignal);
      socket.off('voice:left', handleLeft);
      socket.off('disconnect', handleDisconnect);
    },
  };
}
