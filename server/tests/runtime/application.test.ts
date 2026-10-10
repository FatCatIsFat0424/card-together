import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io as connectSocket } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AccountProfile, BridgeVisibleState, Card, ClientToServerEvents, LiarCard, Seat, ServerToClientEvents, SevensOptions, TimeControl,
} from '@shared/types';
import type { PlayerSnapshot } from '@shared/types/socket-events';
import { identifyCombo, isBomb, legalPlays } from '@shared/rules/bigtwo';
import { rpPairOptions } from '@shared/rules/redpoints';
import { NN_MAX, nnApply, nnIsPlayable, nnRequiresChoice } from '@shared/rules/ninetynine';
import type { NnChoice } from '@shared/rules/ninetynine';
import { getPresentationEndsAt } from '@shared/game-presentation';
import { ldCanChallenge, ldMustChallenge } from '@shared/rules/liarsdeck';
import { bjTotal } from '@shared/rules/blackjack';
import { heLegalActions } from '@shared/rules/holdem';
import { createApplication } from '../../src/app';
import { createJsonRepository } from '../../src/database/json-repository';
import type { Repository } from '../../src/database/repository';

const ORIGIN = 'http://localhost:5173';
const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
const cardKey = (card: Card | LiarCard): string => ('suit' in card ? `${card.suit}:${card.rank}` : `liar:${card.id}`);

/** Every game except Blackjack, whose cards are public, has a private hand. */
function handOf(state: PlayerSnapshot): readonly (Card | LiarCard)[] {
  const game = state.gameState;
  if (!game || !('myHand' in game)) throw new Error('Expected a private hand');
  return game.myHand;
}
type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
type Application = Awaited<ReturnType<typeof createApplication>>;

interface RegisteredAccount {
  account: AccountProfile;
  cookie: string;
}

function bridgeView(snapshot: PlayerSnapshot): BridgeVisibleState | undefined {
  return snapshot.gameState?.gameType === 'bridge' ? snapshot.gameState : undefined;
}

