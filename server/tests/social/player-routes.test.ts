import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReplaySnapshot } from '@shared/types';
import { createApplication } from '../../src/app';
import { SESSION_COOKIE_NAME, tokenHash } from '../../src/auth/auth-service';
import { REPOSITORY_ADAPTERS } from '../helpers/repository-adapters';
import type { AccountRecord, MatchRecord, NewMatchRecord, Repository } from '../../src/database/repository';

const ORIGIN = 'http://localhost:5173';
const PASSWORD_HASH = `scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`;

describe.each(REPOSITORY_ADAPTERS)('public player profile HTTP routes ($name)', (adapter) => {
  let directory: string;
  let repository: Repository;
  let application: Awaited<ReturnType<typeof createApplication>>;
  let baseUrl: string;
  let accounts: Record<string, AccountRecord>;
  let cookies: Record<string, string>;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'bridge-player-profiles-'));
    repository = await adapter.open(join(directory, adapter.fileName));
    accounts = {};
    cookies = {};
    const now = Date.now();
    for (const [username, tokenCharacter] of [
      ['alice', 'a'],
      ['bravo', 'b'],
    ]) {
      const account: AccountRecord = {
        id: randomUUID(),
        username,
        usernameNormalized: username,
        nickname: `${username} nickname`,
        color: '#2563eb',
        avatar: 'cat',
        avatarImage: null,
        tableBackground: null,
        tableBackgroundOpacity: 100,
        cardBack: null,
        cardBackOpacity: 100,
        matchesPublic: false,
        createdAt: now,
        updatedAt: now,
        passwordHash: PASSWORD_HASH,
        lastSeenAt: 123,
      };
      await repository.createAccount(account);
      accounts[username] = account;
      const token = tokenCharacter.repeat(43);
      await repository.createSession(
        {
          tokenHash: tokenHash(token),
          accountId: account.id,
          createdAt: now,
          expiresAt: now + 60_000,
        },
        PASSWORD_HASH,
      );
      cookies[username] = `${SESSION_COOKIE_NAME}=${token}`;
    }
    application = await createApplication(repository, { allowedOrigins: [ORIGIN] });
    await new Promise<void>((resolve) => {
      application.httpServer.listen(0, '127.0.0.1', resolve);
    });
    const address = application.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Expected HTTP server address.');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await application?.close();
    await rm(directory, { recursive: true, force: true });
  });

  function headers(username = 'alice'): Record<string, string> {
    return { Cookie: cookies[username], Origin: ORIGIN, 'Content-Type': 'application/json' };
  }

  it('should require an active session for both existing and missing profiles', async () => {
    for (const accountId of [accounts.alice.id, randomUUID()]) {
      const response = await fetch(`${baseUrl}/api/players/${accountId}`);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ success: false, error: 'Sign in to continue.' });
    }
    await repository.deleteAccountSessions(accounts.alice.id);
    const revoked = await fetch(`${baseUrl}/api/players/${accounts.bravo.id}`, {
      headers: headers(),
    });
    expect(revoked.status).toBe(401);
    const expiredToken = 'c'.repeat(43);
    await repository.createSession(
      {
        tokenHash: tokenHash(expiredToken),
        accountId: accounts.alice.id,
        createdAt: 100,
        expiresAt: 200,
      },
      PASSWORD_HASH,
    );
    const expired = await fetch(`${baseUrl}/api/players/${accounts.bravo.id}`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${expiredToken}` },
    });
    expect(expired.status).toBe(401);
  });

  it('should expose exactly the same public fields for self and another player', async () => {
    for (const account of Object.values(accounts)) {
      const response = await fetch(`${baseUrl}/api/players/${account.id}`, { headers: headers() });
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({
        success: true,
        account: {
          id: account.id,
          username: account.username,
          nickname: account.nickname,
          color: account.color,
          avatar: account.avatar,
          avatarImage: null,
          avatarBorder: null, nameplate: null, chatFrame: null,
        },
      });
    }
    // Viewing another profile does not require creating a friendship first.
    expect(await repository.listFriendships(accounts.alice.id)).toEqual([]);
  });

  it('should return 404 for an absent player and reject malformed or oversized IDs', async () => {
    const missing = await fetch(`${baseUrl}/api/players/${randomUUID()}`, { headers: headers() });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ success: false, error: 'Player not found.' });
    for (const malformed of ['x'.repeat(129), 'invalid%20id', 'invalid%2Fid']) {
      const response = await fetch(`${baseUrl}/api/players/${malformed}`, { headers: headers() });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ success: false, error: 'Invalid player ID.' });
    }
  });

  it('should return fresh nickname, avatar and color after the owner edits their account', async () => {
    const target = `${baseUrl}/api/players/${accounts.bravo.id}`;
    const before = await fetch(target, { headers: headers() });
    expect((await before.json()).account.avatar).toBe('cat');
    const updated = await fetch(`${baseUrl}/api/auth/profile`, {
      method: 'PATCH',
      headers: headers('bravo'),
      body: JSON.stringify({ nickname: 'New nickname', avatar: 'fox', color: '#abcdef' }),
    });
    expect(updated.status).toBe(200);
    const after = await fetch(target, { headers: headers() });
    expect(await after.json()).toEqual({
      success: true,
      account: {
        id: accounts.bravo.id,
        username: 'bravo',
        nickname: 'New nickname',
        avatar: 'fox',
        avatarImage: null,
        avatarBorder: null, nameplate: null, chatFrame: null,
        color: '#abcdef',
      },
    });
  });

  it('should return the latest 100 human and bot matches to owners and public viewers', async () => {
    const extra = ['charlie', 'delta'].map((username) => ({
      ...accounts.alice, id: randomUUID(), username, usernameNormalized: username,
    }));
    for (const account of extra) await repository.createAccount(account);
    const oldestParticipant = { ...extra[0], id: randomUUID(), username: 'echo', usernameNormalized: 'echo' };
    await repository.createAccount(oldestParticipant);
    const matches = Array.from({ length: 125 }, (_, index): MatchRecord => ({
      id: randomUUID(),
      roomCode: 'ABC123',
      accountIds: [accounts.alice.id, accounts.bravo.id, extra[0].id,
        index === 0 ? oldestParticipant.id : extra[1].id],
      finishedAt: index + 1,
      result: {
        gameType: 'bridge',
        contract: { level: 1, suit: 'nt', declarer: 'N' },
        declarerTeamTricks: 7,
        defenderTeamTricks: 6,
        requiredTricks: 7,
        declarerTeamWins: true,
      },
    }));
    await repository.saveRuntime({ players: [], rooms: [], games: [], chat: [] }, matches);
    const history = `${baseUrl}/api/players/${accounts.bravo.id}/history`;
    const botMatch: MatchRecord = {
      id: randomUUID(), roomCode: 'OLD123', finishedAt: 1000,
      accountIds: [accounts.bravo.id, ...Array.from({ length: 3 }, () => `bot:${randomUUID()}`)],
      result: { gameType: 'bridge', contract: { level: 1, suit: 'nt', declarer: 'N' },
        declarerTeamTricks: 7, defenderTeamTricks: 6, requiredTricks: 7, declarerTeamWins: true },
    };
    await repository.saveMatch(botMatch);
    const expected = [botMatch, ...matches.slice().reverse()].slice(0, 100);
    const accountHistory = await fetch(`${baseUrl}/api/account/history`, { headers: headers('bravo') });
    expect((await accountHistory.json()).matches).toEqual(expected);
    const own = await fetch(history, { headers: headers('bravo') });
    expect(own.status).toBe(200);
    const body = await own.json();
    expect(body.matches).toEqual(expected);
    expect(body.players[oldestParticipant.id]).toBeUndefined();
    expect((await repository.listMatches(oldestParticipant.id)).map((match) => match.id)).toEqual([matches[0].id]);
    expect(body.players[accounts.alice.id]).toMatchObject({ username: 'alice', avatarImage: null });
    expect(body.players[accounts.alice.id]).not.toHaveProperty('passwordHash');

    const hidden = await fetch(history, { headers: headers() });
    expect(hidden.status).toBe(403);
    expect((await hidden.json()).success).toBe(false);
    // Statistics follow the history's visibility.
    const stats = `${baseUrl}/api/players/${accounts.bravo.id}/stats`;
    expect((await fetch(stats, { headers: headers() })).status).toBe(403);
    const ownStats = await (await fetch(stats, { headers: headers('bravo') })).json();
    expect(ownStats).toMatchObject({ success: true, stats: { scopes: { human: { games: [] }, all: { account: null } } } });
    expect((await fetch(`${baseUrl}/api/players/${randomUUID()}/stats`, { headers: headers() })).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/players/bad%20id/stats`, { headers: headers() })).status).toBe(400);

    const published = await fetch(`${baseUrl}/api/auth/profile`, {
      method: 'PATCH',
      headers: headers('bravo'),
      body: JSON.stringify({ matchesPublic: true }),
    });
    expect(published.status).toBe(200);
    const visible = await fetch(history, { headers: headers() });
    expect(visible.status).toBe(200);
    expect((await fetch(stats, { headers: headers() })).status).toBe(200);
    const publicHistory = await visible.json();
    expect(publicHistory.matches).toEqual(expected);
    expect(publicHistory.players[oldestParticipant.id]).toBeUndefined();

    const missing = await fetch(`${baseUrl}/api/players/${randomUUID()}/history`, { headers: headers() });
    expect(missing.status).toBe(404);
  });

  it('should expose new account history by default and allow the owner to make it private', async () => {
    const registered = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'charlie', password: 'correct password' }),
    });
    expect(registered.status).toBe(201);
    const { account } = await registered.json();
    expect(account.matchesPublic).toBe(true);
    const cookie = registered.headers.get('set-cookie')!.split(';')[0];
    const ownerHeaders = { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json' };
    const history = `${baseUrl}/api/players/${account.id}/history`;
    expect((await fetch(history)).status).toBe(401);
    const visible = await fetch(history, { headers: headers() });
    expect(visible.status).toBe(200);
    expect(await visible.json()).toEqual({ success: true, matches: [], players: {} });

    const hidden = await fetch(`${baseUrl}/api/auth/profile`, {
      method: 'PATCH', headers: ownerHeaders, body: JSON.stringify({ matchesPublic: false }),
    });
    expect(hidden.status).toBe(200);
    expect((await repository.getAccountById(account.id))?.matchesPublic).toBe(false);
    expect((await fetch(history, { headers: headers() })).status).toBe(403);
    expect((await fetch(history, { headers: ownerHeaders })).status).toBe(200);
  });

  it('serves only retained subject replays under current history permissions and projects both lists', async () => {
    const others = ['charlie', 'delta', 'echo'].map((username) => ({
      ...accounts.alice, id: randomUUID(), username, usernameNormalized: username,
    }));
    for (const account of others) await repository.createAccount(account);
    const match: NewMatchRecord = {
      id: randomUUID(), roomCode: 'ABC123', finishedAt: 100,
      accountIds: [accounts.alice.id, ...others.map((account) => account.id)],
      result: { gameType: 'bridge', contract: { level: 1, suit: 'nt', declarer: 'N' },
        declarerTeamTricks: 7, defenderTeamTricks: 6, requiredTricks: 7, declarerTeamWins: true },
      replay: { version: 1, gameType: 'bridge', startedAt: 1,
        // A minimal snapshot: archives are validated structurally, not against game rules.
        initial: { gameType: 'bridge', observedHands: { N: [{ suit: 'clubs', rank: 2 }] }, log: [] } as unknown as ReplaySnapshot,
        steps: [[{ op: 'append', path: ['log'], values: [{ type: 'play', seat: 'N', card: { suit: 'clubs', rank: 2 }, timestamp: 10 }] },
          { op: 'set', path: ['observedHands', 'N'], value: [] }]] },
    };
    const legacy = { ...match, id: randomUUID(), finishedAt: 90, replay: undefined };
    const unrelated = { ...match, id: randomUUID(), accountIds: [accounts.bravo.id, ...others.map((account) => account.id)] };
    const botPractice = { ...match, id: randomUUID(),
      accountIds: [accounts.alice.id, ...Array.from({ length: 3 }, () => `bot:${randomUUID()}`)] };
    await repository.saveRuntime({ players: [], rooms: [], games: [], chat: [] }, [match, legacy, unrelated, botPractice]);
    const subject = `${baseUrl}/api/players/${accounts.alice.id}/history`;
    const replayUrl = `${subject}/${match.id}/replay`;
    expect((await fetch(replayUrl)).status).toBe(401);
    expect((await fetch(replayUrl, { headers: headers('bravo') })).status).toBe(403);
    const own = await fetch(replayUrl, { headers: headers() });
    expect(own.status).toBe(200);
    expect(own.headers.get('cache-control')).toBe('no-store');
    expect(await own.json()).toEqual({ success: true, replay: match.replay });
    for (const id of [legacy.id, unrelated.id, randomUUID()]) {
      const missing = await fetch(`${subject}/${id}/replay`, { headers: headers() });
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ success: false, error: 'Match replay not found.' });
    }
    const botReplay = await fetch(`${subject}/${botPractice.id}/replay`, { headers: headers() });
    expect(botReplay.status).toBe(200);
    expect(await botReplay.json()).toEqual({ success: true, replay: botPractice.replay });
    for (const url of [`${baseUrl}/api/account/history`, subject]) {
      const response = await fetch(url, { headers: headers() });
      const body = await response.json();
      expect(body.matches).toEqual([
        { id: match.id, roomCode: match.roomCode, finishedAt: 100,
          accountIds: match.accountIds, result: match.result, hasReplay: true },
        { id: botPractice.id, roomCode: botPractice.roomCode, finishedAt: 100,
          accountIds: botPractice.accountIds, result: botPractice.result, hasReplay: true },
        { id: legacy.id, roomCode: legacy.roomCode, finishedAt: 90,
          accountIds: legacy.accountIds, result: legacy.result },
      ]);
      expect(body.matches.every((entry: Record<string, unknown>) => !('replay' in entry) && !('log' in entry))).toBe(true);
    }
    await repository.updateProfile(accounts.alice.id, { matchesPublic: true }, Date.now());
    const publicReplay = await fetch(replayUrl, { headers: headers('bravo') });
    expect(publicReplay.status).toBe(200);
    expect(await publicReplay.json()).toEqual({ success: true, replay: match.replay });
    expect((await fetch(`${subject}/${unrelated.id}/replay`, { headers: headers('bravo') })).status).toBe(404);
    await repository.updateProfile(accounts.alice.id, { matchesPublic: false }, Date.now());
    expect((await fetch(replayUrl, { headers: headers('bravo') })).status).toBe(403);
    expect((await fetch(`${baseUrl}/api/players/${randomUUID()}/history/${match.id}/replay`, { headers: headers() })).status).toBe(404);
    for (const url of [`${subject}/invalid%20id/replay`, `${baseUrl}/api/players/invalid%20id/history/${match.id}/replay`]) {
      expect((await fetch(url, { headers: headers() })).status).toBe(400);
    }
    // Archives are read from the replay store on demand; a lost file reads as unavailable.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await unlink(join(directory, 'replays', `${match.id}.json`));
    expect((await fetch(replayUrl, { headers: headers() })).status).toBe(404);
    await repository.deleteAccountSessions(accounts.alice.id);
    expect((await fetch(replayUrl, { headers: headers() })).status).toBe(401);
  });

  it('should use the application error handler without exposing repository details', async () => {
    const lookup = repository.getAccountById.bind(repository);
    vi.spyOn(repository, 'getAccountById').mockImplementation(async (id) => {
      if (id === accounts.bravo.id) throw new Error('private database path and internal query');
      return lookup(id);
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await fetch(`${baseUrl}/api/players/${accounts.bravo.id}`, {
      headers: headers(),
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false,
      error: 'Unable to complete the request. Please try again.',
    });
  });
});
