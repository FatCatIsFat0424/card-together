import { randomUUID } from 'node:crypto';
import type { Card, PlayerInfo, RoomCode, Seat } from '@shared/types';
import type { GongZhuGameState, GongZhuVisibleState } from '@shared/games/gongzhu/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { sameCard } from '@shared/rules/cards';
import { GONGZHU_FIRST_CARD, GONGZHU_HANDS, gongZhuLegalCards, gongZhuNextSeat,
  gongZhuScore, gongZhuSeatMap, gongZhuTrickWinner, gongZhuWinners } from '@shared/rules/gongzhu';
import { createDeck, shuffleDeck } from '../../engine/deck';
import type { GameActionResult } from './game-adapter';

const games = new Map<RoomCode, GongZhuGameState>();

function deal(game: GongZhuGameState, deck: readonly Card[], now: number): void {
  game.hands = gongZhuSeatMap((seat) => deck.slice(SEAT_ORDER_CLOCKWISE.indexOf(seat) * 13,
    (SEAT_ORDER_CLOCKWISE.indexOf(seat) + 1) * 13));
  game.captures = gongZhuSeatMap(() => []);
  game.trick = [];
  game.tricks = [];
  game.currentTurnSeat = SEAT_ORDER_CLOCKWISE.find((seat) => game.hands[seat].some((card) => sameCard(card, GONGZHU_FIRST_CARD))) ?? 'N';
  game.log.push({ type: 'deal', hand: game.hand, first: game.currentTurnSeat, timestamp: now });
}

export function startGame(
  roomCode: RoomCode, players: Record<Seat, PlayerInfo>, deck: readonly Card[] = shuffleDeck(createDeck()), now = Date.now(),
): void {
  const game: GongZhuGameState = { gameType: 'gongzhu', id: randomUUID(), roomCode, startedAt: now, players,
    phase: 'playing', hand: 1, hands: gongZhuSeatMap(() => []), captures: gongZhuSeatMap(() => []),
    trick: [], tricks: [], currentTurnSeat: 'N', scores: gongZhuSeatMap(() => 0), handResults: [], log: [], result: null };
  deal(game, deck, now);
  games.set(roomCode, game);
}

export function playCard(roomCode: RoomCode, seat: Seat, card: Card, now = Date.now()): GameActionResult {
  const game = games.get(roomCode);
  if (!game || game.phase !== 'playing') return { success: false, reason: 'Game is not in progress.' };
  if (game.currentTurnSeat !== seat) return { success: false, reason: 'Not your turn.' };
  if (!gongZhuLegalCards(game.hands[seat], game.trick, game.tricks.length === 0).some((legal) => sameCard(legal, card))) {
    return { success: false, reason: 'You must follow suit and lead the first trick with the two of clubs.' };
  }
  const played: Card = { suit: card.suit, rank: card.rank };
  game.hands[seat] = game.hands[seat].filter((held) => !sameCard(held, played));
  game.trick.push({ seat, card: played });
  game.log.push({ type: 'play', seat, card: played, timestamp: now });
  game.currentTurnSeat = gongZhuNextSeat(seat);
  if (game.trick.length < 4) return { success: true };
  const plays = [...game.trick];
  const winner = gongZhuTrickWinner(plays);
  game.tricks.push({ plays, winner });
  game.captures[winner].push(...plays.map((play) => play.card));
  game.log.push({ type: 'trick', plays, winner, timestamp: now });
  game.trick = [];
  game.currentTurnSeat = winner;
  if (game.tricks.length < 13) return { success: true };
  const scores = gongZhuSeatMap((other) => gongZhuScore(game.captures[other]));
  game.scores = gongZhuSeatMap((other) => game.scores[other] + scores[other]);
  game.handResults.push({ hand: game.hand, scores, captures: structuredClone(game.captures) });
  game.log.push({ type: 'settle', hand: game.hand, scores, timestamp: now });
  if (game.hand === GONGZHU_HANDS) {
    game.phase = 'scoring';
    game.result = { gameType: 'gongzhu', scores: { ...game.scores }, winners: gongZhuWinners(game.scores),
      hands: GONGZHU_HANDS, handResults: structuredClone(game.handResults) };
  } else {
    game.hand += 1;
    // The facade presents settlement before the next deal and starts its clock after both frames.
    deal(game, shuffleDeck(createDeck()), now);
  }
  return { success: true };
}
export function getGameState(code: RoomCode): GongZhuGameState | null { return games.get(code) ?? null; }
export function exportGames(): GongZhuGameState[] { return [...games.values()]; }
export function restoreGames(records: GongZhuGameState[]): void {
  games.clear();
  for (const game of records) games.set(game.roomCode, game);
}
export function abortGame(code: RoomCode): void { games.delete(code); }
export function getPlayerVisibleState(code: RoomCode, seat: Seat): GongZhuVisibleState | null {
  const game = games.get(code);
  if (!game) return null;
  return { gameType: 'gongzhu', phase: game.phase, mySeat: seat, myHand: game.hands[seat],
    validCards: game.phase === 'playing' && game.currentTurnSeat === seat
      ? gongZhuLegalCards(game.hands[seat], game.trick, game.tricks.length === 0) : [],
    handCounts: gongZhuSeatMap((other) => game.hands[other].length), hand: game.hand,
    captures: game.captures, trick: game.trick, tricks: game.tricks, currentTurnSeat: game.currentTurnSeat,
    scores: game.scores, handResults: game.handResults, log: game.log, result: game.result };
}
