import type { Seat } from '@shared/types';
import type { HeartsGameState, HeartsHandScore, HeartsLogEntry, HeartsTrick, HeartsTrickRecord } from '@shared/games/hearts/types';
import { HEARTS_SEATS, HEARTS_MAX_HANDS, HEARTS_TARGET, emptyHeartsScores, heartsPassDirection,
  heartsPassTarget, heartsPassError, heartsValidCards, nextHeartsSeat, heartsTrickWinner, scoreHeartsHand,
  heartsWinners } from '@shared/rules/hearts';
import { cardKey, hasCard, removeCards } from '@shared/rules/cards';
import { commonGame, object, number, oneOf, card, cards, seatCards, seatCounts, sameJson, distinctPlayers } from '../../runtime/validation-helpers';
import type { ObjectValue, PlayerValidator } from '../../runtime/validation-helpers';

const seat = (value: unknown): boolean => oneOf(value, [...HEARTS_SEATS]);
function handScore(value: unknown): value is HeartsHandScore {
  if (!object(value) || !seatCounts(value.penalties, 26) || !seatCounts(value.added, 26)
    || !(value.moon === null || seat(value.moon))) return false;
  const penalties = value.penalties;
  const moon = HEARTS_SEATS.find((member) => penalties[member] === 26) ?? null;
  return HEARTS_SEATS.reduce((sum, member) => sum + penalties[member], 0) === 26 && value.moon === moon
    && HEARTS_SEATS.every((member) => (value.added as Record<Seat, number>)[member] ===
      (moon ? member === moon ? 0 : 26 : penalties[member]));
}
export function isHeartsResult(value: unknown): boolean {
  if (!object(value) || value.gameType !== 'hearts' || !seatCounts(value.scores, 125)
    || !Array.isArray(value.winners) || !Array.isArray(value.hands) || value.hands.length < 1
    || value.hands.length > HEARTS_MAX_HANDS || !value.hands.every(handScore)) return false;
  const totals = emptyHeartsScores();
  for (let index = 0; index < value.hands.length; index++) {
    if (HEARTS_SEATS.some((member) => totals[member] >= HEARTS_TARGET)) return false;
    const score: HeartsHandScore = value.hands[index];
    for (const member of HEARTS_SEATS) totals[member] += score.added[member];
  }
  return HEARTS_SEATS.some((member) => totals[member] >= HEARTS_TARGET)
    && sameJson(totals, value.scores) && sameJson(heartsWinners(totals), value.winners);
}
function trickShape(value: unknown, complete: boolean): boolean {
  return object(value) && seat(value.leadSeat) && Array.isArray(value.plays)
    && value.plays.length <= 4 && (!complete || value.plays.length === 4)
    && value.plays.every((play: unknown) => object(play) && seat(play.seat) && card(play.card))
    && (!complete || seat(value.winner));
}
function logShape(value: unknown): boolean {
  if (!object(value) || !number(value.timestamp)) return false;
  switch (value.type) {
    case 'deal': return number(value.hand) && value.hand > 0 && value.hand <= HEARTS_MAX_HANDS;
    case 'pass': return seat(value.seat) && Object.keys(value).length === 3;
    case 'play': return seat(value.seat) && card(value.card);
    case 'trick_end': return trickShape(value.trick, true);
    case 'hand_end': return number(value.hand) && handScore(value.score) && seatCounts(value.totals, 125);
    default: return false;
  }
}
export function heartsGame(value: ObjectValue, player: PlayerValidator): boolean {
  return commonGame(value, player) && oneOf(value.phase, ['passing', 'playing', 'scoring'])
    && number(value.hand) && value.hand >= 1 && value.hand <= HEARTS_MAX_HANDS
    && seatCards(value.hands, 13) && Array.isArray(value.deals) && value.deals.length === value.hand
    && value.deals.every((deal: unknown) => object(deal) && seatCards(deal.hands, 13) && object(deal.passes)
      && Object.entries(deal.passes).every(([member, selection]) => seat(member) && cards(selection, 3)
        && Array.isArray(selection) && selection.length === 3))
    && (value.passDeadline === null || number(value.passDeadline))
    && number(value.passDurationMs) && value.passDurationMs >= 30000 && value.passDurationMs <= 3600000
    && typeof value.heartsBroken === 'boolean' && (value.currentTurnSeat === null || seat(value.currentTurnSeat))
    && (value.trick === null || trickShape(value.trick, false))
    && Array.isArray(value.tricks) && value.tricks.length <= 13 && value.tricks.every((trick: unknown) => trickShape(trick, true))
    && seatCounts(value.scores, 125) && Array.isArray(value.log) && value.log.length <= HEARTS_MAX_HANDS * 72
    && value.log.every(logShape) && (value.result === null || isHeartsResult(value.result));
}
type PublicEntry = { [K in HeartsLogEntry['type']]: Omit<Extract<HeartsLogEntry, { type: K }>, 'timestamp'> }[HeartsLogEntry['type']];
function publicEntry(entry: HeartsLogEntry): PublicEntry {
  const { timestamp: _timestamp, ...rest } = entry;
  return rest;
}
/** Replay private deal evidence and public plays, checking ownership, turn order, legality and settlement. */
export function coherentHeartsGame(state: HeartsGameState): boolean {
  if (!distinctPlayers(state.players)) return false;
  const totals = emptyHeartsScores();
  const handScores: HeartsHandScore[] = [];
  let cursor = 0;
  let previousTime = state.startedAt;
  const take = (expected: PublicEntry): boolean => {
    const entry = state.log[cursor++];
    if (!entry || entry.timestamp < previousTime || !sameJson(publicEntry(entry), expected)) return false;
    previousTime = entry.timestamp;
    return true;
  };
  for (let index = 0; index < state.deals.length; index++) {
    if (HEARTS_SEATS.some((member) => totals[member] >= HEARTS_TARGET)) return false;
    const evidence = state.deals[index];
    let hands = structuredClone(evidence.hands);
    const all = HEARTS_SEATS.flatMap((member) => hands[member]);
    if (all.length !== 52 || new Set(all.map(cardKey)).size !== 52
      || HEARTS_SEATS.some((member) => hands[member].length !== 13)
      || !take({ type: 'deal', hand: index + 1 })) return false;
    const direction = heartsPassDirection(index + 1);
    const passed: Seat[] = [];
    while (state.log[cursor]?.type === 'pass') {
      const entry = state.log[cursor];
      if (entry.type !== 'pass' || direction === 'hold' || passed.includes(entry.seat)) return false;
      const selection = evidence.passes[entry.seat];
      if (!selection || heartsPassError(hands[entry.seat], selection) || !take({ type: 'pass', seat: entry.seat })) return false;
      passed.push(entry.seat);
    }
    if (!sameJson([...passed].sort(), Object.keys(evidence.passes).sort())) return false;
    const passing = direction !== 'hold' && passed.length < 4;
    if (!passing && direction !== 'hold') {
      hands = { N: removeCards(hands.N, evidence.passes.N ?? []), E: removeCards(hands.E, evidence.passes.E ?? []),
        S: removeCards(hands.S, evidence.passes.S ?? []), W: removeCards(hands.W, evidence.passes.W ?? []) };
      for (const member of HEARTS_SEATS) hands[heartsPassTarget(member, direction)].push(...evidence.passes[member] ?? []);
    }
    let current: Seat | null = passing ? null : HEARTS_SEATS.find((member) =>
      hands[member].some((entry) => entry.suit === 'clubs' && entry.rank === 2)) ?? null;
    if (!passing && !current) return false;
    let trick: HeartsTrick | null = current ? { leadSeat: current, plays: [] } : null;
    const tricks: HeartsTrickRecord[] = [];
    let broken = false;
    while (state.log[cursor]?.type === 'play') {
      const entry = state.log[cursor];
      if (entry.type !== 'play' || !trick || entry.seat !== current || tricks.length === 13
        || !hasCard(heartsValidCards(hands[entry.seat], trick, tricks.length === 0, broken), entry.card)
        || !take({ type: 'play', seat: entry.seat, card: entry.card })) return false;
      hands[entry.seat] = removeCards(hands[entry.seat], [entry.card]);
      broken ||= entry.card.suit === 'hearts';
      trick = { ...trick, plays: [...trick.plays, { seat: entry.seat, card: entry.card }] };
      current = nextHeartsSeat(entry.seat);
      if (trick.plays.length === 4) {
        const winner = heartsTrickWinner(trick);
        const record: HeartsTrickRecord = { ...trick, winner };
        if (!take({ type: 'trick_end', trick: record })) return false;
        tricks.push(record); trick = { leadSeat: winner, plays: [] }; current = winner;
      }
    }
    const complete = tricks.length === 13;
    if (complete) {
      const score = scoreHeartsHand(tricks);
      for (const member of HEARTS_SEATS) totals[member] += score.added[member];
      handScores.push(score);
      if (!take({ type: 'hand_end', hand: index + 1, score, totals: { ...totals } })) return false;
    }
    if (index < state.deals.length - 1) { if (!complete) return false; continue; }
    const finished = HEARTS_SEATS.some((member) => totals[member] >= HEARTS_TARGET);
    if (complete !== finished || !sameJson(hands, state.hands) || broken !== state.heartsBroken
      || !sameJson(tricks, state.tricks) || !sameJson(totals, state.scores)
      || state.phase !== (finished ? 'scoring' : passing ? 'passing' : 'playing')
      || (state.phase === 'passing' ? state.passDeadline === null : state.passDeadline !== null)
      || current !== (finished ? tricks[12].winner : state.currentTurnSeat)
      || !sameJson(finished ? null : trick, state.trick)) return false;
    if (finished && state.currentTurnSeat !== null) return false;
    const result = finished ? { gameType: 'hearts', scores: totals, winners: heartsWinners(totals), hands: handScores } : null;
    if (!sameJson(result, state.result)) return false;
  }
  return cursor === state.log.length;
}