describe('persistent authenticated application', () => {
  let now: number;
  function finishPresentation(game: PlayerSnapshot['gameState']): void {
    if (game) now = Math.max(now, getPresentationEndsAt(game));
  }

  let directory: string;
  let filePath: string;
  let repository: Repository;
  let application: Application | null;
  let baseUrl: string;
  const clients: Client[] = [];

  async function start(trustProxyLoopback: boolean = false): Promise<void> {
    repository = await createJsonRepository(filePath);
    application = await createApplication(repository, {
      allowedOrigins: [ORIGIN], trustProxyLoopback,
    });
    // Advancing the game clock must not expire real socket heartbeat deadlines.
    application.io.engine.opts.pingTimeout = 24 * 60 * 60 * 1000;
    const server = application.httpServer;
    await new Promise<void>((resolve, reject): void => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected server address');
    baseUrl = `http://127.0.0.1:${address.port}`;
  }

  async function stop(): Promise<void> {
    await application?.close();
    application = null;
    for (const client of clients.splice(0)) client.disconnect();
  }

  beforeEach(async (): Promise<void> => {
    now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    directory = await mkdtemp(join(tmpdir(), 'bridge-application-'));
    filePath = join(directory, 'database.json');
    await start();
  });

  afterEach(async (): Promise<void> => {
    vi.restoreAllMocks();
    await stop();
    await rm(directory, { recursive: true, force: true });
  });

  function headers(cookie?: string): Record<string, string> {
    return {
      Origin: ORIGIN,
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    };
  }

  async function register(username: string): Promise<RegisteredAccount> {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ username, password: 'A valid test password 123', nickname: username }),
    });
    expect(response.status).toBe(201);
    const body = await response.json() as { success: boolean; account: AccountProfile };
    expect(body.success).toBe(true);
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    if (!cookie) throw new Error('Expected session cookie');
    return { account: body.account, cookie };
  }

  async function connect(cookie?: string): Promise<Client> {
    const client: Client = connectSocket(baseUrl, {
      autoConnect: false, forceNew: true, reconnection: false, transports: ['websocket'],
      extraHeaders: headers(cookie),
    });
    clients.push(client);
    await new Promise<void>((resolve, reject): void => {
      client.once('connect', (): void => resolve());
      client.once('connect_error', reject);
      client.connect();
    });
    return client;
  }

  async function resume(client: Client): Promise<PlayerSnapshot> {
    const snapshot = await client.timeout(5_000).emitWithAck('player:resume');
    expect(snapshot.success).toBe(true);
    return snapshot;
  }

  async function connectPlayers(accounts: RegisteredAccount[]): Promise<Client[]> {
    const players: Client[] = [];
    for (const account of accounts) {
      const client = await connect(account.cookie);
      await resume(client);
      players.push(client);
    }
    return players;
  }

  it('should ignore spoofed forwarded addresses when proxy trust is disabled', async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { ...headers(), 'X-Forwarded-For': `192.0.2.${attempt + 1}` },
        body: '{}',
      });
      expect(response.status).toBe(400);
    }
    const blocked = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { ...headers(), 'X-Forwarded-For': '198.51.100.1' },
      body: '{}',
    });
    expect(blocked.status).toBe(429);
  });

  it('should rate limit clients separately behind a trusted loopback proxy', async () => {
    await stop();
    await start(true);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { ...headers(), 'X-Forwarded-For': '192.0.2.1' },
        body: '{}',
      });
      expect(response.status).toBe(400);
    }
    const blocked = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { ...headers(), 'X-Forwarded-For': '192.0.2.1' },
      body: '{}',
    });
    expect(blocked.status).toBe(429);
    const otherClient = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { ...headers(), 'X-Forwarded-For': '198.51.100.1' },
      body: '{}',
    });
    expect(otherClient.status).toBe(400);
  });

  it('should reject anonymous sockets and revoke a connected socket on logout', async () => {
    await expect(connect()).rejects.toThrow('Sign in');
    const registered = await register('session_player');
    const client = await connect(registered.cookie);
    expect((await resume(client)).player?.id).toBe(registered.account.id);
    const disconnected = new Promise<string>((resolve): void => {
      client.once('disconnect', resolve);
    });
    const response = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST', headers: headers(registered.cookie),
    });
    expect(response.status).toBe(200);
    expect(await disconnected).toBe('io server disconnect');
    expect(client.connected).toBe(false);
    await expect(connect(registered.cookie)).rejects.toThrow('Sign in');
    const session = await fetch(`${baseUrl}/api/auth/me`, { headers: headers(registered.cookie) });
    expect(session.status).toBe(401);
  }, 15_000);

  it('should reject malformed first actions and still allow a valid authenticated action', async () => {
    const registered = await register('payload_player');
    const client = await connect(registered.cookie);
    const invalid = await client.timeout(5_000).emitWithAck('room:changeSeat',
      null as unknown as { seat: Seat });
    expect(invalid).toMatchObject({ success: false, error: 'Invalid seat.' });
    expect((await resume(client)).player?.id).toBe(registered.account.id);
    const created = await client.timeout(5_000).emitWithAck('room:create', { gameType: 'bridge' });
    expect(created.success).toBe(true);
    client.emit('chat:send', { message: 'ignored without a valid callback' },
      null as unknown as (response: { success: boolean }) => void);
    const snapshot = await resume(client);
    expect(snapshot.room?.code).toBe(created.roomCode);
    expect(snapshot.chatHistory).toEqual([]);
  }, 15_000);

  it('should roll back a failed durable write and allow the same connection to retry', async () => {
    const registered = await register('rollback_player');
    const client = await connect(registered.cookie);
    const logged = vi.spyOn(console, 'error').mockImplementation((): void => undefined);
    const persist = vi.spyOn(repository, 'saveRuntime').mockRejectedValueOnce(new Error('Disk full'));
    const failed = await client.timeout(5_000).emitWithAck('room:create', { gameType: 'bridge' });
    expect(failed).toMatchObject({ success: false, error: expect.stringContaining('save') });
    expect(logged).toHaveBeenCalled();
    expect(await repository.loadRuntime()).toBeNull();
    expect((await resume(client)).room).toBeUndefined();
    const created = await client.timeout(5_000).emitWithAck('room:create', { gameType: 'bridge' });
    expect(created.success).toBe(true);
    const stored = await repository.loadRuntime();
    expect(stored?.rooms).toHaveLength(1);
    expect(stored?.rooms[0].info.code).toBe(created.roomCode);
    expect(stored?.players).toHaveLength(1);
    expect(persist).toHaveBeenCalledTimes(3);
  }, 15_000);

  it('should persist bots, start when ready and let one human abort after a restart', async () => {
    const account = await register('bot_host');
    let [client] = await connectPlayers([account]);
    await client.timeout(5_000).emitWithAck('room:create', { gameType: 'bigtwo' });
    await client.timeout(5_000).emitWithAck('room:changeSeat', { seat: 'N' });
    expect(await client.timeout(5_000).emitWithAck('room:ready')).toEqual({ success: true });
    expect(await client.timeout(5_000).emitWithAck('room:fillBots')).toEqual({ success: true });
    const active = await resume(client);
    expect(active.room?.status).toBe('playing');
    expect(active.gameState?.gameType).toBe('bigtwo');
    expect(active.gameState).not.toHaveProperty('hands');
    expect(active.gameState).not.toHaveProperty('players');
    expect(SEATS.slice(1).every((seat) => active.room?.seats[seat].player?.isBot)).toBe(true);
    const stored = await repository.loadRuntime();
    expect(stored?.players).toHaveLength(1);
    expect(stored?.rooms[0].memberIds).toHaveLength(4);
    expect(await client.timeout(5_000).emitWithAck('room:removeBot', { seat: 'E' }))
      .toMatchObject({ success: false });

    await stop();
    await start();
    [client] = await connectPlayers([account]);
    expect((await resume(client)).room).toEqual(active.room);
    expect(await client.timeout(5_000).emitWithAck('game:abortVote:start')).toEqual({ success: true });
    const aborted = await resume(client);
    expect(aborted.gameState).toBeUndefined();
    expect(aborted.room).toMatchObject({ status: 'waiting', abortVote: null, abortVoteCooldownUntil: null });
    expect(aborted.room?.seats.N.isReady).toBe(false);
    expect(SEATS.slice(1).every((seat) => aborted.room?.seats[seat].isReady)).toBe(true);
    expect(await repository.listMatches(account.account.id)).toEqual([]);
    expect((await repository.loadRuntime())?.rooms[0].info.abortVoteCooldownUntil).toBeNull();
    expect(await client.timeout(5_000).emitWithAck('room:setGameType', { gameType: 'bridge' }))
      .toEqual({ success: true });
    expect(await client.timeout(5_000).emitWithAck('room:ready')).toEqual({ success: true });
    expect((await resume(client)).room?.status).toBe('playing');
    expect(await client.timeout(5_000).emitWithAck('game:abortVote:start')).toEqual({ success: true });
    expect(await client.timeout(5_000).emitWithAck('room:leave')).toEqual({ success: true });
    expect((await repository.loadRuntime())?.rooms).toEqual([]);
    expect((await repository.loadRuntime())?.games).toEqual([]);
  }, 15_000);

  it('validates host timer changes, resets readiness, and rolls back failed persistence', async () => {
    const accounts = [await register('timer_host'), await register('timer_guest')];
    const [host, guest] = await connectPlayers(accounts);
    const { roomCode } = await host.timeout(5_000).emitWithAck('room:create', { gameType: 'ninetynine' });
    await host.timeout(5_000).emitWithAck('room:changeSeat', { seat: 'N' });
    await guest.timeout(5_000).emitWithAck('room:join', { roomCode: roomCode! });
    await guest.timeout(5_000).emitWithAck('room:changeSeat', { seat: 'E' });
    await guest.timeout(5_000).emitWithAck('room:ready');
    expect((await resume(host)).room?.timeControl).toEqual({ baseSeconds: 5, bankSeconds: 20 });
    expect(await guest.timeout(5_000).emitWithAck('room:setTimeControl', { baseSeconds: 8, bankSeconds: 0 }))
      .toMatchObject({ success: false });
    for (const payload of [null, {}, { baseSeconds: 0, bankSeconds: 20 },
      { baseSeconds: 61, bankSeconds: 20 }, { baseSeconds: 5, bankSeconds: 301 },
      { baseSeconds: 5, bankSeconds: -1 }, { baseSeconds: 1.5, bankSeconds: 20 },
      { baseSeconds: '5', bankSeconds: 20 }, { baseSeconds: 5, bankSeconds: 20, extra: true }]) {
      expect(await host.timeout(5_000).emitWithAck('room:setTimeControl', payload as TimeControl))
        .toMatchObject({ success: false });
    }
    const before = (await resume(host)).room;
    vi.spyOn(repository, 'saveRuntime').mockRejectedValueOnce(new Error('Disk full'));
    expect(await host.timeout(5_000).emitWithAck('room:setTimeControl', { baseSeconds: 8, bankSeconds: 0 }))
      .toMatchObject({ success: false });
    expect((await resume(host)).room).toEqual(before);
    expect(await host.timeout(5_000).emitWithAck('room:setTimeControl', { baseSeconds: 8, bankSeconds: 0 }))
      .toEqual({ success: true });
    const room = (await resume(guest)).room!;
    expect(room.timeControl).toEqual({ baseSeconds: 8, bankSeconds: 0 });
    expect(room.seats.E.isReady).toBe(false);
    await host.timeout(5_000).emitWithAck('room:fillBots');
    await host.timeout(5_000).emitWithAck('room:ready');
    await guest.timeout(5_000).emitWithAck('room:ready');
    expect((await resume(host)).gameState?.clock?.settings).toEqual({ baseSeconds: 8, bankSeconds: 0 });
    expect(await host.timeout(5_000).emitWithAck('room:setTimeControl', { baseSeconds: 5, bankSeconds: 20 }))
      .toMatchObject({ success: false });
  });

  it('persists host Sevens options, resets readiness, and rolls back failed saves', async () => {
    const accounts = [await register('sevens_host'), await register('sevens_guest')];
    const [host, guest] = await connectPlayers(accounts);
    const { roomCode } = await host.timeout(5_000).emitWithAck('room:create', { gameType: 'bridge' });
    expect(await host.timeout(5_000).emitWithAck('room:setSevensOptions', { closeOnEnd: true }))
      .toMatchObject({ success: false });
    await host.timeout(5_000).emitWithAck('room:setGameType', { gameType: 'sevens' });
    await host.timeout(5_000).emitWithAck('room:changeSeat', { seat: 'N' });
    await guest.timeout(5_000).emitWithAck('room:join', { roomCode: roomCode! });
    await guest.timeout(5_000).emitWithAck('room:changeSeat', { seat: 'E' });
    await guest.timeout(5_000).emitWithAck('room:ready');
    expect((await resume(host)).room?.sevensOptions).toEqual({ closeOnEnd: false });
    expect(await guest.timeout(5_000).emitWithAck('room:setSevensOptions', { closeOnEnd: true }))
      .toMatchObject({ success: false });
    for (const payload of [null, {}, [], true, { closeOnEnd: 'true' }, { closeOnEnd: 1 },
      { closeOnEnd: true, extra: true }]) {
      expect(await host.timeout(5_000).emitWithAck('room:setSevensOptions', payload as SevensOptions))
        .toMatchObject({ success: false });
    }
    expect(await host.timeout(5_000).emitWithAck('room:setSevensOptions', { closeOnEnd: false }))
      .toEqual({ success: true });
    const before = (await resume(host)).room!;
    expect(before.seats.E.isReady).toBe(true);
    vi.spyOn(repository, 'saveRuntime').mockRejectedValueOnce(new Error('Disk full'));
    expect(await host.timeout(5_000).emitWithAck('room:setSevensOptions', { closeOnEnd: true }))
      .toMatchObject({ success: false });
    expect((await resume(host)).room).toEqual(before);
    expect(await host.timeout(5_000).emitWithAck('room:setSevensOptions', { closeOnEnd: true }))
      .toEqual({ success: true });
    const changed = (await resume(guest)).room!;
    expect(changed.sevensOptions).toEqual({ closeOnEnd: true });
    expect(changed.seats.E.isReady).toBe(false);
    expect((await repository.loadRuntime())?.rooms[0].info.sevensOptions).toEqual({ closeOnEnd: true });
    await host.timeout(5_000).emitWithAck('room:fillBots');
    await host.timeout(5_000).emitWithAck('room:ready');
    await guest.timeout(5_000).emitWithAck('room:ready');
    const active = await resume(host);
    expect(active.gameState).toMatchObject({ gameType: 'sevens', options: { closeOnEnd: true } });
    expect(await host.timeout(5_000).emitWithAck('room:setSevensOptions', { closeOnEnd: false }))
      .toMatchObject({ success: false });
    await stop();
    await start();
    const [reconnected] = await connectPlayers(accounts);
    const restored = await resume(reconnected);
    expect(restored.room?.sevensOptions).toEqual({ closeOnEnd: true });
    expect(restored.gameState).toMatchObject({ gameType: 'sevens', options: { closeOnEnd: true } });
  }, 15_000);

  it('should enforce bot payloads and host rights while unseated members spectate', async () => {
    const accounts = [await register('manage_host'), await register('manage_guest')];
    const [host, guest] = await connectPlayers(accounts);
    const { roomCode } = await host.timeout(5_000).emitWithAck('room:create', { gameType: 'bridge' });
    if (!roomCode) throw new Error('Expected room code');
    await host.timeout(5_000).emitWithAck('room:changeSeat', { seat: 'N' });
    await guest.timeout(5_000).emitWithAck('room:join', { roomCode });
    expect(await guest.timeout(5_000).emitWithAck('room:addBot', { seat: 'E' })).toMatchObject({ success: false });
    expect(await guest.timeout(5_000).emitWithAck('room:fillBots')).toMatchObject({ success: false });
    expect(await host.timeout(5_000).emitWithAck('room:addBot', { seat: 'invalid' as Seat }))
      .toEqual({ success: false, error: 'Invalid seat.' });
    expect(await host.timeout(5_000).emitWithAck('room:fillBots')).toEqual({ success: true });
    expect(await host.timeout(5_000).emitWithAck('room:addBot', { seat: 'W' })).toMatchObject({ success: false });
    const filled = (await resume(host)).room;
    expect(filled?.seats.W.player?.isBot).toBe(true);
    expect(filled?.spectators?.map((spectator) => spectator.id)).toEqual([accounts[1].account.id]);
    expect(await host.timeout(5_000).emitWithAck('room:removeBot', { seat: 'W' })).toEqual({ success: true });
    expect(await guest.timeout(5_000).emitWithAck('room:changeSeat', { seat: 'W' })).toEqual({ success: true });
    expect((await resume(host)).room?.spectators).toEqual([]);
    expect(await guest.timeout(5_000).emitWithAck('room:removeBot', { seat: 'E' })).toMatchObject({ success: false });
    expect(await host.timeout(5_000).emitWithAck('room:removeBot', { seat: 'E' })).toEqual({ success: true });
    expect((await resume(host)).room?.seats.E).toEqual({ player: null, isReady: false });
  }, 15_000);

  it('should let the host remove a waiting member and notify them', async () => {
    const accounts = [await register('kick_host'), await register('kick_guest')];
    const [host, guest] = await connectPlayers(accounts);
    const { roomCode } = await host.timeout(5_000).emitWithAck('room:create', { gameType: 'bridge' });
    if (!roomCode) throw new Error('Expected room code');
    await guest.timeout(5_000).emitWithAck('room:join', { roomCode });
    await guest.timeout(5_000).emitWithAck('room:changeSeat', { seat: 'S' });
    const guestId = accounts[1].account.id;
    expect(await host.timeout(5_000).emitWithAck('room:kick', { accountId: 42 as unknown as string }))
      .toEqual({ success: false, error: 'Choose a player to remove.' });
    expect(await guest.timeout(5_000).emitWithAck('room:kick', { accountId: accounts[0].account.id }))
      .toMatchObject({ success: false });
    const kicked = new Promise<{ roomCode: string }>((resolve): void => { guest.once('room:kicked', resolve); });
    expect(await host.timeout(5_000).emitWithAck('room:kick', { accountId: guestId })).toEqual({ success: true });
    expect(await kicked).toEqual({ roomCode });
    expect((await resume(guest)).room).toBeUndefined();
    const room = (await resume(host)).room;
    expect(room?.seats.S.player).toBeNull();
    expect(await host.timeout(5_000).emitWithAck('room:kick', { accountId: guestId })).toMatchObject({ success: false });
    expect(await guest.timeout(5_000).emitWithAck('room:join', { roomCode })).toMatchObject({ success: true });
  }, 15_000);

  it('should roll back bot additions and automatic game start if persistence fails', async () => {
    const account = await register('bot_rollback');
    const [client] = await connectPlayers([account]);
    await client.timeout(5_000).emitWithAck('room:create', { gameType: 'bigtwo' });
    await client.timeout(5_000).emitWithAck('room:changeSeat', { seat: 'N' });
    await client.timeout(5_000).emitWithAck('room:ready');
    const before = await resume(client);
    vi.spyOn(console, 'error').mockImplementation((): void => undefined);
    vi.spyOn(repository, 'saveRuntime').mockRejectedValueOnce(new Error('Disk full'));
    expect(await client.timeout(5_000).emitWithAck('room:fillBots'))
      .toMatchObject({ success: false, error: expect.stringContaining('save') });
    const failed = await resume(client);
    expect(failed.room).toEqual(before.room);
    expect(failed.gameState).toBeUndefined();
    expect((await repository.loadRuntime())?.rooms[0].memberIds).toEqual([account.account.id]);
    expect(await client.timeout(5_000).emitWithAck('room:fillBots')).toEqual({ success: true });
    expect((await resume(client)).room?.status).toBe('playing');
  }, 15_000);

  it('should preserve ready rooms, private hands and active games across restarts and record a completed game', async () => {
    const accounts: RegisteredAccount[] = [];
    for (const username of ['north_player', 'east_player', 'south_player', 'west_player']) {
      accounts.push(await register(username));
    }
    let players = await connectPlayers(accounts);
    const created = await players[0].timeout(5_000).emitWithAck('room:create', { gameType: 'bridge' });
    expect(created.success).toBe(true);
    const roomCode = created.roomCode;
    if (!roomCode) throw new Error('Expected room code');
    for (let index = 0; index < 4; index += 1) {
      if (index > 0) {
        expect(await players[index].timeout(5_000).emitWithAck('room:join', { roomCode }))
          .toMatchObject({ success: true });
      }
      expect(await players[index].timeout(5_000).emitWithAck('room:changeSeat', { seat: SEATS[index] }))
        .toEqual({ success: true });
      if (index < 3) expect(await players[index].timeout(5_000).emitWithAck('room:ready'))
        .toEqual({ success: true });
    }
    expect(await players[0].timeout(5_000).emitWithAck('chat:send', { message: 'Keep this table chat' }))
      .toEqual({ success: true });
    const waiting = await resume(players[0]);
    expect(waiting.room?.status).toBe('waiting');
    expect(Object.values(waiting.room!.seats).map((seat) => seat.isReady)).toEqual([true, true, true, false]);

    await stop();
    await start();
    players = await connectPlayers(accounts);
    const restored = await resume(players[0]);
    expect(restored.room).toEqual(waiting.room);
    expect(restored.chatHistory).toEqual(waiting.chatHistory);
    expect(restored.gameState).toBeUndefined();
    expect(await players[3].timeout(5_000).emitWithAck('room:ready')).toEqual({ success: true });

    let snapshot = await resume(players[0]);
    for (let attempt = 0; snapshot.gameState?.phase === 'redeal_pending' && attempt < 30; attempt += 1) {
      const seat = snapshot.gameState.redealPendingSeat;
      if (!seat) throw new Error('Expected player choosing whether to redeal');
      expect(await players[SEATS.indexOf(seat)].timeout(5_000)
        .emitWithAck('game:redealResponse', { accept: true })).toEqual({ success: true });
      snapshot = await resume(players[0]);
    }
    expect(snapshot.gameState?.phase).toBe('bidding');
    const dealt = await Promise.all(players.map(resume));
    const allCards = dealt.flatMap((state, index) => {
      expect(state.gameState?.mySeat).toBe(SEATS[index]);
      expect(handOf(state)).toHaveLength(13);
      expect(state.gameState).not.toHaveProperty('hands');
      expect(state.gameState).not.toHaveProperty('players');
      expect(Object.values(state.room!.seats).every((seat) => seat.isReady)).toBe(true);
      return handOf(state).map(cardKey);
    });
    expect(new Set(allCards).size).toBe(52);

    for (let bidIndex = 0; bidIndex < 4; bidIndex += 1) {
      const bidder = bridgeView(snapshot)?.bidding?.currentBidderSeat;
      if (!bidder) throw new Error('Expected current bidder');
      const bid = bidIndex === 0 ? { type: 'bid' as const, level: 1 as const, suit: 'clubs' as const }
        : { type: 'pass' as const };
      expect(await players[SEATS.indexOf(bidder)].timeout(5_000).emitWithAck('game:bid', { bid }))
        .toEqual({ success: true });
      snapshot = await resume(players[0]);
    }
    expect(snapshot.gameState?.phase).toBe('playing');
    expect(await players[0].timeout(5_000).emitWithAck('game:continue')).toMatchObject({ success: false });
    expect((await resume(players[0])).gameState).toEqual(snapshot.gameState);

    const firstTurn = bridgeView(snapshot)?.playing?.currentTurnSeat;
    if (!firstTurn) throw new Error('Expected current player');
    const firstPlayer = players[SEATS.indexOf(firstTurn)];
    const firstState = await resume(firstPlayer);
    const firstCard = bridgeView(firstState)?.validCards[0];
    if (!firstCard) throw new Error('Expected playable card');
    expect(await firstPlayer.timeout(5_000).emitWithAck('game:playCard', { card: firstCard }))
      .toEqual({ success: true });
    const active = await Promise.all(players.map(resume));
    expect(active.reduce((total, state) => total + handOf(state).length, 0)).toBe(51);

    players[0].disconnect();
    players[0] = await connect(accounts[0].cookie);
    const refreshed = await resume(players[0]);
    expect(refreshed.gameState).toEqual(active[0].gameState);
    expect(refreshed.chatHistory).toEqual(waiting.chatHistory);

    await stop();
    await start();
    players = await connectPlayers(accounts);
    const resumed = await Promise.all(players.map(resume));
    for (let index = 0; index < 4; index += 1) {
      expect(resumed[index].room).toEqual(active[index].room);
      expect(resumed[index].gameState).toEqual(active[index].gameState);
      expect(resumed[index].chatHistory).toEqual(waiting.chatHistory);
    }

    snapshot = resumed[0];
    for (let played = 0; snapshot.gameState?.phase === 'playing' && played < 52; played += 1) {
      finishPresentation(snapshot.gameState);
      const seat = bridgeView(snapshot)?.playing?.currentTurnSeat;
      if (!seat) throw new Error('Expected player turn');
      const client = players[SEATS.indexOf(seat)];
      const state = await resume(client);
      const card = bridgeView(state)?.validCards[0];
      if (!card) throw new Error('Expected a legal card');
      expect(await client.timeout(5_000).emitWithAck('game:playCard', { card })).toEqual({ success: true });
      snapshot = await resume(players[0]);
    }
    expect(snapshot.gameState?.phase).toBe('scoring');
    expect(snapshot.room?.status).toBe('waiting');
    expect(Object.values(snapshot.room!.seats).every((seat) => !seat.isReady)).toBe(true);
    const stored = await repository.loadRuntime();
    expect(stored?.games[0].result).toEqual(snapshot.gameState?.result);
    for (const registered of accounts) {
      const response = await fetch(`${baseUrl}/api/account/history`, { headers: headers(registered.cookie) });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.matches).toHaveLength(1);
      expect(body.matches[0]).toMatchObject({
        roomCode, result: { ...snapshot.gameState?.result, gameType: 'bridge' },
      });
      expect(body.matches[0].accountIds).toEqual(accounts.map(({ account }) => account.id));
    }

    await stop();
    await start();
    const finalPlayer = await connect(accounts[0].cookie);
    expect((await resume(finalPlayer)).gameState?.result).toEqual(snapshot.gameState?.result);
    expect(await repository.listMatches(accounts[0].account.id)).toHaveLength(1);
  }, 30_000);

  it('should switch game type as host and abort a game by vote without a match record', async () => {
    const accounts: RegisteredAccount[] = [];
    for (const username of ['vote_north', 'vote_east', 'vote_south', 'vote_west']) {
      accounts.push(await register(username));
    }
    const players = await connectPlayers(accounts);
    const created = await players[0].timeout(5_000).emitWithAck('room:create', { gameType: 'bigtwo' });
    const roomCode = created.roomCode;
    if (!roomCode) throw new Error('Expected room code');
    for (let index = 0; index < 4; index += 1) {
      if (index > 0) await players[index].timeout(5_000).emitWithAck('room:join', { roomCode });
      await players[index].timeout(5_000).emitWithAck('room:changeSeat', { seat: SEATS[index] });
    }
    const readyAll = async (): Promise<(typeof created)[]> => {
      const results = [];
      for (const client of players) results.push(await client.timeout(5_000).emitWithAck('room:ready'));
      return results;
    };
    expect((await resume(players[1])).room).toMatchObject({
      gameType: 'bigtwo', hostId: accounts[0].account.id, abortVote: null,
    });
    expect(await players[1].timeout(5_000).emitWithAck('room:setGameType', { gameType: 'bridge' }))
      .toMatchObject({ success: false });
    expect(await players[0].timeout(5_000).emitWithAck('room:setGameType', { gameType: 'bridge' }))
      .toEqual({ success: true });
    const switched = await resume(players[0]);
    expect(switched.room?.gameType).toBe('bridge');
    expect(Object.values(switched.room!.seats).every((seat) => !seat.isReady)).toBe(true);
    expect((await readyAll()).every((result) => result.success)).toBe(true);
    expect((await resume(players[0])).gameState?.gameType).toBe('bridge');

    expect(await players[0].timeout(5_000).emitWithAck('game:abortVote:start')).toEqual({ success: true });
    expect(await players[1].timeout(5_000).emitWithAck('game:abortVote:start')).toMatchObject({ success: false });
    expect(await players[0].timeout(5_000).emitWithAck('game:abortVote:cast', { agree: true }))
      .toEqual({ success: false, error: 'You have already voted.' });
    expect(await players[1].timeout(5_000).emitWithAck('game:abortVote:cast', { agree: true }))
      .toEqual({ success: true });
    expect((await resume(players[3])).room?.abortVote).toMatchObject({
      startedBy: accounts[0].account.id, yes: [accounts[0].account.id, accounts[1].account.id], no: [],
    });
    const beforeDecisiveVote = await resume(players[3]);
    vi.spyOn(console, 'error').mockImplementation((): void => undefined);
    vi.spyOn(repository, 'saveRuntime').mockRejectedValueOnce(new Error('Disk full'));
    expect(await players[2].timeout(5_000).emitWithAck('game:abortVote:cast', { agree: true }))
      .toMatchObject({ success: false, error: expect.stringContaining('save') });
    expect((await resume(players[3])).room).toEqual(beforeDecisiveVote.room);
    expect(await players[2].timeout(5_000).emitWithAck('game:abortVote:cast', { agree: true }))
      .toEqual({ success: true });

    const aborted = await resume(players[3]);
    expect(aborted.gameState).toBeUndefined();
    expect(aborted.room).toMatchObject({ status: 'waiting', abortVote: null, abortVoteCooldownUntil: null });
    expect(Object.values(aborted.room!.seats).every((seat) => !seat.isReady)).toBe(true);
    expect(aborted.chatHistory?.map((message) => [message.system, message.content])).toEqual([
      [true, 'abortVote.started'], [true, 'abortVote.passed'],
    ]);
    expect(await repository.listMatches(accounts[0].account.id)).toEqual([]);
    expect((await repository.loadRuntime())?.games).toEqual([]);
    expect((await repository.loadRuntime())?.rooms[0].info.abortVoteCooldownUntil).toBeNull();
    expect((await readyAll()).every((result) => result.success)).toBe(true);
    expect(await players[0].timeout(5_000).emitWithAck('game:abortVote:start')).toEqual({ success: true });
    const nextVote = (await resume(players[3])).room!;
    expect(nextVote.abortVoteCooldownUntil).toBe(nextVote.abortVote!.startedAt + 3 * 60_000);
  }, 20_000);

  it('should play a full Big Two game across a restart and record it', async () => {
    const accounts: RegisteredAccount[] = [];
    for (const username of ['big_north', 'big_east', 'big_south', 'big_west']) {
      accounts.push(await register(username));
    }
    let players = await connectPlayers(accounts);
    const created = await players[0].timeout(5_000).emitWithAck('room:create', { gameType: 'bigtwo' });
    const roomCode = created.roomCode;
    if (!roomCode) throw new Error('Expected room code');
    for (let index = 0; index < 4; index += 1) {
      if (index > 0) await players[index].timeout(5_000).emitWithAck('room:join', { roomCode });
      await players[index].timeout(5_000).emitWithAck('room:changeSeat', { seat: SEATS[index] });
      expect(await players[index].timeout(5_000).emitWithAck('room:ready')).toEqual({ success: true });
    }

    /** Leads the weakest play; follows with the weakest non-bomb, else passes. */
    async function step(): Promise<PlayerSnapshot> {
      const view = (await resume(players[0])).gameState;
      finishPresentation(view);
      if (view?.gameType !== 'bigtwo') throw new Error('Expected Big Two state');
      const seat = view.currentTurnSeat;
      const client = players[SEATS.indexOf(seat)];
      const mine = (await resume(client)).gameState;
      if (mine?.gameType !== 'bigtwo') throw new Error('Expected Big Two state');
      const previous = mine.lastPlay ? identifyCombo(mine.lastPlay.cards) : null;
      const choice = legalPlays(mine.myHand, previous, mine.firstPlay)
        .find((combo) => previous === null || !isBomb(combo));
      if (!previous) expect(await client.timeout(5_000).emitWithAck('game:bigtwo:pass')).toMatchObject({ success: false });
      const response = choice
        ? await client.timeout(5_000).emitWithAck('game:bigtwo:play', { cards: choice.cards })
        : await client.timeout(5_000).emitWithAck('game:bigtwo:pass');
      expect(response).toEqual({ success: true });
      return resume(players[0]);
    }

    const opening = await Promise.all(players.map(resume));
    const allCards = opening.flatMap((state) => handOf(state).map(cardKey));
    expect(new Set(allCards).size).toBe(52);
    let snapshot = opening[0];
    if (snapshot.gameState?.phase === 'playing') {
      expect(await players[0].timeout(5_000).emitWithAck('game:bid', { bid: { type: 'pass' } }))
        .toMatchObject({ success: false });
      expect(await players[0].timeout(5_000).emitWithAck('game:bigtwo:play', { cards: [] }))
        .toEqual({ success: false, error: 'Invalid cards.' });
      for (let moves = 0; moves < 6 && snapshot.gameState?.phase === 'playing'; moves += 1) snapshot = await step();
    }

    const before = await Promise.all(players.map(resume));
    await stop();
    await start();
    players = await connectPlayers(accounts);
    const after = await Promise.all(players.map(resume));
    for (let index = 0; index < 4; index += 1) expect(after[index].gameState).toEqual(before[index].gameState);

    snapshot = after[0];
    for (let moves = 0; snapshot.gameState?.phase === 'playing' && moves < 300; moves += 1) snapshot = await step();
    const final = snapshot.gameState;
    if (final?.gameType !== 'bigtwo' || !final.result) throw new Error('Expected a scored Big Two game');
    expect(final.phase).toBe('scoring');
    expect(final.revealedHands).not.toBeNull();
    expect(final.result.scores[final.result.winnerSeat]).toBe(0);
    expect(snapshot.room?.status).toBe('waiting');
    const matches = await repository.listMatches(accounts[0].account.id);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ roomCode, result: final.result });
    expect(matches[0].result.gameType).toBe('bigtwo');
    expect(matches[0].accountIds).toEqual(accounts.map(({ account }) => account.id));

    await stop();
    await start();
    const finalPlayer = await connect(accounts[0].cookie);
    expect((await resume(finalPlayer)).gameState).toEqual(final);
    expect(await finalPlayer.timeout(5_000).emitWithAck('game:continue')).toMatchObject({ success: false });
    finishPresentation((await resume(finalPlayer)).gameState);
    expect(await finalPlayer.timeout(5_000).emitWithAck('game:continue')).toEqual({ success: true });
  }, 60_000);

  it('should play a full Red Points game across a restart and record it', async () => {
    const accounts: RegisteredAccount[] = [];
    for (const username of ['red_north', 'red_east', 'red_south', 'red_west']) {
      accounts.push(await register(username));
    }
    let players = await connectPlayers(accounts);
    const created = await players[0].timeout(5_000).emitWithAck('room:create', { gameType: 'redpoints' });
    const roomCode = created.roomCode;
    if (!roomCode) throw new Error('Expected room code');
    for (let index = 0; index < 4; index += 1) {
      if (index > 0) await players[index].timeout(5_000).emitWithAck('room:join', { roomCode });
      await players[index].timeout(5_000).emitWithAck('room:changeSeat', { seat: SEATS[index] });
      expect(await players[index].timeout(5_000).emitWithAck('room:ready')).toEqual({ success: true });
    }

    /** Plays the first hand card, capturing the first match; resolves flips with the first match. */
    async function step(): Promise<PlayerSnapshot> {
      const view = (await resume(players[0])).gameState;
      finishPresentation(view);
      if (view?.gameType !== 'redpoints') throw new Error('Expected Red Points state');
      const client = players[SEATS.indexOf(view.currentTurnSeat)];
      const mine = (await resume(client)).gameState;
      if (mine?.gameType !== 'redpoints') throw new Error('Expected Red Points state');
      let response;
      if (mine.step === 'flip-choose' && mine.pendingFlip) {
        response = await client.timeout(5_000).emitWithAck('game:redpoints:chooseFlip',
          { capture: rpPairOptions(mine.pendingFlip, mine.table)[0] });
      } else {
        const card = mine.myHand[0];
        const capture = rpPairOptions(card, mine.table)[0];
        response = await client.timeout(5_000).emitWithAck('game:redpoints:play', capture ? { card, capture } : { card });
      }
      expect(response).toEqual({ success: true });
      return resume(players[0]);
    }

    const opening = await Promise.all(players.map(resume));
    const first = opening[0].gameState;
    if (first?.gameType !== 'redpoints') throw new Error('Expected Red Points state');
    expect(first).toMatchObject({ phase: 'playing', stockCount: 24, step: 'play' });
    expect(first.table).toHaveLength(4);
    expect(first).not.toHaveProperty('stock');
    expect(new Set(opening.flatMap((state) => handOf(state).map(cardKey))).size)
      .toBe(24);
    expect(await players[0].timeout(5_000).emitWithAck('game:bigtwo:pass')).toMatchObject({ success: false });
    expect(await players[0].timeout(5_000).emitWithAck('game:redpoints:play', { card: { suit: 'x', rank: 1 } } as never))
      .toEqual({ success: false, error: 'Invalid card.' });
    for (let moves = 0; moves < 6; moves += 1) await step();

    const before = await Promise.all(players.map(resume));
    await stop();
    await start();
    players = await connectPlayers(accounts);
    const after = await Promise.all(players.map(resume));
    for (let index = 0; index < 4; index += 1) expect(after[index].gameState).toEqual(before[index].gameState);

    let snapshot = after[0];
    for (let moves = 0; snapshot.gameState?.phase === 'playing' && moves < 100; moves += 1) snapshot = await step();
    const final = snapshot.gameState;
    if (final?.gameType !== 'redpoints' || !final.result) throw new Error('Expected a scored Red Points game');
    expect(final).toMatchObject({ phase: 'scoring', table: [], stockCount: 0 });
    expect(SEATS.reduce((sum, seat) => sum + final.result!.points[seat], 0)).toBe(208);
    expect(snapshot.room?.status).toBe('waiting');
    const matches = await repository.listMatches(accounts[0].account.id);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ roomCode, result: final.result });
    expect(matches[0].result.gameType).toBe('redpoints');

    await stop();
    await start();
    const finalPlayer = await connect(accounts[0].cookie);
    expect((await resume(finalPlayer)).gameState).toEqual(final);
    expect(await finalPlayer.timeout(5_000).emitWithAck('game:continue')).toMatchObject({ success: false });
    finishPresentation((await resume(finalPlayer)).gameState);
    expect(await finalPlayer.timeout(5_000).emitWithAck('game:continue')).toEqual({ success: true });
  }, 60_000);

  it('should play a full 99 game across a restart and record it', async () => {
    const accounts: RegisteredAccount[] = [];
    for (const username of ['nn_north', 'nn_east', 'nn_south', 'nn_west']) {
      accounts.push(await register(username));
    }
    let players = await connectPlayers(accounts);
    const created = await players[0].timeout(5_000).emitWithAck('room:create', { gameType: 'ninetynine' });
    const roomCode = created.roomCode;
    if (!roomCode) throw new Error('Expected room code');
    for (let index = 0; index < 4; index += 1) {
      if (index > 0) await players[index].timeout(5_000).emitWithAck('room:join', { roomCode });
      await players[index].timeout(5_000).emitWithAck('room:changeSeat', { seat: SEATS[index] });
      expect(await players[index].timeout(5_000).emitWithAck('room:ready')).toEqual({ success: true });
    }

    /** Plays the card reaching the highest legal total; a 5 names the first other seat still in. */
    async function step(): Promise<PlayerSnapshot> {
      const view = (await resume(players[0])).gameState;
      finishPresentation(view);
      if (view?.gameType !== 'ninetynine') throw new Error('Expected 99 state');
      const client = players[SEATS.indexOf(view.currentTurnSeat)];
      const mine = (await resume(client)).gameState;
      if (mine?.gameType !== 'ninetynine') throw new Error('Expected 99 state');
      const options = mine.myHand.filter((card) => nnIsPlayable(mine.total, card)).flatMap((card) =>
        (nnRequiresChoice(card) ? ['plus', 'minus'] as NnChoice[] : [undefined])
          .map((choice) => ({ card, choice, total: nnApply(mine.total, card, choice).total }))
          .filter((option) => option.total <= NN_MAX));
      const best = options.reduce((top, option) => (option.total > top.total ? option : top));
      const target = best.card.rank === 5
        ? SEATS.find((seat) => seat !== mine.mySeat && !mine.eliminated.includes(seat)) : undefined;
      const response = await client.timeout(5_000).emitWithAck('game:ninetynine:play', {
        card: best.card, ...(best.choice && { choice: best.choice }), ...(target && { target }),
      });
      expect(response).toEqual({ success: true });
      return resume(players[0]);
    }

    const opening = await Promise.all(players.map(resume));
    const first = opening[0].gameState;
    if (first?.gameType !== 'ninetynine') throw new Error('Expected 99 state');
    expect(first).toMatchObject({ phase: 'playing', stockCount: 32, total: 0, direction: 'ccw', lastPlayed: null });
    expect(first).not.toHaveProperty('stock');
    expect(first).not.toHaveProperty('discard');
    expect(new Set(opening.flatMap((state) => handOf(state).map(cardKey))).size)
      .toBe(20);
    expect(await players[0].timeout(5_000).emitWithAck('game:redpoints:play', { card: first.myHand[0] }))
      .toMatchObject({ success: false });
    expect(await players[0].timeout(5_000).emitWithAck('game:ninetynine:play',
      { card: first.myHand[0], choice: 'double' } as never)).toEqual({ success: false, error: 'Invalid choice.' });
    let snapshot = opening[0];
    for (let moves = 0; snapshot.gameState?.phase === 'playing' && moves < 6; moves += 1) snapshot = await step();

    const before = await Promise.all(players.map(resume));
    await stop();
    await start();
    players = await connectPlayers(accounts);
    const after = await Promise.all(players.map(resume));
    for (let index = 0; index < 4; index += 1) expect(after[index].gameState).toEqual(before[index].gameState);

    snapshot = after[0];
    for (let moves = 0; snapshot.gameState?.phase === 'playing' && moves < 1000; moves += 1) snapshot = await step();
    const final = snapshot.gameState;
    if (final?.gameType !== 'ninetynine' || !final.result) throw new Error('Expected a finished 99 game');
    expect(final.eliminated).toHaveLength(3);
    expect(final.result.eliminationOrder).toEqual(final.eliminated);
    expect(final.eliminated).not.toContain(final.result.winnerSeat);
    expect(snapshot.room?.status).toBe('waiting');
    const matches = await repository.listMatches(accounts[0].account.id);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ roomCode, result: final.result });

    await stop();
    await start();
    const finalPlayer = await connect(accounts[0].cookie);
    expect((await resume(finalPlayer)).gameState).toEqual(final);
    expect(await finalPlayer.timeout(5_000).emitWithAck('game:continue')).toMatchObject({ success: false });
    finishPresentation((await resume(finalPlayer)).gameState);
    expect(await finalPlayer.timeout(5_000).emitWithAck('game:continue')).toEqual({ success: true });
  }, 60_000);

  it("should play a full Liar's Deck game across a restart without leaking hidden cards", async () => {
    const accounts: RegisteredAccount[] = [];
    for (const username of ['ld_north', 'ld_east', 'ld_south', 'ld_west']) {
      accounts.push(await register(username));
    }
    let players = await connectPlayers(accounts);
    const created = await players[0].timeout(5_000).emitWithAck('room:create', { gameType: 'liarsdeck' });
    const roomCode = created.roomCode;
    if (!roomCode) throw new Error('Expected room code');
    for (let index = 0; index < 4; index += 1) {
      if (index > 0) await players[index].timeout(5_000).emitWithAck('room:join', { roomCode });
      await players[index].timeout(5_000).emitWithAck('room:changeSeat', { seat: SEATS[index] });
      expect(await players[index].timeout(5_000).emitWithAck('room:ready')).toEqual({ success: true });
    }

    /** Calls whenever allowed after two plays this round, otherwise plays the first card. */
    async function step(): Promise<PlayerSnapshot> {
      const view = (await resume(players[0])).gameState;
      finishPresentation(view);
      if (view?.gameType !== 'liarsdeck') throw new Error("Expected Liar's Deck state");
      const client = players[SEATS.indexOf(view.currentTurnSeat)];
      const mine = (await resume(client)).gameState;
      if (mine?.gameType !== 'liarsdeck') throw new Error("Expected Liar's Deck state");
      expect(mine).not.toHaveProperty('pile');
      expect(mine).not.toHaveProperty('bullets');
      const call = ldMustChallenge(mine.mySeat, mine.handCounts, mine.lastPlay)
        || (ldCanChallenge(mine.mySeat, mine.lastPlay) && mine.pileCount >= 2);
      const response = call ? await client.timeout(5_000).emitWithAck('game:liarsdeck:challenge')
        : await client.timeout(5_000).emitWithAck('game:liarsdeck:play', { cardIds: [mine.myHand[0].id] });
      expect(response).toEqual({ success: true });
      return resume(players[0]);
    }

    const opening = await Promise.all(players.map(resume));
    const first = opening[0].gameState;
    if (first?.gameType !== 'liarsdeck') throw new Error("Expected Liar's Deck state");
    expect(first).toMatchObject({ phase: 'playing', round: 1, pileCount: 0, lastPlay: null });
    expect(new Set(opening.flatMap((state) => handOf(state).map(cardKey))).size).toBe(20);
    finishPresentation(first);
    const opener = players[SEATS.indexOf(first.currentTurnSeat)];
    expect(await opener.timeout(5_000).emitWithAck('game:liarsdeck:challenge')).toMatchObject({ success: false });
    expect(await opener.timeout(5_000).emitWithAck('game:liarsdeck:play', { cardIds: [0, 1, 2, 3] }))
      .toEqual({ success: false, error: 'Invalid cards.' });
    expect(await opener.timeout(5_000).emitWithAck('game:liarsdeck:play', { cardIds: ['x'] } as never))
      .toEqual({ success: false, error: 'Invalid cards.' });
    let snapshot = opening[0];
    for (let moves = 0; snapshot.gameState?.phase === 'playing' && moves < 4; moves += 1) snapshot = await step();

    const before = await Promise.all(players.map(resume));
    await stop();
    await start();
    players = await connectPlayers(accounts);
    const after = await Promise.all(players.map(resume));
    for (let index = 0; index < 4; index += 1) expect(after[index].gameState).toEqual(before[index].gameState);

    snapshot = after[0];
    for (let moves = 0; snapshot.gameState?.phase === 'playing' && moves < 500; moves += 1) snapshot = await step();
    const final = snapshot.gameState;
    if (final?.gameType !== 'liarsdeck' || !final.result) throw new Error("Expected a finished Liar's Deck game");
    expect(final.result.eliminationOrder).toEqual(final.eliminated);
    expect(final.eliminated).not.toContain(final.result.winnerSeat);
    expect(snapshot.room?.status).toBe('waiting');
    const matches = await repository.listMatches(accounts[0].account.id);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ roomCode, result: final.result });
  }, 60_000);

  it('should play a full Blackjack match across a restart without leaking bets or the hole card', async () => {
    const accounts: RegisteredAccount[] = [];
    for (const username of ['bj_north', 'bj_east', 'bj_south', 'bj_west']) {
      accounts.push(await register(username));
    }
    let players = await connectPlayers(accounts);
    const created = await players[0].timeout(5_000).emitWithAck('room:create', { gameType: 'blackjack' });
    const roomCode = created.roomCode;
    if (!roomCode) throw new Error('Expected room code');
    for (let index = 0; index < 4; index += 1) {
      if (index > 0) await players[index].timeout(5_000).emitWithAck('room:join', { roomCode });
      await players[index].timeout(5_000).emitWithAck('room:changeSeat', { seat: SEATS[index] });
      expect(await players[index].timeout(5_000).emitWithAck('room:ready')).toEqual({ success: true });
    }

    /** Every seat that owes a bet stakes 20; otherwise the acting hand hits below 12 and stands from 12. */
    async function step(): Promise<PlayerSnapshot> {
      const view = (await resume(players[0])).gameState;
      finishPresentation(view);
      if (view?.gameType !== 'blackjack') throw new Error('Expected Blackjack state');
      expect(view).not.toHaveProperty('bets');
      expect(view).not.toHaveProperty('hole');
      expect(view).not.toHaveProperty('deck');
      if (view.phase === 'betting') {
        for (const seat of SEATS) {
          if (view.betPlaced[seat] || view.chips[seat] < 10) continue;
          expect(await players[SEATS.indexOf(seat)].timeout(5_000).emitWithAck('game:blackjack:bet', { amount: 20 }))
            .toEqual({ success: true });
        }
        return resume(players[0]);
      }
      if (view.holeHidden) expect(view.dealer).toHaveLength(1);
      const hand = view.hands[view.currentTurnSeat][view.activeHand];
      const action = bjTotal(hand.cards).total < 12 ? 'hit' : 'stand';
      expect(await players[SEATS.indexOf(view.currentTurnSeat)].timeout(5_000)
        .emitWithAck('game:blackjack:action', { action })).toEqual({ success: true });
      return resume(players[0]);
    }

    const opening = await resume(players[0]);
    expect(opening.gameState).toMatchObject({ gameType: 'blackjack', phase: 'betting', hand: 0,
      chips: { N: 1000, E: 1000, S: 1000, W: 1000 } });
    expect(await players[0].timeout(5_000).emitWithAck('game:blackjack:bet', { amount: 5 }))
      .toEqual({ success: false, error: 'Invalid bet.' });
    expect(await players[0].timeout(5_000).emitWithAck('game:blackjack:bet', { amount: 15 }))
      .toMatchObject({ success: false });
    expect(await players[0].timeout(5_000).emitWithAck('game:blackjack:action', { action: 'surrender' } as never))
      .toEqual({ success: false, error: 'Invalid action.' });
    expect(await players[0].timeout(5_000).emitWithAck('game:blackjack:action', { action: 'hit' }))
      .toMatchObject({ success: false });
    expect(await players[0].timeout(5_000).emitWithAck('game:blackjack:bet', { amount: 40 })).toEqual({ success: true });
    const east = (await resume(players[1])).gameState;
    if (east?.gameType !== 'blackjack') throw new Error('Expected Blackjack state');
    expect(east.myBet).toBeNull();
    expect(east.betPlaced.N).toBe(true);
    expect((await resume(players[0])).gameState).toMatchObject({ myBet: 40 });

    let snapshot = opening;
    for (let moves = 0; snapshot.gameState?.phase !== 'scoring' && moves < 6; moves += 1) snapshot = await step();

    const before = await Promise.all(players.map(resume));
    await stop();
    await start();
    players = await connectPlayers(accounts);
    const after = await Promise.all(players.map(resume));
    for (let index = 0; index < 4; index += 1) expect(after[index].gameState).toEqual(before[index].gameState);

    snapshot = after[0];
    for (let moves = 0; snapshot.gameState?.phase !== 'scoring' && moves < 500; moves += 1) snapshot = await step();
    const final = snapshot.gameState;
    if (final?.gameType !== 'blackjack' || !final.result) throw new Error('Expected a finished Blackjack match');
    expect(final.result.hands).toBe(8);
    expect(final.result.chips).toEqual(final.chips);
    expect(snapshot.room?.status).toBe('waiting');
    const matches = await repository.listMatches(accounts[0].account.id);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ roomCode, result: final.result });
  }, 60_000);

  it("should play a full Hold'em match across a restart without leaking hole cards", async () => {
    const accounts: RegisteredAccount[] = [];
    for (const username of ['he_north', 'he_east', 'he_south', 'he_west']) {
      accounts.push(await register(username));
    }
    let players = await connectPlayers(accounts);
    const created = await players[0].timeout(5_000).emitWithAck('room:create', { gameType: 'holdem' });
    const roomCode = created.roomCode;
    if (!roomCode) throw new Error('Expected room code');
    for (let index = 0; index < 4; index += 1) {
      if (index > 0) await players[index].timeout(5_000).emitWithAck('room:join', { roomCode });
      await players[index].timeout(5_000).emitWithAck('room:changeSeat', { seat: SEATS[index] });
      expect(await players[index].timeout(5_000).emitWithAck('room:ready')).toEqual({ success: true });
    }

    /** The acting seat calls or checks, except that every third hand opens with an all-in to reach eliminations. */
    async function step(): Promise<PlayerSnapshot> {
      const view = (await resume(players[0])).gameState;
      finishPresentation(view);
      if (view?.gameType !== 'holdem') throw new Error("Expected Hold'em state");
      const client = players[SEATS.indexOf(view.currentTurnSeat)];
      const mine = (await resume(client)).gameState;
      if (mine?.gameType !== 'holdem') throw new Error("Expected Hold'em state");
      expect(mine).not.toHaveProperty('hands');
      expect(mine).not.toHaveProperty('deck');
      expect(mine.myHand).toHaveLength(2);
      const legal = heLegalActions(mine, mine.mySeat)!;
      const action = mine.hand % 3 === 0 && legal.raise ? { type: 'raise' as const, to: legal.raise.max }
        : legal.check ? { type: 'check' as const } : { type: 'call' as const };
      expect(await client.timeout(5_000).emitWithAck('game:holdem:action', { action })).toEqual({ success: true });
      return resume(players[0]);
    }

    const opening = await Promise.all(players.map(resume));
    const first = opening[0].gameState;
    if (first?.gameType !== 'holdem') throw new Error("Expected Hold'em state");
    expect(first).toMatchObject({ phase: 'playing', hand: 1, street: 'preflop', board: [] });
    expect(new Set(opening.flatMap((state) => handOf(state).map(cardKey))).size).toBe(8);
    for (const state of opening) {
      if (state.gameState?.gameType !== 'holdem') throw new Error("Expected Hold'em state");
      expect(state.gameState.revealed).toEqual({ N: [], E: [], S: [], W: [] });
    }
    finishPresentation(first);
    const actor = players[SEATS.indexOf(first.currentTurnSeat)];
    expect(await actor.timeout(5_000).emitWithAck('game:holdem:action', { action: { type: 'check' } }))
      .toMatchObject({ success: false });
    expect(await actor.timeout(5_000).emitWithAck('game:holdem:action', { action: { type: 'raise', to: -5 } }))
      .toEqual({ success: false, error: 'Invalid action.' });
    expect(await actor.timeout(5_000).emitWithAck('game:holdem:action', { action: { type: 'shove' } } as never))
      .toEqual({ success: false, error: 'Invalid action.' });

    let snapshot = opening[0];
    for (let moves = 0; snapshot.gameState?.phase !== 'scoring' && moves < 6; moves += 1) snapshot = await step();

    const before = await Promise.all(players.map(resume));
    await stop();
    await start();
    players = await connectPlayers(accounts);
    const after = await Promise.all(players.map(resume));
    for (let index = 0; index < 4; index += 1) expect(after[index].gameState).toEqual(before[index].gameState);

    snapshot = after[0];
    for (let moves = 0; snapshot.gameState?.phase !== 'scoring' && moves < 1000; moves += 1) snapshot = await step();
    const final = snapshot.gameState;
    if (final?.gameType !== 'holdem' || !final.result) throw new Error("Expected a finished Hold'em match");
    expect(final.result.chips).toEqual(final.chips);
    expect(Object.values(final.chips).reduce((sum, value) => sum + value, 0)).toBe(4000);
    expect(snapshot.room?.status).toBe('waiting');
    const matches = await repository.listMatches(accounts[0].account.id);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ roomCode, result: final.result });
  }, 60_000);
});
