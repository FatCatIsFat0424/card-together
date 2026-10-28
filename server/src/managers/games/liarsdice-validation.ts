import {
  LDI_DICE_PER_PLAYER, ldiIsLegalBid, ldiNextAlive, ldiNextStarter, ldiOnesWildAfter, ldiResolveCall, ldiTotalDice,
} from '@shared/rules/liarsdice';
import { gameSeatMap, occupiedSeats } from '@shared/rules/seats';
import type { GameSeat, LiarsDiceGameState, LiarsDiceStandingBid } from '@shared/types';
import {
  object, number, oneOf, gameSeats, gameSeatCounts, gameSeatList, gameSeatValues, flexibleSeatGame, distinctPlayers, sameJson,
} from '../../runtime/validation-helpers';
import type { ObjectValue, PlayerValidator } from '../../runtime/validation-helpers';

/** Largest legal bid: every seat's dice at the start of a match. */
const MAX_DICE = LDI_DICE_PER_PLAYER * gameSeats.length;

function die(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6;
}

function diceList(value: unknown): boolean {
  return Array.isArray(value) && value.length <= LDI_DICE_PER_PLAYER && value.every(die);
}

function bidShape(value: ObjectValue): boolean {
  return number(value.quantity) && value.quantity >= 1 && value.quantity <= MAX_DICE && die(value.face);
}

/** Liar's Dice result: one survivor, every other seat eliminated, and one die lost per round. */
export function isLiarsDiceResult(value: unknown): boolean {
  if (!object(value) || value.gameType !== 'liarsdice' || !gameSeatList(value.seats) || !gameSeatList(value.eliminationOrder)
    || !oneOf(value.winnerSeat, gameSeats) || !gameSeatCounts(value.dice, LDI_DICE_PER_PLAYER) || !number(value.rounds)) {
    return false;
  }
  const { seats, winnerSeat, eliminationOrder, dice, rounds } = value;
  const winner = winnerSeat as GameSeat;
  return seats.length >= 2 && sameJson(seats, gameSeats.filter((seat) => seats.includes(seat)))
    && seats.includes(winner) && eliminationOrder.length === seats.length - 1
    && eliminationOrder.every((seat) => seats.includes(seat) && seat !== winner)
    && gameSeats.every((seat) => dice[seat] === (seat === winner ? dice[seat] : 0)) && dice[winner] >= 1
    && rounds === LDI_DICE_PER_PLAYER * (seats.length - 1) + LDI_DICE_PER_PLAYER - dice[winner];
}

function liarsDiceLog(value: unknown): boolean {
  if (!object(value) || !number(value.timestamp)) return false;
  switch (value.type) {
    case 'round':
      return number(value.round) && value.round >= 1 && oneOf(value.starter, gameSeats)
        && gameSeatCounts(value.counts, LDI_DICE_PER_PLAYER);
    case 'bid':
      return oneOf(value.seat, gameSeats) && bidShape(value);
    case 'challenge':
      return oneOf(value.seat, gameSeats) && oneOf(value.target, gameSeats) && value.target !== value.seat && bidShape(value)
        && typeof value.wild === 'boolean' && gameSeatValues(value.dice, diceList) && number(value.count)
        && value.count <= MAX_DICE && typeof value.bidTrue === 'boolean' && oneOf(value.loser, gameSeats)
        && typeof value.eliminated === 'boolean';
    default: return false;
  }
}

function standingBid(value: unknown): boolean {
  return value === null || (object(value) && Object.keys(value).length === 3 && oneOf(value.seat, gameSeats)
    && bidShape(value));
}

export function liarsDiceGame(value: ObjectValue, player: PlayerValidator): boolean {
  return flexibleSeatGame(value, player) &&
    oneOf(value.phase, ['playing', 'scoring']) &&
    number(value.round) && value.round >= 1 &&
    gameSeatValues(value.hands, diceList) &&
    standingBid(value.bid) &&
    typeof value.onesWild === 'boolean' &&
    oneOf(value.currentTurnSeat, gameSeats) &&
    gameSeatList(value.eliminated) &&
    Array.isArray(value.log) &&
    value.log.every(liarsDiceLog) &&
    (value.result === null || isLiarsDiceResult(value.result));
}

/**
 * Replaying the public log reproduces every round's roll counts and starter, each legal bid in turn,
 * and every challenge's tally, loser, and elimination; the dice still in cups match the survivors' counts.
 */
export function coherentLiarsDiceGame(state: LiarsDiceGameState): boolean {
  if (!distinctPlayers(state.players)) return false;
  const seats = occupiedSeats(state.players);
  const counts = gameSeatMap((seat) => (seats.includes(seat) ? LDI_DICE_PER_PLAYER : 0));
  const eliminated: GameSeat[] = [];
  let round = 0;
  let bid: LiarsDiceStandingBid | null = null;
  let onesWild = true;
  let current: GameSeat | null = null;
  let nextStarter: GameSeat | null = null;
  for (const entry of state.log) {
    if (entry.type === 'round') {
      if (entry.round !== round + 1 || !sameJson(entry.counts, counts) || eliminated.length >= seats.length - 1
        || (round === 0 ? !seats.includes(entry.starter) : entry.starter !== nextStarter)) return false;
      round = entry.round;
      bid = null;
      onesWild = true;
      current = entry.starter;
      nextStarter = null;
    } else if (entry.type === 'bid') {
      if (current === null || entry.seat !== current || !ldiIsLegalBid(bid, entry, ldiTotalDice(counts))) return false;
      bid = { seat: entry.seat, quantity: entry.quantity, face: entry.face };
      onesWild = ldiOnesWildAfter(onesWild, entry);
      current = ldiNextAlive(entry.seat, seats, eliminated);
    } else {
      if (current === null || entry.seat !== current || !bid || bid.seat === entry.seat || entry.target !== bid.seat
        || entry.quantity !== bid.quantity || entry.face !== bid.face || entry.wild !== onesWild
        || gameSeats.some((seat) => entry.dice[seat].length !== counts[seat])) return false;
      const call = ldiResolveCall(entry.dice, bid, onesWild);
      const loser = call.bidTrue ? entry.seat : bid.seat;
      counts[loser] -= 1;
      if (call.count !== entry.count || call.bidTrue !== entry.bidTrue || entry.loser !== loser
        || entry.eliminated !== (counts[loser] === 0)) return false;
      if (entry.eliminated) eliminated.push(loser);
      nextStarter = ldiNextStarter(loser, seats, eliminated);
      current = null;
    }
  }
  if (round !== state.round || onesWild !== state.onesWild || !sameJson(eliminated, state.eliminated)
    || gameSeats.some((seat) => state.hands[seat].length !== counts[seat])) return false;
  if (state.phase === 'playing') {
    return state.result === null && current !== null && state.currentTurnSeat === current
      && sameJson(state.bid, bid) && eliminated.length < seats.length - 1;
  }
  const winner = seats.find((seat) => !eliminated.includes(seat));
  return eliminated.length === seats.length - 1 && winner !== undefined && current === null && state.bid === null
    && state.currentTurnSeat === winner && sameJson(state.result, {
      gameType: 'liarsdice', seats, winnerSeat: winner, eliminationOrder: eliminated, dice: counts, rounds: round,
    });
}
