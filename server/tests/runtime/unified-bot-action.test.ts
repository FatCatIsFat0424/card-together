import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPresentationEndsAt } from '@shared/game-presentation';
import type { GameActionEnvelope } from '@shared/games/actions';
import type { PlayerInfo, Seat } from '@shared/types';
import { getBotAction } from '../../src/bots/bot-decisions';
import * as games from '../../src/managers/game-manager';
import { applyAutomatedAction } from '../../src/runtime/automated-action';

describe('unified bot action', () => {
  afterEach(() => { games.restoreGames([]); vi.useRealTimers(); });

  it('uses the same adapter while bypassing manual auto-play restrictions and advancing its clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-28T00:00:00Z'));
    const players = Object.fromEntries(['N', 'E', 'S', 'W'].map((seat) => [seat, {
      id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
    }])) as Record<Seat, PlayerInfo>;
    expect(games.startGame('BOT001', 'bigtwo', players)).toEqual({ success: true });
    const state = games.getGameState('BOT001');
    if (state?.gameType !== 'bigtwo') throw new Error('Expected Big Two');
    vi.setSystemTime(Math.max(Date.now(), getPresentationEndsAt(state)));
    const seat = state.currentTurnSeat;
    const visible = games.getPlayerVisibleState('BOT001', seat);
    if (!visible) throw new Error('Expected the acting player view');
    const decision = getBotAction(visible, () => 0);
    if (decision?.type !== 'bigtwo-play') throw new Error('Expected an opening play');
    const request: GameActionEnvelope = { gameType: 'bigtwo', action: { type: 'play', cards: decision.cards } };
    expect(games.setAutoPlay('BOT001', seat, true).success).toBe(true);
    const before = structuredClone(state);
    expect(games.handleGameAction('BOT001', seat, request)).toEqual({
      success: false, reason: 'Turn off auto-play before playing manually.',
    });
    expect(games.getGameState('BOT001')).toEqual(before);
    expect(applyAutomatedAction('BOT001', seat, { type: 'game-action', request })).toEqual({ success: true });
    expect(state.log.length).toBeGreaterThan(before.log.length);
    expect(state.clock?.turn?.seat).toBe(state.currentTurnSeat);
    expect(state.presentation).toBeDefined();
  });
});
