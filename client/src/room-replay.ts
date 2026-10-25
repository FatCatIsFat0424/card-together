import { REPLAY_SPEED_MAX, REPLAY_SPEED_MIN, replaySessionPosition } from '@shared/replay-session';
import type { ReplaySessionPosition, ReplayStepDuration } from '@shared/replay-session';
import type {
  MatchHistory, MatchSummary, PlayerInfo, PublicAccount, RoomInfo, RoomReplayPlayback, RoomReplaySession,
} from '@shared/types';
import type { ReplayTranslationKey } from './replay-i18n';
import { roomErrorKey } from './room-error-i18n';
import type { RoomErrorTranslationKey } from './room-error-i18n';

/** Host intents from the transport; each becomes a new server-anchored playback. */
export type RoomReplayControl =
  | { readonly type: 'play' }
  | { readonly type: 'pause' }
  | { readonly type: 'seek'; readonly step: number }
  | { readonly type: 'speed'; readonly speed: number };

/** Readable dwell per step until the viewer supplies presentation-based durations. */
export const FALLBACK_ROOM_REPLAY_STEP_MS = 900;
export const fallbackRoomReplayStepDuration: ReplayStepDuration = () => FALLBACK_ROOM_REPLAY_STEP_MS;

/** Position on this client, projecting the server clock from the last snapshot's offset. */
export function roomReplayPosition(
  session: RoomReplaySession, clockOffset: number, localNow: number, stepDuration: ReplayStepDuration,
): ReplaySessionPosition {
  return replaySessionPosition(session, localNow + clockOffset, stepDuration);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The playback to request for a host control, from the position every member currently sees. */
export function roomReplayPlayback(
  session: RoomReplaySession, position: ReplaySessionPosition, control: RoomReplayControl,
): RoomReplayPlayback {
  const current = { step: position.step, playing: session.playing && !position.finished, speed: session.speed };
  switch (control.type) {
    case 'play':
      // Playing from the end starts over, as the personal viewer does.
      return { ...current, step: position.finished ? 0 : position.step, playing: true };
    case 'pause':
      return { ...current, playing: false };
    case 'seek':
      return { ...current, step: clamp(Math.round(control.step), 0, session.lastStep) };
    case 'speed':
      return { ...current, speed: clamp(control.speed, REPLAY_SPEED_MIN, REPLAY_SPEED_MAX) };
  }
}

const REPLAY_ERROR_KEYS: Readonly<Record<string, ReplayTranslationKey>> = {
  'Only the host can control the replay': 'replay.sharedErrorHostOnly',
  'Replays start from the waiting room': 'replay.sharedErrorWaiting',
  'A replay is in progress': 'replay.sharedErrorInProgress',
  'No replay in progress': 'replay.sharedErrorNoSession',
  'Invalid replay position': 'replay.sharedErrorInvalid',
  'Match replay not found': 'replay.sharedErrorNotFound',
  'Choose a match to replay': 'replay.sharedErrorNotFound',
  'Match history is private': 'replay.sharedPrivate',
};

/** Shared-replay acknowledgements first, then the general room messages. */
export function roomReplayErrorKey(
  message: string | undefined,
): ReplayTranslationKey | RoomErrorTranslationKey | 'common.error' {
  return REPLAY_ERROR_KEYS[message?.trim().replace(/\.$/, '') ?? ''] ?? roomErrorKey(message);
}

/** Human members, host first, then seats in order and spectators in join order. */
export function roomReplayMembers(room: RoomInfo): PlayerInfo[] {
  const seated = [...Object.values(room.seats), ...room.additionalSeats ?? []]
    .flatMap((entry) => entry.player && !entry.player.isBot ? [entry.player] : []);
  const members = [...seated, ...room.spectators ?? []];
  const unique = members.filter((member, index) => members.findIndex((entry) => entry.id === member.id) === index);
  return [...unique.filter((member) => member.id === room.hostId), ...unique.filter((member) => member.id !== room.hostId)];
}

export type MemberReplayHistory =
  | { readonly status: 'loading' }
  | { readonly status: 'private' }
  | { readonly status: 'failed' }
  | { readonly status: 'loaded'; readonly matches: readonly MatchSummary[]; readonly players: Readonly<Record<string, PublicAccount>> };

/** Keeps only matches with a recording, preserving the API's newest-first order. */
export function replayableHistory(history: MatchHistory): MemberReplayHistory {
  return { status: 'loaded', matches: history.matches.filter((match) => match.hasReplay), players: history.players };
}

/** Name for whoever started the session: a current member, else the recorded profile, else nothing. */
export function replayStarterName(
  room: RoomInfo, session: RoomReplaySession, players: Readonly<Record<string, PublicAccount>> = {},
): string | null {
  return roomReplayMembers(room).find((member) => member.id === session.startedBy)?.nickname
    ?? players[session.startedBy]?.nickname ?? null;
}
