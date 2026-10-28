import {
  HE_STARTING_CHIPS, HE_HANDS, heWinners, HE_HOLE_CARDS, heEmptyTable, heLegalActions, heInHand, heMatchOver,
  heNextButton, heBlinds, heBlindSeats, heApplyEntry, heFirstToAct, heNextToAct, HE_STREET_CARDS, heAward,
  heEliminations,
} from '@shared/rules/holdem';
import { normalizeGameSeatMaps } from '@shared/game-seat-compat';
import {
  object, gameSeatCounts, number, gameSeatList, resultSeats, gameSeats, sameJson, oneOf, cards,
  gameSeatValues, flexibleSeatGame, distinctPlayers, cardId, flexibleResult,
} from '../../runtime/validation-helpers';
import type { ObjectValue, PlayerValidator } from '../../runtime/validation-helpers';
import type { HoldemGameState, GameSeat } from '@shared/types';
import { occupiedSeats, gameSeatMap } from '@shared/rules/seats';

/** Chips never enter or leave a Hold'em match. */
const HE_TOTAL_CHIPS = HE_STARTING_CHIPS * 8;

/** Hold'em result: chips are conserved, winners hold the most, and the match had ended. */
export function isHoldemResult(value: unknown): boolean {
  value = normalizeGameSeatMaps(value);
  if (!object(value) || value.gameType !== 'holdem' || !gameSeatCounts(value.chips, HE_TOTAL_CHIPS) || !number(value.hands)
    || value.hands < 1 || value.hands > HE_HANDS || !gameSeatList(value.eliminationOrder)) return false;
  const chips = value.chips;
  const participants = resultSeats(value);
  if (!participants) return false;
  const holders = gameSeats.filter((seat) => chips[seat] > 0);
  return gameSeats.reduce((sum, seat) => sum + chips[seat], 0) === HE_STARTING_CHIPS * participants.length
    && holders.every((seat) => participants.includes(seat))
    && (value.hands === HE_HANDS || holders.length === 1)
    && value.eliminationOrder.every((seat) => participants.includes(seat) && chips[seat] === 0)
    && value.eliminationOrder.length === participants.length - holders.length
    && sameJson(value.winners, heWinners(chips));
}

function holdemLog(value: unknown): boolean {
  if (!object(value) || !number(value.timestamp)) return false;
  switch (value.type) {
    case 'hand':
      return number(value.hand) && value.hand >= 1 && value.hand <= HE_HANDS && oneOf(value.button, gameSeats)
        && number(value.smallBlind) && number(value.bigBlind) && gameSeatCounts(value.blinds, HE_TOTAL_CHIPS);
    case 'action':
      return oneOf(value.seat, gameSeats) && oneOf(value.action, ['fold', 'check', 'call', 'bet', 'raise'])
        && number(value.to) && value.to <= HE_TOTAL_CHIPS && typeof value.allIn === 'boolean';
    case 'street':
      return oneOf(value.street, ['flop', 'turn', 'river']) && cards(value.cards, 3);
    case 'showdown':
      return gameSeatValues(value.cards, (entry) => cards(entry, HE_HOLE_CARDS));
    case 'award':
      return Array.isArray(value.pots) && value.pots.every((pot: unknown) => object(pot) && number(pot.amount)
        && gameSeatList(pot.eligible) && gameSeatList(pot.winners)) && gameSeatCounts(value.chips, HE_TOTAL_CHIPS)
        && gameSeatList(value.eliminated);
    default: return false;
  }
}

export function holdemGame(value: ObjectValue, player: PlayerValidator): boolean {
  return flexibleSeatGame(value, player) &&
    oneOf(value.phase, ['playing', 'scoring']) &&
    number(value.hand) && value.hand >= 1 && value.hand <= HE_HANDS &&
    oneOf(value.button, gameSeats) &&
    number(value.smallBlind) && number(value.bigBlind) &&
    gameSeatCounts(value.chips, HE_TOTAL_CHIPS) && gameSeatCounts(value.streetBets, HE_TOTAL_CHIPS) &&
    gameSeatCounts(value.totalBets, HE_TOTAL_CHIPS) &&
    gameSeatList(value.dealt) && gameSeatList(value.folded) && gameSeatList(value.acted) && gameSeatList(value.eliminated) &&
    oneOf(value.street, ['preflop', 'flop', 'turn', 'river']) &&
    cards(value.board, 5) &&
    number(value.currentBet) && number(value.minRaise) &&
    gameSeatValues(value.revealed, (entry) => cards(entry, HE_HOLE_CARDS)) &&
    oneOf(value.currentTurnSeat, gameSeats) &&
    cards(value.deck, 52) &&
    gameSeatValues(value.hands, (entry) => cards(entry, HE_HOLE_CARDS)) &&
    Array.isArray(value.log) &&
    value.log.every(holdemLog) &&
    (value.result === null || isHoldemResult(value.result));
}

