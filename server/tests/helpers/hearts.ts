import type { Card, PlayerInfo, Seat } from '@shared/types';
import type { HeartsAction, HeartsGameState, HeartsVisibleState } from '@shared/games/hearts/types';
import { HEARTS_SEATS } from '@shared/rules/hearts';
import { createDeck, shuffleDeck } from '../../src/engine/deck';
import type { BotAction } from '../../src/bots/bot-decisions';
export const HEARTS_PLAYERS = Object.fromEntries(HEARTS_SEATS.map((seat) => [seat, {
  id: seat, username: seat, nickname: seat, avatar: 'cat', avatarImage: null, color: '#123456',
}])) as Record<Seat, PlayerInfo>;
export function heartsRandom(seed: number): () => number {
  let state = seed;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
}
export function heartsShuffle(random: () => number): Card[] { return shuffleDeck(createDeck(), random); }
export function heartsAction(action: BotAction | null): HeartsAction {
  if (action?.type !== 'game-action' || action.request.gameType !== 'hearts') throw new Error('Expected a Hearts action.');
  return action.request.action;
}
export function heartsActor(game: HeartsGameState): Seat {
  const seat = game.currentTurnSeat ?? HEARTS_SEATS.find((member) => !game.deals[game.hand - 1].passes[member]);
  if (!seat) throw new Error('No Hearts decision is pending.');
  return seat;
}
export function heartsView(hand: readonly Card[], overrides: Partial<HeartsVisibleState> = {}): HeartsVisibleState {
  return { gameType: 'hearts', phase: 'playing', mySeat: 'N', myHand: hand,
    handCounts: { N: hand.length, E: 13, S: 13, W: 13 }, hand: 1, passDirection: 'left',
    passedSeats: [], myPass: [], passDeadline: null, heartsBroken: false, currentTurnSeat: 'N',
    trick: { leadSeat: 'N', plays: [] }, tricks: [], scores: { N: 0, E: 0, S: 0, W: 0 },
    validCards: hand, log: [], result: null, ...overrides };
}
