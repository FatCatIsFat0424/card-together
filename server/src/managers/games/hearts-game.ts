import { randomInt, randomUUID } from 'node:crypto';
import type { Card, Seat, GameSeat, PlayerInfo, RoomCode } from '@shared/types';
import type { HeartsAction, HeartsGameState, HeartsVisibleState, HeartsTrickRecord } from '@shared/games/hearts/types';
import { HEARTS_SEATS, HEARTS_TARGET, heartsPassDirection, heartsPassTarget, heartsPassError, nextHeartsSeat,
  heartsValidCards, heartsTrickWinner, scoreHeartsHand, emptyHeartsScores, heartsWinners } from '@shared/rules/hearts';
import { hasCard, removeCards } from '@shared/rules/cards';
import { createDeck, shuffleDeck } from '../../engine/deck';
import type { GameActionResult } from './game-adapter';
const games = new Map<RoomCode, HeartsGameState>();
const copyCard = (card: Card): Card => ({ suit: card.suit, rank: card.rank });
export function shuffleHeartsDeck(): Card[] {
  return shuffleDeck(createDeck(), () => randomInt(2 ** 32) / 2 ** 32);
}
function beginPlay(game: HeartsGameState): void {
  const leadSeat = HEARTS_SEATS.find((seat) => game.hands[seat].some((card) => card.suit === 'clubs' && card.rank === 2));
  if (!leadSeat) throw new Error('Missing two of clubs.');
  game.phase = 'playing'; game.passDeadline = null; game.currentTurnSeat = leadSeat;
  game.trick = { leadSeat, plays: [] };
}
function deal(game: HeartsGameState, deck: readonly Card[], now: number): void {
  game.hand++;
  game.hands = { N: [], E: [], S: [], W: [] };
  deck.forEach((card, index) => game.hands[HEARTS_SEATS[index % 4]].push(copyCard(card)));
  game.deals.push({ hands: structuredClone(game.hands), passes: {} });
  game.heartsBroken = false; game.tricks = []; game.trick = null; game.currentTurnSeat = null;
  game.phase = 'passing'; game.passDeadline = now + game.passDurationMs;
  game.log.push({ type: 'deal', hand: game.hand, timestamp: now });
  if (heartsPassDirection(game.hand) === 'hold') beginPlay(game);
}
export function startGame(roomCode: RoomCode, players: Record<Seat, PlayerInfo>, passDurationMs = 30000,
  deck: readonly Card[] = shuffleHeartsDeck(), now = Date.now()): void {
  const game: HeartsGameState = { gameType: 'hearts', id: randomUUID(), startedAt: now, roomCode,
    players: structuredClone(players), phase: 'passing', hand: 0, hands: { N: [], E: [], S: [], W: [] },
    deals: [], passDeadline: null, passDurationMs, heartsBroken: false, currentTurnSeat: null, trick: null, tricks: [],
    scores: emptyHeartsScores(), log: [], result: null };
  deal(game, deck, now); games.set(roomCode, game);
}
export function pendingPassSeats(game: HeartsGameState): Seat[] {
  return game.phase === 'passing' ? HEARTS_SEATS.filter((seat) => !game.deals[game.hand - 1].passes[seat]) : [];
}
export function act(roomCode: RoomCode, seat: Seat, action: HeartsAction, now = Date.now(),
  shuffle: () => Card[] = shuffleHeartsDeck): GameActionResult {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found.' };
  if (action.type === 'pass') {
    if (!pendingPassSeats(game).includes(seat)) return { success: false, reason: 'No cards to pass.' };
    const error = heartsPassError(game.hands[seat], action.cards);
    if (error) return { success: false, reason: error };
    const passes = game.deals[game.hand - 1].passes;
    passes[seat] = action.cards.map(copyCard);
    game.log.push({ type: 'pass', seat, timestamp: now });
    if (pendingPassSeats(game).length === 0) {
      // Remove from every original hand before adding any incoming cards.
      for (const other of HEARTS_SEATS) game.hands[other] = removeCards(game.hands[other], passes[other] ?? []);
      for (const other of HEARTS_SEATS) {
        game.hands[heartsPassTarget(other, heartsPassDirection(game.hand))].push(...passes[other] ?? []);
      }
      beginPlay(game);
    }
    return { success: true };
  }
  if (game.phase !== 'playing' || !game.trick || game.currentTurnSeat !== seat) {
    return { success: false, reason: 'Not your turn.' };
  }
  const valid = heartsValidCards(game.hands[seat], game.trick, game.tricks.length === 0, game.heartsBroken);
  if (!hasCard(valid, action.card)) return { success: false, reason: 'That card cannot be played.' };
  const card = copyCard(action.card);
  game.hands[seat] = removeCards(game.hands[seat], [card]);
  game.heartsBroken ||= card.suit === 'hearts';
  game.trick = { ...game.trick, plays: [...game.trick.plays, { seat, card }] };
  game.log.push({ type: 'play', seat, card, timestamp: now });
  if (game.trick.plays.length < 4) { game.currentTurnSeat = nextHeartsSeat(seat); return { success: true }; }
  const winner = heartsTrickWinner(game.trick);
  const trick: HeartsTrickRecord = { ...game.trick, winner };
  game.tricks.push(trick); game.log.push({ type: 'trick_end', trick, timestamp: now });
  game.trick = { leadSeat: winner, plays: [] }; game.currentTurnSeat = winner;
  if (game.tricks.length === 13) {
    const score = scoreHeartsHand(game.tricks);
    for (const other of HEARTS_SEATS) game.scores[other] += score.added[other];
    game.log.push({ type: 'hand_end', hand: game.hand, score, totals: { ...game.scores }, timestamp: now });
    if (HEARTS_SEATS.some((other) => game.scores[other] >= HEARTS_TARGET)) {
      game.phase = 'scoring'; game.currentTurnSeat = null; game.trick = null;
      game.result = { gameType: 'hearts', scores: { ...game.scores }, winners: heartsWinners(game.scores),
        hands: game.log.flatMap((entry) => entry.type === 'hand_end' ? [entry.score] : []) };
    } else deal(game, shuffle(), now);
  }
  return { success: true };
}
export function getPlayerVisibleState(roomCode: RoomCode, seat: GameSeat): HeartsVisibleState | null {
  const game = games.get(roomCode);
  if (!game || !HEARTS_SEATS.includes(seat as Seat)) return null;
  const mySeat = seat as Seat;
  return { gameType: 'hearts', phase: game.phase, mySeat, myHand: game.hands[mySeat],
    handCounts: { N: game.hands.N.length, E: game.hands.E.length, S: game.hands.S.length, W: game.hands.W.length },
    hand: game.hand, passDirection: heartsPassDirection(game.hand),
    passedSeats: HEARTS_SEATS.filter((other) => game.deals[game.hand - 1].passes[other]),
    myPass: game.phase === 'passing' ? game.deals[game.hand - 1].passes[mySeat] ?? [] : [],
    passDeadline: game.passDeadline, heartsBroken: game.heartsBroken, currentTurnSeat: game.currentTurnSeat,
    trick: game.trick, tricks: game.tricks, scores: game.scores,
    validCards: game.phase === 'playing' && game.currentTurnSeat === mySeat && game.trick
      ? heartsValidCards(game.hands[mySeat], game.trick, game.tricks.length === 0, game.heartsBroken) : [],
    log: game.log, result: game.result };
}
export function getGameState(code: RoomCode): HeartsGameState | null { return games.get(code) ?? null; }
export function exportGames(): HeartsGameState[] { return [...games.values()]; }
export function restoreGames(records: HeartsGameState[]): void {
  games.clear(); for (const game of records) games.set(game.roomCode, game);
}
export function abortGame(code: RoomCode): void { games.delete(code); }
