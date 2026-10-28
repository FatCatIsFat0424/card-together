import { object, number, oneOf, seats, seatCounts, commonGame, sameJson } from '../../runtime/validation-helpers';
import {
  LD_DECK, LD_CHAMBERS, LD_TABLE_FACES, LD_MAX_PLAY, LD_HAND_SIZE, ldMustChallenge, ldNextHolder,
  ldCanChallenge, ldIsLie, ldNextAlive,
} from '@shared/rules/liarsdeck';
import type { Seat, LiarsDeckGameState, LiarsDeckLastPlay } from '@shared/types';
import type { ObjectValue, PlayerValidator } from '../../runtime/validation-helpers';
import { isDeepStrictEqual } from 'node:util';

function liarCard(value: unknown): boolean {
  return object(value) && Object.keys(value).length === 2 && number(value.id) && value.id < LD_DECK.length
    && value.face === LD_DECK[value.id].face;
}

function liarCards(value: unknown, max: number): boolean {
  return Array.isArray(value) && value.length <= max && value.every(liarCard);
}

/** Liar's Deck result: three distinct eliminations, the winner is the fourth, and only losers fired a bullet. */
export function isLiarsDeckResult(value: unknown): boolean {
  if (!object(value) || value.gameType !== 'liarsdeck' || !oneOf(value.winnerSeat, seats)
    || !Array.isArray(value.eliminationOrder) || !seatCounts(value.shots, LD_CHAMBERS)
    || !number(value.rounds)) return false;
  const order: unknown[] = value.eliminationOrder;
  const shots = value.shots;
  const pulls = seats.reduce((sum, seat) => sum + shots[seat], 0);
  return order.length === 3 && order.every((seat) => oneOf(seat, seats))
    && new Set([...order, value.winnerSeat]).size === 4
    && order.every((seat) => shots[seat as Seat] >= 1) && shots[value.winnerSeat as Seat] < LD_CHAMBERS
    && value.rounds === pulls;
}

function liarsDeckLog(value: unknown): boolean {
  if (!object(value) || !number(value.timestamp)) return false;
  if (value.type === 'round') {
    return number(value.round) && value.round >= 1 && oneOf(value.tableFace, [...LD_TABLE_FACES])
      && oneOf(value.starter, seats);
  }
  if (!oneOf(value.seat, seats)) return false;
  if (value.type === 'play') return number(value.count) && value.count >= 1 && value.count <= LD_MAX_PLAY;
  if (value.type === 'challenge') {
    return oneOf(value.target, seats) && value.target !== value.seat && Array.isArray(value.revealed)
      && value.revealed.length >= 1 && value.revealed.length <= LD_MAX_PLAY
      && value.revealed.every((face: unknown) => oneOf(face, ['K', 'Q', 'A', 'joker']))
      && typeof value.lied === 'boolean';
  }
  return value.type === 'shot' && number(value.shot) && value.shot >= 1 && value.shot <= LD_CHAMBERS
    && typeof value.survived === 'boolean';
}

function liarsDeckLastPlay(value: unknown): boolean {
  return value === null || (object(value) && Object.keys(value).length === 2 && oneOf(value.seat, seats)
    && number(value.count) && value.count >= 1 && value.count <= LD_MAX_PLAY);
}

export function liarsDeckGame(value: ObjectValue, player: PlayerValidator): boolean {
  const eliminated = value.eliminated;
  return commonGame(value, player) &&
    oneOf(value.phase, ['playing', 'scoring']) &&
    object(value.hands) && Object.keys(value.hands).length === 4 &&
    seats.every((seat) => liarCards((value.hands as ObjectValue)[seat], LD_HAND_SIZE)) &&
    liarCards(value.pile, LD_DECK.length) &&
    liarsDeckLastPlay(value.lastPlay) &&
    oneOf(value.tableFace, [...LD_TABLE_FACES]) &&
    number(value.round) && value.round >= 1 &&
    oneOf(value.currentTurnSeat, seats) &&
    seatCounts(value.bullets, LD_CHAMBERS) && seats.every((seat) => (value.bullets as ObjectValue)[seat] !== 0) &&
    seatCounts(value.shots, LD_CHAMBERS) &&
    Array.isArray(eliminated) && eliminated.length <= 3 &&
    eliminated.every((seat: unknown) => oneOf(seat, seats)) && new Set(eliminated).size === eliminated.length &&
    Array.isArray(value.log) &&
    value.log.every(liarsDeckLog) &&
    (value.result === null || isLiarsDeckResult(value.result));
}

