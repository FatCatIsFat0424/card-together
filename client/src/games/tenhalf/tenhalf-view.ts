import { GAME_SEAT_ORDER } from '@shared/constants';
import { frameLogIndex } from '@shared/game-presentation';
import type { PresentationFrame } from '@shared/game-presentation';
import { bjSitsIn } from '@shared/rules/blackjack';
import { thNextTurn, thReplay } from '@shared/rules/tenhalf';
import type {
  Card, GameSeat, TenHalfLogEntry, TenHalfOutcome, TenHalfVisibleState,
} from '@shared/types';
import { createLogViewCache } from '../log-view-cache';
import { isOwnTurn } from '../observer-view';

export interface TenHalfSettlementView {
  readonly outcomes: Record<GameSeat, TenHalfOutcome | null>;
  readonly net: Record<GameSeat, number>;
}

/** Public table state as the presentation currently shows it. */
export interface TenHalfTableView {
  /** Hands dealt so far */
  readonly hand: number;
  /** Chips not staked on the table */
  readonly chips: Record<GameSeat, number>;
  /** Stakes on the shown hand */
  readonly bets: Record<GameSeat, number>;
  /** Banker of the shown hand; null before the first deal */
  readonly banker: GameSeat | null;
  /** Banker of the hand in progress or, while betting, of the next one */
  readonly currentBanker: GameSeat | null;
  readonly dealt: readonly GameSeat[];
  readonly ups: Record<GameSeat, readonly Card[]>;
  readonly done: Record<GameSeat, boolean>;
  /** Hole cards the showdown has revealed */
  readonly holes: Record<GameSeat, Card | null>;
  readonly revealed: boolean;
  readonly settlement: TenHalfSettlementView | null;
  /** The seat to act while a hand is played */
  readonly turn: GameSeat | null;
  /** Seats are betting on the next hand right now */
  readonly betting: boolean;
  /** Log entries already shown */
  readonly logEnd: number;
}

/** Whether the showdown and settlement of the latest deal lie within the first `end` entries. */
function scanHand(log: readonly TenHalfLogEntry[], end: number): { revealed: boolean; settlement: TenHalfSettlementView | null } {
  let revealed = false;
  let settlement: TenHalfSettlementView | null = null;
  for (const entry of log.slice(0, end)) {
    if (entry.type === 'deal') {
      revealed = false;
      settlement = null;
    } else if (entry.type === 'showdown') {
      revealed = true;
    } else if (entry.type === 'settle') {
      settlement = { outcomes: entry.outcomes, net: entry.net };
    }
  }
  return { revealed, settlement };
}

function lastBanker(log: readonly TenHalfLogEntry[]): GameSeat | null {
  const deal = log.findLast((entry) => entry.type === 'deal');
  return deal?.type === 'deal' ? deal.banker : null;
}

const replays = createLogViewCache<readonly TenHalfLogEntry[], TenHalfTableView>();
const views = createLogViewCache<TenHalfVisibleState, TenHalfTableView>();

/** The table of a match between `seats` replayed from the public log before `end`. */
export function replayTenHalf(log: readonly TenHalfLogEntry[], seats: readonly GameSeat[], end: number): TenHalfTableView {
  return replays.get(log, `${seats.join('')}:${end}`, () => buildReplay(log, seats, end));
}

function buildReplay(log: readonly TenHalfLogEntry[], seats: readonly GameSeat[], end: number): TenHalfTableView {
  const table = thReplay(log, seats, end);
  const { revealed, settlement } = scanHand(log, end);
  const inHand = table.hand > 0 && !revealed;
  return {
    hand: table.hand,
    chips: table.chips,
    bets: table.bets,
    banker: table.banker ?? null,
    currentBanker: table.banker ?? null,
    dealt: table.dealt,
    ups: table.ups,
    done: table.done,
    holes: table.holes,
    revealed,
    settlement,
    turn: inHand ? thNextTurn(table) : null,
    betting: false,
    logEnd: Math.min(end, log.length),
  };
}

