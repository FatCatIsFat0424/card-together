import { describe, expect, it } from 'vitest';
import type { Card, NinetyNineVisibleState, PlayerVisibleGameState, Seat } from '@shared/types';
import { HIDDEN_GOD_VIEW, nextGodView } from '../../../client/src/stores/god-view-store';
import { isOwnTurn, isSpectator } from '../../../client/src/games/observer-view';
import { observedRows, sortObserved } from '../../../client/src/components/ObservedHand';

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });
const seats = <T>(value: T): Record<Seat, T> => ({ N: value, E: value, S: value, W: value });

function ninetyNine(overrides: Partial<NinetyNineVisibleState> = {}): NinetyNineVisibleState {
  return {
    gameType: 'ninetynine', phase: 'playing', mySeat: 'S', myHand: [c(2, 'clubs')], handCounts: seats(1),
    total: 0, direction: 'ccw', currentTurnSeat: 'S', lastPlayed: null, stockCount: 30, eliminated: [],
    log: [], result: null, ...overrides,
  };
}

describe('god view', () => {
  const hands = { N: [c(14, 'spades')], E: [c(9, 'hearts')], S: [c(2, 'clubs')], W: [] };

  it('should stay hidden for seated players', () => {
    expect(nextGodView(HIDDEN_GOD_VIEW, ninetyNine(), false)).toBe(HIDDEN_GOD_VIEW);
    expect(nextGodView(HIDDEN_GOD_VIEW, null, false)).toBe(HIDDEN_GOD_VIEW);
  });

  it('should show a spectator every hand at once and hold it during later presentations', () => {
    const shown = nextGodView(HIDDEN_GOD_VIEW, ninetyNine({ observer: 'spectator', observedHands: hands }), true);
    expect(shown).toEqual({ ...HIDDEN_GOD_VIEW, role: 'spectator', hands });
    const played = { ...hands, N: [] };
    const next = ninetyNine({ observer: 'spectator', observedHands: played });
    expect(nextGodView(shown, next, true)).toBe(shown);
    expect(nextGodView(shown, next, false).hands).toEqual(played);
  });

  it('should open an eliminated view only after the eliminating presentation', () => {
    const visible = ninetyNine({ observer: 'eliminated', observedHands: hands, eliminated: ['S'] });
    expect(nextGodView(HIDDEN_GOD_VIEW, visible, true)).toBe(HIDDEN_GOD_VIEW);
    expect(nextGodView(HIDDEN_GOD_VIEW, visible, false)).toMatchObject({ role: 'eliminated', hands });
  });

  it('should keep an equal view and clear it when the match ends for the recipient', () => {
    const visible = ninetyNine({ observer: 'spectator', observedHands: hands });
    const shown = nextGodView(HIDDEN_GOD_VIEW, visible, false);
    expect(nextGodView(shown, structuredClone(visible), false)).toBe(shown);
    expect(nextGodView(shown, ninetyNine(), false)).toBe(HIDDEN_GOD_VIEW);
  });

  it('should carry Liar\'s Deck faces and the Blackjack hole card separately', () => {
    const liars = { gameType: 'liarsdeck', observer: 'spectator',
      observedHands: { N: [{ id: 1, face: 'joker' }], E: [], S: [], W: [] } } as unknown as PlayerVisibleGameState;
    expect(nextGodView(HIDDEN_GOD_VIEW, liars, false)).toMatchObject({ hands: null,
      liarHands: { N: [{ id: 1, face: 'joker' }] } });
    const blackjack = { gameType: 'blackjack', observer: 'eliminated', observedHole: c(13, 'spades') } as
      unknown as PlayerVisibleGameState;
    expect(nextGodView(HIDDEN_GOD_VIEW, blackjack, false)).toMatchObject({ hands: null, hole: c(13, 'spades') });
  });

  it('should never give a spectator the turn of the seat it watches from', () => {
    expect(isOwnTurn(ninetyNine())).toBe(true);
    expect(isOwnTurn(ninetyNine({ observer: 'spectator' }))).toBe(false);
    expect(isOwnTurn(ninetyNine({ observer: 'eliminated', currentTurnSeat: 'N' }))).toBe(false);
    expect(isSpectator(ninetyNine({ observer: 'spectator' }))).toBe(true);
    expect(isSpectator(ninetyNine({ observer: 'eliminated' }))).toBe(false);
    expect(isSpectator(null)).toBe(false);
  });

  it('should lay out face-up hands by suit in at most two readable rows', () => {
    expect(sortObserved([c(2, 'hearts'), c(14, 'diamonds'), c(9, 'spades'), c(13, 'hearts')]))
      .toEqual([c(9, 'spades'), c(13, 'hearts'), c(2, 'hearts'), c(14, 'diamonds')]);
    expect(observedRows([1, 2, 3, 4, 5, 6, 7])).toEqual([[1, 2, 3, 4, 5, 6, 7]]);
    expect(observedRows(Array.from({ length: 13 }, (_, index) => index)).map((row) => row.length)).toEqual([7, 6]);
    expect(observedRows([])).toEqual([[]]);
  });
});
