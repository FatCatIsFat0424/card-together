import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GAME_TYPES } from '@shared/constants';
import type { GameType, MatchReplay, MatchResult } from '@shared/types';
import { dropUnplayableRecordings, isMatchReplay, isReplayRecording } from '../../src/database/match-replay';
import { createJsonRepository } from '../../src/database/json-repository';
import { emptyDocument } from '../../src/database/schema';
import type { AccountRecord, MatchRecord, NewMatchRecord } from '../../src/database/repository';

const card = { suit: 'clubs', rank: 2 };
const initial = (gameType: GameType = 'bridge'): Record<string, unknown> => ({
  gameType, phase: 'playing', observedHands: { N: [card], E: [] }, log: [],
  presentation: { id: 'start', startedAt: 10, logStart: 0, timingVersion: 3 },
});
const steps = [
  [{ op: 'append', path: ['log'], values: [{ type: 'play', seat: 'N', card, timestamp: 20 }] },
    { op: 'set', path: ['observedHands', 'N'], value: [] }],
  [{ op: 'delete', path: ['presentation'] }, { op: 'set', path: ['phase'], value: 'scoring' }],
];
const archive = (gameType: GameType = 'bridge'): Record<string, unknown> => ({
  version: 1, gameType, startedAt: 10, initial: initial(gameType), steps,
});
const bridgeResult = { gameType: 'bridge' } as MatchResult;

describe('match replay validation', () => {
  it.each<GameType>(GAME_TYPES)('accepts a %s archive whose steps apply in order', (gameType) => {
    expect(isMatchReplay(archive(gameType), { gameType } as MatchResult, 30)).toBe(true);
    expect(isMatchReplay({ ...archive(gameType), steps: [] }, { gameType } as MatchResult, 30)).toBe(true);
  });

  it('rejects mismatched versions, types, times and unexpected fields', () => {
    const valid = archive();
    for (const invalid of [null, [], {}, { ...valid, version: 2 }, { ...valid, version: '1' },
      { ...valid, gameType: 'holdem' }, { ...valid, initial: initial('holdem') }, { ...valid, log: [] },
      { ...valid, table: { frames: [] } },
      ...['version', 'gameType', 'startedAt', 'initial', 'steps'].map((key) => {
        const missing = { ...valid };
        delete missing[key];
        return missing;
      }),
      ...[-1, 31, 10.5, Infinity, Number.MAX_SAFE_INTEGER + 1].map((startedAt) => ({ ...valid, startedAt })),
    ]) expect(isMatchReplay(invalid, bridgeResult, 30), JSON.stringify(invalid)).toBe(false);
  });

  it('rejects malformed operations, unsafe keys, and steps that do not apply', () => {
    const invalidSteps: unknown[][] = [
      [], [{ op: 'replace', path: ['phase'], value: 1 }],
      [{ op: 'set', path: ['phase'] }], [{ op: 'set', path: 'phase', value: 1 }],
      [{ op: 'set', path: [1], value: 1 }], [{ op: 'set', path: [''], value: 1 }],
      [{ op: 'set', path: ['phase'], value: 1, extra: true }],
      [{ op: 'append', path: ['log'], values: [] }], [{ op: 'append', path: ['log'], values: 'x' }],
      [{ op: 'delete', path: [] }], [{ op: 'delete', path: ['phase'], value: 1 }],
      ...['__proto__', 'constructor', 'prototype'].map((key) => [{ op: 'set', path: ['observedHands', key], value: 1 }]),
      [{ op: 'set', path: ['observedHands'], value: JSON.parse('{"__proto__":{"polluted":true}}') }],
      [{ op: 'set', path: ['phase'], value: Number.NaN }],
      [{ op: 'set', path: Array.from({ length: 33 }, () => 'deep'), value: 1 }],
      // Appending to an object, or descending into an array or a missing parent, cannot apply.
      [{ op: 'append', path: ['observedHands'], values: [1] }],
      [{ op: 'set', path: ['log', 'length'], value: 0 }],
      [{ op: 'set', path: ['missing', 'child'], value: 0 }],
      // Snapshots keep their game, never gain a clock, and never carry a server time.
      [{ op: 'set', path: ['gameType'], value: 'holdem' }], [{ op: 'delete', path: ['gameType'] }],
      [{ op: 'set', path: ['clock'], value: {} }], [{ op: 'set', path: ['presentation', 'serverNow'], value: 1 }],
      [{ op: 'set', path: [], value: [] }],
    ];
    for (const step of invalidSteps) {
      expect(isMatchReplay({ ...archive(), steps: [step] }, bridgeResult, 30), JSON.stringify(step)).toBe(false);
    }
    expect(isMatchReplay({ ...archive(), steps: [[]] }, bridgeResult, 30)).toBe(false);
    expect(isMatchReplay({ ...archive(), steps: 'none' }, bridgeResult, 30)).toBe(false);
    expect(isMatchReplay({ ...archive(), steps: Array.from({ length: 50_001 }, () => steps[0]) }, bridgeResult, 30))
      .toBe(false);
    expect(isMatchReplay({ ...archive(), steps: [Array.from({ length: 2_001 }, () => steps[1][1])] }, bridgeResult, 30))
      .toBe(false);
  });

  it('rejects snapshots carrying a clock, server time or unsafe keys', () => {
    for (const snapshot of [{ ...initial(), clock: {} },
      { ...initial(), presentation: { id: 'x', startedAt: 1, logStart: 0, serverNow: 5 } },
      { ...initial(), extra: JSON.parse('{"__proto__":{"polluted":true}}') },
      { ...initial(), log: [{ type: 'play', constructor: 1 }] }, 'bridge', null,
    ]) expect(isMatchReplay({ ...archive(), initial: snapshot }, bridgeResult, 30), JSON.stringify(snapshot)).toBe(false);
  });

  it('validates runtime recordings without the archive envelope', () => {
    expect(isReplayRecording({ initial: initial(), steps }, 'bridge')).toBe(true);
    expect(isReplayRecording({ initial: initial(), steps, version: 1 }, 'bridge')).toBe(false);
    expect(isReplayRecording({ initial: initial(), steps }, 'holdem')).toBe(false);
    expect(isReplayRecording({ frames: [] }, 'bridge')).toBe(false);
    // Structure-only checks accept a well-formed step that does not apply; full checks reject it.
    const inapplicable = { initial: initial(), steps: [[{ op: 'set', path: ['missing', 'child'], value: 0 }]] };
    expect(isReplayRecording(inapplicable, 'bridge', false)).toBe(true);
    expect(isReplayRecording(inapplicable, 'bridge')).toBe(false);
    expect(isReplayRecording({ ...inapplicable, steps: [[{ op: 'set', path: ['__proto__'], value: 0 }]] }, 'bridge', false))
      .toBe(false);
  });

  it('drops only unplayable in-progress recordings at load so the match continues unrecorded', () => {
    const inapplicable = { initial: initial(), steps: [[{ op: 'set', path: ['missing', 'child'], value: 0 }]] };
    const document = { runtime: { games: [
      { id: 'damaged', gameType: 'bridge', replayRecording: inapplicable },
      { id: 'healthy', gameType: 'bridge', replayRecording: { initial: initial(), steps } },
      { id: 'unrecorded', gameType: 'bridge' },
    ] } };
    expect(dropUnplayableRecordings(document)).toEqual(['damaged']);
    expect(document.runtime.games.map((game) => 'replayRecording' in game)).toEqual([false, true, false]);
    // Malformed recordings are corruption, left for schema validation to reject.
    const malformed = { runtime: { games: [{ id: 'bad', gameType: 'bridge', replayRecording: { frames: [] } }] } };
    expect(dropUnplayableRecordings(malformed)).toEqual([]);
    expect(malformed.runtime.games[0].replayRecording).toEqual({ frames: [] });
    expect(dropUnplayableRecordings({ runtime: null })).toEqual([]);
  });
});