/**
 * While a frame is presented the table is rebuilt up to that frame's entry, so the next deal, the
 * revealed hole cards, and settlement outcomes never appear before their own frames.
 */
export function tenHalfView(game: TenHalfVisibleState, frame: PresentationFrame | null): TenHalfTableView {
  const index = frame ? frameLogIndex(frame) : null;
  if (index !== null) return replayTenHalf(game.log, game.seats, index + 1);
  return views.get(game, 'live', () => {
    const { revealed, settlement } = scanHand(game.log, game.log.length);
    return {
      hand: game.hand,
      chips: game.chips,
      bets: game.bets,
      // While betting, the cards on the table still belong to the hand the previous banker dealt.
      banker: game.phase === 'betting' ? lastBanker(game.log) : game.banker,
      currentBanker: game.banker,
      dealt: game.dealt,
      ups: game.ups,
      done: game.done,
      holes: revealed ? game.holes : Object.fromEntries(GAME_SEAT_ORDER.map((seat) => [seat, null])) as Record<GameSeat, Card | null>,
      revealed,
      settlement,
      turn: game.phase === 'playing' ? game.currentTurnSeat : null,
      betting: game.phase === 'betting',
      logEnd: game.log.length,
    };
  });
}

/** The hole card a seat shows at this point: revealed at the showdown, otherwise only the viewer's own. */
export function holeOf(
  view: TenHalfTableView, game: TenHalfVisibleState, seat: GameSeat, observed?: Partial<Record<GameSeat, readonly Card[]>> | null,
): { readonly card: Card | null; readonly hidden: boolean } {
  if (!view.dealt.includes(seat)) return { card: null, hidden: false };
  const shown = view.holes[seat];
  if (shown) return { card: shown, hidden: false };
  if (view.revealed) return { card: null, hidden: false };
  // Only the viewer's own face-down card, or god view's, is known before the showdown.
  const known = seat === game.mySeat && game.observer !== 'spectator' ? game.holes[seat] : observed?.[seat]?.[0] ?? null;
  return { card: known, hidden: true };
}

/** A seat that cannot bet while betting, or holds no cards in the shown hand; a banker never is. */
export function tenHalfSeatOut(view: TenHalfTableView, seat: GameSeat): boolean {
  if (seat === view.currentBanker) return false;
  if (view.betting) return !bjSitsIn(view.chips[seat]);
  return view.hand > 0 && !view.dealt.includes(seat);
}

/** Hand number shown to players: betting is already for the next hand. */
export function tenHalfHandNumber(view: TenHalfTableView): number {
  return view.betting ? view.hand + 1 : view.hand;
}

/** Actions the local player may take now; empty unless it is their turn and the table is ready. */
export function tenHalfCanAct(game: TenHalfVisibleState, ready: boolean): boolean {
  return ready && game.phase === 'playing' && isOwnTurn(game) && !game.done[game.mySeat]
    && game.holes[game.mySeat] !== null;
}

/** The seat may still place a bet in the open betting window; the banker never bets. */
export function tenHalfNeedsBet(game: TenHalfVisibleState): boolean {
  return game.phase === 'betting' && game.observer !== 'spectator' && game.betDeadline !== null
    && game.banker !== game.mySeat && bjSitsIn(game.chips[game.mySeat])
    && !game.betPlaced[game.mySeat] && game.myBet === null;
}

/** Seats whose bet on the latest hand dealt before `end` was placed automatically at the deadline. */
export function autoBetSeats(log: readonly TenHalfLogEntry[], end: number): GameSeat[] {
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
export function recentTenHalfMoves(log: readonly TenHalfLogEntry[], limit: number): TenHalfLogEntry[] {
  return limit > 0 ? log.slice(-limit).reverse() : [];
}
