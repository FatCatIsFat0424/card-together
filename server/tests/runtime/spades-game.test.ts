import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlayerInfo, Seat } from '@shared/types';
import type { SpadesGameState, SpadesVisibleState } from '@shared/games/spades/types';
import { SPADES_SEATS, spadesNext, spadesSeatMap } from '@shared/rules/spades';
import { matchStanding } from '@shared/rules/match-standing';
import { spadesFacts } from '@shared/stats/spades';
import { createDeck, shuffleDeck } from '../../src/engine/deck';
import * as spades from '../../src/managers/games/spades-game';
import { spadesAdapter } from '../../src/managers/games/spades-adapter';
import { coherentSpadesGame, isSpadesResult, spadesGame } from '../../src/managers/games/spades-validation';
import { easySpadesAction, getSpadesBotAction, spadesFirstLegalAction } from '../../src/bots/spades-strategy';
import { gameBot } from '../../src/bots/bot-registry';
import { isRuntimeSnapshot } from '../../src/runtime/validate';
import type { RuntimeSnapshot } from '../../src/runtime/types';

const code = 'SP0001';
const players = spadesSeatMap((seat): PlayerInfo => ({ id: seat, username: seat, nickname: seat,
  color: '#123456', avatar: 'cat', avatarImage: null }));
const state = (): SpadesGameState => spades.getGameState(code)!;
const view = (seat: Seat): SpadesVisibleState => spades.getPlayerVisibleState(code, seat)!;
function snapshot(): RuntimeSnapshot {
  const game = structuredClone(state());
  const active = game.phase !== 'scoring';
  return { players: Object.values(players).map((info) => ({ info, currentRoomCode: code, disconnectedAt: null })),
    rooms: [{ info: { code, gameType: 'spades', status: active ? 'playing' : 'waiting', createdAt: 1,
      hostId: 'N', abortVote: null, abortVoteCooldownUntil: null,
      seats: spadesSeatMap((seat) => ({ player: players[seat], isReady: active })) }, memberIds: [...SPADES_SEATS] }],
    games: [game], chat: [] };
}
function legal(visible: SpadesVisibleState, strategy = getSpadesBotAction): void {
  const action = strategy(visible);
  expect(action?.type).toBe('game-action');
  if (action?.type !== 'game-action' || action.request.gameType !== 'spades') throw new Error('Expected Spades action.');
  expect(spades.act(code, visible.mySeat, action.request.action, 1)).toEqual({ success: true });
}
afterEach(() => { spades.restoreGames([]); vi.restoreAllMocks(); });

