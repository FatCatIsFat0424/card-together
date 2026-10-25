import { createElement } from 'react';
import type { ReactNode } from 'react';
import { renderToReadableStream, renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyReplayPatch } from '@shared/replay-patch';
import type { GameType, MatchReplay, MatchSummary, ReplaySnapshot } from '@shared/types';
import * as games from '../../src/managers/game-manager';

vi.mock('../../../client/src/socket', () => ({ socket: {}, disconnectSocket: () => undefined }));
vi.mock('../../../client/src/deployment', () => ({
  APP_BASE_PATH: '/', API_BASE_URL: '', SERVER_URL: '', SOCKET_PATH: '/socket.io',
}));
vi.mock('../../../client/src/components/ChatPanel', async () => {
  const react = await import('react');
  return { ChatPanel: () => react.createElement('div', { 'data-chat-panel': true }) };
});

import { ReplayViewer } from '../../../client/src/components/ReplayViewer';
import type { ReplayViewerProps } from '../../../client/src/components/ReplayViewer';
import { createTableStores, TableStoreScope } from '../../../client/src/games/TableStoreScope';
import { presentationMoment } from '../../../client/src/games/presentation-state';
import {
  createReplayTimeline, isPlayableReplay, presentedReplaySnapshot, replayParticipants, replayRoom, replaySeatOf,
} from '../../../client/src/match-replay';
import { useGameStore } from '../../../client/src/stores/game-store';
import { useGodViewStore } from '../../../client/src/stores/god-view-store';
import { useI18nStore } from '../../../client/src/stores/i18n-store';
import { useRoomStore } from '../../../client/src/stores/room-store';
import { useTablePerspectiveStore } from '../../../client/src/stores/table-perspective-store';
import { RECORDED_PLAYERS, recordMatch } from './replay-fixtures';
import type { RecordedMatch } from './replay-fixtures';

const recordings = new Map<GameType, RecordedMatch>();
const recorded = (gameType: GameType): RecordedMatch => {
  const known = recordings.get(gameType);
  if (known) return known;
  const created = recordMatch(gameType, `R${gameType.slice(0, 5).toUpperCase()}`);
  recordings.set(gameType, created);
  return created;
};

beforeAll(() => { useI18nStore.getState().setLocale('en'); });
afterEach(() => { games.restoreGames([]); });

describe('replay snapshot reconstruction', () => {
  it('rebuilds every recorded snapshot, in order and after arbitrary seeks', () => {
    const { replay, snapshots } = recorded('bigtwo');
    expect(replay.steps.length).toBeGreaterThan(40);
    const timeline = createReplayTimeline(replay);
    expect(timeline.total).toBe(snapshots.length - 1);
    for (let step = 0; step <= timeline.total; step++) expect(timeline.snapshot(step)).toEqual(snapshots[step]);
    // Backwards, across checkpoints, and out of range.
    for (const step of [timeline.total, 3, 70, 1, 33, 32, 0, 64, timeline.total - 1]) {
      expect(timeline.snapshot(step)).toEqual(snapshots[Math.min(step, timeline.total)]);
    }
    expect(timeline.snapshot(-5)).toEqual(snapshots[0]);
    expect(timeline.snapshot(10_000)).toEqual(snapshots.at(-1));
  });

  it('never mutates the archive and matches sequential patching', () => {
    const { replay } = recorded('liarsdeck');
    const archive = structuredClone(replay);
    const timeline = createReplayTimeline(replay);
    const folded = replay.steps.reduce<ReplaySnapshot>((snapshot, ops) => applyReplayPatch(snapshot, ops), replay.initial);
    expect(timeline.snapshot(timeline.total)).toEqual(folded);
    expect(replay).toEqual(archive);
  });

  it('records only the spectator view: every hand, no clock, no server time', () => {
    const { replay } = recorded('bigtwo');
    const timeline = createReplayTimeline(replay);
    for (const step of [0, 5, timeline.total]) {
      const snapshot = timeline.snapshot(step);
      expect(snapshot.observer).toBe('spectator');
      expect(snapshot).not.toHaveProperty('clock');
      expect(snapshot.presentation?.serverNow).toBeUndefined();
    }
    const initial = timeline.snapshot(0);
    expect(initial.gameType === 'bigtwo' && Object.keys(initial.observedHands ?? {})).toEqual(['N', 'E', 'S', 'W']);
  });

  it('rejects recordings that do not apply or belong to another match', () => {
    const { replay, match } = recorded('bigtwo');
    expect(isPlayableReplay(replay, match)).toBe(true);
    const broken: MatchReplay = { ...replay, steps: [...replay.steps, [{ op: 'append', path: ['phase'], values: [1] }]] };
    expect(isPlayableReplay(broken, match)).toBe(false);
    expect(isPlayableReplay({ ...replay, steps: [[{ op: 'set', path: ['__proto__', 'x'], value: 1 }]] }, match)).toBe(false);
    expect(isPlayableReplay({ ...replay, gameType: 'sevens' }, match)).toBe(false);
  });
});

describe('replay presentation timing', () => {
  it('plays an advanced step now and shows a sought step settled', () => {
    const { replay } = recorded('bigtwo');
    const timeline = createReplayTimeline(replay);
    const step = Array.from({ length: timeline.total }, (_, index) => index + 1)
      .find((index) => timeline.holdMs(index) > 900 && timeline.snapshot(index).presentation);
    if (!step) throw new Error('Expected a presented step.');
    const now = 5_000_000;
    const animated = presentedReplaySnapshot(timeline.snapshot(step - 1), timeline.snapshot(step), true);
    const settled = presentedReplaySnapshot(timeline.snapshot(step - 1), timeline.snapshot(step), false);
    expect(presentationMoment(animated, now, now)).toMatchObject({ locked: true, frameStartedAt: now });
    expect(presentationMoment(settled, now, now).locked).toBe(false);
    expect(timeline.snapshot(step).presentation?.serverNow).toBeUndefined();
  });

  it('leaves snapshots without a presentation untouched', () => {
    const { replay } = recorded('bigtwo');
    const { presentation: _presentation, ...plain } = replay.initial;
    const snapshot = plain as ReplaySnapshot;
    expect(presentedReplaySnapshot(null, snapshot, true)).toBe(snapshot);
  });
});

