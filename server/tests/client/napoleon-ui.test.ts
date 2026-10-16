import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPresentationFrames } from '@shared/game-presentation';
import type { Card, NapoleonCard, NapoleonVisibleState } from '@shared/types';

const state = vi.hoisted(() => ({ napoleon: null as unknown }));

vi.mock('../../../client/src/cosmetics/card-faces/use-card-face', () => ({
  useCardFaceUrl: () => () => '/card.svg', useJokerFaceUrl: () => null, useNapoleonJokerFaceUrls: () => null,
}));
// Static rendering reads a store's initial state, so the frame reads this snapshot instead.
vi.mock('../../../client/src/stores/game-store', () => ({
  useGameStore: (select: (value: { napoleon: unknown }) => unknown) => select(state),
}));

import { CardHand } from '../../../client/src/components/CardHand';
import { NapoleonFrame } from '../../../client/src/games/napoleon/NapoleonFrame';
import { SecretaryPicker } from '../../../client/src/games/napoleon/SecretaryPicker';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

const card = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });
const BIG: NapoleonCard = { joker: 'big' };
const secretaryCard = card(14, 'hearts');

function game(overrides: Partial<NapoleonVisibleState> = {}): NapoleonVisibleState {
  return {
    gameType: 'napoleon', phase: 'calling', options: { jokerSummon: true }, mySeat: 'N', seats: ['N', 'E', 'S', 'W'],
    dealerSeat: 'W', myHand: [card(2, 'spades'), BIG], handCounts: { N: 13, E: 13, S: 13, W: 13 }, pickedUp: null,
    discards: [card(12, 'diamonds'), card(3, 'clubs')], bidding: null,
    contract: { level: 12, suit: 'spades', napoleon: 'N' }, reviewed: [], reviewDeadline: null,
    secretaryCard: null, secretarySeat: null, trick: null, tricks: [], currentTurnSeat: 'N', validCards: [],
    log: [], result: null, ...overrides,
  };
}

describe('Napoleon controls', () => {
  beforeEach(() => useI18nStore.setState({ locale: 'en' }));
  afterEach(() => { state.napoleon = null; });

  it('opens the secretary picker on the trump suit and marks cards that would leave no secretary', () => {
    const html = renderToStaticMarkup(createElement(SecretaryPicker, { game: game(), disabled: false, onConfirm: () => undefined }));
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-pressed="true"[^>]*>♠</);
    expect(html).toContain('>Jokers<');
    for (const rank of ['A', 'K', 'Q', 'J', '10', '2']) expect(html).toContain(`aria-label="♠${rank}"`);
    expect(html).toMatch(/class="[^"]*ownCard[^"]*"[^>]*aria-label="♠2"[^>]*title="In your hand/);
    expect(html).toMatch(/disabled=""[^>]*>Confirm</);
  });

  it('draws jokers in the hand with their own names and badges picked-up cards', () => {
    const html = renderToStaticMarkup(createElement(CardHand<NapoleonCard>, {
      cards: [BIG, card(14, 'spades')], selectedCards: [], highlightedCards: [BIG], highlightedLabel: 'Picked up',
      onCardClick: () => undefined,
    }));
    expect(html).toContain('aria-label="Big joker (Picked up)"');
    expect(html).toContain('aria-label="A♠"');
    expect(html.match(/cardHighlighted/g)).toHaveLength(1);
    // The joker art is original, not the suit-card image.
    expect(html.match(/<img src="\/card\.svg"/g)).toHaveLength(1);
  });

  it('tells the secretary their role and alerts summoned seats during the notice frames', () => {
    const called = game({ phase: 'playing', mySeat: 'E', secretaryCard, secretarySeat: 'E', currentTurnSeat: 'N',
      trick: { leadSeat: 'N', plays: [], leadSuit: null, summon: null },
      log: [{ type: 'call', seat: 'N', card: secretaryCard, timestamp: 1 },
        { type: 'play', seat: 'N', card: card(2, 'spades'), leadSuit: 'spades', summon: 'bigJoker', timestamp: 2 }] });
    const frames = getPresentationFrames({ ...called, presentation: { id: 'p', startedAt: 0, logStart: 0, timingVersion: 3 } });
    const render = (index: number): string => renderToStaticMarkup(createElement(NapoleonFrame, {
      frame: frames[index], name: (seat) => `Player ${seat}`,
    }));
    expect(frames.map((frame) => frame.kind)).toEqual(['call', 'play', 'summon']);

    state.napoleon = called;
    expect(render(0)).toContain('You are the secretary. The secretary card is ♥A');
    expect(render(2)).toContain('Big joker, play!');

    state.napoleon = { ...called, mySeat: 'S', secretarySeat: null };
    expect(render(0)).toContain('The secretary card is ♥A');
    expect(render(0)).not.toContain('You are the secretary');

    state.napoleon = { ...called, mySeat: 'N', secretarySeat: null };
    expect(render(2)).toContain('You summoned the big joker');
    expect(render(1)).toBe('');

    state.napoleon = { ...called, mySeat: 'S', observer: 'spectator' };
    expect(render(0)).toContain('Held by Player E');
  });
});
