import type { Locale } from '../i18n';
import type { RoomInfo, Seat } from '@shared/types';
import { useI18nStore } from '../stores/i18n-store';
import { useRoomStore } from '../stores/room-store';

const LIST_SEPARATOR: Record<Locale, string> = { 'zh-TW': '、', en: ', ' };

/** Join display names with the locale's list separator. */
export function joinNames(names: readonly string[], locale: Locale): string {
  return names.join(LIST_SEPARATOR[locale]);
}

/** Player nickname for a seat, falling back to the localized seat name. */
export function seatDisplayName(
  seats: RoomInfo['seats'] | undefined, seat: Seat, seatLabel: (seat: Seat) => string,
): string {
  return seats?.[seat].player?.nickname ?? seatLabel(seat);
}

export function useSeatName(): (seat: Seat) => string {
  const seats = useRoomStore((state) => state.roomInfo?.seats);
  const { t } = useI18nStore();
  return (seat: Seat): string => seatDisplayName(seats, seat, (value) => t(`seat.${value}`));
}
