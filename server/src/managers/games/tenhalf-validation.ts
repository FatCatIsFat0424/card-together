import {
  object, cards, number, chipCounts, gameSeatList, gameSeats, sameJson, oneOf, gameSeatCounts, gameSeatValues,
  card, flexibleSeatGame, distinctPlayers, cardId,
} from '../../runtime/validation-helpers';
import {
  BJ_MAX_BET, bjBettingSeats, bjIsValidBet, bjMatchHands, bjMatchOver, bjNextDealer, bjWinners,
} from '@shared/rules/blackjack';
import { TH_MAX_CARDS, TH_OUTCOMES, thApplyEntry, thEmptyTable, thIsMaxed, thNextTurn, thSettle } from '@shared/rules/tenhalf';
import type { ObjectValue, PlayerValidator } from '../../runtime/validation-helpers';
import type { Card, GameSeat, TenHalfGameState } from '@shared/types';
import { occupiedSeats } from '@shared/rules/seats';

/** Two rotations of eight seats */
const MAX_HANDS = 16;

/** Tenhalf result: winners hold the most chips after the match; empty seats hold none. */
export function isTenHalfResult(value: unknown): boolean {
  if (!object(value) || value.gameType !== 'tenhalf' || !chipCounts(value.chips) || !number(value.hands)
    || value.hands < 1 || value.hands > MAX_HANDS || !gameSeatList(value.seats) || value.seats.length < 2
    || !sameJson(value.seats, gameSeats.filter((seat) => (value.seats as GameSeat[]).includes(seat)))) return false;
  const chips = value.chips;
  const participants = value.seats;
  return gameSeats.every((seat) => participants.includes(seat) || chips[seat] === 0)
    && sameJson(value.winners, bjWinners(chips, participants));
}

function tenHalfLog(value: unknown): boolean {
  if (!object(value) || !number(value.timestamp)) return false;
  switch (value.type) {
    case 'bet': return oneOf(value.seat, gameSeats) && typeof value.auto === 'boolean';
    case 'deal':
      return number(value.hand) && value.hand >= 1 && value.hand <= MAX_HANDS && oneOf(value.banker, gameSeats)
        && gameSeatCounts(value.bets, BJ_MAX_BET);
    case 'hit':
      return oneOf(value.seat, gameSeats) && card(value.card) && typeof value.done === 'boolean';
    case 'stand': return oneOf(value.seat, gameSeats);
    case 'showdown':
      return number(value.hand) && value.hand >= 1 && value.hand <= MAX_HANDS
        && gameSeatValues(value.holes, (entry) => entry === null || card(entry));
    case 'settle':
      return number(value.hand) && value.hand >= 1 && value.hand <= MAX_HANDS
        && gameSeatValues(value.outcomes, (entry) => entry === null || oneOf(entry, [...TH_OUTCOMES]))
        && gameSeatValues(value.net, (entry) => typeof entry === 'number' && Number.isSafeInteger(entry))
        && chipCounts(value.chips);
    default: return false;
  }
}

export function tenHalfGame(value: ObjectValue, player: PlayerValidator): boolean {
  return flexibleSeatGame(value, player) &&
    oneOf(value.phase, ['betting', 'playing', 'scoring']) &&
    number(value.hand) && value.hand <= MAX_HANDS &&
    oneOf(value.banker, gameSeats) &&
    chipCounts(value.chips) &&
    gameSeatValues(value.pendingBets, (entry) => entry === null || (number(entry) && entry <= BJ_MAX_BET)) &&
    gameSeatCounts(value.bets, BJ_MAX_BET) &&
    chipCounts(value.stacks) &&
    number(value.betMs) && value.betMs > 0 &&
    (value.betDeadline === null || number(value.betDeadline)) &&
    cards(value.deck, 52) &&
    gameSeatList(value.dealt) &&
    gameSeatValues(value.holes, (entry) => entry === null || card(entry)) &&
    gameSeatValues(value.ups, (entry) => cards(entry, TH_MAX_CARDS - 1)) &&
    gameSeatValues(value.done, (entry) => typeof entry === 'boolean') &&
    oneOf(value.currentTurnSeat, gameSeats) &&
    Array.isArray(value.log) &&
    value.log.every(tenHalfLog) &&
    (value.result === null || isTenHalfResult(value.result));
}

/**
 * A seat's actions in one hand, checked once the showdown reveals its hole card: it only acts
 * while its hand can still draw, and each draw records whether it ended the hand.
 */
function handActionsLegal(
  actions: readonly ({ readonly type: 'stand' } | { readonly type: 'hit'; readonly card: Card; readonly done: boolean })[],
  hole: Card,
): boolean {
  const held: Card[] = [hole];
  for (const action of actions) {
    if (thIsMaxed(held)) return false;
    if (action.type === 'hit') {
      held.push(action.card);
      if (action.done !== thIsMaxed(held)) return false;
    }
  }
  return true;
}

/**
 * Replaying the public log in order reproduces every bet window, turn order, and settlement, and the
 * banker deals in clockwise turn. One deck per hand accounts for all 52 cards. Hole cards enter the
 * log only at the showdown, which is where each seat's earlier draws are checked against them.
 */
