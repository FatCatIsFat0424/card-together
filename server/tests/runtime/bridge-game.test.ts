import { afterEach, describe, expect, it } from 'vitest';
import type { PlayerInfo, Seat } from '@shared/types';
import { createDeck } from '../../src/engine/deck';
import { dealCards, sortHand } from '../../src/engine/dealing';
import * as bridge from '../../src/managers/games/bridge-game';

const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
const PLAYERS = Object.fromEntries(SEATS.map((seat) => [seat, {
  id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
}])) as Record<Seat, PlayerInfo>;

describe('Bridge deal randomness', () => {
  afterEach(() => bridge.restoreGames([]));

  it('should deal an injected deck from an injected dealer without mutating the deck', () => {
    const deck = createDeck();
    const original = structuredClone(deck);
    bridge.startGame('DEAL01', PLAYERS, deck, 'S');
    const game = bridge.getGameState('DEAL01')!;
    const expected = dealCards(original);
    expect(deck).toEqual(original);
    expect(game.dealerSeat).toBe('S');
    for (const seat of SEATS) expect(game.hands[seat]).toEqual(sortHand(expected[seat]));
    // The auction (or redeal offer) starts from the dealer's clockwise neighbour.
    if (game.phase === 'bidding') expect(game.bidding?.currentBidderSeat).toBe('W');
    else expect(game.phase).toBe('redeal_pending');
  });
});
