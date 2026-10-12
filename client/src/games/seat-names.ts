import { isCompassSeat, roomSeatInfo } from '@shared/rules/seats';
import type { Locale } from '../i18n';
import type { RoomInfo, GameSeat } from '@shared/types';
import { useI18nStore } from '../stores/i18n-store';
import { useRoomStore } from '../stores/room-store';

const LIST_SEPARATOR: Record<Locale, string> = { 'zh-TW': '、', en: ', ' };

/** Join display names with the locale's list separator. */
export function joinNames(names: readonly string[], locale: Locale): string {
  return names.join(LIST_SEPARATOR[locale]);
}

/** Player nickname for a seat, falling back to the localized seat name. */
export function seatDisplayName(
  seats: RoomInfo['seats'] | undefined, seat: GameSeat, seatLabel: (seat: GameSeat) => string,
): string {
  return (isCompassSeat(seat) ? seats?.[seat].player?.nickname : undefined) ?? seatLabel(seat);
}

export function useSeatName(): (seat: GameSeat) => string {
  const room = useRoomStore((state) => state.roomInfo);
  const { t } = useI18nStore();
  return (seat: GameSeat): string => (room ? roomSeatInfo(room, seat)?.player?.nickname : null) ?? t(`seat.${seat}`);
}
