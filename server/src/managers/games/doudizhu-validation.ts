import {
  object, number, text, gameSeatList, gameSeats, sameJson, oneOf, gameSeatValues, gameSeatCounts, flexibleSeatGame,
  distinctPlayers,
} from '../../runtime/validation-helpers';
import type { ObjectValue, PlayerValidator } from '../../runtime/validation-helpers';
import type { CardOrJoker, DouDizhuGameState, GameSeat } from '@shared/types';
import { isDouDizhuOptions } from '@shared/doudizhu-options';
import { cardKey, isCardOrJoker } from '@shared/rules/cards';
import {
  DDZ_BOTTOM_SIZE, DDZ_DEALS, DDZ_HAND_SIZE, DDZ_MAX_REDEALS, ddzAuction, ddzBeats, ddzCombos, ddzSettle, ddzWinners,
} from '@shared/rules/doudizhu';
import type { DdzCombo } from '@shared/rules/doudizhu';
import { ddzReplay } from '@shared/rules/doudizhu-table';
import { occupiedSeats } from '@shared/rules/seats';
import { firstCallerOf } from './doudizhu-game';

const COMBO_TYPES = [
  'single', 'pair', 'triple', 'tripleSingle', 'triplePair', 'straight', 'pairStraight', 'airplane', 'airplaneSingle',
  'airplanePair', 'fourSingles', 'fourPairs', 'bomb', 'rocket',
];
const MAX_HAND = DDZ_HAND_SIZE + DDZ_BOTTOM_SIZE;
/** A deal holds 54 cards, so no more bombs than there are fours and the rocket. */
const MAX_BOMBS = 14;

const signed = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);

function cardList(value: unknown, max: number): value is CardOrJoker[] {
  return Array.isArray(value) && value.length <= max && value.every(isCardOrJoker)
    && new Set(value.map(cardKey)).size === value.length;
}

function combo(value: unknown): value is DdzCombo {
  return object(value) && Object.keys(value).length === 4 && oneOf(value.type, COMBO_TYPES)
    && number(value.power) && value.power >= 3 && value.power <= 17 && number(value.length) && value.length >= 1
    && number(value.size) && value.size >= 1 && value.size <= MAX_HAND;
}

/** Dou Dizhu result: six deals of a zero-sum score, won by the highest total, ties included. */
export function isDouDizhuResult(value: unknown): boolean {
  if (!object(value) || value.gameType !== 'doudizhu' || value.deals !== DDZ_DEALS || !gameSeatList(value.seats)
    || value.seats.length !== 3 || !sameJson(value.seats, gameSeats.filter((seat) => (value.seats as GameSeat[]).includes(seat)))
    || !gameSeatValues(value.scores, signed)) return false;
  const participants = value.seats;
  const scores = value.scores as Record<GameSeat, number>;
  return gameSeats.every((seat) => participants.includes(seat) || scores[seat] === 0)
    && participants.reduce((sum, seat) => sum + scores[seat], 0) === 0
    && sameJson(value.winners, ddzWinners(participants, scores));
}

function bidEntry(value: unknown): boolean {
  return object(value) && oneOf(value.seat, gameSeats) && (value.kind === 'score'
    ? Object.keys(value).length === 3 && [0, 1, 2, 3].includes(value.score as number)
    : value.kind === 'claim' && Object.keys(value).length === 3 && typeof value.take === 'boolean');
}

function playValue(value: unknown): boolean {
  return object(value) && oneOf(value.seat, gameSeats) && cardList(value.cards, MAX_HAND) && value.cards.length > 0
    && combo(value.combo) && value.combo.size === value.cards.length;
}

function douDizhuLog(value: unknown): boolean {
  if (!object(value) || !number(value.timestamp)) return false;
  switch (value.type) {
    case 'deal':
      return number(value.deal) && value.deal >= 1 && value.deal <= DDZ_DEALS && number(value.redeal)
        && value.redeal <= DDZ_MAX_REDEALS && oneOf(value.firstCaller, gameSeats);
    case 'bid': return oneOf(value.seat, gameSeats) && [0, 1, 2, 3].includes(value.score as number);
    case 'claim': return oneOf(value.seat, gameSeats) && typeof value.take === 'boolean';
    case 'redeal': return true;
    case 'landlord':
      return oneOf(value.seat, gameSeats) && number(value.base) && value.base <= 3 && number(value.grabs) && value.grabs <= 3
        && typeof value.forced === 'boolean' && cardList(value.bottom, DDZ_BOTTOM_SIZE) && value.bottom.length === DDZ_BOTTOM_SIZE;
    case 'play': return playValue(value);
    case 'pass': return oneOf(value.seat, gameSeats);
    case 'round_end': return oneOf(value.leaderSeat, gameSeats);
    case 'deal_end':
      return number(value.deal) && value.deal >= 1 && value.deal <= DDZ_DEALS && oneOf(value.landlord, gameSeats)
        && oneOf(value.winner, gameSeats) && typeof value.landlordWins === 'boolean' && number(value.base) && value.base <= 3
        && number(value.bombs) && value.bombs <= MAX_BOMBS && number(value.grabs) && value.grabs <= 3
        && typeof value.spring === 'boolean' && typeof value.antiSpring === 'boolean' && number(value.multiplier)
        && gameSeatValues(value.scores, signed) && gameSeatValues(value.totals, signed)
        && gameSeatValues(value.hands, (hand) => cardList(hand, MAX_HAND));
    default: return false;
  }
}

