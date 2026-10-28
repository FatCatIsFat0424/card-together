import {
  object, cards, number, chipCounts, resultSeats, gameSeats, sameJson, oneOf, gameSeatCounts, gameSeatValues,
  card, flexibleSeatGame, distinctPlayers, cardId, flexibleResult,
} from '../../runtime/validation-helpers';
import {
  BJ_MIN_BET, BJ_MAX_BET, bjWinners, BJ_MAX_SEAT_HANDS, BJ_OUTCOMES, bjEmptyTable, bjNextDealer,
  bjBettingSeats, bjIsValidBet, bjDealerPeeks, bjIsNatural, bjNextTurn, bjDealerDone, bjDealerActions,
  bjSettle, bjLegalActions, bjApplyEntry, bjMatchOver,
} from '@shared/rules/blackjack';
import { normalizeGameSeatMaps } from '@shared/game-seat-compat';
import type { ObjectValue, PlayerValidator } from '../../runtime/validation-helpers';
import { isBlackjackOptions } from '@shared/blackjack-options';
import type { BlackjackGameState, GameSeat } from '@shared/types';
import { occupiedSeats } from '@shared/rules/seats';

/** Two decks allow eight aces and six twos (hard 20), followed by one final draw. */
const BJ_MAX_HAND_CARDS = 15;

function blackjackHand(value: unknown): boolean {
  return object(value) && Object.keys(value).length === 5 && Array.isArray(value.cards)
    && value.cards.length >= 2 && cards(value.cards, BJ_MAX_HAND_CARDS) && number(value.bet)
    && value.bet >= BJ_MIN_BET && value.bet <= BJ_MAX_BET * 2 && typeof value.doubled === 'boolean'
    && typeof value.split === 'boolean' && typeof value.done === 'boolean';
}

/** Blackjack result: winners hold the most chips after one to eight hands; empty gameSeats hold none. */
export function isBlackjackResult(value: unknown): boolean {
  value = normalizeGameSeatMaps(value);
  if (!object(value) || value.gameType !== 'blackjack' || !chipCounts(value.chips) || !number(value.hands)
    || value.hands < 1 || value.hands > 16) return false;
  const chips = value.chips;
  const participants = resultSeats(value);
  return participants !== null && gameSeats.every((seat) => participants.includes(seat) || chips[seat] === 0)
    && sameJson(value.winners, bjWinners(chips, participants));
}

function blackjackLog(value: unknown): boolean {
  if (!object(value) || !number(value.timestamp)) return false;
  switch (value.type) {
    case 'bet': return oneOf(value.seat, gameSeats) && typeof value.auto === 'boolean';
    case 'deal':
      return number(value.hand) && value.hand >= 1 && value.hand <= 16
        && gameSeatCounts(value.bets, BJ_MAX_BET) && gameSeatValues(value.cards, (entry) => cards(entry, 2))
        && card(value.upCard) && (value.dealer === undefined || oneOf(value.dealer, gameSeats));
    case 'hit':
    case 'double':
      return oneOf(value.seat, gameSeats) && number(value.handIndex) && card(value.card);
    case 'stand': return oneOf(value.seat, gameSeats) && number(value.handIndex);
    case 'split':
      return oneOf(value.seat, gameSeats) && number(value.handIndex) && Array.isArray(value.cards)
        && value.cards.length === 2 && cards(value.cards, 2);
    case 'reveal':
    case 'dealerHit':
      return card(value.card);
    case 'dealerStand': return true;
    case 'settle':
      return number(value.hand) && value.hand >= 1 && value.hand <= 16
        && gameSeatValues(value.outcomes, (entry) => Array.isArray(entry) && entry.length <= BJ_MAX_SEAT_HANDS
          && entry.every((outcome: unknown) => oneOf(outcome, [...BJ_OUTCOMES])))
        && gameSeatValues(value.net, (entry) => typeof entry === 'number' && Number.isSafeInteger(entry))
        && chipCounts(value.chips);
    default: return false;
  }
}

export function blackjackGame(value: ObjectValue, player: PlayerValidator): boolean {
  return flexibleSeatGame(value, player) &&
    (value.options === undefined || isBlackjackOptions(value.options)) &&
    (value.dealerSeat === undefined || oneOf(value.dealerSeat, gameSeats)) &&
    (value.dealerStood === undefined || typeof value.dealerStood === 'boolean') &&
    oneOf(value.phase, ['betting', 'playing', 'scoring']) &&
    number(value.hand) && value.hand <= 16 &&
    chipCounts(value.chips) &&
    gameSeatValues(value.bets, (entry) => entry === null || (number(entry) && entry <= BJ_MAX_BET)) &&
    number(value.betMs) && value.betMs > 0 &&
    (value.betDeadline === null || number(value.betDeadline)) &&
    cards(value.deck, 104) &&
    gameSeatValues(value.hands, (entry) => Array.isArray(entry) && entry.length <= BJ_MAX_SEAT_HANDS
      && entry.every(blackjackHand)) &&
    cards(value.dealer, BJ_MAX_HAND_CARDS) &&
    (value.hole === null || card(value.hole)) &&
    oneOf(value.currentTurnSeat, gameSeats) &&
    number(value.activeHand) && value.activeHand < BJ_MAX_SEAT_HANDS &&
    Array.isArray(value.log) &&
    value.log.every(blackjackLog) &&
    (value.result === null || isBlackjackResult(value.result));
}

/**
 * Replaying the public log in order reproduces every bet window, legal action, dealer draw, and
 * settlement; one deck per hand accounts for all 52 cards and the current phase matches the replay.
 * A player dealer deals in clockwise turn from its first hand, never bets, and plays its own hand.
 */
