import {
  object, number, gameSeatList, resultSeats, sameJson, oneOf, gameSeats, text, flexibleSeatGame,
  gameSeatValues, distinctPlayers, gameSeatCounts,
} from '../../runtime/validation-helpers';
import type { ObjectValue, PlayerValidator } from '../../runtime/validation-helpers';
import { DOMINOES_TARGETS, isDominoesOptions } from '@shared/dominoes-options';
import type { DominoesGameState, DominoPlacement, DominoTile } from '@shared/games/dominoes/types';
import { DM_MAX_ROUNDS, DM_PIPS, dmAllTiles, dmLeaders, dmMatchOver, dmSameTile } from '@shared/rules/dominoes';
import { occupiedSeats } from '@shared/rules/seats';
import { GAME_SEAT_ORDER } from '@shared/constants';

/** The whole set holds 168 pips, which bounds what one round can score. */
const MAX_ROUND_POINTS = 168;
const MAX_SCORE = MAX_ROUND_POINTS * DM_MAX_ROUNDS;

function pip(value: unknown): boolean {
  return (DM_PIPS as readonly unknown[]).includes(value);
}

function tile(value: unknown): value is DominoTile {
  return Array.isArray(value) && value.length === 2 && pip(value[0]) && pip(value[1]) && value[0] <= value[1];
}

function tiles(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 28 && value.every(tile);
}

function placement(value: unknown): boolean {
  if (!object(value) || !tile(value.tile) || !pip(value.left) || !pip(value.right)) return false;
  const [low, high] = value.tile;
  return (value.left === low && value.right === high) || (value.left === high && value.right === low);
}

function ends(value: unknown): boolean {
  return object(value) && pip(value.left) && pip(value.right);
}

/** Dominoes result: the highest totals win, so `winners` lists exactly the seats on the highest total. */
export function isDominoesResult(value: unknown): boolean {
  if (!object(value) || value.gameType !== 'dominoes' || !gameSeatCounts(value.scores, MAX_SCORE)
    || !gameSeatList(value.winners) || !number(value.rounds) || value.rounds < 1 || value.rounds > DM_MAX_ROUNDS
    || !DOMINOES_TARGETS.includes(value.targetScore as never)
    || !Array.isArray(value.roundWinners) || value.roundWinners.length !== value.rounds) return false;
  const participants = resultSeats(value);
  if (!participants) return false;
  const scores = value.scores as Record<string, number>;
  return value.roundWinners.every((winner: unknown) => winner === null
      || (oneOf(winner, gameSeats) && participants.includes(winner as never)))
    && gameSeats.every((seat) => participants.includes(seat) || scores[seat] === 0)
    && sameJson(value.winners, dmLeaders(participants, value.scores as never));
}

function dominoesLog(value: unknown): boolean {
  if (!object(value) || !number(value.timestamp)) return false;
  switch (value.type) {
    case 'round':
      return number(value.round) && oneOf(value.leader, gameSeats) && gameSeatCounts(value.counts, 28)
        && number(value.boneyard) && value.boneyard <= 28;
    case 'play':
      return oneOf(value.seat, gameSeats) && tile(value.tile) && (value.side === null || oneOf(value.side, ['left', 'right']))
        && placement(value.placement);
    case 'draw':
    case 'pass':
      return oneOf(value.seat, gameSeats) && ends(value.ends);
    case 'roundEnd':
      return number(value.round) && oneOf(value.reason, ['domino', 'blocked', 'tie'])
        && (value.winner === null || oneOf(value.winner, gameSeats)) && number(value.points)
        && value.points <= MAX_ROUND_POINTS && gameSeatValues(value.hands, tiles)
        && gameSeatCounts(value.scores, MAX_SCORE);
    default:
      return false;
  }
}

