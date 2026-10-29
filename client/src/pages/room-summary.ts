import { isSeatReady, playerCountAllowed, roomCanStart } from '@shared/rules/seats';
import type { RoomInfo, TimeControl } from '@shared/types';
import type { GameRulesContext } from '../game-rules-context';
import type { TranslationKey } from '../i18n';
import type { RoomSummaryDot } from '../components/RoomSummaryCard';
import type { RoomSeatCard } from './room-moves';

export type RoomSummaryStage = 'missing' | 'waiting' | 'ready';

export interface RoomSummaryStatus {
  readonly stage: RoomSummaryStage;
  /** Seats still to fill (`missing`) or humans still to ready up (`waiting`). */
  readonly count: number;
  readonly seated: number;
  readonly tagKey: TranslationKey;
  readonly hintKey: TranslationKey;
}

export interface RoomSummaryViewer {
  readonly isHost: boolean;
  /** Ready flag of the viewer's own seat, or null when the viewer holds no seat. */
  readonly seatReady: boolean | null;
}

/** What the waiting-room summary tells the viewer to do next, derived from the seats and the start rule. */
export function roomSummaryStatus(
  room: RoomInfo, seatCards: readonly RoomSeatCard[], viewer: RoomSummaryViewer,
): RoomSummaryStatus {
  const occupied = seatCards.filter((card) => card.info.player);
  const seated = occupied.length;
  const unready = occupied.filter((card) => !isSeatReady(room, card.info)).length;
  const { isHost } = viewer;
  const missing = (count: number): RoomSummaryStatus => ({
    stage: 'missing', count, seated, tagKey: 'room.summaryMissing',
    hintKey: isHost ? 'room.summaryHintInvite' : 'room.summaryHintWaitPlayers',
  });
  // Some games skip a player count, so the next allowed count may be more than one seat away.
  let needed = 0;
  while (needed <= seatCards.length && !playerCountAllowed(room.gameType, seated + needed)) needed += 1;
  if (needed > 0 && needed <= seatCards.length) return missing(needed);
  if (unready > 0) {
    return { stage: 'waiting', count: unready, seated, tagKey: 'room.summaryUnready',
      hintKey: !isHost && viewer.seatReady === false ? 'room.summaryHintPressReady' : 'room.summaryHintWaitReady' };
  }
  if (roomCanStart(room)) {
    return { stage: 'ready', count: 0, seated, tagKey: isHost ? 'room.summaryReadyHost' : 'room.summaryReadyGuest',
      hintKey: isHost ? 'room.summaryHintPressStart' : 'room.summaryHintWaitHost' };
  }
  // Only bots are seated, so a human is still needed.
  return missing(1);
}

/** One dot per seat: taken, still required to start, or optional. */
export function summaryDots(seated: number, seats: number, minimum: number): RoomSummaryDot[] {
  return Array.from({ length: seats }, (_, index) => index < seated ? 'filled' : index < minimum ? 'required' : 'open');
}

export interface RoomSummaryChip {
  readonly key: string;
  readonly label: TranslationKey;
  readonly params?: Record<string, string>;
}

/** Active room rules as short chips: the game's own enabled options and the seat shuffle. */
export function roomOptionChips(
  room: Pick<RoomInfo, 'shuffleSeats'>, rules: Pick<GameRulesContext, 'option' | 'moreOptions'>,
): RoomSummaryChip[] {
  const options = [rules.option, ...rules.moreOptions ?? []].flatMap((option) => option?.enabled ? [option] : []);
  return [
    ...options.map((option) => ({ key: option.label, label: option.label })),
    ...room.shuffleSeats ? [{ key: 'shuffleSeats', label: 'room.shuffleSeats' as TranslationKey }] : [],
  ];
}

/** Turn and reserve clocks as chips; a game without a reserve shows only the turn clock. */
export function roomTimeChips(timeControl: TimeControl): RoomSummaryChip[] {
  return [
    { key: 'turn', label: 'room.summaryTurn', params: { n: String(timeControl.baseSeconds) } },
    ...timeControl.bankSeconds > 0
      ? [{ key: 'bank', label: 'room.summaryBank' as TranslationKey, params: { n: String(timeControl.bankSeconds) } }]
      : [],
  ];
}
