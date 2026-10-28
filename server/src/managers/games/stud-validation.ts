import { heEliminations, heInHand, heLegalActions, heMatchOver, heNextButton, heNextToAct, heWinners } from '@shared/rules/holdem';
import {
  STUD_FINAL_STREET, STUD_HANDS, STUD_STARTING_CHIPS, studApplyEntry, studAward, studEmptyTable, studFirstToAct, studStakes,
} from '@shared/rules/stud';
import {
  object, gameSeatCounts, number, gameSeatList, resultSeats, gameSeats, sameJson, oneOf, cards,
  gameSeatValues, flexibleSeatGame, distinctPlayers, cardId, flexibleResult,
} from '../../runtime/validation-helpers';
import type { ObjectValue, PlayerValidator } from '../../runtime/validation-helpers';
import type { StudGameState, GameSeat } from '@shared/types';
import { occupiedSeats, gameSeatMap } from '@shared/rules/seats';

/** Chips never enter or leave a stud match. */
const STUD_TOTAL_CHIPS = STUD_STARTING_CHIPS * 8;
/** Face-up cards a seat holds at most: one on each of the four streets. */
const MAX_UP_CARDS = STUD_FINAL_STREET - 1;

/** Stud result: chips are conserved, winners hold the most, and the match had ended. */
export function isStudResult(value: unknown): boolean {
  if (!object(value) || value.gameType !== 'stud' || !gameSeatCounts(value.chips, STUD_TOTAL_CHIPS) || !number(value.hands)
    || value.hands < 1 || value.hands > STUD_HANDS || !gameSeatList(value.eliminationOrder)) return false;
  const chips = value.chips;
  const participants = resultSeats(value);
  if (!participants) return false;
  const holders = gameSeats.filter((seat) => chips[seat] > 0);
  return gameSeats.reduce((sum, seat) => sum + chips[seat], 0) === STUD_STARTING_CHIPS * participants.length
    && holders.every((seat) => participants.includes(seat))
    && (value.hands === STUD_HANDS || holders.length === 1)
    && value.eliminationOrder.every((seat) => participants.includes(seat) && chips[seat] === 0)
    && value.eliminationOrder.length === participants.length - holders.length
    && sameJson(value.winners, heWinners(chips));
}

function studLog(value: unknown): boolean {
  if (!object(value) || !number(value.timestamp)) return false;
  switch (value.type) {
    case 'hand':
      return number(value.hand) && value.hand >= 1 && value.hand <= STUD_HANDS && oneOf(value.button, gameSeats)
        && number(value.ante) && number(value.minBet) && gameSeatCounts(value.antes, STUD_TOTAL_CHIPS);
    case 'action':
      return oneOf(value.seat, gameSeats) && oneOf(value.action, ['fold', 'check', 'call', 'bet', 'raise'])
        && number(value.to) && value.to <= STUD_TOTAL_CHIPS && typeof value.allIn === 'boolean';
    case 'street':
      return oneOf(String(value.street), ['2', '3', '4', '5']) && gameSeatValues(value.cards, (entry) => cards(entry, 1));
    case 'showdown':
      return gameSeatValues(value.cards, (entry) => cards(entry, 1));
    case 'award':
      return Array.isArray(value.pots) && value.pots.every((pot: unknown) => object(pot) && number(pot.amount)
        && gameSeatList(pot.eligible) && gameSeatList(pot.winners)) && gameSeatCounts(value.chips, STUD_TOTAL_CHIPS)
        && gameSeatList(value.eliminated);
    default: return false;
  }
}

export function studGame(value: ObjectValue, player: PlayerValidator): boolean {
  return flexibleSeatGame(value, player) &&
    oneOf(value.phase, ['playing', 'scoring']) &&
    number(value.hand) && value.hand >= 1 && value.hand <= STUD_HANDS &&
    oneOf(value.button, gameSeats) &&
    number(value.ante) && number(value.minBet) &&
    gameSeatCounts(value.chips, STUD_TOTAL_CHIPS) && gameSeatCounts(value.streetBets, STUD_TOTAL_CHIPS) &&
    gameSeatCounts(value.totalBets, STUD_TOTAL_CHIPS) &&
    gameSeatList(value.dealt) && gameSeatList(value.folded) && gameSeatList(value.acted) && gameSeatList(value.eliminated) &&
    oneOf(String(value.street), ['2', '3', '4', '5']) &&
    gameSeatValues(value.up, (entry) => cards(entry, MAX_UP_CARDS)) &&
    number(value.currentBet) && number(value.minRaise) &&
    gameSeatValues(value.revealed, (entry) => cards(entry, 1)) &&
    oneOf(value.currentTurnSeat, gameSeats) &&
    cards(value.deck, 52) &&
    gameSeatValues(value.hands, (entry) => cards(entry, 1)) &&
    Array.isArray(value.log) &&
    value.log.every(studLog) &&
    (value.result === null || isStudResult(value.result));
}

