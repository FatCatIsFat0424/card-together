// ─── Bridge Game: flow management ───

import { randomInt, randomUUID } from 'node:crypto';
import type {
  RoomCode,
  Seat,
  Card,
  BidAction,
  Contract,
  BridgeGameState,
  GameLogEntry,
  BridgeVisibleState,
  PlayerInfo,
} from '@shared/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { createDeck, shuffleDeck } from '../../engine/deck';
import { dealCards, sortHand, findRedealEligibleSeat, isRedealEligible as isRedealEligibleCheck } from '../../engine/dealing';
import {
  createBiddingState,
  validateBid,
  applyBid,
  checkBiddingEnd,
  getNextSeat,
} from '../../engine/bidding';
import {
  createPlayingState,
  validatePlay,
  applyPlay,
  determineTrickWinner,
  completeTrick,
  isPlayingComplete,
  removeCardFromHand,
  getValidPlays,
} from '../../engine/playing';
import { calculateGameResult } from '../../engine/scoring';

// ─── Module-private state ───

/** roomCode → BridgeGameState */
const games: Map<RoomCode, BridgeGameState> = new Map();

// ─── Exported functions ───

/** `deck` and `dealerSeat` are test hooks; games normally deal a fresh shuffle. */
export function startGame(
  roomCode: RoomCode,
  players: Record<Seat, PlayerInfo>,
  deck: readonly Card[] = shuffleDeck(createDeck()),
  dealerSeat: Seat = SEAT_ORDER_CLOCKWISE[randomInt(4)],
): void {
  const rawHands = dealCards(deck);

  // Sort hands
  const hands: Record<Seat, Card[]> = {
    N: sortHand(rawHands.N),
    E: sortHand(rawHands.E),
    S: sortHand(rawHands.S),
    W: sortHand(rawHands.W),
  };

  const gameState: BridgeGameState = {
    gameType: 'bridge',
    id: randomUUID(),
    startedAt: Date.now(),
    players: structuredClone(players),
    roomCode,
    phase: 'dealing',
    hands,
    dealerSeat,
    bidding: null,
    contract: null,
    playing: null,
    result: null,
    log: [],
    redealPendingSeat: null,
    redealDeclinedSeats: [],
  };

  games.set(roomCode, gameState);

  // Check for a redeal
  const biddingStartSeat = getNextSeat(dealerSeat);
  const redealSeat = findRedealEligibleSeat(hands, biddingStartSeat);

  if (redealSeat) {
    gameState.phase = 'redeal_pending';
    gameState.redealPendingSeat = redealSeat;
  } else {
    startBidding(roomCode, biddingStartSeat);
  }
}

/**
 * Handle a redeal response
 */
export function handleRedealResponse(
  roomCode: RoomCode,
  seat: Seat,
  accept: boolean,
): { success: true } | { success: false; reason: string } {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase !== 'redeal_pending') return { success: false, reason: 'Not in redeal phase' };
  if (game.redealPendingSeat !== seat) return { success: false, reason: 'Not your turn to respond' };

  addLog(game, { type: 'redeal', seat, accepted: accept, timestamp: Date.now() });

  if (accept) {
    game.redealDeclinedSeats = [];
    // Reshuffle
    const deck = shuffleDeck(createDeck());
    const rawHands = dealCards(deck);
    game.hands = {
      N: sortHand(rawHands.N),
      E: sortHand(rawHands.E),
      S: sortHand(rawHands.S),
      W: sortHand(rawHands.W),
    };

    // Check for a redeal again
    const biddingStartSeat = getNextSeat(game.dealerSeat);
    const nextRedealSeat = findRedealEligibleSeat(game.hands, biddingStartSeat);

    if (nextRedealSeat) {
      game.redealPendingSeat = nextRedealSeat;
    } else {
      startBidding(roomCode, biddingStartSeat);
    }
  } else {
    game.redealDeclinedSeats.push(seat);
    // Declined: check the next player
    const biddingStartSeat = getNextSeat(game.dealerSeat);
    const nextSeat = getNextSeat(seat);

    // Continue searching from the next seat
    let foundNext = false;
    const startIdx = SEAT_ORDER_CLOCKWISE.indexOf(nextSeat);

    for (let i = 0; i < 4; i++) {
      const checkSeat = SEAT_ORDER_CLOCKWISE[(startIdx + i) % 4];
      // Skip seats already checked
      if (game.redealDeclinedSeats.includes(checkSeat)) continue;

      const hand = game.hands[checkSeat];
      if (isRedealEligibleCheck(hand)) {
        game.redealPendingSeat = checkSeat;
        foundNext = true;
        break;
      }
    }

    if (!foundNext) {
      startBidding(roomCode, biddingStartSeat);
    }
  }

  return { success: true };
}

/**
 * Handle a bid
 */
export function handleBid(
  roomCode: RoomCode,
  seat: Seat,
  action: BidAction,
): { success: true } | { success: false; reason: string } {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase !== 'bidding') return { success: false, reason: 'Not in bidding phase' };
  if (!game.bidding) return { success: false, reason: 'Bidding state not initialized' };

  const validation = validateBid(game.bidding, seat, action);
  if (!validation.valid) return { success: false, reason: validation.reason };

  game.bidding = applyBid(game.bidding, seat, action);
  addLog(game, { type: 'bid', seat, action, timestamp: Date.now() });

  // Check whether bidding ended
  const endResult = checkBiddingEnd(game.bidding);

  if (endResult === 'all_pass') {
    // All pass in the first round: redeal
    addLog(game, { type: 'system', message: 'All pass - redealing', timestamp: Date.now() });
    restartDeal(roomCode);
  } else if (endResult === 'contract') {
    // Contract set
    const highest = game.bidding.highestBid!;
    const contract: Contract = {
      level: highest.level,
      suit: highest.suit,
      declarer: highest.seat,
    };
    game.contract = contract;
    startPlaying(roomCode, contract);
  }

  return { success: true };
}

