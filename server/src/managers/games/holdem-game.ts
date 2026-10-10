// ─── Texas Hold'em Game: no-limit hands with rising blinds ───

import { randomInt, randomUUID } from 'node:crypto';
import type {
  Card,
  HoldemAction,
  HoldemGameState,
  HoldemLogEntry,
  HoldemVisibleState,
  PlayerInfo,
  RoomCode,
  Seat,
} from '@shared/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import {
  HE_HOLE_CARDS,
  HE_STREET_CARDS,
  heApplyEntry,
  heAward,
  heBlinds,
  heBlindSeats,
  heEliminations,
  heEmptyTable,
  heFirstToAct,
  heInHand,
  heLegalActions,
  heMatchOver,
  heNextButton,
  heNextSeat,
  heNextToAct,
  heWinners,
} from '@shared/rules/holdem';
import { createDeck, shuffleDeck } from '../../engine/deck';

type Result = { success: true } | { success: false; reason: string };

/** Deals stay unpredictable from previously observed shuffles. */
const RANDOM_RANGE = 2 ** 32;
const secureRandom = (): number => randomInt(RANDOM_RANGE) / RANDOM_RANGE;

/** roomCode → HoldemGameState */
const games: Map<RoomCode, HoldemGameState> = new Map();

function seatMap<T>(value: (seat: Seat) => T): Record<Seat, T> {
  return { N: value('N'), E: value('E'), S: value('S'), W: value('W') };
}

function record(game: HoldemGameState, entry: HoldemLogEntry): void {
  game.log.push(entry);
  heApplyEntry(game, entry);
}

function draw(game: HoldemGameState): Card {
  const card = game.deck.shift();
  if (!card) throw new Error("Hold'em deck exhausted");
  return card;
}

/** Shuffles, deals two hole cards from the button's left, and posts the blinds. */
function startHand(game: HoldemGameState, button: Seat, now: number, random: () => number): void {
  game.deck = shuffleDeck(createDeck(), random);
  const hand = game.hand + 1;
  const { smallBlind, bigBlind } = heBlinds(hand);
  const dealt = SEAT_ORDER_CLOCKWISE.filter((seat) => game.chips[seat] > 0);
  const hands = seatMap((): Card[] => []);
  for (let round = 0; round < HE_HOLE_CARDS; round++) {
    let seat = heNextSeat(button, (candidate) => dealt.includes(candidate)) ?? button;
    for (let count = 0; count < dealt.length; count++) {
      hands[seat].push(draw(game));
      seat = heNextSeat(seat, (candidate) => dealt.includes(candidate)) ?? seat;
    }
  }
  game.hands = hands;
  const { small, big } = heBlindSeats(dealt, button);
  const blinds = seatMap(() => 0);
  blinds[small] = Math.min(smallBlind, game.chips[small]);
  blinds[big] = Math.min(bigBlind, game.chips[big]);
  record(game, { type: 'hand', hand, button, smallBlind, bigBlind, blinds, timestamp: now });
  progress(game, heFirstToAct(game), now, random);
}

/**
 * Gives the turn to `next`, or once betting closes deals the next street, shows down, awards the
 * pots, and starts the following hand or ends the match.
 */
function progress(game: HoldemGameState, next: Seat | null, now: number, random: () => number): void {
  let seat = next;
  while (!seat) {
    const inHand = heInHand(game);
    if (inHand.length > 1 && game.board.length < 5) {
      const street = game.board.length === 0 ? 'flop' : game.board.length === 3 ? 'turn' : 'river';
      const cards = Array.from({ length: HE_STREET_CARDS[street] }, () => draw(game));
      record(game, { type: 'street', street, cards, timestamp: now });
      seat = heFirstToAct(game);
      continue;
    }
    if (inHand.length > 1) {
      record(game, { type: 'showdown', cards: seatMap((other) => inHand.includes(other) ? [...game.hands[other]] : []),
        timestamp: now });
    }
    const { pots, payouts } = heAward(game);
    const chips = seatMap((other) => game.chips[other] + payouts[other]);
    record(game, { type: 'award', pots, chips: { ...chips }, eliminated: heEliminations(game, chips), timestamp: now });
    if (heMatchOver(game)) {
      game.phase = 'scoring';
      game.result = { gameType: 'holdem', chips: { ...game.chips }, hands: game.hand, winners: heWinners(game.chips),
        eliminationOrder: [...game.eliminated] };
      return;
    }
    startHand(game, heNextButton(game.button, game.chips), now, random);
    return;
  }
  game.currentTurnSeat = seat;
}