describe('replay participants', () => {
  const match: MatchSummary = {
    id: 'm', roomCode: 'OLD123', accountIds: ['account-N', 'gone', 'account-S', 'account-W'],
    result: recorded('bigtwo').match.result, finishedAt: 1, hasReplay: true,
  };

  it('names seats from recorded accounts and keeps plates for accounts no longer on record', () => {
    const participants = replayParticipants(match, RECORDED_PLAYERS, (seat) => `Seat ${seat}`);
    expect(participants.N).toMatchObject({ id: 'account-N', nickname: 'Recorded N', avatar: 'fox' });
    expect(participants.E).toMatchObject({ id: 'gone', nickname: 'Seat E' });
    expect(replaySeatOf(match, 'account-S')).toBe('S');
    expect(replaySeatOf(match, 'stranger')).toBeNull();
    const room = replayRoom(recorded('bigtwo').replay, match, participants);
    expect(room).toMatchObject({ code: 'OLD123', gameType: 'bigtwo', status: 'playing', hostId: '', abortVote: null });
    expect(room.seats.W.player?.nickname).toBe('Recorded W');
    expect(room).not.toHaveProperty('additionalSeats');
  });
});

describe('scoped table stores', () => {
  function Probe(): ReactNode {
    const code = useRoomStore((state) => state.roomInfo?.code ?? 'none');
    const phase = useGameStore((state) => state.phase ?? 'none');
    const seat = useTablePerspectiveStore((state) => state.seat);
    return createElement('p', null, `${code}:${phase}:${seat}`);
  }

  it('render against their own instances and leave the global stores alone', () => {
    const { replay, match } = recorded('bigtwo');
    const stores = createTableStores();
    const room = replayRoom(replay, match, replayParticipants(match, RECORDED_PLAYERS, (seat) => seat));
    stores.room.getState().setRoom(room.code, room);
    stores.game.getState().restore(replay.initial);
    stores.perspective.getState().selectSeat('W');
    expect(renderToStaticMarkup(createElement(TableStoreScope, { stores, children: createElement(Probe) })))
      .toBe('<p>OLD123:playing:W</p>');
    expect(renderToStaticMarkup(createElement(Probe))).toBe('<p>none:none:S</p>');
    // A null scope inside a scoped tree, as the shared replay's chat uses, reaches the live stores.
    expect(renderToStaticMarkup(createElement(TableStoreScope, { stores,
      children: createElement(TableStoreScope, { stores: null, children: createElement(Probe) }) }))).toBe('<p>none:none:S</p>');
    expect(useRoomStore.getState().roomInfo).toBeNull();
    expect(useGameStore.getState().visible).toBeNull();
  });
});

describe('replay viewer', () => {
  async function render(recording: RecordedMatch, props: Partial<ReplayViewerProps> = {}): Promise<string> {
    const stream = await renderToReadableStream(createElement(MemoryRouter, null, createElement(ReplayViewer, {
      replay: recording.replay, match: recording.match, players: RECORDED_PLAYERS, viewedAccountId: 'account-E',
      step: 4, playing: false, speed: 1, onControl: () => undefined, controlsEnabled: true, onClose: () => undefined,
      ...props,
    })));
    await stream.allReady;
    return new Response(stream).text();
  }

  it('renders the recorded table with historical names and no live room', async () => {
    const html = await render(recorded('bigtwo'));
    expect(html).toContain('data-replay-viewer="bigtwo"');
    expect(html).toContain('data-game-shell');
    for (const seat of ['N', 'E', 'S', 'W']) expect(html).toContain(`Recorded ${seat}`);
    expect(html).not.toContain('Live N');
    expect(html).toContain('Spectating');
    // The viewed account sits at the bottom.
    expect(/data-table-seat="bottom"[^]*?Recorded ([NESW])/.exec(html)?.[1]).toBe('E');
    expect(html).not.toContain('data-chat-panel');
    expect(html).not.toContain('OLD123');
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('4 / ');
    expect(useRoomStore.getState().roomInfo).toBeNull();
    expect(useGameStore.getState().visible).toBeNull();
    expect(useGodViewStore.getState().role).toBeNull();
    expect(useTablePerspectiveStore.getState().seat).toBe('S');
  });

  it('shows the recorded result without acting on a room', async () => {
    const recording = recorded('liarsdeck');
    const html = await render(recording, { step: recording.replay.steps.length });
    expect(html).toContain('role="dialog"');
    expect(html).not.toContain('Back to Room');
  });

  it('disables every control for members of a host-controlled replay and can keep the room chat', async () => {
    const html = await render(recorded('bigtwo'), { controlsEnabled: false, chat: true, onClose: undefined });
    expect(html).toContain('Only the host controls playback');
    expect(html).toContain('data-chat-panel');
    // The lazily loaded table streams in after the transport.
    const toolbar = html.slice(html.indexOf('role="toolbar"'), html.indexOf('<div hidden'));
    expect(toolbar).not.toContain('aria-label="Close"');
    expect(toolbar.match(/<button[^>]*>/g)?.every((button) => button.includes('disabled'))).toBe(true);
  });
});