/** Whether a logged action is exactly what the rules allow for the acting seat. */
function legalHoldemAction(table: ReturnType<typeof heEmptyTable>, entry: Extract<HoldemGameState['log'][number],
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
 * Replaying the public log reproduces every hand's button and blinds, each legal action in turn,
 * streets and showdowns only once betting closes, and every award; the deck, hole cards, and board
 * account for all 52 cards of the latest hand.
 */
export function coherentHoldemGame(state: HoldemGameState): boolean {
  if (!distinctPlayers(state.players)) return false;
  const participants = occupiedSeats(state.players);
  const table = heEmptyTable(participants);
  let inHand = false;
  let turn: GameSeat | null = null;
  for (const entry of state.log) {
    const contested = heInHand(table).length > 1;
    if (entry.type === 'hand') {
      if (inHand || entry.hand !== table.hand + 1 || (table.hand > 0 && heMatchOver(table))) return false;
      const dealt = gameSeats.filter((seat) => table.chips[seat] > 0);
      if (table.hand > 0 ? entry.button !== heNextButton(table.button, table.chips) : !dealt.includes(entry.button)) {
        return false;
      }
      const { smallBlind, bigBlind } = heBlinds(entry.hand);
      const { small, big } = heBlindSeats(dealt, entry.button);
      const blinds = gameSeatMap(() => 0);
      blinds[small] = Math.min(smallBlind, table.chips[small]);
      blinds[big] = Math.min(bigBlind, table.chips[big]);
      if (entry.smallBlind !== smallBlind || entry.bigBlind !== bigBlind || !sameJson(entry.blinds, blinds)) return false;
      heApplyEntry(table, entry);
      inHand = true;
      turn = heFirstToAct(table);
      continue;
    }
    if (!inHand) return false;
    if (entry.type === 'action') {
      if (turn !== entry.seat || !legalHoldemAction(table, entry)) return false;
      heApplyEntry(table, entry);
      turn = heNextToAct(table, entry.seat);
      continue;
    }
    if (turn !== null) return false;
    if (entry.type === 'street') {
      const expected = table.board.length === 0 ? 'flop' : table.board.length === 3 ? 'turn' : 'river';
      if (!contested || table.board.length >= 5 || entry.street !== expected
        || entry.cards.length !== HE_STREET_CARDS[expected]) return false;
      heApplyEntry(table, entry);
      turn = heFirstToAct(table);
    } else if (entry.type === 'showdown') {
      const showing = heInHand(table);
      if (!contested || table.board.length !== 5 || gameSeats.some((seat) =>
        entry.cards[seat].length !== (showing.includes(seat) ? HE_HOLE_CARDS : 0))) return false;
      heApplyEntry(table, entry);
    } else {
      if (contested && (table.board.length !== 5 || heInHand(table).some((seat) => table.revealed[seat].length === 0))) {
        return false;
      }
      const { pots, payouts } = heAward(table);
      const chips = gameSeatMap(() => 0);
      for (const seat of gameSeats) chips[seat] = table.chips[seat] + payouts[seat];
      if (!sameJson({ pots: entry.pots, chips: entry.chips, eliminated: entry.eliminated },
        { pots, chips, eliminated: heEliminations(table, chips) })) return false;
      heApplyEntry(table, entry);
      inHand = false;
    }
  }
  const publicState = (value: typeof table): unknown => ({
    hand: value.hand, button: value.button, smallBlind: value.smallBlind, bigBlind: value.bigBlind,
    chips: value.chips, streetBets: value.streetBets, totalBets: value.totalBets, dealt: value.dealt,
    folded: value.folded, street: value.street, board: value.board, currentBet: value.currentBet,
    minRaise: value.minRaise, acted: value.acted, revealed: value.revealed, eliminated: value.eliminated,
  });
  if (!sameJson(publicState(table), publicState(state))) return false;
  const held = [...state.deck, ...gameSeats.flatMap((seat) => state.hands[seat]), ...state.board];
  if (new Set(held.map(cardId)).size !== held.length || held.length !== 52
    || gameSeats.some((seat) => state.hands[seat].length !== (table.dealt.includes(seat) ? HE_HOLE_CARDS : 0)
      || (state.revealed[seat].length > 0 && !sameJson(state.revealed[seat], state.hands[seat])))) return false;
  if (state.phase === 'playing') return inHand && turn !== null && state.currentTurnSeat === turn && state.result === null;
  return !inHand && state.log.at(-1)?.type === 'award' && heMatchOver(table)
    && sameJson(state.result, flexibleResult(state.result, participants, {
      gameType: 'holdem', chips: state.chips, hands: state.hand, winners: heWinners(state.chips),
      eliminationOrder: state.eliminated,
    }));
}
