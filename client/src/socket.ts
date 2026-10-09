import { io, Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@shared/types';
import { SERVER_URL, SOCKET_PATH } from './deployment';

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SERVER_URL, {
  path: SOCKET_PATH,
  autoConnect: false,
  // Close the old transport on refresh instead of waiting for its heartbeat timeout.
  closeOnBeforeunload: true,
  withCredentials: true,
  transports: ['websocket', 'polling'],
  // Fall back to polling on networks that block WebSocket upgrades.
  tryAllTransports: true,
  // The server keeps seats for a grace period; give up only when the page does.
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
});

export function disconnectSocket(): void {
  socket.disconnect();
}

/** Starts a fresh connection attempt without waiting for the reconnection backoff. */
export function reconnectSocket(): void {
  socket.disconnect();
  socket.connect();
}
