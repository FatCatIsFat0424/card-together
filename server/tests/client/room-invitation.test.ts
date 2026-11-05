import { describe, expect, it, vi } from 'vitest';
import {
  copyRoomInvitation, normalizeRoomCode, roomInvitationUrl, shareRoomInvitation,
} from '../../../client/src/room-invitation';

const url = 'https://cards.example/play/room/ABC234';

describe('room invitation URLs', () => {
  it.each([
    ['/', 'https://cards.example/room/ABC234'],
    ['/play/', url],
    ['/play', url],
    ['/nested/play/', 'https://cards.example/nested/play/room/ABC234'],
  ])('uses the browser origin and deployment path %s', (base, expected) => {
    expect(roomInvitationUrl('https://cards.example', base, ' abc234 ')).toBe(expected);
  });

  it('keeps development origins and ports instead of the API server', () => {
    expect(roomInvitationUrl('http://localhost:6209', '/', 'ABC234'))
      .toBe('http://localhost:6209/room/ABC234');
  });

  it.each([undefined, null, 123456, '', 'ABCDE', 'ABCDEFG', '../ABC', 'ABC/23', 'ABC?23', 'ABC#23', '%2FABC', 'ＡBC234'])('rejects invalid room codes: %s', (code) => {
    expect(normalizeRoomCode(code)).toBeNull();
    if (typeof code === 'string') expect(roomInvitationUrl('https://cards.example', '/', code)).toBeNull();
  });
});

describe('invitation sharing', () => {
  it('uses native Web Share without modifying the clipboard on success', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    expect(await shareRoomInvitation(url, 'Room ABC234', { share, clipboard: { writeText } })).toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: 'Room ABC234', url });
    expect(writeText).not.toHaveBeenCalled();
  });

  it.each([new DOMException('Cancelled', 'AbortError'), { name: 'AbortError' }])('treats cancellation as silent and leaves the clipboard untouched', async (error) => {
    const share = vi.fn().mockRejectedValue(error);
    const writeText = vi.fn();
    expect(await shareRoomInvitation(url, 'Room', { share, clipboard: { writeText } })).toBe('cancelled');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copies the URL when Web Share is unsupported', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await shareRoomInvitation(url, 'Room', { clipboard: { writeText } })).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(url);
  });

  it('copies after native sharing fails or is blocked by permissions', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('Blocked', 'NotAllowedError'));
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await shareRoomInvitation(url, 'Room', { share, clipboard: { writeText } })).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(url);
  });

  it('falls back when Web Share throws synchronously', async () => {
    const share = (): Promise<void> => { throw new Error('Unavailable'); };
    expect(await shareRoomInvitation(url, 'Room', { share })).toBe('manual');
  });

  it('offers manual copying when neither API is available, including insecure contexts', async () => {
    expect(await shareRoomInvitation(url, 'Room', {})).toBe('manual');
    expect(await copyRoomInvitation(url, {})).toBe('manual');
  });

  it('offers manual copying when clipboard access fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('Blocked', 'NotAllowedError'));
    expect(await copyRoomInvitation(url, { clipboard: { writeText } })).toBe('manual');
    expect(await shareRoomInvitation(url, 'Room', {
      share: vi.fn().mockRejectedValue(new Error('Unavailable')), clipboard: { writeText },
    })).toBe('manual');
  });

  it('copies directly without invoking native share', async () => {
    const share = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await copyRoomInvitation(url, { share, clipboard: { writeText } })).toBe('copied');
    expect(share).not.toHaveBeenCalled();
  });
});
