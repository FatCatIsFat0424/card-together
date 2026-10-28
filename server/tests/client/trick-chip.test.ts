import { describe, expect, it, vi } from 'vitest';
import { getPresentationFrames } from '@shared/game-presentation';
import type { Card, NapoleonCard, NapoleonLogEntry, NapoleonVisibleState } from '@shared/types';
import { bridgeChip, napoleonChip } from '../../../client/src/games/trick-chip';

vi.mock('../../../client/src/cosmetics/card-faces/use-card-face', () => ({
  useCardFaceUrl: () => () => '/card.svg', useJokerFaceUrl: () => null, useNapoleonJokerFaceUrls: () => null,
}));

const contract = { level: 4, suit: 'spades', declarer: 'W' } as const;

describe('Bridge contract chip', () => {
  it('shows nothing before the auction starts and the highest bid while it runs', () => {
    expect(bridgeChip({ phase: 'waiting', contract: null, highestBid: null, tricks: null, mySeat: 'N' })).toBeNull();
    expect(bridgeChip({ phase: 'bidding', contract: null, highestBid: null, tricks: null, mySeat: 'N' }))
      .toEqual({ bid: null, bidding: true, declarer: null, sides: [] });
    expect(bridgeChip({ phase: 'bidding', contract: null, highestBid: { level: 2, suit: 'hearts' }, tricks: null, mySeat: 'N' }))
      .toMatchObject({ bid: { level: 2, suit: 'hearts' }, bidding: true });
  });

  it('lists the contract, the declarer and the viewer’s side first, each with the tricks that settle the contract', () => {
    const chip = bridgeChip({ phase: 'playing', contract, highestBid: null, tricks: { ns: 3, ew: 2 }, mySeat: 'N' });
    // 4♠ by West needs ten tricks, so North-South set it with four.
    expect(chip).toEqual({
      bid: { level: 4, suit: 'spades' }, bidding: false, declarer: 'W',
      sides: [{ team: 'ours', tricks: 3, target: 4 }, { team: 'theirs', tricks: 2, target: 10 }],
    });
    expect(bridgeChip({ phase: 'playing', contract, highestBid: null, tricks: { ns: 3, ew: 2 }, mySeat: 'E' })?.sides)
      .toEqual([{ team: 'ours', tricks: 2, target: 10 }, { team: 'theirs', tricks: 3, target: 4 }]);
    const grand = bridgeChip({ phase: 'playing', contract: { level: 7, suit: 'nt', declarer: 'S' }, highestBid: null,
      tricks: null, mySeat: 'S' });
    expect(grand?.sides.map((side) => side.target)).toEqual([13, 1]);
  });

  it('names the compass teams for a viewer without a seat and starts at zero tricks', () => {
    expect(bridgeChip({ phase: 'playing', contract, highestBid: null, tricks: { ns: 1, ew: 0 }, mySeat: null })?.sides)
      .toEqual([{ team: 'ns', tricks: 1, target: 4 }, { team: 'ew', tricks: 0, target: 10 }]);
    expect(bridgeChip({ phase: 'playing', contract, highestBid: null, tricks: null, mySeat: 'S' })?.sides)
      .toEqual([{ team: 'ours', tricks: 0, target: 4 }, { team: 'theirs', tricks: 0, target: 10 }]);
  });
});

const card = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });
const secretaryCard = card(14, 'hearts');
const secretaryPlay: NapoleonLogEntry = { type: 'play', seat: 'E', card: secretaryCard, timestamp: 60 };

/** A four-player deal in play: N is the Napoleon in spades, E holds the secretary card ♥A. */
function game(overrides: Partial<NapoleonVisibleState> = {}): NapoleonVisibleState {
  const hand: NapoleonCard[] = [card(2, 'spades'), card(3, 'spades')];
  return {
    gameType: 'napoleon', phase: 'playing', options: { jokerSummon: true }, mySeat: 'S',
    seats: ['N', 'E', 'S', 'W'], dealerSeat: 'W', myHand: hand,
    handCounts: { N: 4, E: 4, S: 4, W: 4 }, pickedUp: null, discards: [card(12, 'diamonds'), card(4, 'clubs')],
    bidding: null, contract: { level: 12, suit: 'spades', napoleon: 'N' }, reviewed: [], reviewDeadline: null,
    secretaryCard, secretarySeat: null, trick: { leadSeat: 'N', plays: [], leadSuit: null, summon: null },
    tricks: [], currentTurnSeat: 'N', validCards: hand,
    log: [{ type: 'call', seat: 'N', card: secretaryCard, timestamp: 50 }], result: null,
    ...overrides,
  };
}

describe('Napoleon contract chip', () => {
  it('shows the bidding state, then nothing until a contract exists', () => {
    expect(napoleonChip(game({ phase: 'bidding', contract: null, secretaryCard: null, bidding: {
      bids: [], currentBidderSeat: 'N', highestBid: { level: 10, suit: 'hearts', seat: 'E' },
    } as unknown as NapoleonVisibleState['bidding'] }), null))
      .toMatchObject({ bidding: true, bid: { level: 10, suit: 'hearts' }, napoleon: null, progress: null });
    expect(napoleonChip(game({ phase: 'exchanging', contract: null, secretaryCard: null }), null)).toBeNull();
  });

  it('keeps the secretary private from other seats until the secretary card is played', () => {
    const hidden = napoleonChip(game({ secretarySeat: null }), null);
    expect(hidden).toMatchObject({ napoleon: 'N', secretary: null, secretaryCard });
    // A snapshot that already names the secretary still hides it from a third seat until the card's play frame.
    const revealed = game({ mySeat: 'S', secretarySeat: 'E', log: [...game().log,
      { type: 'play', seat: 'N', card: card(13, 'clubs'), timestamp: 55 }, secretaryPlay] });
    const [first] = getPresentationFrames({ ...revealed, presentation: { id: 'p', startedAt: 0, logStart: 1, timingVersion: 3 } });
    expect(napoleonChip(revealed, first)?.secretary).toBeNull();
    // The secretary knows their own role from the call, and observers see it at once.
    expect(napoleonChip(game({ mySeat: 'E', secretarySeat: 'E' }), null)?.secretary).toBe('E');
    expect(napoleonChip(game({ observer: 'spectator', secretarySeat: 'E' }), null)?.secretary).toBe('E');
    expect(napoleonChip(game({ mySeat: 'S', secretarySeat: 'E', log: [...game().log, secretaryPlay] }), null)?.secretary)
      .toBe('E');
  });

  it('keeps side progress pending until the card shows which seats form the Napoleon side', () => {
    const pending = napoleonChip(game(), null)?.progress;
    expect(pending).toEqual({
      napoleon: null, defenders: null, napoleonTarget: 12, defenderTarget: 5, pendingDiscards: false,
    });
    const shown = napoleonChip(game({ secretarySeat: 'E', log: [...game().log, secretaryPlay] }), null)?.progress;
    expect(shown).toMatchObject({ napoleon: 0, napoleonTarget: 12, defenderTarget: 5 });
    expect(shown?.defenders).not.toBeNull();
  });

  it('shows no progress outside the play and the settlement', () => {
    expect(napoleonChip(game({ phase: 'calling' }), null)?.progress).toBeNull();
    expect(napoleonChip(game({ phase: 'exchanging' }), null)?.progress).toBeNull();
  });
});
