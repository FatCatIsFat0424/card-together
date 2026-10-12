import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GAME_SEAT_ORDER } from '@shared/constants';
import { getPresentationEndsAt } from '@shared/game-presentation';
import { heLegalActions } from '@shared/rules/holdem';
import { nnApply, nnRank, nnRequiresChoice, nnWinners } from '@shared/rules/ninetynine';
import type { NnChoice } from '@shared/rules/ninetynine';
import type { AnyGameState, GameSeat, NinetyNineMatchResult, PlayerInfo, TimeControl } from '@shared/types';
import { createDeck, shuffleDeck } from '../../src/engine/deck';
import * as gameManager from '../../src/managers/game-manager';
import * as blackjack from '../../src/managers/games/blackjack-game';
import * as holdem from '../../src/managers/games/holdem-game';
import * as ninetynine from '../../src/managers/games/ninetynine-game';
import { isRuntimeSnapshot } from '../../src/runtime/validate';
import type { RuntimeSnapshot } from '../../src/runtime/types';

const CODE = 'COUNT8';
const SETTINGS: TimeControl = { baseSeconds: 300, bankSeconds: 300 };
const MODES = ['ninetynine', 'blackjack', 'holdem'] as const;
type Mode = typeof MODES[number];
type FlexibleGame = Extract<AnyGameState, { gameType: Mode }>;

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function player(seat: GameSeat): PlayerInfo {
  return { id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null };
}

function game(): FlexibleGame {
  const state = gameManager.getGameState(CODE);
  if (!state || !MODES.includes(state.gameType as Mode)) throw new Error('Expected a flexible-seat game.');
  return state as FlexibleGame;
}

function start(mode: Mode, participants: readonly GameSeat[]): void {
  const players = Object.fromEntries(participants.map((seat) => [seat, player(seat)]));
  if (mode === 'ninetynine') {
    ninetynine.startGame(CODE, players, shuffleDeck([...createDeck(), ...createDeck()], seeded(23)),
      participants[0], { twoDecks: true });
  } else if (mode === 'blackjack') blackjack.startGame(CODE, players, 300_000);
  else holdem.startGame(CODE, players, seeded(23));
  gameManager.initializeClock(CODE, SETTINGS);
}

/** Wrap the actual live game and all occupied seats in the same membership contract as persistence. */
function snapshot(state: FlexibleGame): RuntimeSnapshot {
  const playing = state.phase !== 'scoring';
  const ids = Object.values(state.players).map((entry) => entry.id);
  const seat = (position: GameSeat): { player: PlayerInfo | null; isReady: boolean } => ({
    player: state.players[position] ?? null, isReady: playing && Boolean(state.players[position]),
  });
  return {
    players: Object.values(state.players).map((info) => ({ info, currentRoomCode: CODE, disconnectedAt: null })),
    rooms: [{
      info: {
        code: CODE, gameType: state.gameType, status: playing ? 'playing' : 'waiting', createdAt: 1,
        hostId: ids[0], abortVote: null, abortVoteCooldownUntil: null, timeControl: SETTINGS,
        seats: { N: seat('N'), E: seat('E'), S: seat('S'), W: seat('W') },
        additionalSeats: GAME_SEAT_ORDER.slice(4).map(seat),
      },
      memberIds: ids,
    }],
    games: [structuredClone(state)],
    chat: [],
  };
}

function assertPrivateViews(state: FlexibleGame, participants: readonly GameSeat[]): void {
  for (const seat of participants) {
    const visible = gameManager.getRecipientVisibleState(CODE, seat);
    expect(visible?.mySeat).toBe(seat);
    expect(visible?.gameType).toBe(state.gameType);
    if (visible?.gameType === 'ninetynine' && state.gameType === 'ninetynine') {
      expect(visible.myHand).toEqual(state.hands[seat]);
      expect(visible.handCounts[seat]).toBe(state.hands[seat].length);
      expect(visible).not.toHaveProperty('hands');
      if (!state.eliminated.includes(seat)) expect(visible).not.toHaveProperty('observedHands');
    } else if (visible?.gameType === 'holdem' && state.gameType === 'holdem') {
      expect(visible.myHand).toEqual(state.hands[seat]);
      expect(visible).not.toHaveProperty('hands');
      if (!state.eliminated.includes(seat)) expect(visible).not.toHaveProperty('observedHands');
    } else if (visible?.gameType === 'blackjack' && state.gameType === 'blackjack') {
      expect(visible.myBet).toBe(state.bets[seat]);
      expect(visible).not.toHaveProperty('bets');
      expect(visible).not.toHaveProperty('hole');
      expect(visible).not.toHaveProperty('myHole');
      // A house-player seat still in the match must not receive the dealer's hidden card.
      if (!visible.observer) expect(visible).not.toHaveProperty('observedHole');
    }
  }
}

/** Finish the presentation without spending a player's time reserve. */
function finishPresentation(): void {
  const state = game();
  vi.setSystemTime(Math.max(Date.now(), getPresentationEndsAt(state), state.clock?.turn?.startsAt ?? 0) + 1);
}

