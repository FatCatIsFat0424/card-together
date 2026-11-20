import { afterEach, describe, expect, it } from 'vitest';
import type { PlayerInfo, Seat } from '@shared/types';
import type { SpadesAction, SpadesVisibleState } from '@shared/games/spades/types';
import { scoreSpadesHand, SPADES_SEATS, spadesSeatMap, spadesTeam } from '@shared/rules/spades';
import type { BotAction } from '../../src/bots/bot-decisions';
import { GAME_BOTS } from '../../src/bots/bot-registry';
import { SPADES_BAG_COST, spadesHandUtility, spadesSearch } from '../../src/bots/spades-search';
import type { SearchContext } from '../../src/bots/search/search-types';
import { seededRandom } from '../../src/bots/search/seeded-random';
import { createDeck, shuffleDeck } from '../../src/engine/deck';
import * as spades from '../../src/managers/games/spades-game';

const CODE = 'SPSRCH';
const players = spadesSeatMap((seat): PlayerInfo => ({ id: seat, username: seat, nickname: seat, color: '#123456',
  avatar: 'cat', avatarImage: null }));

/** A clock that never runs out: the sample bound alone ends the search, so results depend only on the seed. */
function unbounded(seed: number): SearchContext {
  return { random: seededRandom(seed), budget: { maxDepth: undefined, timeLeftMs: () => 1_000, expired: () => false } };
}

function clocked(seed: number, budgetMs: number): SearchContext {
  const began = performance.now();
  const timeLeftMs = (): number => Math.max(0, budgetMs - (performance.now() - began));
  return { random: seededRandom(seed), budget: { maxDepth: undefined, timeLeftMs, expired: () => timeLeftMs() === 0 } };
}

function actionOf(action: BotAction | null): SpadesAction {
  if (action?.type !== 'game-action' || action.request.gameType !== 'spades') throw new Error('Expected a Spades action.');
  return action.request.action;
}

const view = (seat: Seat): SpadesVisibleState => spades.getPlayerVisibleState(CODE, seat)!;
const turn = (): Seat => spades.getGameState(CODE)!.position.currentTurnSeat!;

afterEach(() => spades.abortGame(CODE));

describe('Spades search', () => {
  it('is registered for bots and timeouts in the worker pool', () => {
    expect(GAME_BOTS.spades.search?.strategy.exportName).toBe('spadesSearch');
    expect(GAME_BOTS.spades.turnTimeout).toBeUndefined();
  });

  it.each([3, 8])('bids and plays legally without changing or overreading the view (deal %i)', (seed) => {
    spades.startGame(CODE, players, shuffleDeck(createDeck(), seededRandom(seed)), 'W', 1);
    for (let step = 0; step < 56; step++) {
      const seat = turn();
      const visible = view(seat);
      const before = structuredClone(visible);
      Object.defineProperty(visible, 'observedHands', { get: () => { throw new Error('Spectator data read.'); } });
      const action = actionOf(spadesSearch(visible, unbounded(seed * 100 + step), { maxSamples: 16 }));
      expect(actionOf(spadesSearch(visible, unbounded(seed * 100 + step), { maxSamples: 16 }))).toEqual(action);
      expect(structuredClone({ ...visible, observedHands: undefined })).toEqual({ ...before, observedHands: undefined });
      if (action.type === 'play') expect(visible.validCards).toContainEqual(action.card);
      else expect(action.bid).toBeGreaterThanOrEqual(0);
      expect(spades.act(CODE, seat, action, 1).success).toBe(true);
    }
    expect(spades.getGameState(CODE)!.handResults).toHaveLength(1);
  });

  it('returns within its budget early in a hand', () => {
    spades.startGame(CODE, players, shuffleDeck(createDeck(), seededRandom(5)), 'W', 1);
    for (let step = 0; step < 6; step++) {
      const seat = turn();
      const began = performance.now();
      const action = actionOf(spadesSearch(view(seat), clocked(step, 120)));
      expect(performance.now() - began).toBeLessThan(120 + 150);
      expect(spades.act(CODE, seat, action, 1).success).toBe(true);
    }
  });

  it('scores a finished hand as the real hand result less the carried bags', () => {
    const random = seededRandom(9);
    for (let round = 0; round < 200; round++) {
      const bids = spadesSeatMap(() => (random() < 0.2 ? 0 : 1 + Math.floor(random() * 5)));
      const taken = spadesSeatMap(() => 0);
      for (let trick = 0; trick < 13; trick++) taken[SPADES_SEATS[Math.floor(random() * 4)]]++;
      const bags = { NS: Math.floor(random() * 10), EW: Math.floor(random() * 10) };
      const result = scoreSpadesHand(bids, taken, bags);
      for (const seat of SPADES_SEATS) {
        const mine = result.teams[spadesTeam(seat)];
        const theirs = result.teams[spadesTeam(seat) === 'NS' ? 'EW' : 'NS'];
        expect(spadesHandUtility(bids, taken, { NS: 0, EW: 0 }, bags, seat))
          .toBe(mine.points - theirs.points - SPADES_BAG_COST * (mine.bags - theirs.bags));
      }
    }
  });
});