export function coherentTenHalfGame(state: TenHalfGameState): boolean {
  if (!distinctPlayers(state.players)) return false;
  const participants = occupiedSeats(state.players);
  if (!participants.includes(state.banker)) return false;
  const firstDeal = state.log.find((entry) => entry.type === 'deal');
  const firstBanker = firstDeal?.type === 'deal' ? firstDeal.banker : state.banker;
  const table = thEmptyTable(participants);
  /** The banker of the hand being bet: the first one, then clockwise after the latest. */
  const nextBanker = (): GameSeat => (table.banker ? bjNextDealer(table.banker, participants) : firstBanker);
  let betSeats: GameSeat[] = [];
  let inHand = false;
  let shown = false;
  let actions = new Map<GameSeat, ({ type: 'stand' } | { type: 'hit'; card: Card; done: boolean })[]>();
  for (const entry of state.log) {
    if (entry.type === 'bet') {
      if (inHand || betSeats.includes(entry.seat) || !bjBettingSeats(table.chips, nextBanker()).includes(entry.seat)
        || (entry.auto && state.players[entry.seat]?.isBot === true)) return false;
      betSeats.push(entry.seat);
    } else if (entry.type === 'deal') {
      const bettors = bjBettingSeats(table.chips, nextBanker());
      if (inHand || entry.hand !== table.hand + 1 || entry.banker !== nextBanker() || !participants.includes(entry.banker)
        || gameSeats.some((seat) => {
          const bet = entry.bets[seat];
          return betSeats.includes(seat) !== bettors.includes(seat) || (bet > 0) !== betSeats.includes(seat)
            || (bet > 0 && !bjIsValidBet(bet, table.chips[seat]));
        })) return false;
      inHand = true;
      shown = false;
      betSeats = [];
      actions = new Map();
    } else if (entry.type === 'hit' || entry.type === 'stand') {
      if (!inHand || shown || thNextTurn(table) !== entry.seat) return false;
      actions.set(entry.seat, [...(actions.get(entry.seat) ?? []),
        entry.type === 'stand' ? { type: 'stand' } : { type: 'hit', card: entry.card, done: entry.done }]);
    } else if (entry.type === 'showdown') {
      if (!inHand || shown || entry.hand !== table.hand || thNextTurn(table) !== null) return false;
      for (const seat of gameSeats) {
        const hole = entry.holes[seat];
        if ((hole !== null) !== table.dealt.includes(seat)) return false;
        if (hole && !handActionsLegal(actions.get(seat) ?? [], hole)) return false;
      }
      shown = true;
    } else {
      const holes: Partial<Record<GameSeat, Card>> = {};
      for (const seat of table.dealt) {
        const hole = table.holes[seat];
        if (hole) holes[seat] = hole;
      }
      if (!shown || entry.hand !== table.hand
        || !sameJson({ outcomes: entry.outcomes, net: entry.net, chips: entry.chips }, thSettle(table, holes))) {
        return false;
      }
      inHand = false;
    }
    thApplyEntry(table, entry);
  }
  if (table.hand !== state.hand || !sameJson(table.chips, state.chips) || !sameJson(table.bets, state.bets)
    || !sameJson(table.stacks, state.stacks) || !sameJson(table.dealt, state.dealt)
    || !sameJson(table.ups, state.ups) || !sameJson(table.done, state.done)) return false;
  // Between hands the revealed hole cards stay on the table; during play they are only on the server,
  // where the actions so far can already be checked against them.
  if (inHand ? gameSeats.some((seat) => {
    const hole = state.holes[seat];
    return (hole !== null) !== table.dealt.includes(seat) || (hole !== null && !handActionsLegal(actions.get(seat) ?? [], hole));
  }) : !sameJson(table.holes, state.holes)) return false;
  const held = [...state.deck, ...gameSeats.flatMap((seat) => [...(state.holes[seat] ? [state.holes[seat]] : []),
    ...state.ups[seat]])];
  const counts = new Map<string, number>();
  for (const heldCard of held) counts.set(cardId(heldCard), (counts.get(cardId(heldCard)) ?? 0) + 1);
  if (held.length !== (state.hand > 0 ? 52 : 0) || [...counts.values()].some((count) => count !== 1)) return false;
  const over = bjMatchOver(state.hand, state.chips, participants, true);

  if (state.phase === 'betting') {
    return !inHand && state.result === null && !over && state.banker === nextBanker()
      && gameSeats.every((seat) => (state.pendingBets[seat] !== null) === betSeats.includes(seat)
        && (state.pendingBets[seat] === null || bjIsValidBet(state.pendingBets[seat], state.chips[seat])))
      && bjBettingSeats(state.chips, state.banker).some((seat) => state.pendingBets[seat] === null);
  }
  if (betSeats.length > 0 || gameSeats.some((seat) => state.pendingBets[seat] !== null) || state.betDeadline !== null
    || state.banker !== table.banker) return false;
  if (state.phase === 'playing') return inHand && !shown && state.result === null
    && thNextTurn(table) === state.currentTurnSeat;
  return !inHand && state.log.at(-1)?.type === 'settle' && over && state.result !== null
    && sameJson(state.result, { gameType: 'tenhalf', seats: participants, chips: state.chips, hands: state.hand,
      winners: bjWinners(state.chips, participants) })
    && state.hand <= bjMatchHands(participants.length, true);
}
