import { describe, expect, it } from 'vitest';
import { t } from '../../../client/src/i18n';
import { roomErrorKey } from '../../../client/src/room-error-i18n';

describe('room warning translations', () => {
  it('explains the reserved human seat in the selected language', () => {
    const key = roomErrorKey('Leave a seat for a player.');
    expect(t(key, 'zh-TW')).toBe('請至少留一個座位給真人玩家。');
    expect(t(key, 'en')).toBe('Leave a seat for a player.');
  });

  it('handles the manager and socket punctuation variants', () => {
    expect(roomErrorKey('Room not found')).toBe(roomErrorKey('Room not found.'));
    expect(t(roomErrorKey('Seat is occupied'), 'zh-TW')).toBe('這個座位已有人。');
  });

  it('keeps unexpected server text out of the warning', () => {
    expect(t(roomErrorKey('Unexpected internal failure'), 'zh-TW')).toBe('發生錯誤');
    expect(roomErrorKey(undefined)).toBe('common.error');
  });
});