/**
 * Handle a card play
 */
export function handlePlayCard(
  roomCode: RoomCode,
  seat: Seat,
  card: Card,
): { success: true } | { success: false; reason: string } {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase !== 'playing') return { success: false, reason: 'Not in playing phase' };
  if (!game.playing || !game.contract) return { success: false, reason: 'Playing state not initialized' };

  const hand = game.hands[seat];
  const validation = validatePlay(hand, game.playing, seat, card);
  if (!validation.valid) return { success: false, reason: validation.reason };

  // Remove the card from hand
  game.hands[seat] = removeCardFromHand(hand, card);

  // Apply the play
  game.playing = applyPlay(game.playing, seat, card);
  addLog(game, { type: 'play', seat, card, timestamp: Date.now() });

  // Check whether the trick is complete (4 cards)
  if (Object.keys(game.playing.currentTrick).length === 4) {
    const trick = game.playing.currentTrick as Record<Seat, Card>;
    const winner = determineTrickWinner(trick, game.playing.trickLeadSeat, game.contract.suit);
    game.playing = completeTrick(game.playing, winner, trick, game.playing.trickLeadSeat);

    const trickIdx = game.playing.completedTricks.length;
    addLog(game, { type: 'trick_end', winnerSeat: winner, trickIndex: trickIdx, timestamp: Date.now() });

    // Check whether the game is over
    if (isPlayingComplete(game.playing)) {
      game.phase = 'scoring';
      game.result = calculateGameResult(
        game.contract,
        game.playing.trickCountEW,
        game.playing.trickCountNS,
      );
    }
  }

  return { success: true };
}

/**
 * Abort the game
 */
export function abortGame(roomCode: RoomCode): void {
  games.delete(roomCode);
}

/**
 * Get the state visible to one player
 */
export function getPlayerVisibleState(
  roomCode: RoomCode,
  seat: Seat,
): BridgeVisibleState | null {
  const game = games.get(roomCode);
  if (!game) return null;

  return {
    gameType: 'bridge',
    validCards: game.playing && game.phase === 'playing' && game.playing.currentTurnSeat === seat
      ? getValidPlays(game.hands[seat], game.playing) : [],
    phase: game.phase,
    myHand: game.hands[seat],
    mySeat: seat,
    dealerSeat: game.dealerSeat,
    bidding: game.bidding,
    contract: game.contract,
    playing: game.playing,
    result: game.result,
    log: game.log,
    redealPendingSeat: game.redealPendingSeat,
  };
}

/**
 * Get the internal game state
 */
export function getGameState(roomCode: RoomCode): BridgeGameState | null {
  return games.get(roomCode) ?? null;
}

export function exportGames(): BridgeGameState[] {
  return [...games.values()];
}

export function restoreGames(records: BridgeGameState[]): void {
  games.clear();
  for (const game of records) games.set(game.roomCode, game);
}

// ─── Internal helpers ───

function addLog(game: BridgeGameState, entry: GameLogEntry): void {
  game.log.push(entry);
}

function startBidding(roomCode: RoomCode, startSeat: Seat): void {
  const game = games.get(roomCode);
  if (!game) return;

  game.phase = 'bidding';
  game.bidding = createBiddingState(startSeat);
  game.redealPendingSeat = null;

  addLog(game, { type: 'system', message: `Bidding starts from ${startSeat}`, timestamp: Date.now() });
}

function startPlaying(roomCode: RoomCode, contract: Contract): void {
  const game = games.get(roomCode);
  if (!game) return;

  // The player counterclockwise of the declarer leads
  const declarerIdx = SEAT_ORDER_CLOCKWISE.indexOf(contract.declarer);
  const leadSeat = SEAT_ORDER_CLOCKWISE[(declarerIdx + 3) % 4]; // counterclockwise = index - 1 = (index + 3) % 4

  game.phase = 'playing';
  game.playing = createPlayingState(leadSeat);

  addLog(game, { type: 'system', message: `Playing starts. Lead: ${leadSeat}. Contract: ${contract.level}${contract.suit} by ${contract.declarer}`, timestamp: Date.now() });
}

function restartDeal(roomCode: RoomCode): void {
  const game = games.get(roomCode);
  if (!game) return;
  game.redealDeclinedSeats = [];

  const deck = shuffleDeck(createDeck());
  const rawHands = dealCards(deck);
  game.hands = {
    N: sortHand(rawHands.N),
    E: sortHand(rawHands.E),
    S: sortHand(rawHands.S),
    W: sortHand(rawHands.W),
  };
  game.bidding = null;

  const biddingStartSeat = getNextSeat(game.dealerSeat);
  const redealSeat = findRedealEligibleSeat(game.hands, biddingStartSeat);

  if (redealSeat) {
    game.phase = 'redeal_pending';
    game.redealPendingSeat = redealSeat;
  } else {
    startBidding(roomCode, biddingStartSeat);
  }
}