describe('stored archive compatibility', () => {
  it('roundtrips replay flags, rejects invalid archives and refuses inline archives at startup without rewriting them', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'card-replay-schema-'));
    const path = join(directory, 'database.json');
    let repository = await createJsonRepository(path);
    try {
      const accounts: AccountRecord[] = ['alice', 'bravo', 'charlie', 'delta'].map((username) => ({
        id: username, username, usernameNormalized: username, nickname: username, color: '#123456', avatar: 'cat',
        avatarImage: null, tableBackground: null, tableBackgroundOpacity: 100, cardBack: null, cardBackOpacity: 100,
        matchesPublic: false, passwordHash: `scrypt$131072$8$1$${'ab'.repeat(16)}$${'cd'.repeat(64)}`, createdAt: 1, updatedAt: 1,
      }));
      const legacy: MatchRecord = {
        id: 'legacy', roomCode: 'ABC123', accountIds: accounts.map((entry) => entry.id), finishedAt: 30,
        result: { gameType: 'bridge', contract: { level: 1, suit: 'nt', declarer: 'N' }, declarerTeamTricks: 7,
          defenderTeamTricks: 6, requiredTricks: 7, declarerTeamWins: true },
      };
      await repository.close();
      await writeFile(path, JSON.stringify({ ...emptyDocument(), accounts, matches: [legacy] }));
      repository = await createJsonRepository(path);
      await repository.saveMatch({ ...legacy, id: 'archived', finishedAt: 31, replay: archive() as unknown as MatchReplay });
      const completed: MatchRecord = { ...legacy, id: 'archived', finishedAt: 31, hasReplay: true };
      const expected = [completed, legacy];
      expect(await repository.listMatches('alice')).toEqual(expected);
      const before = await readFile(path, 'utf8');
      await expect(repository.saveMatch({ ...legacy, id: 'old-format',
        replay: { version: 2, gameType: 'bridge', startedAt: 10, log: [], table: { frames: [] } } } as unknown as NewMatchRecord))
        .rejects.toMatchObject({ code: 'INVALID_REPLAY' });
      expect(await repository.listMatches('alice')).toEqual(expected);
      expect(await readFile(path, 'utf8')).toBe(before);
      await repository.close();
      repository = await createJsonRepository(path);
      expect(await repository.listMatches('alice')).toEqual(expected);
      expect(await repository.getMatchReplay('archived')).toEqual(archive());
      await repository.close();
      // Archives never shipped inside the database; an inline one is rejected rather than kept.
      for (const inline of [{ ...legacy, replay: archive() }, { ...legacy, hasReplay: false }]) {
        const rejected = JSON.stringify({ ...emptyDocument(), accounts, matches: [inline] });
        await writeFile(path, rejected);
        await expect(createJsonRepository(path)).rejects.toThrow('schema');
        expect(await readFile(path, 'utf8')).toBe(rejected);
      }
    } finally {
      await repository.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
