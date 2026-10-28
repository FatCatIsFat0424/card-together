import type { GameType } from '@shared/types';
import type { AppIconName } from './AppIcon';
import type { GameCategory } from '@shared/games/game-definition';
import { gameDefinition } from '@shared/games/registry';
import type { TranslationKey } from '../i18n';
import { lobbyCategories } from '../games/registry';

/** The desktop layout: a left rail with every page beside it. Phones and short landscape keep their own chrome. */
export const DESKTOP_SHELL_QUERY = '(min-width: 768px) and (min-height: 501px)';

export type RailItemId = 'lobby' | 'friends' | 'messages' | 'shop' | 'achievements' | 'history';

export interface RailItem {
  readonly id: RailItemId;
  readonly icon: AppIconName;
  readonly label: TranslationKey;
}

export const RAIL_ITEMS: readonly RailItem[] = [
  { id: 'lobby', icon: 'home', label: 'rail.lobby' },
  { id: 'friends', icon: 'friends', label: 'rail.friends' },
  { id: 'messages', icon: 'chat', label: 'rail.messages' },
  { id: 'shop', icon: 'shop', label: 'rail.shop' },
  { id: 'achievements', icon: 'trophy', label: 'rail.achievements' },
  { id: 'history', icon: 'info', label: 'rail.history' },
];

function under(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/** The leading rail item that returns to the viewer's room or game; it exists only while they are in one. */
export type TableRailItem = 'table';

/** The account page, marked on the avatar button at the rail's bottom instead of an item. */
export type AccountRailItem = 'account';

/** Where the table item leads: the running game, or the waiting room (which also hosts shared replays). */
export function tableRailPath(roomCode: string, playing: boolean): string {
  return `/${playing ? 'game' : 'room'}/${encodeURIComponent(roomCode)}`;
}

/** Rail destination for a path, or null when no rail item stands for the page (for example another player's profile). */
export function currentRailItem(
  pathname: string, accountId: string,
): RailItemId | TableRailItem | AccountRailItem | null {
  if (pathname === '/') return 'lobby';
  if (under(pathname, '/game') || under(pathname, '/room')) return 'table';
  if (under(pathname, '/friends')) return 'friends';
  if (under(pathname, '/messages')) return 'messages';
  if (under(pathname, '/shop')) return 'shop';
  if (under(pathname, '/achievements')) return 'achievements';
  if (under(pathname, `/players/${encodeURIComponent(accountId)}`)) return 'history';
  if (under(pathname, '/account')) return 'account';
  return null;
}

/** Link target of a rail item; messages and achievements are resolved to their toggle target by the shell. */
export function railItemPath(id: RailItemId, accountId: string): string {
  switch (id) {
    case 'lobby': return '/';
    case 'friends': return '/friends';
    case 'messages': return '/messages';
    case 'shop': return '/shop';
    case 'achievements': return '/achievements';
    case 'history': return `/players/${encodeURIComponent(accountId)}`;
  }
}

export const LOBBY_PANEL_ID = 'lobby-games';
export const LOBBY_TAB_PREFIX = 'lobby-category';
export const DEFAULT_LOBBY_GAME: GameType = 'bridge';

/** The category the lobby shows: the stored choice while it still has games, otherwise the default game's category. */
export function activeLobbyCategory(stored: GameCategory | null): GameCategory {
  return stored && lobbyCategories().includes(stored) ? stored : gameDefinition(DEFAULT_LOBBY_GAME).category;
}
