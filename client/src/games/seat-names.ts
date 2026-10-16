import { isCompassSeat, isNumberedSeatGame, roomSeatInfo, seatNumber } from '@shared/rules/seats';
import type { Locale, TranslationKey } from '../i18n';
import type { RoomInfo, GameSeat, GameType } from '@shared/types';
import { useI18nStore } from '../stores/i18n-store';
import { useRoomStore } from '../stores/room-store';

const LIST_SEPARATOR: Record<Locale, string> = { 'zh-TW': '、', en: ', ' };

/** Join display names with the locale's list separator. */
export function joinNames(names: readonly string[], locale: Locale): string {
  return names.join(LIST_SEPARATOR[locale]);
}

type Translate = (key: TranslationKey, params?: Record<string, string>) => string;

/** Localized seat name (or its badge text when `short`); numbered games say "Player n" for every seat. */
export function seatLabel(t: Translate, gameType: GameType | undefined, seat: GameSeat, short = false): string {
  if (gameType && isNumberedSeatGame(gameType)) {
    const n = String(seatNumber(seat));
    return short ? n : t('seat.numbered', { n });
  }
  return t(short ? `seat.short.${seat}` : `seat.${seat}`);
}

/**
 * Seat name for one-column-per-seat grids (auction, trick history): numbered games show the bare number, like
 * their seat badges, so six columns fit the info rail; compass games keep their full, already short, names.
 */
export function compactSeatLabel(t: Translate, gameType: GameType | undefined, seat: GameSeat): string {
  return seatLabel(t, gameType, seat, Boolean(gameType && isNumberedSeatGame(gameType)));
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
  return (seat: GameSeat): string => (room ? roomSeatInfo(room, seat)?.player?.nickname : null)
    ?? seatLabel(t, room?.gameType, seat);
}
