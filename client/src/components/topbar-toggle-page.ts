/** Top bar destinations whose button closes them again by returning to the previous page. */
export type TogglePage = 'messages' | 'achievements';

export function togglePageOf(pathname: string): TogglePage | null {
  if (pathname === '/messages' || pathname.startsWith('/messages/')) return 'messages';
  if (pathname === '/achievements' || pathname.startsWith('/achievements/')) return 'achievements';
  return null;
}

/** The latest location outside every toggle page, so hopping between them still returns home. */
export function nextReturnLocation(previous: string, pathname: string, search: string): string {
  return togglePageOf(pathname) ? previous : `${pathname}${search}`;
}

export function togglePageHref(page: TogglePage, current: TogglePage | null, returnTo: string): string {
  return current === page ? returnTo : `/${page}`;
}