export function dominoesGame(value: ObjectValue, player: PlayerValidator): boolean {
  return isDominoesOptions(value.options)
    && text(value.id) && text(value.roomCode) && number(value.startedAt)
    && flexibleSeatGame(value, player)
    && oneOf(value.phase, ['playing', 'scoring'])
    && number(value.round) && value.round >= 1 && value.round <= DM_MAX_ROUNDS
    && gameSeatValues(value.hands, tiles)
    && tiles(value.boneyard)
    && Array.isArray(value.line) && value.line.length <= 28 && value.line.every(placement)
    && oneOf(value.leader, gameSeats) && oneOf(value.currentTurnSeat, gameSeats)
    && (value.openingTile === null || tile(value.openingTile))
    && gameSeatCounts(value.scores, MAX_SCORE)
    && Array.isArray(value.log) && value.log.every(dominoesLog)
    && (value.result === null || isDominoesResult(value.result));
}

/** The line, hands, boneyard, scores, and result all follow from the public log. */
export function coherentDominoesGame(state: DominoesGameState): boolean {
  if (!distinctPlayers(state.players)) return false;
  const seats = occupiedSeats(state.players);
  if (!seats.includes(state.currentTurnSeat) || !seats.includes(state.leader)
    || GAME_SEAT_ORDER.some((seat) => !state.players[seat] && state.hands[seat].length > 0)) return false;
  const logSeats = state.log.every((entry) => {
    switch (entry.type) {
      case 'round': return seats.includes(entry.leader);
      case 'play': case 'draw': case 'pass': return seats.includes(entry.seat);
      case 'roundEnd': return entry.winner === null || seats.includes(entry.winner);
    }
  });
  if (!logSeats) return false;

  // Every tile of the set is in exactly one place.
  const all = [...seats.flatMap((seat) => state.hands[seat]), ...state.boneyard, ...state.line.map((placed) => placed.tile)];
  const set = dmAllTiles();
  if (all.length !== set.length || !set.every((entry) => all.filter((other) => dmSameTile(other, entry)).length === 1)) {
    return false;
  }

  const rounds = state.log.filter((entry) => entry.type === 'round');
  const ends = state.log.filter((entry) => entry.type === 'roundEnd');
  const finished = state.phase === 'scoring';
  if (rounds.length !== state.round || rounds.some((entry, index) => entry.round !== index + 1)
    || ends.some((entry, index) => entry.round !== index + 1)
    || ends.length !== (finished ? state.round : state.round - 1)) return false;
  const lastEnd = ends.at(-1);
  const expectedScores = lastEnd?.scores ?? Object.fromEntries(GAME_SEAT_ORDER.map((seat) => [seat, 0]));
  if (!sameJson(state.scores, expectedScores)) return false;
  const wins = GAME_SEAT_ORDER.map((seat) => ends.reduce(
    (sum, entry) => sum + (entry.winner === seat ? entry.points : 0), 0));
  if (!sameJson(wins, GAME_SEAT_ORDER.map((seat) => state.scores[seat]))) return false;

  // Replay the current round from its deal.
  const start = state.log.map((entry) => entry.type).lastIndexOf('round');
  const opening = state.log[start];
  if (opening?.type !== 'round' || opening.leader !== state.leader) return false;
  const counts = { ...opening.counts };
  let boneyard = opening.boneyard;
  let line: DominoPlacement[] = [];
  for (const entry of state.log.slice(start + 1)) {
    if (entry.type === 'play') {
      line = entry.side === 'left' ? [entry.placement, ...line] : [...line, entry.placement];
      counts[entry.seat]--;
    } else if (entry.type === 'draw') {
      counts[entry.seat]++;
      boneyard--;
    }
  }
  const roundEnded = finished || state.log.at(-1)?.type === 'roundEnd';
  if (!sameJson(line, state.line) || boneyard !== state.boneyard.length
    || GAME_SEAT_ORDER.some((seat) => counts[seat] !== state.hands[seat].length)) return false;
  if (roundEnded && !finished) return false;
  if (state.line.length === 0 && state.currentTurnSeat !== state.leader) return false;
  if ((state.round === 1) !== (state.openingTile !== null)) return false;

  if (!finished) {
    return state.result === null && !dmMatchOver(seats, state.scores, state.options.targetScore, state.round - 1);
  }
  const { result } = state;
  return result !== null && sameJson(result.scores, state.scores) && sameJson(result.seats, seats)
    && result.rounds === state.round && result.targetScore === state.options.targetScore
    && sameJson(result.roundWinners, ends.map((entry) => entry.winner))
    && dmMatchOver(seats, state.scores, state.options.targetScore, state.round);
}
