import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatchReplay, ReplaySnapshot } from '@shared/types';
import type { MatchRecord } from '../../src/database/repository';
import * as rooms from '../../src/managers/room-manager';
import { createRuntimeCoordinator } from '../../src/runtime/coordinator';
import { isRuntimeSnapshot } from '../../src/runtime/validate';
import { createSocketHarness } from '../performance/socket-harness';
import type { SocketHarness } from '../performance/socket-harness';

const REPLAY: MatchReplay = {
  version: 1, gameType: 'bridge', startedAt: 1,
  initial: { gameType: 'bridge', phase: 'bidding' } as unknown as ReplaySnapshot,
  steps: [[{ op: 'set', path: ['phase'], value: 'playing' }], [], [{ op: 'append', path: ['log'], values: [1] }]],
};

function recordedMatch(id: string, accountIds: readonly string[], recorded = true): MatchRecord {
  return {
    id, roomCode: 'OLD123', accountIds, finishedAt: 100,
    result: { gameType: 'bridge', contract: { level: 1, suit: 'nt', declarer: 'N' },
      declarerTeamTricks: 7, defenderTeamTricks: 6, requiredTricks: 7, declarerTeamWins: true },
    ...(recorded ? { hasReplay: true as const } : {}),
  };
}

/** Matches are served from a stub so the test does not depend on the archive validator. */
function stubHistory(app: SocketHarness, matches: readonly MatchRecord[]): void {
  vi.spyOn(app.repository, 'listMatches').mockImplementation(async (accountId) =>
    matches.filter((match) => match.accountIds.includes(accountId)));
  vi.spyOn(app.repository, 'getMatchReplay').mockImplementation(async (matchId) =>
    matches.some((match) => match.id === matchId && match.hasReplay) ? structuredClone(REPLAY) : undefined);
}