/**
 * Replaying the public log in turn order reproduces every round, call, and trigger pull; dealt cards
 * still in hands or the pile are distinct and number five per seat alive when the round began.
 */
export function coherentLiarsDeckGame(state: LiarsDeckGameState): boolean {
  if (new Set(seats.map((seat) => state.players[seat].id)).size !== 4) return false;
  const shots = { N: 0, E: 0, S: 0, W: 0 };
  const counts = { N: 0, E: 0, S: 0, W: 0 };
  const eliminated: Seat[] = [];
  let round = 0;
  let dealtSeats = 0;
  let tableFace = state.tableFace;
  let pileCount = 0;
  let lastPlay: LiarsDeckLastPlay | null = null;
  let current: Seat | null = null;
  let shooter: Seat | null = null;
  let nextStarter: Seat | null = null;
  for (const entry of state.log) {
    if (shooter && entry.type !== 'shot') return false;
    if (entry.type === 'round') {
      if (entry.round !== round + 1 || (round > 0 && entry.starter !== nextStarter)
        || eliminated.includes(entry.starter) || eliminated.length >= 3) return false;
      round = entry.round;
      tableFace = entry.tableFace;
      dealtSeats = 4 - eliminated.length;
      for (const seat of seats) counts[seat] = eliminated.includes(seat) ? 0 : LD_HAND_SIZE;
      pileCount = 0;
      lastPlay = null;
      current = entry.starter;
      nextStarter = null;
    } else if (entry.type === 'play') {
      if (entry.seat !== current || counts[entry.seat] < entry.count
        || ldMustChallenge(entry.seat, counts, lastPlay)) return false;
      counts[entry.seat] -= entry.count;
      pileCount += entry.count;
      lastPlay = { seat: entry.seat, count: entry.count };
      current = ldNextHolder(entry.seat, counts);
    } else if (entry.type === 'challenge') {
      if (entry.seat !== current || !lastPlay || !ldCanChallenge(entry.seat, lastPlay)
        || entry.target !== lastPlay.seat || entry.revealed.length !== lastPlay.count
        || entry.lied !== ldIsLie(entry.revealed, tableFace)) return false;
      shooter = entry.lied ? entry.target : entry.seat;
      current = null;
    } else {
      if (entry.seat !== shooter || entry.shot !== shots[entry.seat] + 1
        || entry.survived !== (entry.shot !== state.bullets[entry.seat])) return false;
      shots[entry.seat] = entry.shot;
      if (!entry.survived) eliminated.push(entry.seat);
      nextStarter = entry.survived ? entry.seat : ldNextAlive(entry.seat, eliminated);
      shooter = null;
    }
  }
  const held = [...seats.flatMap((seat) => state.hands[seat]), ...state.pile];
  if (round !== state.round || tableFace !== state.tableFace || shooter !== null
    || !isDeepStrictEqual(shots, state.shots) || !isDeepStrictEqual(eliminated, state.eliminated)
    || seats.some((seat) => state.shots[seat] > state.bullets[seat]
      || (state.shots[seat] === state.bullets[seat]) !== eliminated.includes(seat))
    || new Set(held.map((entry) => entry.id)).size !== held.length
    || held.length !== dealtSeats * LD_HAND_SIZE) return false;
  if (state.phase === 'playing') {
    return state.result === null && eliminated.length < 3 && nextStarter === null && current !== null
      && state.currentTurnSeat === current && state.pile.length === pileCount
      && sameJson(state.lastPlay, lastPlay) && seats.every((seat) => state.hands[seat].length === counts[seat]);
  }
  const winner = seats.find((seat) => !eliminated.includes(seat));
  return eliminated.length === 3 && state.currentTurnSeat === winner && sameJson(state.result,
    { gameType: 'liarsdeck', winnerSeat: winner, eliminationOrder: eliminated, shots, rounds: round });
}
