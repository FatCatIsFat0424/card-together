import { gameDefinition } from '@shared/games/registry';
import { diffReplaySnapshot } from '@shared/replay-patch';
import type {
  GameType, MatchReplay, MatchResult, MatchSummary, PlayerInfo, PublicAccount, ReplayPatchOp, ReplaySnapshot, Seat,
} from '@shared/types';
import * as games from '../../src/managers/game-manager';
import { getTurnSeat } from '../../src/managers/game-clock';
import { applyAutomatedAction, firstLegalAction } from '../../src/runtime/automated-action';

export const REPLAY_SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];

const player = (seat: Seat): PlayerInfo => ({
  id: `account-${seat}`, username: `player_${seat.toLowerCase()}`, nickname: `Live ${seat}`, color: '#4a9eff',
  avatar: 'cat', avatarImage: null,
});

/** Historical profiles differ from the room's live names, so tests can tell which one a seat shows. */
export const RECORDED_PLAYERS: Readonly<Record<string, PublicAccount>> = Object.fromEntries(REPLAY_SEATS.map((seat) => [
  `account-${seat}`,
  { id: `account-${seat}`, username: `player_${seat.toLowerCase()}`, nickname: `Recorded ${seat}`, color: '#123456',
    avatar: 'fox', avatarImage: null },
]));

/** What the recorder stores: the unseated spectator view without its clock or server time. */
export function spectatorSnapshot(code: string): ReplaySnapshot {
  const visible = structuredClone(games.getRecipientVisibleState(code, null)!);
  delete visible.clock;
  if (visible.presentation) {
    const { serverNow: _serverNow, ...presentation } = visible.presentation;
    visible.presentation = presentation;
  }
  return visible;
}

function act(code: string): void {
  const game = games.getGameState(code)!;
  // Presentations hold the next action back; the recording already holds this one.
  delete game.presentation;
  const seat = game.gameType === 'chinesepoker'
    ? REPLAY_SEATS.find((pending) => game.arrangements[pending] === null)
    : game.gameType === 'blackjack' && game.phase === 'betting'
      ? REPLAY_SEATS.find((pending) => game.players[pending] && game.bets[pending] === null && game.chips[pending] >= 10)
      : game.gameType === 'tenhalf' && game.phase === 'betting'
        ? REPLAY_SEATS.find((pending) => game.players[pending] && game.pendingBets[pending] === null
          && pending !== game.banker && game.chips[pending] >= 10)
      : game.gameType === 'napoleon' && game.phase === 'reviewing'
        ? game.seats.find((pending) => pending !== game.contract?.napoleon && !game.reviewed.includes(pending))
        : getTurnSeat(game);
  if (!seat) throw new Error('Expected a pending action.');
  if (game.gameType === 'bridge' && game.phase === 'bidding' && !game.bidding?.highestBid) {
    if (!games.handleBid(code, seat as Seat, { type: 'bid', level: 1, suit: 'clubs' }, true).success) throw new Error('Bid failed.');
  } else if (game.gameType === 'napoleon' && game.phase === 'bidding' && !game.bidding?.highestBid) {
    if (!games.handleNapoleonAction(code, seat, { type: 'bid', action: { type: 'bid', level: 9, suit: 'clubs' } }, true).success) {
      throw new Error('Bid failed.');
    }
  } else {
    const action = firstLegalAction(games.getPlayerVisibleState(code, seat)!);
    if (!action || !applyAutomatedAction(code, seat, action).success) throw new Error('Expected a legal action.');
  }
}

export interface RecordedMatch {
  readonly replay: MatchReplay;
  readonly match: MatchSummary;
  /** Every recorded snapshot, folded independently of the client timeline. */
  readonly snapshots: readonly ReplaySnapshot[];
}

/** Plays a real match with simple legal moves and records it as the server would. */
export function recordMatch(gameType: GameType, code = 'REPLAY', maxSteps = 2_000): RecordedMatch {
  // Two-player games seat only the first two seats.
  const seated = REPLAY_SEATS.slice(0, Math.min(REPLAY_SEATS.length, gameDefinition(gameType).seats.maxPlayers));
  const live = Object.fromEntries(seated.map((seat) => [seat, player(seat)]));
  if (!games.startGame(code, gameType, live).success) throw new Error('Game did not start.');
  const startedAt = games.getGameState(code)!.startedAt;
  const snapshots = [spectatorSnapshot(code)];
  const steps: ReplayPatchOp[][] = [];
  while (!games.getGameState(code)!.result && steps.length < maxSteps) {
    act(code);
    const next = spectatorSnapshot(code);
    const ops = diffReplaySnapshot(snapshots.at(-1), next);
    if (ops.length === 0) continue;
    steps.push(ops);
    snapshots.push(next);
  }
  const game = games.getGameState(code)!;
  const result = (game.gameType === 'bridge' ? { ...game.result, gameType: 'bridge' } : game.result) as MatchResult;
  games.removeGame(code);
  return {
    replay: { version: 1, gameType, startedAt, initial: snapshots[0], steps },
    match: { id: `match-${gameType}`, roomCode: 'OLD123', accountIds: seated.map((seat) => `account-${seat}`),
      result, finishedAt: startedAt + 1, hasReplay: true },
    snapshots,
  };
}
