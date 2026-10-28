import type { GameSeat, PlayerInfo, RoomSeatTarget, Seat, SeatInfo } from '@shared/types';

/** One seat of the waiting-room oval. */
export interface RoomSeatCard {
  /** `data-room-drop` key: a compass seat or `additional-n`. */
  readonly key: string;
  readonly label: string;
  readonly info: SeatInfo;
  readonly seat?: Seat;
  readonly additionalIndex?: number;
  /** Seat a bot is added to or managed in. */
  readonly gameSeat: GameSeat;
}

/** Where a dragged member comes from: a seat card or the spectator list. */
export type DragSource = 'seat' | 'spectator';

export type DropAction = 'move' | 'swap' | 'sit' | 'spectate';

export interface DropOutcome {
  /** `origin` is the place the member already holds; releasing there cancels. */
  readonly state: 'origin' | 'available' | 'unavailable';
  readonly action?: DropAction;
  /** The server turns spectators away from bot seats, so the UI says so before the drop. */
  readonly reason?: 'bot';
}

const ORIGIN: DropOutcome = { state: 'origin' };

/** What dropping a member on a seat does. Mirrors the server: only a seated member may replace a bot. */
export function seatDropOutcome(source: DragSource, occupant: PlayerInfo | null, origin: boolean): DropOutcome {
  if (origin) return ORIGIN;
  if (!occupant) return { state: 'available', action: source === 'seat' ? 'move' : 'sit' };
  if (occupant.isBot && source === 'spectator') return { state: 'unavailable', reason: 'bot' };
  return { state: 'available', action: 'swap' };
}

/** Only seated members have somewhere to step aside to. */
export function spectatorDropOutcome(source: DragSource): DropOutcome {
  return source === 'seat' ? { state: 'available', action: 'spectate' } : ORIGIN;
}

export function seatCardTarget(card: RoomSeatCard): RoomSeatTarget {
  if (card.seat) return { type: 'seat', seat: card.seat };
  return { type: 'additional', index: card.additionalIndex ?? 0 };
}

export interface MoveOption {
  readonly key: string;
  readonly target: RoomSeatTarget;
  /** Seat name; absent for the spectator area. */
  readonly label: string | null;
  readonly occupant: PlayerInfo | null;
  readonly outcome: DropOutcome;
  readonly disabled: boolean;
}

/** The "move to..." list: every seat and the spectator area, except where the member already is. */
export function moveOptions(
  cards: readonly RoomSeatCard[], spectators: readonly PlayerInfo[], member: PlayerInfo, spectatorLimit: number,
): MoveOption[] {
  const source: DragSource = spectators.some((entry) => entry.id === member.id) ? 'spectator' : 'seat';
  const options: MoveOption[] = cards.flatMap((card) => {
    const occupant = card.info.player;
    const outcome = seatDropOutcome(source, occupant, occupant?.id === member.id);
    return outcome.state === 'origin' ? []
      : [{ key: card.key, target: seatCardTarget(card), label: card.label, occupant, outcome,
        disabled: outcome.state === 'unavailable' }];
  });
  const spectate = spectatorDropOutcome(source);
  if (spectate.state === 'available') {
    options.push({ key: 'spectator', target: { type: 'spectator' }, label: null, occupant: null, outcome: spectate,
      disabled: spectators.length >= spectatorLimit });
  }
  return options;
}
