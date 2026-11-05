import { ROOM_CODE_LENGTH } from '@shared/constants';

/** Match room-code input conventions without accepting path separators or Unicode lookalikes. */
export function normalizeRoomCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim();
  return code.length === ROOM_CODE_LENGTH && /^[a-zA-Z0-9]+$/.test(code) ? code.toUpperCase() : null;
}

export function roomInvitationUrl(origin: string, basePath: string, roomCode: string): string | null {
  const code = normalizeRoomCode(roomCode);
  if (!code) return null;
  return new URL(`${basePath.replace(/\/?$/, '/')}room/${encodeURIComponent(code)}`, origin).href;
}

export type InvitationShareResult = 'shared' | 'cancelled' | 'copied' | 'manual';

export interface InvitationBrowser {
  readonly share?: (data: ShareData) => Promise<void>;
  readonly clipboard?: Pick<Clipboard, 'writeText'>;
}

export async function copyRoomInvitation(url: string, browser: InvitationBrowser): Promise<'copied' | 'manual'> {
  try {
    if (!browser.clipboard) return 'manual';
    await browser.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'manual';
  }
}

export async function shareRoomInvitation(
  url: string, title: string, browser: InvitationBrowser,
): Promise<InvitationShareResult> {
  if (browser.share) {
    try {
      await browser.share({ title, url });
      return 'shared';
    } catch (error) {
      // Closing the native sheet is intentional; do not copy anything on cancellation.
      if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') return 'cancelled';
    }
  }
  return copyRoomInvitation(url, browser);
}
