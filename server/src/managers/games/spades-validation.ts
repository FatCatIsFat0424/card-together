import type { Seat } from '@shared/types';
import type { SpadesGameState, SpadesHandResult, SpadesLogEntry, SpadesMatchResult } from '@shared/games/spades/types';
import { applySpadesMove, newSpadesHand, sameSpadesCard, scoreSpadesHand, SPADES_SEATS, SPADES_TEAMS,
  spadesNext, spadesSeatMap, spadesWinners } from '@shared/rules/spades';
import { card, cardId, cards, commonGame, distinctPlayers, number, object, oneOf, sameJson, seatCards,
  seatCounts, seats } from '../../runtime/validation-helpers';
import type { ObjectValue, PlayerValidator } from '../../runtime/validation-helpers';

function teams(value: unknown, bags = false): boolean {
  return object(value) && Object.keys(value).length === 2 && SPADES_TEAMS.every((team) =>
    typeof value[team] === 'number' && Number.isSafeInteger(value[team]) && (!bags || (number(value[team]) && value[team] < 10)));
}
function handResult(value: unknown): boolean {
  if (!object(value) || !seatCounts(value.bids, 13) || !seatCounts(value.taken, 13) || !object(value.teams)) return false;
  return seats.reduce((sum, seat) => sum + (value.taken as Record<Seat, number>)[seat], 0) === 13
    && SPADES_TEAMS.every((team) => {
      const score = (value.teams as ObjectValue)[team];
      return object(score) && ['contract', 'tricks', 'nilPoints', 'contractPoints', 'bagsAdded', 'bagPenalty', 'points', 'bags']
        .every((key) => typeof score[key] === 'number' && Number.isSafeInteger(score[key]));
    });
}
/** Recompute every hand and carry bags before accepting historical totals. */
function totals(hands: readonly SpadesHandResult[]): { scores: Record<'NS' | 'EW', number>; bags: Record<'NS' | 'EW', number> } | null {
  let bags = { NS: 0, EW: 0 };
  const scores = { NS: 0, EW: 0 };
  for (const hand of hands) {
    if (spadesWinners(scores).length) return null;
    const expected = scoreSpadesHand(hand.bids, hand.taken, bags);
    if (!sameJson(hand, expected)) return null;
    for (const team of SPADES_TEAMS) scores[team] += expected.teams[team].points;
    bags = { NS: expected.teams.NS.bags, EW: expected.teams.EW.bags };
  }
  return { scores, bags };
}
export function isSpadesResult(value: unknown): boolean {
  if (!object(value) || value.gameType !== 'spades' || !teams(value.scores) || !teams(value.bags, true)
    || !Array.isArray(value.hands) || !value.hands.length || !value.hands.every(handResult)
    || !Array.isArray(value.winners)) return false;
  const calculated = totals(value.hands as SpadesHandResult[]);
  return calculated !== null && sameJson(value.scores, calculated.scores) && sameJson(value.bags, calculated.bags)
    && spadesWinners(calculated.scores).length === 2 && sameJson(value.winners, spadesWinners(calculated.scores));
}
function play(value: unknown): boolean { return object(value) && oneOf(value.seat, seats) && card(value.card); }
function logEntry(value: unknown): boolean {
  if (!object(value) || !number(value.timestamp)) return false;
  switch (value.type) {
    case 'deal': return oneOf(value.dealerSeat, seats);
    case 'bid': return oneOf(value.seat, seats) && number(value.bid) && value.bid <= 13;
    case 'play': return play(value);
    case 'trick_end': return oneOf(value.winnerSeat, seats) && cards(value.cards, 4) && Array.isArray(value.cards) && value.cards.length === 4
      && Array.isArray(value.cardSeats) && value.cardSeats.length === 4 && value.cardSeats.every((seat) => oneOf(seat, seats));
    case 'hand_end': return handResult(value.result);
    default: return false;
  }
}
export function spadesGame(value: ObjectValue, player: PlayerValidator): boolean {
  const p = value.position;
  return commonGame(value, player) && oneOf(value.phase, ['bidding', 'playing', 'scoring'])
    && seatCards(value.hands, 13) && teams(value.scores) && teams(value.bags, true)
    && Array.isArray(value.handResults) && value.handResults.every(handResult)
    && Array.isArray(value.log) && value.log.every(logEntry)
    && (value.result === null || isSpadesResult(value.result))
    && object(p) && oneOf(p.phase, ['bidding', 'playing', 'complete']) && oneOf(p.dealerSeat, seats)
    && (p.currentTurnSeat === null || oneOf(p.currentTurnSeat, seats)) && typeof p.broken === 'boolean'
    && object(p.bids) && Object.keys(p.bids).length === 4
    && seats.every((seat) => p.bids && object(p.bids) && (p.bids[seat] === null || (number(p.bids[seat]) && p.bids[seat] <= 13)))
    && seatCounts(p.taken, 13) && Array.isArray(p.trick) && p.trick.length < 4 && p.trick.every(play)
    && Array.isArray(p.tricks) && p.tricks.length <= 13 && p.tricks.every((trick: unknown) => object(trick)
      && oneOf(trick.winner, seats) && Array.isArray(trick.plays) && trick.plays.length === 4 && trick.plays.every(play));
}
/** Reconstruct each deal from public plays plus the remaining private cards, and replay all legal decisions. */
export function coherentSpadesGame(state: SpadesGameState): boolean {
  if (!distinctPlayers(state.players) || !state.log.length || state.log[0].type !== 'deal') return false;
  const starts = state.log.flatMap((entry, index) => entry.type === 'deal' ? [index] : []);
  let scores = { NS: 0, EW: 0 };
  let bags = { NS: 0, EW: 0 };
  const handResults: SpadesHandResult[] = [];
  let dealer: Seat | null = null;
  for (let i = 0; i < starts.length; i++) {
    if (spadesWinners(scores).length) return false;
    const segment = state.log.slice(starts[i], starts[i + 1] ?? state.log.length);
    const first = segment[0];
    if (first.type !== 'deal' || (dealer !== null && first.dealerSeat !== spadesNext(dealer))) return false;
    dealer = first.dealerSeat;
    const last = i === starts.length - 1;
    const hands = spadesSeatMap((seat) => [
      ...segment.flatMap((entry) => entry.type === 'play' && entry.seat === seat ? [entry.card] : []),
      ...(last ? state.hands[seat] : []),
    ]);
    const all = SPADES_SEATS.flatMap((seat) => hands[seat]);
    if (SPADES_SEATS.some((seat) => hands[seat].length !== 13) || new Set(all.map(cardId)).size !== 52) return false;
    let position = newSpadesHand(dealer);
    const expected: SpadesLogEntry[] = [first];
    let ended = false;
    for (const entry of segment) {
      if (entry.type !== 'bid' && entry.type !== 'play') continue;
      const previous = position;
      const action = entry.type === 'bid' ? { type: 'bid' as const, bid: entry.bid } : { type: 'play' as const, card: entry.card };
      const next = applySpadesMove(position, entry.seat, hands[entry.seat], action);
      if (!next) return false;
      position = next;
      expected.push(entry);
      if (entry.type === 'play') hands[entry.seat] = hands[entry.seat].filter((card) => !sameSpadesCard(card, entry.card));
      if (next.tricks.length > previous.tricks.length) {
        const trick = next.tricks.at(-1);
        if (!trick) return false;
        expected.push({ type: 'trick_end', winnerSeat: trick.winner, cards: trick.plays.map((play) => play.card),
          cardSeats: trick.plays.map((play) => play.seat), timestamp: entry.timestamp });
      }
      if (position.phase === 'complete') {
        const result = scoreSpadesHand(position.bids as Record<Seat, number>, position.taken, bags);
        handResults.push(result);
        expected.push({ type: 'hand_end', result, timestamp: entry.timestamp });
        scores = { NS: scores.NS + result.teams.NS.points, EW: scores.EW + result.teams.EW.points };
        bags = { NS: result.teams.NS.bags, EW: result.teams.EW.bags };
        ended = true;
      }
    }
    if (!sameJson(segment, expected) || (!last && !ended)) return false;
    if (last) {
      if (!sameJson(state.position, position) || !sameJson(state.hands, hands)) return false;
      const phase = position.phase === 'complete' ? 'scoring' : position.phase;
      if (state.phase !== phase || (ended && !spadesWinners(scores).length)) return false;
    }
  }
  if (!sameJson(state.scores, scores) || !sameJson(state.bags, bags) || !sameJson(state.handResults, handResults)) return false;
  const result: SpadesMatchResult | null = state.phase === 'scoring'
    ? { gameType: 'spades', scores, bags, hands: handResults, winners: spadesWinners(scores) } : null;
  return sameJson(state.result, result);
}
