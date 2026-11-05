import type { Card, Seat } from '@shared/types';
import type { GongZhuGameState, GongZhuHand, GongZhuPlay, GongZhuTrick } from '@shared/games/gongzhu/types';
import { cardKey, sameCard } from '@shared/rules/cards';
import { GONGZHU_FIRST_CARD, GONGZHU_HANDS, gongZhuLegalCards, gongZhuNextSeat, gongZhuScore,
  gongZhuSeatMap, gongZhuTrickWinner, gongZhuWinners } from '@shared/rules/gongzhu';
import { card, commonGame, distinctPlayers, number, object, oneOf, sameJson, seatCards, seats } from '../../runtime/validation-helpers';
import type { ObjectValue, PlayerValidator } from '../../runtime/validation-helpers';

function scores(value: unknown): value is Record<Seat, number> {
  return object(value) && Object.keys(value).length === 4 && seats.every((seat) =>
    typeof value[seat] === 'number' && Number.isSafeInteger(value[seat]) && Math.abs(value[seat]) <= 4000);
}
function plays(value: unknown, max: number): boolean {
  return Array.isArray(value) && value.length <= max && value.every((play: unknown) =>
    object(play) && oneOf(play.seat, seats) && card(play.card));
}
function completeDeck(cards: readonly Card[]): boolean {
  return cards.length === 52 && new Set(cards.map(cardKey)).size === 52;
}
function hand(value: unknown): value is GongZhuHand {
  if (!object(value) || !number(value.hand) || value.hand < 1 || value.hand > GONGZHU_HANDS
    || !scores(value.scores) || !seatCards(value.captures, 52)) return false;
  const captures = value.captures as Record<Seat, Card[]>;
  const points = value.scores;
  return completeDeck(seats.flatMap((seat) => captures[seat]))
    && seats.every((seat) => captures[seat].length % 4 === 0 && points[seat] === gongZhuScore(captures[seat]));
}
export function isGongZhuResult(value: unknown): boolean {
  if (!object(value) || value.gameType !== 'gongzhu' || value.hands !== GONGZHU_HANDS || !scores(value.scores)
    || !Array.isArray(value.handResults) || value.handResults.length !== GONGZHU_HANDS
    || !value.handResults.every(hand)) return false;
  const totals = gongZhuSeatMap((seat) => (value.handResults as GongZhuHand[]).reduce((sum, entry) => sum + entry.scores[seat], 0));
  return value.handResults.every((entry, index) => (entry as GongZhuHand).hand === index + 1)
    && sameJson(value.scores, totals) && sameJson(value.winners, gongZhuWinners(totals));
}
function log(value: unknown): boolean {
  if (!object(value) || !number(value.timestamp)) return false;
  switch (value.type) {
    case 'deal': return number(value.hand) && value.hand >= 1 && value.hand <= GONGZHU_HANDS && oneOf(value.first, seats);
    case 'play': return oneOf(value.seat, seats) && card(value.card);
    case 'trick': return oneOf(value.winner, seats) && plays(value.plays, 4) && (value.plays as unknown[]).length === 4;
    case 'settle': return number(value.hand) && value.hand >= 1 && value.hand <= GONGZHU_HANDS && scores(value.scores);
    default: return false;
  }
}
export function gongZhuGame(value: ObjectValue, player: PlayerValidator): boolean {
  return commonGame(value, player) && oneOf(value.phase, ['playing', 'scoring'])
    && number(value.hand) && value.hand >= 1 && value.hand <= GONGZHU_HANDS
    && seatCards(value.hands, 13) && seatCards(value.captures, 52) && plays(value.trick, 3)
    && Array.isArray(value.tricks) && value.tricks.length <= 13 && value.tricks.every((trick: unknown) =>
      object(trick) && plays(trick.plays, 4) && (trick.plays as unknown[]).length === 4 && oneOf(trick.winner, seats))
    && oneOf(value.currentTurnSeat, seats) && scores(value.scores)
    && Array.isArray(value.handResults) && value.handResults.length <= GONGZHU_HANDS && value.handResults.every(hand)
    && Array.isArray(value.log) && value.log.length <= 268 && value.log.every(log)
    && (value.result === null || isGongZhuResult(value.result));
}

