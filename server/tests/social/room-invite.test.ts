import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io as connectSocket } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  AccountProfile, ClientToServerEvents, FriendsData, RoomInvite, ServerToClientEvents,
} from '@shared/types';
import { createApplication } from '../../src/app';
import { createJsonRepository } from '../../src/database/json-repository';

const ORIGIN = 'http://localhost:5173';
type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
type Application = Awaited<ReturnType<typeof createApplication>>;

interface Registered {
  account: AccountProfile;
  cookie: string;
}

describe('room invites and friend presence', () => {
  let directory: string;
  let application: Application;
  let baseUrl: string;
  const clients: Client[] = [];

  beforeEach(async (): Promise<void> => {
    directory = await mkdtemp(join(tmpdir(), 'bridge-invite-'));
    const repository = await createJsonRepository(join(directory, 'database.json'));
    application = await createApplication(repository, { allowedOrigins: [ORIGIN] });
    const server = application.httpServer;
    await new Promise<void>((resolve, reject): void => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected server address');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async (): Promise<void> => {
    for (const client of clients.splice(0)) client.disconnect();
    await application.close();
    await rm(directory, { recursive: true, force: true });
  });

  function headers(cookie?: string): Record<string, string> {
    return { Origin: ORIGIN, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) };
  }

  async function register(username: string): Promise<Registered> {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ username, password: 'A valid test password 123', nickname: username }),
    });
    expect(response.status).toBe(201);
    const body = await response.json() as { account: AccountProfile };
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    if (!cookie) throw new Error('Expected session cookie');
    return { account: body.account, cookie };
  }

  async function befriend(first: Registered, second: Registered): Promise<void> {
    const sent = await fetch(`${baseUrl}/api/friends/requests`, {
      method: 'POST', headers: headers(first.cookie),
      body: JSON.stringify({ username: second.account.username }),
    });
    const { request } = await sent.json() as { request: { id: string } };
    const accepted = await fetch(`${baseUrl}/api/friends/requests/${request.id}/accept`, {
      method: 'POST', headers: headers(second.cookie), body: '{}',
    });
    expect(accepted.status).toBe(200);
  }

  async function connect(user: Registered): Promise<Client> {
    const client: Client = connectSocket(baseUrl, {
      autoConnect: false, forceNew: true, reconnection: false, transports: ['websocket'],
      extraHeaders: headers(user.cookie),
    });
    clients.push(client);
    await new Promise<void>((resolve, reject): void => {
      client.once('connect', (): void => resolve());
      client.once('connect_error', reject);
      client.connect();
    });
    expect((await client.timeout(5_000).emitWithAck('player:resume')).success).toBe(true);
    return client;
  }

  async function createRoom(client: Client): Promise<string> {
    const created = await client.timeout(5_000).emitWithAck('room:create', { gameType: 'bridge' });
    if (!created.roomCode) throw new Error('Expected room code');
    return created.roomCode;
  }

  it('should deliver an invite to an online friend and enforce the cooldown', async () => {
    const [alice, bob] = [await register('alice'), await register('bob')];
    await befriend(alice, bob);
    const [host, guest] = [await connect(alice), await connect(bob)];
    const roomCode = await createRoom(host);

    const listed = await fetch(`${baseUrl}/api/friends`, { headers: headers(alice.cookie) });
    const friends = await listed.json() as FriendsData;
    expect(friends.friends).toMatchObject([{ id: bob.account.id, online: true, inRoom: false }]);

    const received = new Promise<RoomInvite>((resolve): void => { guest.once('room:invited', resolve); });
    expect(await host.timeout(5_000).emitWithAck('room:invite', { accountId: bob.account.id }))
      .toEqual({ success: true });
    expect(await received).toMatchObject({
      roomCode, gameType: 'bridge', seatsFree: 3, from: { id: alice.account.id, nickname: 'alice' },
    });

    const again = await host.timeout(5_000).emitWithAck('room:invite', { accountId: bob.account.id });
    expect(again).toEqual({ success: false, error: 'Please wait before inviting this friend again.' });
  });

  it('should reject inviting a non-friend', async () => {
    const [alice, bob] = [await register('alice'), await register('bob')];
    const host = await connect(alice);
    await connect(bob);
    await createRoom(host);
    const result = await host.timeout(5_000).emitWithAck('room:invite', { accountId: bob.account.id });
    expect(result).toEqual({ success: false, error: 'You can only invite friends.' });
  });

  // Five scrypt registrations can exceed the default timeout on a loaded machine.
  it('should reject inviting into a full room', async () => {
    const users = [
      await register('alice'), await register('bob'), await register('carol'),
      await register('dave'), await register('erin'),
    ];
    await befriend(users[0], users[4]);
    const sockets = await Promise.all(users.map(connect));
    const roomCode = await createRoom(sockets[0]);
    for (const member of sockets.slice(1, 4)) {
      expect((await member.timeout(5_000).emitWithAck('room:join', { roomCode })).success).toBe(true);
    }
    const result = await sockets[0].timeout(5_000)
      .emitWithAck('room:invite', { accountId: users[4].account.id });
    expect(result).toEqual({ success: false, error: 'Room is full.' });
  }, 20_000);
});
