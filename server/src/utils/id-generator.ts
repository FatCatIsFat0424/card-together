// ─── ID generation utilities ───

import { randomInt, randomUUID } from 'node:crypto';
import type { RoomCode } from '@shared/types';
import { ROOM_CODE_LENGTH } from '@shared/constants';

/**
 * Generate a room code
 * Format: 6 uppercase alphanumeric characters (excluding confusable 0/O/I/1)
 * The caller is responsible for collision checks
 */
export function generateRoomCode(): RoomCode {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += chars.charAt(randomInt(chars.length));
  }
  return code;
}

/**
 * Generate a chat message id
 * Format: UUID v4
 */
export function generateMessageId(): string {
  return randomUUID();
}