describe('Spades runtime and bots', () => {
  it('filters all opponent and partner hands; observers receive them explicitly', () => {
    spades.startGame(code, players, createDeck(), 'N', 1);
    for (const seat of SPADES_SEATS) {
      const visible = view(seat);
      expect(visible.myHand).toEqual(state().hands[seat]);
      expect(visible).not.toHaveProperty('hands');
      expect(visible).not.toHaveProperty('observedHands');
      expect(visible.log).toEqual([{ type: 'deal', dealerSeat: 'N', timestamp: 1 }]);
      const observer = spadesAdapter.withObserverView(visible, state(), 'spectator');
      expect(observer.observedHands).toEqual(state().hands);
      expect(observer.observer).toBe('spectator');
    }
    expect(spades.getPlayerVisibleState(code, 'P5')).toBeNull();
    expect(isRuntimeSnapshot(snapshot())).toBe(true);
    const before = structuredClone(state());
    expect(spades.act(code, 'N', { type: 'bid', bid: 3 }).success).toBe(false);
    expect(spades.act(code, 'P5', { type: 'bid', bid: 3 }).success).toBe(false);
    expect(state()).toEqual(before);
    expect(() => spades.startGame(code, { N: players.N })).toThrow('four compass seats');
  });
  it('completes a nil deal, redeals with rotating dealer, and restores a partial trick', () => {
    spades.startGame(code, players, createDeck(), 'W', 1);
    for (const seat of SPADES_SEATS) expect(spades.act(code, seat, { type: 'bid', bid: 0 }, 1).success).toBe(true);
    while (state().handResults.length === 0) legal(view(state().position.currentTurnSeat!));
    expect(state().position.dealerSeat).toBe('N');
    expect(state().position.currentTurnSeat).toBe('E');
    expect(state().handResults[0].teams.NS.nilPoints).toBe(0);
    expect(state().handResults[0].teams.NS.bagsAdded).toBe(13);
    expect(coherentSpadesGame(state())).toBe(true);
    for (let i = 0; i < 6; i++) legal(view(state().position.currentTurnSeat!));
    const saved = structuredClone(state());
    spades.abortGame(code);
    expect(spades.getGameState(code)).toBeNull();
    spades.restoreGames([saved]);
    expect(state()).toEqual(saved);
    expect(isRuntimeSnapshot(snapshot())).toBe(true);
    legal(view(state().position.currentTurnSeat!));
    expect(coherentSpadesGame(state())).toBe(true);
  });
  it.each([17, 42, 123, 2026])('plays a complete seeded match %i with legal easy/hard/fallback/timeout actions', (seed) => {
    let randomSeed = seed;
    const random = (): number => { randomSeed = (Math.imul(randomSeed, 1664525) + 1013904223) >>> 0; return randomSeed / 4294967296; };
    vi.spyOn(Math, 'random').mockImplementation(random);
    spades.startGame(code, players, shuffleDeck(createDeck(), random), 'N', 1);
    for (let step = 0; step < 10_000 && !state().result; step++) {
      const current = view(state().position.currentTurnSeat!);
      const before = structuredClone(current);
      const strategies = [getSpadesBotAction, (v: SpadesVisibleState) => easySpadesAction(v, random), spadesFirstLegalAction,
        (v: SpadesVisibleState) => gameBot('spades').turnTimeout!(v, { isBot: false, strategy: () => null })];
      for (const strategy of strategies) {
        const action = strategy(current);
        expect(action?.type).toBe('game-action');
        if (action?.type === 'game-action' && action.request.gameType === 'spades') {
          const move = action.request.action;
          if (move.type === 'play') expect(current.validCards).toContainEqual(move.card);
          else expect(move.bid).toBeGreaterThanOrEqual(0);
        }
      }
      expect(current).toEqual(before);
      for (const seat of SPADES_SEATS.filter((seat) => seat !== current.mySeat)) expect(getSpadesBotAction(view(seat))).toBeNull();
      legal(current, step % 7 === 0 ? (v) => easySpadesAction(v, random) : getSpadesBotAction);
      if (step % 53 === 0) {
        expect(spadesGame(state() as unknown as Record<string, unknown>, () => true)).toBe(true);
        expect(coherentSpadesGame(state())).toBe(true);
        expect(isRuntimeSnapshot(snapshot())).toBe(true);
      }
    }
    const result = state().result;
    expect(result).not.toBeNull();
    expect(isSpadesResult(result)).toBe(true);
    expect(coherentSpadesGame(state())).toBe(true);
    expect(isRuntimeSnapshot(snapshot())).toBe(true);
    for (const seat of SPADES_SEATS) {
      expect(getSpadesBotAction(view(seat))).toBeNull();
      expect(matchStanding(result!, seat)?.won).toBe(result!.winners.includes(seat));
      expect(spadesFacts(result!, seat).values.topScore).toBe(result!.scores[seat === 'N' || seat === 'S' ? 'NS' : 'EW']);
    }
  }, 20_000);
  it('rejects corrupted cards, turns, bids, trick winners, score/bag totals and history order', () => {
    spades.startGame(code, players, createDeck(), 'N', 1);
    for (let i = 0; i < 20; i++) legal(view(state().position.currentTurnSeat!));
    const changes: ((game: SpadesGameState) => void)[] = [
      (game) => { game.hands.N[0] = game.hands.E[0]; },
      (game) => { game.position = { ...game.position, currentTurnSeat: spadesNext(game.position.currentTurnSeat!) }; },
      (game) => { game.position = { ...game.position, bids: { ...game.position.bids, N: 13 } }; },
      (game) => { game.scores.NS++; },
      (game) => { game.bags.EW++; },
      (game) => { game.players.N = game.players.S; },
      (game) => { const end = game.log.find((entry) => entry.type === 'trick_end')!; if (end.type === 'trick_end') Object.assign(end, { winnerSeat: spadesNext(end.winnerSeat) }); },
      (game) => { [game.log[1], game.log[2]] = [game.log[2], game.log[1]]; },
    ];
    expect(coherentSpadesGame(state())).toBe(true);
    for (const change of changes) { const bad = structuredClone(state()); change(bad); expect(coherentSpadesGame(bad)).toBe(false); }
    const bad = snapshot();
    const game = bad.games[0];
    if (game.gameType === 'spades') game.hands.N[0] = { suit: 'clubs', rank: 15 as 14 };
    expect(isRuntimeSnapshot(bad)).toBe(false);
  });
});
