import { GAME_SEAT_ORDER, SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { frameLogIndex } from '@shared/game-presentation';
import type { PresentationFrame } from '@shared/game-presentation';
import {
  BJ_BET_STEP, BJ_MIN_BET, BJ_STARTING_CHIPS, bjDealerActions, bjLegalActions, bjMaxBet, bjNextTurn, bjPayout, bjReplay,
  bjSitsIn,
} from '@shared/rules/blackjack';
import type {
  BlackjackAction, BlackjackDealerAction, BlackjackHand, BlackjackLogEntry, BlackjackMatchResult, BlackjackOutcome,
  BlackjackVisibleState, Card, GameSeat,
} from '@shared/types';
import { isOwnTurn } from '../observer-view';

export const BJ_SEATS: readonly GameSeat[] = GAME_SEAT_ORDER;
/** Quick-pick chip values in the betting controls */
export const BJ_CHIP_VALUES: readonly number[] = [10, 20, 50, 100, 200];

export interface BlackjackSettlementView {
  readonly outcomes: Record<GameSeat, readonly BlackjackOutcome[]>;
  readonly net: Record<GameSeat, number>;
}

/** Public table state as the presentation currently shows it. */
export interface BlackjackTableView {
  /** Hands dealt so far */
  readonly hand: number;
  /** Chips not staked on the table */
  readonly chips: Record<GameSeat, number>;
  readonly hands: Record<GameSeat, readonly BlackjackHand[]>;
  /** Face-up dealer cards */
  readonly dealer: readonly Card[];
  readonly holeHidden: boolean;
  /** Outcomes of the shown hand once its settlement has been reached */
  readonly settlement: BlackjackSettlementView | null;
  /** The hand to act, while hands are being played */
  readonly turn: { readonly seat: GameSeat; readonly handIndex: number } | null;
  /** The player dealer of the shown hand; null with the house */
  readonly dealerSeat: GameSeat | null;
  /** The player dealer of the hand in progress or, while betting, of the next one */
  readonly currentDealer: GameSeat | null;
  /** A player dealer is playing its own hand */
  readonly dealerTurn: boolean;
  /** Seats are betting on the next hand right now */
  readonly betting: boolean;
  /** Log entries already shown */
  readonly logEnd: number;
}

/** Hole-card and settlement status after the first `end` entries; both reset on each deal. */
function scanHand(log: readonly BlackjackLogEntry[], end: number): {
  holeHidden: boolean; settlement: BlackjackSettlementView | null;
} {
  let holeHidden = false;
  let settlement: BlackjackSettlementView | null = null;
  for (const entry of log.slice(0, end)) {
    if (entry.type === 'deal') {
      holeHidden = true;
      settlement = null;
    } else if (entry.type === 'reveal') {
      holeHidden = false;
    } else if (entry.type === 'settle') {
      settlement = { outcomes: entry.outcomes, net: entry.net };
    }
  }
  return { holeHidden, settlement };
}

function lastDealer(log: readonly BlackjackLogEntry[]): GameSeat | null {
  const deal = log.findLast((entry) => entry.type === 'deal');
  return deal?.type === 'deal' ? deal.dealer ?? null : null;
}

/** The table of a match between `seats` replayed from the public log before `end`. */
export function replayBlackjack(
  log: readonly BlackjackLogEntry[], seats: readonly GameSeat[], end: number,
): BlackjackTableView {
  const table = bjReplay(log, seats, end);
  const { holeHidden, settlement } = scanHand(log, end);
  return {
    hand: table.hand,
    chips: table.chips,
    hands: table.hands,
    dealer: table.dealer,
    holeHidden,
    settlement,
    turn: holeHidden && !settlement ? bjNextTurn(table.hands) : null,
    dealerSeat: table.dealerSeat ?? null,
    currentDealer: table.dealerSeat ?? null,
    dealerTurn: Boolean(table.dealerSeat) && table.hand > 0 && !holeHidden && !settlement,
    betting: false,
    logEnd: Math.min(end, log.length),
  };
}

/**
 * While a frame is presented the table is rebuilt up to that frame's entry, so the next deal,
 * the hole card, and settlement outcomes never appear before their own frames.
 */
export function blackjackView(game: BlackjackVisibleState, frame: PresentationFrame | null): BlackjackTableView {
  const index = frame ? frameLogIndex(frame) : null;
  if (index !== null) return replayBlackjack(game.log, game.seats, index + 1);
  return {
    hand: game.hand,
    chips: game.chips,
    hands: game.hands,
    dealer: game.dealer,
    holeHidden: game.holeHidden,
    settlement: scanHand(game.log, game.log.length).settlement,
    turn: game.phase === 'playing' ? { seat: game.currentTurnSeat, handIndex: game.activeHand } : null,
    // While betting, the cards on the table still belong to the hand the previous dealer dealt.
    dealerSeat: game.phase === 'betting' ? lastDealer(game.log) : game.dealerSeat,
    currentDealer: game.dealerSeat,
    dealerTurn: game.phase === 'playing' && !game.holeHidden,
    betting: game.phase === 'betting',
    logEnd: game.log.length,
  };
}

/** Hand number shown to players: betting is already for the next hand. */
export function blackjackHandNumber(view: BlackjackTableView): number {
  return view.betting ? view.hand + 1 : view.hand;
}

/** A seat that cannot bet while betting, or holds no cards in the shown hand; a player dealer never is. */
export function blackjackSeatOut(view: BlackjackTableView, seat: GameSeat): boolean {
  if (seat === view.currentDealer) return false;
  if (view.betting) return !bjSitsIn(view.chips[seat]);
  return view.hand > 0 && view.hands[seat].length === 0;
}

/** Actions the local player may take now; empty unless it is their turn and the table is ready. */
export function blackjackActions(game: BlackjackVisibleState, ready: boolean): BlackjackAction[] {
  if (!ready || game.phase !== 'playing' || !isOwnTurn(game)) return [];
  return bjLegalActions(game.hands[game.mySeat], game.activeHand, game.chips[game.mySeat]);
}

/** Dealer buttons for the local player dealer; empty unless its own turn has come and the table is ready. */
export function blackjackDealerActions(game: BlackjackVisibleState, ready: boolean): BlackjackDealerAction[] {
  if (!ready || game.phase !== 'playing' || game.holeHidden || game.dealerSeat !== game.mySeat
    || !isOwnTurn(game)) return [];
  return bjDealerActions(game.dealer);
}

/** The seat may still place a bet in the open betting window; a player dealer never bets. */
export function blackjackNeedsBet(game: BlackjackVisibleState): boolean {
  return game.phase === 'betting' && game.observer !== 'spectator' && game.betDeadline !== null
    && game.dealerSeat !== game.mySeat && bjSitsIn(game.chips[game.mySeat])
    && !game.betPlaced[game.mySeat] && game.myBet === null;
}

/** Nearest legal bet: a multiple of the step between the minimum and what the chips cover. */
export function clampBet(amount: number, chips: number): number {
  const max = Math.max(BJ_MIN_BET, bjMaxBet(chips));
  const stepped = Math.round(amount / BJ_BET_STEP) * BJ_BET_STEP;
  return Math.min(max, Math.max(BJ_MIN_BET, stepped));
}

export function stepBet(amount: number, steps: number, chips: number): number {
  return clampBet(amount + steps * BJ_BET_STEP, chips);
}

export interface BetChip { readonly amount: number; readonly enabled: boolean }

export function betChips(chips: number): BetChip[] {
  const max = bjMaxBet(chips);
  return BJ_CHIP_VALUES.map((amount) => ({ amount, enabled: amount >= BJ_MIN_BET && amount <= max }));
}

/** Chips won minus the hand's stake. */
export function handNet(hand: Pick<BlackjackHand, 'bet'>, outcome: BlackjackOutcome): number {
  return bjPayout(hand.bet, outcome) - hand.bet;
}

export function signedChips(value: number): string {
  return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '±0';
}

/** Seats whose bet on the latest hand dealt before `end` was placed automatically at the deadline. */
export function autoBetSeats(log: readonly BlackjackLogEntry[], end: number): GameSeat[] {
  let pending: GameSeat[] = [];
  let dealt: GameSeat[] = [];
  for (const entry of log.slice(0, end)) {
    if (entry.type === 'bet' && entry.auto) pending.push(entry.seat);
    else if (entry.type === 'deal') {
      dealt = pending;
      pending = [];
    }
  }
  return dealt;
}

/** Newest first, limited to `limit` entries. */
export function recentBlackjackMoves(log: readonly BlackjackLogEntry[], limit: number): BlackjackLogEntry[] {
  return limit > 0 ? log.slice(-limit).reverse() : [];
}

export interface BlackjackRanking {
  readonly seat: GameSeat;
  readonly place: number;
  readonly chips: number;
  readonly net: number;
  readonly winner: boolean;
}

/** Final standings of the seats that took part by chips; tied seats share a place. */
export function rankBlackjack(result: BlackjackMatchResult): BlackjackRanking[] {
  const sorted = [...result.seats ?? SEAT_ORDER_CLOCKWISE].sort((a, b) => result.chips[b] - result.chips[a]);
  return sorted.map((seat) => ({
    seat,
    place: sorted.findIndex((other) => result.chips[other] === result.chips[seat]) + 1,
    chips: result.chips[seat],
    net: result.chips[seat] - BJ_STARTING_CHIPS,
    winner: result.winners.includes(seat),
  }));
}
