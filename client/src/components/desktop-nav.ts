import type { GameType } from '@shared/types';
import type { AppIconName } from './AppIcon';
import type { GameCategory } from '@shared/games/game-definition';
import { gameDefinition } from '@shared/games/registry';
import type { TranslationKey } from '../i18n';
import { lobbyCategories } from '../games/registry';

/** The desktop layout: a left rail beside a slim top bar. Phones and short landscape keep their own chrome. */
export const DESKTOP_SHELL_QUERY = '(min-width: 768px) and (min-height: 501px)';

export type RailItemId = 'lobby' | 'friends' | 'messages' | 'shop' | 'achievements' | 'history' | 'me';

export interface RailItem {
  readonly id: RailItemId;
  readonly icon: AppIconName;
  readonly label: TranslationKey;
  /** Sits at the bottom of the rail. */
  readonly bottom?: boolean;
}

export const RAIL_ITEMS: readonly RailItem[] = [
  { id: 'lobby', icon: 'home', label: 'rail.lobby' },
  { id: 'friends', icon: 'friends', label: 'rail.friends' },
  { id: 'messages', icon: 'chat', label: 'rail.messages' },
  { id: 'shop', icon: 'shop', label: 'rail.shop' },
  { id: 'achievements', icon: 'trophy', label: 'rail.achievements' },
  { id: 'history', icon: 'info', label: 'rail.history' },
  { id: 'me', icon: 'person', label: 'rail.me', bottom: true },
];

function under(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/** Table pages draw their own full-screen chrome and keep the classic top bar until the in-game dock lands. */
export function isTableRoute(pathname: string): boolean {
  return under(pathname, '/game') || /^\/room\/[^/]+\/replay\/?$/.test(pathname);
}

/** Rail destination for a path, or null when no rail item stands for the page (for example another player's profile). */
export function currentRailItem(pathname: string, accountId: string): RailItemId | null {
  if (pathname === '/') return 'lobby';
  if (under(pathname, '/friends')) return 'friends';
  if (under(pathname, '/messages')) return 'messages';
  if (under(pathname, '/shop')) return 'shop';
  if (under(pathname, '/achievements')) return 'achievements';
  if (under(pathname, `/players/${encodeURIComponent(accountId)}`)) return 'history';
  if (under(pathname, '/account')) return 'me';
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
    case 'me': return '/account';
  }
}

export const LOBBY_PANEL_ID = 'lobby-games';
export const LOBBY_TAB_PREFIX = 'lobby-category';
export const DEFAULT_LOBBY_GAME: GameType = 'bridge';

/** The category the lobby shows: the stored choice while it still has games, otherwise the default game's category. */
export function activeLobbyCategory(stored: GameCategory | null): GameCategory {
  return stored && lobbyCategories().includes(stored) ? stored : gameDefinition(DEFAULT_LOBBY_GAME).category;
}
