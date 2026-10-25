import { GAME_SEAT_ORDER } from '@shared/constants';
import { applyReplayPatch } from '@shared/replay-patch';
import { isCompassSeat } from '@shared/rules/seats';
import type {
  GameSeat, MatchReplay, MatchSummary, PlayerInfo, PublicAccount, ReplayRecording, ReplaySnapshot, RoomInfo, SeatInfo,
} from '@shared/types';
import { resultSeats } from './game-view';
import { clampReplayStep, replayFreshFrames, replayStepHoldMs } from './replay-playback';

/** Rebuilding from the nearest checkpoint applies at most this many patches. */
const CHECKPOINT_INTERVAL = 32;

export interface ReplayTimeline {
  /** The last step; step 0 is the initial snapshot. */
  readonly total: number;
  snapshot: (step: number) => ReplaySnapshot;
  /** Auto-play time on a step at 1x, from the frames it adds to its predecessor. */
  holdMs: (step: number) => number;
}

/**
 * Snapshots are folded on demand from periodic checkpoints, so seeking anywhere stays fast
 * without keeping every step's log copy alive. Invalid patches throw.
 */
export function createReplayTimeline(recording: ReplayRecording): ReplayTimeline {
  const total = recording.steps.length;
  const checkpoints: ReplaySnapshot[] = [recording.initial];
  const holds = new Map<number, number>();
  let recent = { step: 0, snapshot: recording.initial };

  const snapshot = (target: number): ReplaySnapshot => {
    const step = clampReplayStep(target, total);
    if (step === recent.step) return recent.snapshot;
    const index = Math.min(Math.floor(step / CHECKPOINT_INTERVAL), checkpoints.length - 1);
    let from = { step: index * CHECKPOINT_INTERVAL, snapshot: checkpoints[index] };
    if (recent.step < step && recent.step > from.step) from = recent;
    let current = from.snapshot;
    for (let next = from.step + 1; next <= step; next++) {
      current = applyReplayPatch(current, recording.steps[next - 1]);
      if (next % CHECKPOINT_INTERVAL === 0 && checkpoints.length === next / CHECKPOINT_INTERVAL) checkpoints.push(current);
    }
    recent = { step, snapshot: current };
    return current;
  };

  const holdMs = (target: number): number => {
    const step = clampReplayStep(target, total);
    const known = holds.get(step);
    if (known !== undefined) return known;
    const previous = step > 0 ? snapshot(step - 1) : null;
    const hold = replayStepHoldMs(previous, snapshot(step));
    holds.set(step, hold);
    return hold;
  };

  return { total, snapshot, holdMs };
}

/** Whether every patch applies and the recording belongs to the listed match. */
export function isPlayableReplay(replay: MatchReplay, match: MatchSummary): boolean {
  if (replay.gameType !== match.result.gameType || replay.initial.gameType !== replay.gameType) return false;
  try {
    const timeline = createReplayTimeline(replay);
    return timeline.snapshot(timeline.total).gameType === replay.gameType;
  } catch {
    return false;
  }
}

/**
 * Recorded presentations omit `serverNow`; restoring one with `serverNow` set makes the table
 * treat it as arriving now. An animated step starts at its first new frame, a settled step
 * arrives with every frame already over.
 */
export function presentedReplaySnapshot(
  previous: ReplaySnapshot | null, current: ReplaySnapshot, animate: boolean,
): ReplaySnapshot {
  const presentation = current.presentation;
  if (!presentation) return current;
  const { offsetMs, durationMs } = replayFreshFrames(previous, current);
  const serverNow = presentation.startedAt + offsetMs + (animate ? 0 : durationMs);
  return { ...current, presentation: { ...presentation, serverNow } };
}

/** The seat an account played; summaries list account IDs in result seat order. */
export function replaySeatOf(match: MatchSummary, accountId: string | undefined): GameSeat | null {
  const index = accountId ? match.accountIds.indexOf(accountId) : -1;
  return index >= 0 ? resultSeats(match.result)[index] ?? null : null;
}

/**
 * Seat names and appearance come from the recorded accounts, never the current room. Accounts
 * no longer on record keep a plain plate named after their seat.
 */
export function replayParticipants(
  match: MatchSummary, players: Readonly<Record<string, PublicAccount>>, seatName: (seat: GameSeat, bot: boolean) => string,
): Partial<Record<GameSeat, PlayerInfo>> {
  const seats = resultSeats(match.result);
  return Object.fromEntries(match.accountIds.flatMap((id, index): [GameSeat, PlayerInfo][] => {
    const seat = seats[index];
    if (!seat) return [];
    const account = players[id];
    const bot = id.startsWith('bot:');
    return [[seat, account && !bot ? {
      id: account.id, username: account.username, nickname: account.nickname, color: account.color,
      avatar: account.avatar, avatarImage: account.avatarImage, avatarBorder: account.avatarBorder ?? null,
      nameplate: account.nameplate ?? null, chatFrame: account.chatFrame ?? null,
    } : {
      id, username: '', nickname: seatName(seat, bot), color: '#7f8c8d', avatar: 'cat', avatarImage: null,
      ...(bot ? { isBot: true } : {}),
    }]];
  }));
}

/** A room that exists only for the replay table: recorded seats, no host, no votes. */
export function replayRoom(
  replay: MatchReplay, match: MatchSummary, participants: Partial<Record<GameSeat, PlayerInfo>>,
): RoomInfo {
  const seat = (value: GameSeat): SeatInfo => ({ player: participants[value] ?? null, isReady: true });
  const extra = resultSeats(match.result).filter((value) => !isCompassSeat(value))
    .map((value) => GAME_SEAT_ORDER.indexOf(value) - 3);
  const additional = Math.max(0, ...extra);
  return {
    code: match.roomCode,
    gameType: replay.gameType,
    status: 'playing',
    seats: { N: seat('N'), E: seat('E'), S: seat('S'), W: seat('W') },
    ...(additional > 0 ? { additionalSeats: GAME_SEAT_ORDER.slice(4, 4 + additional).map(seat) } : {}),
    createdAt: replay.startedAt,
    hostId: '',
    abortVote: null,
    abortVoteCooldownUntil: null,
  };
}
