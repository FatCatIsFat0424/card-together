import type { VoiceClientState } from './voice-session';

export type VoiceSummaryKind = 'off' | 'joining' | 'error' | 'joined' | 'connected' | 'partial';

/** Dot colour in the panel header. */
export type VoiceDotState = 'idle' | 'busy' | 'ok' | 'bad';

export interface VoiceSummary {
  readonly kind: VoiceSummaryKind;
  readonly dot: VoiceDotState;
  /** People in the call, including the local player. */
  readonly count: number;
  /** Some remote connections failed, so rejoining is worth offering. */
  readonly needsRejoin: boolean;
}

type SummaryInput = Pick<VoiceClientState, 'status' | 'error' | 'participants' | 'peerId' | 'peerErrors' | 'peerConnections'>;

/** Condenses the session into what the header shows and whether the inline rejoin action is warranted. */
export function summarizeVoice(state: SummaryInput): VoiceSummary {
  const count = state.participants.length;
  if (state.status === 'joining') return { kind: 'joining', dot: 'busy', count, needsRejoin: false };
  if (state.status !== 'joined') {
    return state.error
      ? { kind: 'error', dot: 'bad', count: 0, needsRejoin: false }
      : { kind: 'off', dot: 'idle', count: 0, needsRejoin: false };
  }
  const remote = state.participants.filter((participant) => participant.peerId !== state.peerId);
  const failed = remote.some((participant) => state.peerErrors[participant.peerId]);
  if (failed) return { kind: 'partial', dot: 'bad', count, needsRejoin: true };
  const allConnected = remote.length > 0 && remote.every(
    (participant) => state.peerConnections[participant.peerId] === 'connected',
  );
  return { kind: allConnected ? 'connected' : 'joined', dot: allConnected ? 'ok' : 'busy', count, needsRejoin: false };
}

/** Only one participant row is expanded at a time; activating it again collapses it. */
export function toggleExpandedRow(current: string | null, accountId: string): string | null {
  return current === accountId ? null : accountId;
}

/** An expanded row closes when its participant leaves the call. */
export function visibleExpandedRow(current: string | null, accountIds: readonly string[]): string | null {
  return current !== null && accountIds.includes(current) ? current : null;
}