/** Whether a logged action is exactly what the rules allow for the acting seat. */
function legalStudAction(table: ReturnType<typeof studEmptyTable>, entry: Extract<StudGameState['log'][number],
  { type: 'action' }>): boolean {
  const legal = heLegalActions(table, entry.seat);
  if (!legal) return false;
  const stake = table.streetBets[entry.seat];
  switch (entry.action) {
    case 'fold': return entry.to === stake && !entry.allIn;
    case 'check': return legal.check && entry.to === stake && !entry.allIn;
    case 'call':
      return legal.call > 0 && entry.to === stake + legal.call && entry.allIn === (legal.call === table.chips[entry.seat]);
    default:
      return legal.raise !== null && entry.to >= legal.raise.min && entry.to <= legal.raise.max
        && entry.action === (table.currentBet === 0 ? 'bet' : 'raise') && entry.allIn === (entry.to === legal.raise.max);
  }
}

/**
 * Replaying the public log reproduces every hand's button and antes, each up card dealt to the
 * seats still in, each legal action in turn, streets and showdowns only once betting closes, and
 * every award; the deck, hole cards, and up cards account for all 52 cards of the latest hand.
 */
export function coherentStudGame(state: StudGameState): boolean {
  if (!distinctPlayers(state.players)) return false;
  const participants = occupiedSeats(state.players);
  const table = studEmptyTable(participants);
  let inHand = false;
  /** A hand's first up card follows its antes immediately. */
  let awaitingFirstDeal = false;
  let turn: GameSeat | null = null;
  for (const entry of state.log) {
    const contested = heInHand(table).length > 1;
    if (entry.type === 'hand') {
      if (inHand || entry.hand !== table.hand + 1 || (table.hand > 0 && heMatchOver(table))) return false;
      const dealt = gameSeats.filter((seat) => table.chips[seat] > 0);
      if (table.hand > 0 ? entry.button !== heNextButton(table.button, table.chips) : !dealt.includes(entry.button)) {
        return false;
      }
      const { ante, minBet } = studStakes(entry.hand);
      const antes = gameSeatMap((seat) => dealt.includes(seat) ? Math.min(ante, table.chips[seat]) : 0);
      if (entry.ante !== ante || entry.minBet !== minBet || !sameJson(entry.antes, antes)) return false;
      studApplyEntry(table, entry);
      inHand = true;
      awaitingFirstDeal = true;
      turn = null;
      continue;
    }
    if (!inHand) return false;
    if (entry.type === 'action') {
      if (awaitingFirstDeal || turn !== entry.seat || !legalStudAction(table, entry)) return false;
      studApplyEntry(table, entry);
      turn = heNextToAct(table, entry.seat);
      continue;
    }
    if (turn !== null) return false;
    if (entry.type === 'street') {
      const expected = awaitingFirstDeal ? 2 : table.street + 1;
      const receiving = heInHand(table);
      if ((!awaitingFirstDeal && (!contested || table.street >= STUD_FINAL_STREET)) || entry.street !== expected
        || gameSeats.some((seat) => entry.cards[seat].length !== (receiving.includes(seat) ? 1 : 0))) return false;
      studApplyEntry(table, entry);
      awaitingFirstDeal = false;
      turn = studFirstToAct(table);
    } else if (entry.type === 'showdown') {
      const showing = heInHand(table);
      if (awaitingFirstDeal || !contested || table.street !== STUD_FINAL_STREET || gameSeats.some((seat) =>
        entry.cards[seat].length !== (showing.includes(seat) ? 1 : 0))) return false;
      studApplyEntry(table, entry);
    } else {
      if (awaitingFirstDeal || (contested && (table.street !== STUD_FINAL_STREET
        || heInHand(table).some((seat) => table.revealed[seat].length === 0)))) return false;
      const { pots, payouts } = studAward(table);
      const chips = gameSeatMap(() => 0);
      for (const seat of gameSeats) chips[seat] = table.chips[seat] + payouts[seat];
      if (!sameJson({ pots: entry.pots, chips: entry.chips, eliminated: entry.eliminated },
        { pots, chips, eliminated: heEliminations(table, chips) })) return false;
      studApplyEntry(table, entry);
      inHand = false;
    }
  }
  const publicState = (value: typeof table): unknown => ({
    hand: value.hand, button: value.button, ante: value.ante, minBet: value.minBet,
    chips: value.chips, streetBets: value.streetBets, totalBets: value.totalBets, dealt: value.dealt,
    folded: value.folded, street: value.street, up: value.up, currentBet: value.currentBet,
    minRaise: value.minRaise, acted: value.acted, revealed: value.revealed, eliminated: value.eliminated,
  });
  if (!sameJson(publicState(table), publicState(state))) return false;
  const held = [...state.deck, ...gameSeats.flatMap((seat) => [...state.hands[seat], ...state.up[seat]])];
  if (new Set(held.map(cardId)).size !== held.length || held.length !== 52
    || gameSeats.some((seat) => state.hands[seat].length !== (table.dealt.includes(seat) ? 1 : 0)
      || (state.revealed[seat].length > 0 && !sameJson(state.revealed[seat], state.hands[seat])))) return false;
  if (state.phase === 'playing') return inHand && turn !== null && state.currentTurnSeat === turn && state.result === null;
  return !inHand && state.log.at(-1)?.type === 'award' && heMatchOver(table)
    && sameJson(state.result, flexibleResult(state.result, participants, {
      gameType: 'stud', chips: state.chips, hands: state.hand, winners: heWinners(state.chips),
      eliminationOrder: state.eliminated,
    }));
}