export function douDizhuGame(value: ObjectValue, player: PlayerValidator): boolean {
  return flexibleSeatGame(value, player) && Object.keys(value.players as ObjectValue).length === 3 &&
    isDouDizhuOptions(value.options) &&
    oneOf(value.phase, ['calling', 'playing', 'scoring']) &&
    number(value.deal) && value.deal >= 1 && value.deal <= DDZ_DEALS &&
    number(value.redeals) && value.redeals <= DDZ_MAX_REDEALS &&
    oneOf(value.firstCaller, gameSeats) &&
    gameSeatValues(value.hands, (hand) => cardList(hand, MAX_HAND)) &&
    cardList(value.bottom, DDZ_BOTTOM_SIZE) && value.bottom.length === DDZ_BOTTOM_SIZE &&
    Array.isArray(value.bids) && value.bids.length <= 6 && value.bids.every(bidEntry) &&
    (value.landlord === null || oneOf(value.landlord, gameSeats)) &&
    number(value.base) && value.base <= 3 && number(value.grabs) && value.grabs <= 3 &&
    number(value.bombs) && value.bombs <= MAX_BOMBS &&
    (value.lastPlay === null || playValue(value.lastPlay)) &&
    number(value.passes) && value.passes <= 2 &&
    gameSeatCounts(value.plays, MAX_HAND * 2) &&
    oneOf(value.currentTurnSeat, gameSeats) &&
    gameSeatValues(value.totals, signed) &&
    Array.isArray(value.log) && value.log.every(douDizhuLog) &&
    (value.result === null || isDouDizhuResult(value.result));
}

const sameCombo = (a: DdzCombo, b: DdzCombo): boolean => a.type === b.type && a.power === b.power
  && a.length === b.length && a.size === b.size;

/**
 * Replaying the public log reproduces every auction, turn, and settlement, and the cards still in hand
 * plus the cards played in the deal account for the full 54-card deck.
 */
