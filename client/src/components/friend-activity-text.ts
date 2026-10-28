import type { FriendEntry, FriendPlayStats } from '@shared/types';
import { t } from '../i18n';
import type { Locale } from '../i18n';
import { friendActivity } from './lobby-friend-activity';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** "3 hours ago online", capped at 30 days so exact dates stay private; null without a valid time. */
export function formatFriendSeenAgo(lastSeenAt: number | null, locale: Locale, now = Date.now()): string | null {
  if (lastSeenAt === null || !Number.isSafeInteger(lastSeenAt) || lastSeenAt < 0) return null;
  const elapsed = Math.max(0, now - lastSeenAt);
  if (elapsed > 30 * DAY_MS) return t('friends.seenOver30Days', locale);
  if (elapsed < MINUTE_MS) return t('friends.seenAgo', locale, { time: t('friends.lastSeenJustNow', locale) });
  const [unit, duration] = elapsed < HOUR_MS ? ['minute', MINUTE_MS] as const
    : elapsed < DAY_MS ? ['hour', HOUR_MS] as const : ['day', DAY_MS] as const;
  const time = new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(-Math.floor(elapsed / duration), unit);
  return t('friends.seenAgo', locale, { time });
}

export interface FriendActivityText {
  readonly kind: 'playing' | 'replaying' | 'waiting' | 'lobby' | 'offline';
  /** Card heading, such as "Playing Bridge". */
  readonly title: string;
  /** Card second line; empty when there is nothing more to say. */
  readonly detail: string;
  /** One line for phone rows and pickers. */
  readonly short: string;
}

/** What a friend is doing, as card and row text; null for an offline friend without a known last-seen time. */
export function friendActivityText(friend: Pick<FriendEntry, 'online' | 'room' | 'lastSeenAt' | 'nickname'>,
  locale: Locale, now = Date.now()): FriendActivityText | null {
  const activity = friendActivity(friend);
  if (!activity) {
    const seen = formatFriendSeenAgo(friend.lastSeenAt, locale, now);
    return seen === null ? null : { kind: 'offline', title: seen, detail: '', short: seen };
  }
  if (activity.kind === 'lobby') {
    const title = t('lobby.friendInLobby', locale);
    return { kind: 'lobby', title, detail: t('friends.idle', locale), short: title };
  }
  const { room } = activity;
  const game = t(`gameType.${room.gameType}`, locale);
  const seats = t('friends.seatCount', locale, { players: String(room.players), seats: String(room.seats) });
  if (activity.kind === 'waiting') {
    const title = t('friends.waiting', locale, { game });
    const detail = room.hosting ? `${t('friends.hosts', locale, { nickname: friend.nickname })} · ${seats}` : seats;
    return { kind: 'waiting', title, detail, short: `${title} ${room.players}/${room.seats}` };
  }
  const title = activity.kind === 'playing' ? t('friends.playing', locale, { game }) : t('friends.replaying', locale, { game });
  const spectate = room.spectatable ? t('friends.canSpectate', locale) : '';
  const detail = [activity.kind === 'playing' ? t('friends.matchRunning', locale) : '', seats, spectate]
    .filter(Boolean).join(' · ');
  return { kind: activity.kind, title, detail, short: spectate ? `${title} · ${spectate}` : title };
}

/** "Played together 12 times · Plays Big Two most"; null hides the line while statistics are unavailable. */
export function friendStatsText(stats: FriendPlayStats | undefined, locale: Locale): string[] | null {
  if (!stats) return null;
  const parts = [stats.together > 0 ? t('friends.playedTogether', locale, { n: String(stats.together) })
    : t('friends.notPlayedTogether', locale)];
  if (stats.favoriteGame) parts.push(t('friends.favoriteGame', locale, { game: t(`gameType.${stats.favoriteGame}`, locale) }));
  return parts;
}
