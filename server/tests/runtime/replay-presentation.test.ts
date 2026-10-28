import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getPresentationFrames } from '@shared/game-presentation';
import { applyReplayPatch } from '@shared/replay-patch';
import type { Card, GameType, PlayerInfo, ReplayRecording, ReplaySnapshot, Seat } from '@shared/types';
import type { AccountRecord } from '../../src/database/repository';
import { createJsonRepository } from '../../src/database/json-repository';
import { createDeck } from '../../src/engine/deck';
import * as games from '../../src/managers/game-manager';
import * as holdem from '../../src/managers/games/holdem-game';
import * as liar from '../../src/managers/games/liarsdeck-game';
import * as stud from '../../src/managers/games/stud-game';
import * as players from '../../src/managers/player-manager';
import * as rooms from '../../src/managers/room-manager';
import { createRuntimeCoordinator } from '../../src/runtime/coordinator';
import type { RuntimeCoordinator } from '../../src/runtime/coordinator';

const seats: readonly Seat[] = ['N', 'E', 'S', 'W'];
const card = (rank: Card['rank'], suit: Card['suit'] = 'spades'): Card => ({ suit, rank });
const key = (value: Card): string => `${value.suit}${value.rank}`;

/** Draws that make the deck shuffle deal `top` first. */
function shuffleDraws(top: readonly Card[]): number[] {
  const rest = createDeck().filter((value) => !top.some((wanted) => key(wanted) === key(value)));
  const target = [...top, ...rest];
  const deck = createDeck();
  const draws: number[] = [];
  for (let index = deck.length - 1; index > 0; index--) {
    const selected = deck.findIndex((value) => key(value) === key(target[index]));
    draws.push((selected + 0.5) / (index + 1));
    [deck[index], deck[selected]] = [deck[selected], deck[index]];
  }
  return draws;
}

function randomSequence(draws: readonly number[]): () => number {
  let index = 0;
  return () => draws[index++] ?? 0.5;
}

interface TestContext {
  readonly code: string;
  readonly runtime: RuntimeCoordinator;
  readonly close: () => Promise<void>;
}

async function setup(
  gameType: GameType, start: (code: string, seated: Record<Seat, PlayerInfo>) => void,
): Promise<TestContext> {
  const directory = await mkdtemp(join(tmpdir(), 'card-replay-presentation-'));
  const repository = await createJsonRepository(join(directory, 'database.json'));
  const accounts: AccountRecord[] = seats.map((seat) => ({
    id: seat, username: `player_${seat.toLowerCase()}`, usernameNormalized: `player_${seat.toLowerCase()}`, nickname: seat,
    color: '#123456', avatar: 'cat', avatarImage: null, tableBackground: null, tableBackgroundOpacity: 100, cardBack: null,
    cardBackOpacity: 100, matchesPublic: false, createdAt: 1, updatedAt: 1,
    passwordHash: `scrypt$131072$8$1$${'ab'.repeat(16)}$${'cd'.repeat(64)}`,
  }));
  for (const account of accounts) await repository.createAccount(account);
  const runtime = await createRuntimeCoordinator(repository);
  let code = '';
  await runtime.mutate(() => {
    code = rooms.createRoom(gameType, 'N');
    for (const [index, account] of accounts.entries()) {
      const info = players.toPlayerInfo(account);
      players.attachPlayer(`socket-${account.id}`, info);
      if (index > 0) rooms.joinRoom(code, account.id);
      players.setPlayerRoom(account.id, code);
      rooms.changeSeat(code, info, seats[index]);
    }
    rooms.setRoomStatus(code, 'playing');
    start(code, rooms.getSeatPlayers(code)! as Record<Seat, PlayerInfo>);
  });
  return { code, runtime, close: async (): Promise<void> => {
    await repository.close();
    await rm(directory, { recursive: true, force: true });
  } };
}

/** Runs one facade action, which attaches the live presentation, without waiting for the previous one. */
async function present(context: TestContext, operation: () => { success: boolean }): Promise<ReplaySnapshot> {
  await context.runtime.mutate(() => {
    delete games.getGameState(context.code)!.presentation;
    expect(operation().success).toBe(true);
  });
  const recording: ReplayRecording = games.getGameState(context.code)!.replayRecording!;
  return recording.steps.reduce<ReplaySnapshot>((snapshot, step) => applyReplayPatch(snapshot, step), recording.initial);
}

afterEach(() => {
  games.restoreGames([]);
  rooms.restoreRooms([]);
  players.restorePlayers([]);
});