export function coherentDouDizhuGame(state: DouDizhuGameState): boolean {
  if (!distinctPlayers(state.players)) return false;
  const seats = occupiedSeats(state.players);
  if (seats.length !== 3) return false;
  const variant = state.options.variant;
  let previousDealEnd = false;
  for (let index = 0; index < state.log.length; index++) {
    const entry = state.log[index];
    const table = ddzReplay(variant, seats, state.log, index);
    const inPlay = table.phase === 'playing';
    if (entry.type !== 'deal_end' && inPlay && seats.some((seat) => table.counts[seat] === 0)) return false;
    switch (entry.type) {
      case 'deal': {
        const expectedDeal = table.phase === 'idle' && table.deal > 0 && !previousDealEnd ? table.deal : table.deal + 1;
        const expectedRedeal = table.phase === 'idle' && !previousDealEnd && table.deal > 0 ? table.redeals + 1 : 0;
        if (index > 0 && table.phase !== 'idle' && table.phase !== 'ended') return false;
        if (entry.deal !== (index === 0 ? 1 : expectedDeal) || entry.redeal !== (index === 0 ? 0 : expectedRedeal)
          || entry.deal > DDZ_DEALS || entry.firstCaller !== firstCallerOf(seats, entry.deal, entry.redeal)) return false;
        break;
      }
      case 'bid':
      case 'claim': {
        const auction = table.auction;
        if (table.phase !== 'calling' || !auction || auction.done || auction.turn !== entry.seat) return false;
        if (entry.type === 'bid' && (variant !== 'score' || (entry.score !== 0 && entry.score < auction.minScore))) return false;
        if (entry.type === 'claim' && variant !== 'grab') return false;
        break;
      }
      case 'redeal': {
        const auction = table.firstCaller ? ddzAuction(variant, seats, table.firstCaller, table.bids) : null;
        if (table.phase !== 'calling' || !auction?.done || auction.landlord !== null || table.redeals >= DDZ_MAX_REDEALS) return false;
        break;
      }
      case 'landlord': {
        const auction = table.firstCaller ? ddzAuction(variant, seats, table.firstCaller, table.bids) : null;
        if (table.phase !== 'calling' || !auction?.done) return false;
        const forced = auction.landlord === null;
        if (forced ? !entry.forced || table.redeals !== DDZ_MAX_REDEALS || entry.seat !== table.firstCaller
          || entry.base !== 1 || entry.grabs !== 0
          : entry.forced || entry.seat !== auction.landlord || entry.base !== auction.base || entry.grabs !== auction.grabs) return false;
        break;
      }
      case 'play': {
        const previous = table.lastPlay?.combo ?? null;
        if (!inPlay || table.turn !== entry.seat || entry.cards.length > table.counts[entry.seat]
          || !ddzCombos(entry.cards).some((candidate) => sameCombo(candidate, entry.combo))
          || (previous !== null && !ddzBeats(entry.combo, previous))) return false;
        break;
      }
      case 'pass':
        if (!inPlay || table.turn !== entry.seat || table.lastPlay === null) return false;
        break;
      case 'round_end':
        if (!inPlay || table.lastPlay === null || table.passes !== seats.length - 1
          || entry.leaderSeat !== table.lastPlay.seat) return false;
        break;
      case 'deal_end': {
        if (!inPlay || !table.landlord || !table.lastPlay || table.lastPlay.seat !== entry.winner
          || table.counts[entry.winner] !== 0) return false;
        const outcome = ddzSettle({ seats, landlord: table.landlord, winner: entry.winner, base: table.base,
          doublings: table.grabs + table.bombs, plays: table.plays });
        if (entry.deal !== table.deal || entry.landlord !== table.landlord || entry.base !== table.base
          || entry.grabs !== table.grabs || entry.bombs !== table.bombs || entry.landlordWins !== outcome.landlordWins
          || entry.spring !== outcome.spring || entry.antiSpring !== outcome.antiSpring
          || entry.multiplier !== outcome.multiplier
          || !gameSeats.every((seat) => entry.scores[seat] === (seats.includes(seat) ? outcome.scores[seat] : 0)
            && entry.totals[seat] === table.totals[seat] + entry.scores[seat]
            && entry.hands[seat].length === table.counts[seat])) return false;
        break;
      }
    }
    previousDealEnd = entry.type === 'deal_end';
  }

  const table = ddzReplay(variant, seats, state.log);
  const expectedPhase = state.phase === 'scoring' ? 'ended' : state.phase;
  if (table.phase !== expectedPhase || table.deal !== state.deal || table.redeals !== state.redeals
    || table.firstCaller !== state.firstCaller || !sameJson(table.bids, state.bids) || table.landlord !== state.landlord
    || table.base !== state.base || table.grabs !== state.grabs || table.bombs !== state.bombs || table.passes !== state.passes
    || !sameJson(table.lastPlay, state.lastPlay) || !sameJson(table.plays, state.plays)
    || !sameJson(table.totals, state.totals)
    || (state.phase !== 'scoring' && table.turn !== state.currentTurnSeat)
    || !gameSeats.every((seat) => state.hands[seat].length === table.counts[seat])) return false;

  // Cards: the hands plus the cards played in this deal make up the whole deck.
  let dealStart = state.log.length - 1;
  while (dealStart >= 0 && state.log[dealStart].type !== 'deal') dealStart -= 1;
  if (dealStart < 0) return false;
  const played = state.log.slice(dealStart).flatMap((entry) => (entry.type === 'play' ? entry.cards : []));
  const held = gameSeats.flatMap((seat) => state.hands[seat]);
  const everything = state.phase === 'calling' ? [...held, ...state.bottom] : [...held, ...played];
  if (everything.length !== 54 || new Set(everything.map(cardKey)).size !== 54) return false;
  if (state.phase === 'calling' && !seats.every((seat) => state.hands[seat].length === DDZ_HAND_SIZE)) return false;
  const landlordEntry = state.log.slice(dealStart).find((entry) => entry.type === 'landlord');
  if (state.phase !== 'calling') {
    if (landlordEntry?.type !== 'landlord' || !sameJson(landlordEntry.bottom.map(cardKey).sort(), state.bottom.map(cardKey).sort())) {
      return false;
    }
  } else if (landlordEntry) return false;
  if (state.phase === 'scoring') {
    const last = state.log.at(-1);
    return state.deal === DDZ_DEALS && last?.type === 'deal_end' && state.result !== null
      && sameJson(state.result, { gameType: 'doudizhu', seats, scores: state.totals, deals: DDZ_DEALS,
        winners: ddzWinners(seats, state.totals) });
  }
  return state.result === null && text(state.id);
}
