import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessageEvent, PlayerInfo, Seat } from '@shared/types';
import type { PlayerSnapshot } from '@shared/types/socket-events';
import * as games from '../../src/managers/game-manager';
import * as blackjack from '../../src/managers/games/blackjack-game';
import * as rooms from '../../src/managers/room-manager';
import { createSocketHarness, SEATS } from '../performance/socket-harness';
import type { SocketHarness, TestClient } from '../performance/socket-harness';

const CODE = 'GOD123';
const PLAYERS: Record<Seat, PlayerInfo> = {
  N: player('north'), E: player('east'), S: player('south'), W: player('west'),
};

function player(id: string): PlayerInfo {
  return { id, username: id, nickname: id, color: '#123456', avatar: 'cat', avatarImage: null };
}

async function resume(client: TestClient): Promise<PlayerSnapshot> {
  const state = await client.timeout(5_000).emitWithAck('player:resume');
  expect(state.success).toBe(true);
  return state;
}

/** Starts the first fixture room's Bridge match and moves one member of the second room into it. */
async function watchedMatch(app: SocketHarness): Promise<{ players: TestClient[]; visitor: TestClient }> {
  const players = app.clients[0];
  for (const client of players) {
    expect(await client.timeout(5_000).emitWithAck('room:ready')).toEqual({ success: true });
  }
  const visitor = app.clients[1][0];
  expect(await visitor.timeout(5_000).emitWithAck('room:leave')).toEqual({ success: true });
  expect(await visitor.timeout(5_000).emitWithAck('room:join', { roomCode: app.roomCodes[0] }))
    .toMatchObject({ success: true });
  return { players, visitor };
}

describe('spectators', () => {
  let harness: SocketHarness | undefined;

  afterEach(async (): Promise<void> => {
    await harness?.close();
    harness = undefined;
  });

  it('should show spectators every hand without letting them act or end the match', async () => {
    const app = await (harness = await createSocketHarness(2));
    const { players, visitor } = await watchedMatch(app);
    const code = app.roomCodes[0];
    const visitorId = app.accountIds[1][0];
    const game = games.getGameState(code)!;

    const watching = await resume(visitor);
    expect(watching.room?.spectators?.map((spectator) => spectator.id)).toEqual([visitorId]);
    expect(watching.room?.observerIds).toEqual([visitorId]);
    const view = watching.gameState;
    if (view?.gameType !== 'bridge') throw new Error('Expected a Bridge view');
    expect(view.observer).toBe('spectator');
    expect(view.mySeat).toBe('S');
    expect(view.observedHands).toEqual(game.hands);

    const seated = (await resume(players[0])).gameState;
    expect(seated?.gameType).toBe('bridge');
    expect(seated).not.toHaveProperty('observer');
    expect(seated).not.toHaveProperty('observedHands');

    expect(await visitor.timeout(5_000).emitWithAck('game:bid', { bid: { type: 'pass' } }))
      .toEqual({ success: false, error: 'Select a seat first.' });
    expect(await visitor.timeout(5_000).emitWithAck('game:abortVote:start')).toMatchObject({ success: false });
    expect(await visitor.timeout(5_000).emitWithAck('room:changeSeat', { seat: 'N' })).toMatchObject({ success: false });
    expect(await visitor.timeout(5_000).emitWithAck('room:leave')).toEqual({ success: true });
    expect(rooms.getRoomInfo(code)?.status).toBe('playing');
    expect(games.getGameState(code)?.id).toBe(game.id);
  }, 20_000);

  it('should keep spectator chat away from seats still playing until the match ends', async () => {
    const app = await (harness = await createSocketHarness(2));
    const { players, visitor } = await watchedMatch(app);
    const received: string[] = [];
    players[1].on('chat:message', (event: ChatMessageEvent) => { received.push(event.message.content); });

    expect(await visitor.timeout(5_000).emitWithAck('chat:send', { message: 'north holds the ace' }))
      .toEqual({ success: true });
    expect(await players[0].timeout(5_000).emitWithAck('chat:send', { message: 'good luck' }))
      .toEqual({ success: true });
    // Deltas arrive in order, so the player's own later message proves the earlier one was withheld.
    expect(await players[1].timeout(5_000).emitWithAck('chat:send', { message: 'thanks' }))
      .toEqual({ success: true });
    await expect.poll(() => received).toContain('thanks');
    expect(received).toEqual(['good luck', 'thanks']);

    const playerChat = (await resume(players[2])).chatHistory?.map((message) => message.content);
    expect(playerChat).toEqual(['good luck', 'thanks']);
    const spectatorChat = (await resume(visitor)).chatHistory ?? [];
    expect(spectatorChat.map((message) => [message.content, message.audience])).toEqual([
      ['north holds the ace', 'observers'], ['good luck', undefined], ['thanks', undefined],
    ]);

    // Leaving aborts the match; afterwards everyone reads the whole history.
    expect(await players[3].timeout(5_000).emitWithAck('room:leave')).toEqual({ success: true });
    expect((await resume(players[2])).chatHistory?.map((message) => message.content))
      .toEqual(['north holds the ace', 'good luck', 'thanks']);
  }, 20_000);
});