function act(): void {
  finishPresentation();
  const state = game();
  if (state.gameType === 'blackjack') {
    if (state.phase === 'betting') {
      const seat = blackjack.pendingBetSeats(state)[0];
      expect(gameManager.handleBlackjackBet(CODE, seat, 10).success).toBe(true);
    } else expect(gameManager.handleBlackjackAction(CODE, state.currentTurnSeat, 'stand').success).toBe(true);
  } else if (state.gameType === 'holdem') {
    const legal = heLegalActions(state, state.currentTurnSeat);
    expect(legal).not.toBeNull();
    expect(gameManager.handleHoldemAction(CODE, state.currentTurnSeat,
      legal?.check ? { type: 'check' } : { type: 'call' }).success).toBe(true);
  } else {
    const seat = state.currentTurnSeat;
    const candidates = state.hands[seat].flatMap((card) => {
      const choices: readonly (NnChoice | undefined)[] = nnRequiresChoice(card) ? ['minus', 'plus'] : [undefined];
      return choices.map((choice) => ({ card, choice, effect: nnApply(state.total, card, choice) }));
    });
    const chosen = candidates.find((entry) => entry.effect.total <= 99);
    if (!chosen) throw new Error('Expected a legal Ninety-Nine move.');
    const target = chosen.effect.designate ? GAME_SEAT_ORDER.find((other) =>
      state.players[other] && other !== seat && !state.eliminated.includes(other)) : undefined;
    expect(gameManager.handleNinetyNinePlay(CODE, seat, chosen.card, chosen.choice, target).success).toBe(true);
  }
}

describe('two to eight actual players', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    gameManager.restoreGames([]);
  });

  afterEach(() => {
    gameManager.restoreGames([]);
    vi.useRealTimers();
  });

  for (const mode of MODES) {
    it.each([2, 3, 4, 5, 6, 7, 8])(`${mode}: plays and persists %i suffix seats through settlement`, (count) => {
      // At two players, both compass seats and most additional seats are empty: P7/P8 play heads-up.
      const participants = GAME_SEAT_ORDER.slice(8 - count);
      start(mode, participants);
      let actions = 0;
      while (true) {
        const state = game();
        expect(isRuntimeSnapshot(snapshot(state))).toBe(true);
        expect(state.clock?.settings).toEqual(SETTINGS);
        for (const seat of participants) expect(state.clock?.bankRemainingMs[seat]).toBe(300_000);
        if (state.clock?.turn) {
          expect(participants).toContain(state.clock.turn.seat);
          expect(state.clock.turn.deadline - state.clock.turn.startsAt).toBe(600_000);
        }
        assertPrivateViews(state, participants);
        if (state.phase === 'scoring') {
          expect(state.result?.seats).toEqual(participants);
          expect(state.clock?.turn).toBeNull();
          if (state.gameType === 'ninetynine' && state.result) {
            const winners = nnWinners(state.result);
            expect(participants.map((seat) => nnRank(state.result!, seat))).toEqual(participants.map((seat) =>
              winners.includes(seat) ? 1 : count - state.result!.eliminationOrder.indexOf(seat)));
          }
          break;
        }
        expect(actions++).toBeLessThan(1000);
        act();
      }
      expect(actions).toBeGreaterThan(0);
      expect(game().log.some((entry) => 'seat' in entry && entry.seat === 'P8')).toBe(true);
    });
  }

  it.each([2, 3, 4, 5, 6, 7, 8])('ranks all %i Ninety-Nine participants in elimination order', (count) => {
    const participants = GAME_SEAT_ORDER.slice(8 - count);
    const result: NinetyNineMatchResult = {
      gameType: 'ninetynine', seats: [...participants], winnerSeat: 'P8',
      eliminationOrder: participants.slice(0, -1), finalTotal: 99,
    };
    expect(participants.map((seat) => nnRank(result, seat))).toEqual(participants.map((_, index) => count - index));
  });

  it.each(MODES)('%s rejects missing active additional-seat data instead of treating it as legacy', (mode) => {
    start(mode, GAME_SEAT_ORDER);
    const original = snapshot(game());
    const missingHand = structuredClone(original);
    Reflect.deleteProperty(missingHand.games[0].hands, 'P8');
    expect(isRuntimeSnapshot(missingHand)).toBe(false);
    const missingBank = structuredClone(original);
    Reflect.deleteProperty(missingBank.games[0].clock!.bankRemainingMs, 'P8');
    expect(isRuntimeSnapshot(missingBank)).toBe(false);
    expect(isRuntimeSnapshot(original)).toBe(true);
  });

  it.each(MODES)('%s restores four-seat saves with legacy value maps without mutating them', (mode) => {
    const participants = GAME_SEAT_ORDER.slice(0, 4);
    start(mode, participants);
    for (let step = 0; step < 6; step++) act();
    const legacy = structuredClone(game());
    function stripAdditionalValues(value: unknown): void {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { value.forEach(stripAdditionalValues); return; }
      const object = value as Record<string, unknown>;
      for (const seat of GAME_SEAT_ORDER.slice(4)) delete object[seat];
      Object.values(object).forEach(stripAdditionalValues);
    }
    stripAdditionalValues(legacy);
    const original = structuredClone(legacy);
    expect(isRuntimeSnapshot(snapshot(legacy))).toBe(true);
    gameManager.restoreGames([legacy]);
    expect(legacy).toEqual(original);
    expect(isRuntimeSnapshot(snapshot(game()))).toBe(true);
    expect(Object.keys(game().hands)).toEqual(GAME_SEAT_ORDER);
    assertPrivateViews(game(), participants);
    act();
    expect(isRuntimeSnapshot(snapshot(game()))).toBe(true);
  });
});
