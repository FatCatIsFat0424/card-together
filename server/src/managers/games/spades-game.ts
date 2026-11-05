import { randomInt, randomUUID } from 'node:crypto';
import type { Card, GameSeat, PlayerInfo, RoomCode, Seat } from '@shared/types';
import type { SpadesAction, SpadesGameState, SpadesVisibleState } from '@shared/games/spades/types';
import { applySpadesMove, newSpadesHand, sameSpadesCard, scoreSpadesHand, SPADES_SEATS,
  spadesLegalCards, spadesNext, spadesSeatMap, spadesWinners } from '@shared/rules/spades';
import { createDeck, shuffleDeck } from '../../engine/deck';

const games = new Map<RoomCode, SpadesGameState>();

function deal(game: SpadesGameState, dealer: Seat, now: number, deck?: readonly Card[]): void {
  const cards = deck ?? shuffleDeck(createDeck());
  game.hands = spadesSeatMap((seat) => cards.slice(SPADES_SEATS.indexOf(seat) * 13, (SPADES_SEATS.indexOf(seat) + 1) * 13));
  game.position = newSpadesHand(dealer);
  game.phase = 'bidding';
  game.log.push({ type: 'deal', dealerSeat: dealer, timestamp: now });
}

export function startGame(roomCode: RoomCode, players: Partial<Record<GameSeat, PlayerInfo>>, deck?: readonly Card[],
  dealer: Seat = SPADES_SEATS[randomInt(4)], now: number = Date.now()): void {
  if (Object.keys(players).length !== 4 || !SPADES_SEATS.every((seat) => players[seat])) throw new Error('Spades requires four compass seats.');
  const game: SpadesGameState = {
    gameType: 'spades', id: randomUUID(), startedAt: now, roomCode, players: structuredClone(players) as Record<Seat, PlayerInfo>,
    phase: 'bidding', position: newSpadesHand(dealer), hands: spadesSeatMap(() => []),
    scores: { NS: 0, EW: 0 }, bags: { NS: 0, EW: 0 }, handResults: [], log: [], result: null,
  };
  deal(game, dealer, now, deck);
  games.set(roomCode, game);
}

export function act(roomCode: RoomCode, seat: GameSeat, action: SpadesAction, now: number = Date.now()): { success: true } | { success: false; reason: string } {
  const game = games.get(roomCode);
  if (!game || game.phase === 'scoring') return { success: false, reason: 'No active Spades game.' };
  if (!SPADES_SEATS.includes(seat as Seat)) return { success: false, reason: 'Invalid seat.' };
  const actor = seat as Seat;
  const next = applySpadesMove(game.position, actor, game.hands[actor], action);
  if (!next) return { success: false, reason: 'Not a legal action on your turn.' };
  const previous = game.position;
  game.position = next;
  game.log.push(action.type === 'bid' ? { type: 'bid', seat: actor, bid: action.bid, timestamp: now }
    : { type: 'play', seat: actor, card: action.card, timestamp: now });
  if (action.type === 'play') game.hands[actor] = game.hands[actor].filter((card) => !sameSpadesCard(card, action.card));
  game.phase = next.phase === 'bidding' ? 'bidding' : 'playing';
  if (next.tricks.length > previous.tricks.length) {
    const trick = next.tricks[next.tricks.length - 1];
    game.log.push({ type: 'trick_end', winnerSeat: trick.winner, cards: trick.plays.map((play) => play.card),
      cardSeats: trick.plays.map((play) => play.seat), timestamp: now });
  }
  if (next.phase !== 'complete') return { success: true };
  const result = scoreSpadesHand(next.bids as Record<Seat, number>, next.taken, game.bags);
  game.handResults.push(result);
  game.log.push({ type: 'hand_end', result, timestamp: now });
  game.scores = { NS: game.scores.NS + result.teams.NS.points, EW: game.scores.EW + result.teams.EW.points };
  game.bags = { NS: result.teams.NS.bags, EW: result.teams.EW.bags };
  const winners = spadesWinners(game.scores);
  if (winners.length > 0) {
    game.phase = 'scoring';
    game.result = { gameType: 'spades', scores: { ...game.scores }, bags: { ...game.bags }, hands: [...game.handResults], winners };
  } else deal(game, spadesNext(next.dealerSeat), now);
  return { success: true };
}

export function getPlayerVisibleState(roomCode: RoomCode, seat: GameSeat): SpadesVisibleState | null {
  const game = games.get(roomCode);
  if (!game || !SPADES_SEATS.includes(seat as Seat)) return null;
  const mySeat = seat as Seat;
  return { gameType: 'spades', phase: game.phase, mySeat, myHand: game.hands[mySeat],
    handCounts: spadesSeatMap((other) => game.hands[other].length), position: game.position,
    currentTurnSeat: game.position.currentTurnSeat, dealerSeat: game.position.dealerSeat,
    validCards: game.phase === 'playing' && game.position.currentTurnSeat === seat
      ? spadesLegalCards(game.hands[mySeat], game.position.trick, game.position.broken) : [],
    scores: game.scores, bags: game.bags, handResults: game.handResults, log: game.log, result: game.result };
}
export function getGameState(code: RoomCode): SpadesGameState | null { return games.get(code) ?? null; }
export function abortGame(code: RoomCode): void { games.delete(code); }
export function exportGames(): SpadesGameState[] { return [...games.values()]; }
export function restoreGames(records: SpadesGameState[]): void {
  games.clear();
  for (const game of records) games.set(game.roomCode, game);
}