describe('eliminated god view', () => {
  beforeEach(() => {
    games.restoreGames([]);
  });

  it('should add every hand for an eliminated seat only, after its elimination is shown', () => {
    games.startGame(CODE, 'ninetynine', PLAYERS);
    const game = games.getGameState(CODE);
    if (game?.gameType !== 'ninetynine') throw new Error('Expected a 99 game');
    game.hands.E = [];
    game.eliminated = ['E'];
    game.log.push({ type: 'eliminated', seat: 'E', timestamp: Date.now() });
    game.presentation = { id: 'elimination', startedAt: Date.now(), logStart: game.log.length - 1, timingVersion: 2 };

    const eliminated = games.getRecipientVisibleState(CODE, 'E');
    expect(eliminated?.gameType === 'ninetynine' && eliminated.observer).toBe('eliminated');
    expect(eliminated?.gameType === 'ninetynine' && eliminated.observedHands).toEqual(game.hands);
    expect(games.getPlayerVisibleState(CODE, 'E')).not.toHaveProperty('observedHands');
    expect(games.getRecipientVisibleState(CODE, 'N')).not.toHaveProperty('observer');
    expect(games.isEliminationShown(CODE, 'E')).toBe(false);
    expect(games.isEliminationShown(CODE, 'N')).toBe(false);

    game.presentation = { ...game.presentation, startedAt: 0 };
    expect(games.isEliminationShown(CODE, 'E')).toBe(true);
    // A later action's presentation does not hide an elimination that was already shown.
    game.presentation = { id: 'later', startedAt: Date.now(), logStart: game.log.length, timingVersion: 2 };
    expect(games.isEliminationShown(CODE, 'E')).toBe(true);
  });

  it('should reveal the Blackjack hole card to observers only', () => {
    blackjack.startGame(CODE, PLAYERS, 15_000, 1000);
    for (const seat of SEATS) expect(blackjack.bet(CODE, seat, 10, true, 1000, () => 0.5).success).toBe(true);
    const game = blackjack.getGameState(CODE)!;
    expect(game.phase).toBe('playing');
    expect(game.hole).not.toBeNull();
    const spectator = games.getRecipientVisibleState(CODE, null);
    expect(spectator?.gameType === 'blackjack' && spectator.observedHole).toEqual(game.hole);
    expect(games.getRecipientVisibleState(CODE, 'N')).not.toHaveProperty('observedHole');

    game.chips.W = 0;
    game.hands.W = [];
    game.log.push({
      type: 'settle', hand: 1, outcomes: { N: [], E: [], S: [], W: [] }, net: { N: 0, E: 0, S: 0, W: -10 },
      chips: { ...game.chips }, timestamp: 1000,
    });
    expect(games.getRecipientVisibleState(CODE, 'W')).toMatchObject({ observer: 'eliminated' });
  });
});