describe('recorded presentation stages', () => {
  it('keeps the Hold\'em runout, showdown and award in the step that deals the next hand', async () => {
    const board = [card(13), card(13, 'hearts'), card(5, 'diamonds'), card(6, 'hearts'), card(11, 'clubs')];
    const random = randomSequence([0.99, ...shuffleDraws([
      card(14), card(2), card(3, 'hearts'), card(4, 'hearts'), card(14, 'clubs'), card(7, 'diamonds'),
      card(8, 'clubs'), card(9, 'clubs'), ...board,
    ])]);
    const context = await setup('holdem', (code, seated) => holdem.startGame(code, seated, random));
    try {
      const { code } = context;
      for (const seat of ['S', 'W'] as const) {
        await present(context, () => games.handleHoldemAction(code, seat, { type: 'fold' }, true));
      }
      await present(context, () => games.handleHoldemAction(code, 'N', { type: 'raise', to: 1000 }, true));
      const { hands } = holdem.getGameState(code)!;
      const hole = { N: hands.N, E: hands.E };
      // Calling the all-in runs the board out and deals the next hand within one operation.
      const snapshot = await present(context, () => games.handleHoldemAction(code, 'E', { type: 'call' }, true));
      if (snapshot.gameType !== 'holdem') throw new Error('Expected Hold\'em.');
      expect(snapshot.hand).toBe(2);
      expect(snapshot.presentation).not.toHaveProperty('serverNow');
      const kinds = getPresentationFrames(snapshot).map((frame) => frame.kind);
      expect(kinds).toEqual(['allIn', 'street', 'street', 'street', 'showdown', 'award', 'deal']);
      const showdown = snapshot.log.find((entry) => entry.type === 'showdown');
      expect(showdown).toMatchObject({ cards: hole });
      expect(snapshot.log.filter((entry) => entry.type === 'street').flatMap((entry) => entry.cards)).toEqual(board);
    } finally { await context.close(); }
  });

  it('keeps the stud runout, showdown and award in the step that deals the next hand', async () => {
    const deal = [
      card(14), card(2), card(3, 'hearts'), card(4, 'hearts'), card(14, 'hearts'), card(7, 'diamonds'), card(8, 'clubs'),
      card(9, 'clubs'), card(13), card(5, 'diamonds'), card(12), card(6, 'hearts'), card(11), card(10, 'clubs'),
    ];
    const random = randomSequence([0.99, ...shuffleDraws(deal)]);
    const context = await setup('stud', (code, seated) => stud.startGame(code, seated, random));
    try {
      const { code } = context;
      const { hands } = stud.getGameState(code)!;
      await present(context, () => games.handleGameAction(code, 'N', { gameType: 'stud', action: { type: 'raise', to: 990 } }, true));
      await present(context, () => games.handleGameAction(code, 'E', { gameType: 'stud', action: { type: 'call' } }, true));
      await present(context, () => games.handleGameAction(code, 'S', { gameType: 'stud', action: { type: 'fold' } }, true));
      // Folding the last open seat runs the remaining up cards out and deals the next hand within one operation.
      const snapshot = await present(context, () => games.handleGameAction(code, 'W', { gameType: 'stud', action: { type: 'fold' } }, true));
      if (snapshot.gameType !== 'stud') throw new Error('Expected stud.');
      expect(snapshot.hand).toBe(2);
      expect(snapshot.presentation).not.toHaveProperty('serverNow');
      const kinds = getPresentationFrames(snapshot).map((frame) => frame.kind);
      expect(kinds).toEqual(['fold', 'street', 'street', 'street', 'showdown', 'award', 'deal', 'street']);
      const showdown = snapshot.log.find((entry) => entry.type === 'showdown');
      expect(showdown).toMatchObject({ cards: { N: hands.N, E: hands.E, S: [], W: [] } });
    } finally { await context.close(); }
  });

  it('keeps the Liar\'s Deck challenge and shot in the step that starts the next round', async () => {
    const context = await setup('liarsdeck', (code, seated) => liar.startGame(code, seated));
    try {
      const { code } = context;
      const first = liar.getGameState(code)!;
      const actor = first.currentTurnSeat;
      const played = first.hands[actor][0];
      await present(context, () => games.handleLiarsDeckPlay(code, actor, [played.id], true));
      const before = liar.getGameState(code)!;
      const round = before.round;
      const snapshot = await present(context, () => games.handleLiarsDeckChallenge(code, before.currentTurnSeat, true));
      if (snapshot.gameType !== 'liarsdeck') throw new Error('Expected Liar\'s Deck.');
      expect(snapshot.round).toBe(round + 1);
      expect(getPresentationFrames(snapshot).map((frame) => frame.kind))
        .toEqual(['challenge', 'roulette', 'shot', 'deal']);
      expect(snapshot).not.toHaveProperty('bullets');
    } finally { await context.close(); }
  });
});