/** `random` is a test hook; games normally use a cryptographic source. */
export function startGame(
  roomCode: RoomCode,
  players: Record<Seat, PlayerInfo>,
  random: () => number = secureRandom,
  now: number = Date.now(),
): void {
  const game: HoldemGameState = {
    ...heEmptyTable(),
    gameType: 'holdem',
    id: randomUUID(),
    startedAt: now,
    players: structuredClone(players),
    roomCode,
    phase: 'playing',
    currentTurnSeat: 'N',
    deck: [],
    hands: seatMap(() => []),
    log: [],
    result: null,
  };
  const button = SEAT_ORDER_CLOCKWISE[Math.floor(random() * SEAT_ORDER_CLOCKWISE.length)];
  startHand(game, button, now, random);
  games.set(roomCode, game);
}

export function act(
  roomCode: RoomCode,
  seat: Seat,
  action: HoldemAction,
  now: number = Date.now(),
  random: () => number = secureRandom,
): Result {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase !== 'playing') return { success: false, reason: 'Not in playing phase' };
  if (game.currentTurnSeat !== seat) return { success: false, reason: 'Not your turn' };
  const legal = heLegalActions(game, seat);
  if (!legal) return { success: false, reason: 'Not your turn' };
  const stake = game.streetBets[seat];
  const chips = game.chips[seat];
  let entry: HoldemLogEntry;
  if (action.type === 'fold') {
    entry = { type: 'action', seat, action: 'fold', to: stake, allIn: false, timestamp: now };
  } else if (action.type === 'check') {
    if (!legal.check) return { success: false, reason: 'You cannot check facing a bet' };
    entry = { type: 'action', seat, action: 'check', to: stake, allIn: false, timestamp: now };
  } else if (action.type === 'call') {
    if (legal.call === 0) return { success: false, reason: 'There is nothing to call' };
    entry = { type: 'action', seat, action: 'call', to: stake + legal.call, allIn: legal.call === chips, timestamp: now };
  } else {
    const bounds = legal.raise;
    if (!bounds) return { success: false, reason: 'You cannot raise now' };
    if (!Number.isSafeInteger(action.to) || action.to < bounds.min || action.to > bounds.max) {
      return { success: false, reason: 'Invalid raise amount' };
    }
    entry = { type: 'action', seat, action: game.currentBet === 0 ? 'bet' : 'raise', to: action.to,
      allIn: action.to === bounds.max, timestamp: now };
  }
  record(game, entry);
  progress(game, heNextToAct(game, seat), now, random);
  return { success: true };
}

export function abortGame(roomCode: RoomCode): void {
  games.delete(roomCode);
}

/** Only the seat's own hole cards; others appear only when a showdown reveals them. */
export function getPlayerVisibleState(roomCode: RoomCode, seat: Seat): HoldemVisibleState | null {
  const game = games.get(roomCode);
  if (!game) return null;
  return {
    gameType: 'holdem',
    phase: game.phase,
    mySeat: seat,
    myHand: game.hands[seat],
    hand: game.hand,
    button: game.button,
    smallBlind: game.smallBlind,
    bigBlind: game.bigBlind,
    chips: game.chips,
    streetBets: game.streetBets,
    totalBets: game.totalBets,
    dealt: game.dealt,
    folded: game.folded,
    street: game.street,
    board: game.board,
    currentBet: game.currentBet,
    minRaise: game.minRaise,
    acted: game.acted,
    revealed: game.revealed,
    eliminated: game.eliminated,
    currentTurnSeat: game.currentTurnSeat,
    log: game.log,
    result: game.result,
  };
}

export function getGameState(roomCode: RoomCode): HoldemGameState | null {
  return games.get(roomCode) ?? null;
}

export function exportGames(): HoldemGameState[] {
  return [...games.values()];
}

export function restoreGames(records: HoldemGameState[]): void {
  games.clear();
  for (const game of records) games.set(game.roomCode, game);
}
