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
import type { Repository } from '../../src/database/repository';
import { createJsonRepository } from '../../src/database/json-repository';
import * as roomManager from '../../src/managers/room-manager';
import { MAX_SPECTATORS } from '@shared/constants';
import { seedAuthenticatedAccount } from '../auth/account-fixture';

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
  let repository: Repository;
  let baseUrl: string;
  const clients: Client[] = [];

  beforeEach(async (): Promise<void> => {
    directory = await mkdtemp(join(tmpdir(), 'bridge-invite-'));
    repository = await createJsonRepository(join(directory, 'database.json'));
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

  async function seedAccount(username: string): Promise<Registered> {
    return seedAuthenticatedAccount(repository, username);
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
    const [alice, bob] = [await seedAccount('alice'), await seedAccount('bob')];
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
      roomCode, gameType: 'bridge', seatsFree: 4, from: { id: alice.account.id, nickname: 'alice' },
    });

    const again = await host.timeout(5_000).emitWithAck('room:invite', { accountId: bob.account.id });
    expect(again).toEqual({ success: false, error: 'Please wait before inviting this friend again.' });
  });

  it('should reject inviting a non-friend', async () => {
    const [alice, bob] = [await seedAccount('alice'), await seedAccount('bob')];
    const host = await connect(alice);
    await connect(bob);
    await createRoom(host);
    const result = await host.timeout(5_000).emitWithAck('room:invite', { accountId: bob.account.id });
    expect(result).toEqual({ success: false, error: 'You can only invite friends.' });
  });

  it('should reject inviting once the spectator area is full', async () => {
    const [alice, erin] = [await seedAccount('alice'), await seedAccount('erin')];
    await befriend(alice, erin);
    const [host] = [await connect(alice), await connect(erin)];
    const roomCode = await createRoom(host);
    // The unseated host is the first spectator; in-process members fill the rest.
    for (let index = 1; index < MAX_SPECTATORS; index += 1) {
      expect(roomManager.joinRoom(roomCode, `watcher-${index}`).success).toBe(true);
    }
    const result = await host.timeout(5_000).emitWithAck('room:invite', { accountId: erin.account.id });
    expect(result).toEqual({ success: false, error: 'Room is full.' });
  }, 20_000);
});