/** Reconstruct each original deal from public plays and remaining hands, then replay every legal decision. */
export function coherentGongZhuGame(state: GongZhuGameState): boolean {
  if (!distinctPlayers(state.players)) return false;
  const totals = gongZhuSeatMap(() => 0);
  const results: GongZhuHand[] = [];
  let index = 0;
  let handNumber = 0;
  let finalTurn: Seat = 'N';
  let finalTrick: GongZhuPlay[] = [];
  let finalTricks: GongZhuTrick[] = [];
  let finalCaptures = gongZhuSeatMap<Card[]>(() => []);
  while (index < state.log.length) {
    const opening = state.log[index++];
    if (opening.type !== 'deal' || opening.hand !== ++handNumber || handNumber > GONGZHU_HANDS) return false;
    let end = index;
    while (end < state.log.length && state.log[end].type !== 'deal') end += 1;
    const entries = state.log.slice(index, end);
    const initial = gongZhuSeatMap<Card[]>(() => []);
    for (const entry of entries) if (entry.type === 'play') initial[entry.seat].push(entry.card);
    if (end === state.log.length) for (const seat of seats) initial[seat].push(...state.hands[seat]);
    if (!seats.every((seat) => initial[seat].length === 13) || !completeDeck(seats.flatMap((seat) => initial[seat]))) return false;
    if (!initial[opening.first].some((card) => sameCard(card, GONGZHU_FIRST_CARD))) return false;
    let turn = opening.first;
    let trick: GongZhuPlay[] = [];
    const tricks: GongZhuTrick[] = [];
    const captures = gongZhuSeatMap<Card[]>(() => []);
    let settled = false;
    for (const entry of entries) {
      if (settled) return false;
      if (entry.type === 'play') {
        if (trick.length === 4 || tricks.length === 13 || entry.seat !== turn
          || !gongZhuLegalCards(initial[turn], trick, tricks.length === 0).some((card) => sameCard(card, entry.card))) return false;
        initial[turn] = initial[turn].filter((card) => !sameCard(card, entry.card));
        trick.push({ seat: turn, card: entry.card });
        turn = gongZhuNextSeat(turn);
      } else if (entry.type === 'trick') {
        if (trick.length !== 4 || !sameJson(entry.plays, trick) || entry.winner !== gongZhuTrickWinner(trick)) return false;
        turn = entry.winner;
        captures[turn].push(...trick.map((play) => play.card));
        tricks.push({ plays: [...trick], winner: turn });
        trick = [];
      } else if (entry.type === 'settle') {
        const points = gongZhuSeatMap((seat) => gongZhuScore(captures[seat]));
        if (tricks.length !== 13 || trick.length !== 0 || entry.hand !== handNumber || !sameJson(entry.scores, points)) return false;
        results.push({ hand: handNumber, captures, scores: points });
        for (const seat of seats) totals[seat] += points[seat];
        settled = true;
      } else return false;
    }
    if (end < state.log.length && !settled) return false;
    if (end === state.log.length && !sameJson(initial, state.hands)) return false;
    finalTurn = turn;
    finalTrick = trick;
    finalTricks = tricks;
    finalCaptures = captures;
    index = end;
  }
  if (handNumber !== state.hand || state.hand < 1 || !sameJson(state.handResults, results)
    || !sameJson(state.scores, totals) || !sameJson(state.trick, finalTrick) || !sameJson(state.tricks, finalTricks)
    || !sameJson(state.captures, finalCaptures) || state.currentTurnSeat !== finalTurn) return false;
  const finished = results.length === GONGZHU_HANDS;
  if (!finished) return state.phase === 'playing' && state.result === null && results.length === state.hand - 1
    && state.tricks.length < 13 && state.trick.length < 4;
  return state.phase === 'scoring' && sameJson(state.result, { gameType: 'gongzhu', scores: totals,
    winners: gongZhuWinners(totals), hands: GONGZHU_HANDS, handResults: results });
}