export function coherentBlackjackGame(state: BlackjackGameState): boolean {
  if (!distinctPlayers(state.players)) return false;
  const participants = occupiedSeats(state.players);
  const playerDealer = state.options?.playerDealer === true;
  if (playerDealer !== (state.dealerSeat !== undefined) || (!playerDealer && state.dealerStood !== undefined)
    || (state.dealerSeat !== undefined && !participants.includes(state.dealerSeat))) return false;
  const firstDeal = state.log.find((entry) => entry.type === 'deal');
  const firstDealer = firstDeal?.type === 'deal' ? firstDeal.dealer : state.dealerSeat;
  const table = bjEmptyTable(participants);
  /** The seat dealing the hand being bet: the first dealer, then clockwise after the latest one. */
  const nextDealer = (): GameSeat | undefined => !playerDealer ? undefined
    : table.dealerSeat ? bjNextDealer(table.dealerSeat, participants) : firstDealer;
  let betSeats: GameSeat[] = [];
  let inHand = false;
  let revealed = false;
  let acted = false;
  for (const entry of state.log) {
    if (entry.type === 'bet') {
      if (inHand || betSeats.includes(entry.seat) || !bjBettingSeats(table.chips, nextDealer()).includes(entry.seat)
        || (entry.auto && state.players[entry.seat]?.isBot === true)) return false;
      betSeats.push(entry.seat);
    } else if (entry.type === 'deal') {
      const bettors = bjBettingSeats(table.chips, nextDealer());
      if (inHand || entry.hand !== table.hand + 1 || entry.dealer !== nextDealer() || gameSeats.some((seat) => {
        const bet = entry.bets[seat];
        return betSeats.includes(seat) !== bettors.includes(seat) || (bet > 0) !== betSeats.includes(seat)
          || (bet > 0 && !bjIsValidBet(bet, table.chips[seat])) || entry.cards[seat].length !== (bet > 0 ? 2 : 0);
      })) return false;
      inHand = true;
      acted = false;
      betSeats = [];
    } else if (entry.type === 'reveal') {
      const peeked = !acted && bjDealerPeeks(table.dealer[0])
        && bjIsNatural({ cards: [table.dealer[0], entry.card], split: false });
      if (!inHand || revealed || (bjNextTurn(table.hands) !== null && !peeked)) return false;
      revealed = true;
    } else if (entry.type === 'dealerHit') {
      if (!revealed || bjDealerDone(table)) return false;
    } else if (entry.type === 'dealerStand') {
      if (!revealed || !playerDealer || bjDealerDone(table) || !bjDealerActions(table.dealer).includes('stand')) {
        return false;
      }
    } else if (entry.type === 'settle') {
      const { outcomes, net, chips } = bjSettle(table);
      if (!revealed || entry.hand !== table.hand || !bjDealerDone(table)
        || !sameJson({ outcomes: entry.outcomes, net: entry.net, chips: entry.chips }, { outcomes, net, chips })) {
        return false;
      }
      inHand = false;
      revealed = false;
    } else {
      const turn = bjNextTurn(table.hands);
      if (!inHand || revealed || turn?.seat !== entry.seat || turn.handIndex !== entry.handIndex
        || !bjLegalActions(table.hands[entry.seat], entry.handIndex, table.chips[entry.seat]).includes(entry.type)) {
        return false;
      }
      acted = true;
    }
    bjApplyEntry(table, entry);
  }
  if (table.hand !== state.hand || !sameJson(table.chips, state.chips) || !sameJson(table.hands, state.hands)
    || !sameJson(table.dealer, state.dealer) || table.dealerStood !== state.dealerStood
    || (state.hole !== null) !== (inHand && !revealed)) return false;
  const held = [...state.deck, ...gameSeats.flatMap((seat) => state.hands[seat].flatMap((hand) => hand.cards)),
    ...state.dealer, ...(state.hole ? [state.hole] : [])];
  const copies = participants.length > 4 ? 2 : 1;
  const counts = new Map<string, number>();
  for (const card of held) counts.set(cardId(card), (counts.get(cardId(card)) ?? 0) + 1);
  if (held.length !== (state.hand > 0 ? 52 * copies : 0)
    || [...counts.values()].some((count) => count !== copies)) return false;
  const over = bjMatchOver(state.hand, state.chips, participants, playerDealer);

  if (state.phase === 'betting') {
    return !inHand && state.result === null && !over && state.dealerSeat === nextDealer()
      && gameSeats.every((seat) => (state.bets[seat] !== null) === betSeats.includes(seat)
        && (state.bets[seat] === null || bjIsValidBet(state.bets[seat], state.chips[seat])))
      && bjBettingSeats(state.chips, state.dealerSeat).some((seat) => state.bets[seat] === null);
  }
  if (betSeats.length > 0 || gameSeats.some((seat) => state.bets[seat] !== null) || state.betDeadline !== null
    || state.dealerSeat !== table.dealerSeat) return false;
  if (state.phase === 'playing') {
    if (!inHand || state.result !== null) return false;
    // A player dealer's own turn follows the reveal once every player hand is finished.
    if (revealed) return playerDealer && !bjDealerDone(table) && state.currentTurnSeat === state.dealerSeat;
    const turn = bjNextTurn(state.hands);
    return turn !== null && turn.seat === state.currentTurnSeat && turn.handIndex === state.activeHand;
  }
  return !inHand && state.log.at(-1)?.type === 'settle' && over
    && sameJson(state.result, flexibleResult(state.result, participants, { gameType: 'blackjack', chips: state.chips,
      hands: state.hand, winners: bjWinners(state.chips, participants) }));
}