describe('shared room replay over sockets', () => {
  let harness: SocketHarness | undefined;
  afterEach(async () => { await harness?.close(); harness = undefined; vi.restoreAllMocks(); });

  it('checks the host and the subject history permission before starting', async () => {
    const app = await (harness = await createSocketHarness(1));
    const [host, guest] = app.clients[0];
    const [hostId, guestId] = app.accountIds[0];
    const guestOnly = recordedMatch('guest-match', [guestId, 'x', 'y', 'z']);
    const unrecorded = recordedMatch('legacy-match', [hostId, guestId, 'y', 'z'], false);
    stubHistory(app, [recordedMatch('own-match', [hostId, 'x', 'y', 'z']), guestOnly, unrecorded]);
    for (const payload of [null, { subjectId: hostId }, { subjectId: '../x', matchId: 'own-match' }]) {
      expect(await host.emitWithAck('room:replay:start', payload as never))
        .toEqual({ success: false, error: 'Choose a match to replay.' });
    }
    expect(await guest.emitWithAck('room:replay:start', { subjectId: guestId, matchId: 'guest-match' }))
      .toEqual({ success: false, error: 'Only the host can control the replay.' });
    expect(await host.emitWithAck('room:replay:start', { subjectId: guestId, matchId: 'guest-match' }))
      .toEqual({ success: false, error: 'Match history is private.' });
    expect(await host.emitWithAck('room:replay:start', { subjectId: hostId, matchId: 'guest-match' }))
      .toEqual({ success: false, error: 'Match replay not found.' });
    expect(await host.emitWithAck('room:replay:start', { subjectId: hostId, matchId: 'legacy-match' }))
      .toEqual({ success: false, error: 'Match replay not found.' });
    expect(await host.emitWithAck('room:replay:start', { subjectId: 'missing-account', matchId: 'own-match' }))
      .toEqual({ success: false, error: 'Player not found.' });
    expect(rooms.getRoomInfo(app.roomCodes[0])?.status).toBe('waiting');

    await app.repository.updateProfile(guestId, { matchesPublic: true }, Date.now());
    expect(await host.emitWithAck('room:replay:start', { subjectId: guestId, matchId: 'guest-match' }))
      .toEqual({ success: true });
    expect(rooms.getRoomInfo(app.roomCodes[0])?.replay).toMatchObject({
      matchId: 'guest-match', subjectId: guestId, gameType: 'bridge', startedBy: hostId, lastStep: 3,
    });
    expect(await host.emitWithAck('room:replay:end')).toEqual({ success: true });
    expect(await host.emitWithAck('room:replay:start', { subjectId: hostId, matchId: 'own-match' }))
      .toEqual({ success: true });
  });

  it('broadcasts the session without the archive, locks the room, and keeps chat open', async () => {
    const app = await (harness = await createSocketHarness(1));
    const [host, guest] = app.clients[0];
    const [hostId, guestId] = app.accountIds[0];
    stubHistory(app, [recordedMatch('own-match', [hostId, guestId, 'y', 'z'])]);
    app.resetMetrics();
    expect(await host.emitWithAck('room:replay:start', { subjectId: hostId, matchId: 'own-match' }))
      .toEqual({ success: true });
    for (const id of app.accountIds[0]) {
      const snapshot = app.metrics.latestSnapshots.get(id)!;
      expect(snapshot.room).toMatchObject({ status: 'replaying', replay: { matchId: 'own-match', playing: true } });
      expect(snapshot.serverNow).toEqual(expect.any(Number));
      expect(snapshot.gameState).toBeUndefined();
      expect(JSON.stringify(snapshot)).not.toContain('"steps"');
    }
    expect(app.metrics.chatViews.get(guestId)?.at(-1)).toMatchObject({ system: true, content: 'replay.sharedStarted' });
    expect(await host.emitWithAck('room:start')).toEqual({ success: false, error: 'A replay is in progress.' });
    expect(await host.emitWithAck('room:setGameType', { gameType: 'bigtwo' })).toMatchObject({ success: false });
    expect(await guest.emitWithAck('room:standUp')).toMatchObject({ success: false });
    expect(await guest.emitWithAck('room:unready')).toMatchObject({ success: false });
    expect(await host.emitWithAck('room:addBot', { seat: 'N' })).toMatchObject({ success: false });
    expect(await host.emitWithAck('room:replay:start', { subjectId: hostId, matchId: 'own-match' }))
      .toEqual({ success: false, error: 'Replays start from the waiting room.' });
    expect(await guest.emitWithAck('chat:send', { message: 'nice play' })).toEqual({ success: true });
    expect(app.metrics.chatViews.get(hostId)?.at(-1)).toMatchObject({ content: 'nice play' });
  });

  it('serves the archive only to current members while the session is active', async () => {
    const app = await (harness = await createSocketHarness(2));
    const [host, guest] = app.clients[0];
    const [hostId, guestId] = app.accountIds[0];
    const outsider = app.clients[1][1];
    const match = recordedMatch('own-match', [hostId, guestId, 'y', 'z']);
    stubHistory(app, [match]);
    expect(await guest.emitWithAck('room:replay:load')).toEqual({ success: false, error: 'No replay in progress.' });
    expect(await host.emitWithAck('room:replay:start', { subjectId: hostId, matchId: 'own-match' }))
      .toEqual({ success: true });
    // The subject may make the history private later; the host's permission was checked at start.
    const loaded = await guest.emitWithAck('room:replay:load');
    expect(loaded).toEqual({ success: true, archive: {
      match: { id: 'own-match', roomCode: 'OLD123', accountIds: match.accountIds, result: match.result,
        finishedAt: 100, hasReplay: true },
      replay: REPLAY,
      players: { [hostId]: expect.objectContaining({ id: hostId }), [guestId]: expect.objectContaining({ id: guestId }) },
    } });
    expect(await outsider.emitWithAck('room:replay:load')).toEqual({ success: false, error: 'No replay in progress.' });
    expect(await outsider.emitWithAck('room:leave')).toEqual({ success: true });
    expect(await outsider.emitWithAck('room:replay:load')).toEqual({ success: false, error: 'Join a room first.' });
    // Later joiners watch too.
    expect(await outsider.emitWithAck('room:join', { roomCode: app.roomCodes[0] })).toMatchObject({ success: true });
    expect(await outsider.emitWithAck('room:replay:load')).toMatchObject({ success: true, archive: { replay: REPLAY } });
    expect(await host.emitWithAck('room:replay:end')).toEqual({ success: true });
    expect(await guest.emitWithAck('room:replay:load')).toEqual({ success: false, error: 'No replay in progress.' });
  });

  it('lets only the current host control and end playback, including after a host transfer', async () => {
    const app = await (harness = await createSocketHarness(1));
    const [host, guest, third] = app.clients[0];
    const [hostId, guestId] = app.accountIds[0];
    const code = app.roomCodes[0];
    stubHistory(app, [recordedMatch('own-match', [hostId, guestId, 'y', 'z'])]);
    expect(await host.emitWithAck('room:replay:control', { step: 1, playing: false, speed: 1 }))
      .toEqual({ success: false, error: 'No replay in progress.' });
    expect(await host.emitWithAck('room:replay:start', { subjectId: hostId, matchId: 'own-match' }))
      .toEqual({ success: true });
    expect(await guest.emitWithAck('room:replay:control', { step: 1, playing: false, speed: 1 }))
      .toEqual({ success: false, error: 'Only the host can control the replay.' });
    for (const payload of [{ step: 4, playing: false, speed: 1 }, { step: 1, playing: false, speed: 10 }, null]) {
      expect(await host.emitWithAck('room:replay:control', payload as never))
        .toEqual({ success: false, error: 'Invalid replay position.' });
    }
    const before = Date.now();
    expect(await host.emitWithAck('room:replay:control', { step: 2, playing: false, speed: 2 })).toEqual({ success: true });
    const session = rooms.getRoomInfo(code)?.replay;
    expect(session).toMatchObject({ anchorStep: 2, playing: false, speed: 2 });
    expect(session!.anchorAt).toBeGreaterThanOrEqual(before);
    expect(app.metrics.latestSnapshots.get(guestId)?.room?.replay).toEqual(session);
    expect(await guest.emitWithAck('room:replay:end')).toEqual({ success: false, error: 'Only the host can control the replay.' });

    expect(await host.emitWithAck('room:leave')).toEqual({ success: true });
    expect(rooms.getRoomInfo(code)).toMatchObject({ hostId: guestId, status: 'replaying', replay: { anchorStep: 2 } });
    expect(await third.emitWithAck('room:replay:control', { step: 3, playing: true, speed: 1 }))
      .toMatchObject({ success: false });
    expect(await guest.emitWithAck('room:replay:control', { step: 3, playing: true, speed: 1 })).toEqual({ success: true });
    expect(await guest.emitWithAck('room:replay:end')).toEqual({ success: true });
    expect(rooms.getRoomInfo(code)?.status).toBe('waiting');
    expect(app.metrics.latestSnapshots.get(guestId)?.serverNow).toBeUndefined();
  });

  it('keeps the session through a runtime restart', async () => {
    const app = await (harness = await createSocketHarness(1));
    const [host, guest] = app.clients[0];
    const [hostId] = app.accountIds[0];
    const code = app.roomCodes[0];
    stubHistory(app, [recordedMatch('own-match', [hostId, 'x', 'y', 'z'])]);
    expect(await host.emitWithAck('room:replay:start', { subjectId: hostId, matchId: 'own-match' }))
      .toEqual({ success: true });
    expect(await host.emitWithAck('room:replay:control', { step: 1, playing: true, speed: 4 })).toEqual({ success: true });
    const session = rooms.getRoomInfo(code)?.replay;
    const saved = await app.repository.loadRuntime();
    expect(isRuntimeSnapshot(structuredClone(saved))).toBe(true);
    rooms.restoreRooms([]);
    await createRuntimeCoordinator({ loadRuntime: async () => structuredClone(saved), saveRuntime: async () => undefined });
    expect(rooms.getRoomInfo(code)).toMatchObject({ status: 'replaying', replay: session });
    expect(await guest.emitWithAck('room:replay:load')).toMatchObject({ success: true });
  });

  it('loads the archive from the replay store, and reports it missing once pruned', async () => {
    const app = await (harness = await createSocketHarness(1));
    const [host, guest] = app.clients[0];
    const [hostId] = app.accountIds[0];
    const replay: MatchReplay = { ...REPLAY, steps: REPLAY.steps.slice(0, 1) };
    const { hasReplay: _flag, ...match } = recordedMatch('stored-match', app.accountIds[0]);
    await app.repository.saveMatch({ ...match, replay });
    expect(await app.repository.listMatches(hostId)).toEqual([{ ...match, hasReplay: true }]);
    expect(await host.emitWithAck('room:replay:start', { subjectId: hostId, matchId: 'stored-match' }))
      .toEqual({ success: true });
    expect(rooms.getRoomInfo(app.roomCodes[0])?.replay).toMatchObject({ lastStep: replay.steps.length });
    expect(await guest.emitWithAck('room:replay:load')).toMatchObject({ success: true, archive: { replay } });
    vi.spyOn(app.repository, 'getMatchReplay').mockResolvedValue(undefined);
    expect(await guest.emitWithAck('room:replay:load')).toEqual({ success: false, error: 'Match replay not found.' });
  });
});
