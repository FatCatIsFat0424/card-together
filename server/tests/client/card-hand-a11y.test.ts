import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card } from '@shared/types';

vi.mock('../../../client/src/cosmetics/card-faces/use-card-face', () => ({
  useCardFaceUrl: () => () => '/card.svg', useJokerFaceUrl: () => null, useNapoleonJokerFaceUrls: () => null,
}));

import { CardHand } from '../../../client/src/components/CardHand';
import { useI18nStore } from '../../../client/src/stores/i18n-store';
import { useHandSortStore } from '../../../client/src/stores/hand-sort-store';

const ace: Card = { suit: 'spades', rank: 14 };
const two: Card = { suit: 'hearts', rank: 2 };

describe('card hand accessibility', () => {
  beforeEach(() => {
    useI18nStore.setState({ locale: 'en' });
    useHandSortStore.setState({ gameType: null, order: null, revision: 0 });
  });

  it('should label the hand and keep unplayable cards focusable', () => {
    const html = renderToStaticMarkup(createElement(CardHand, {
      cards: [ace, two], playableCards: [ace], onCardClick: () => undefined,
    }));
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Your hand, 2 cards"');
    expect(html).not.toMatch(/\sdisabled=""/);
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(1);
    expect(html.match(/aria-disabled="false"/g)).toHaveLength(1);
  });

  it('should mark every card inactive when it is not the player turn', () => {
    const html = renderToStaticMarkup(createElement(CardHand, {
      cards: [ace, two], playableCards: [ace], disabled: true,
    }));
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(2);
    expect(html.match(/cardReorderable/g)).toHaveLength(2);
  });

  it('should glow playable cards in selection mode except the selected one', () => {
    const html = renderToStaticMarkup(createElement(CardHand, {
      cards: [ace, two], playableCards: [ace, two], selectedCards: [two], onCardClick: () => undefined,
    }));
    expect(html.match(/cardPlayable/g)).toHaveLength(1);
    expect(html.match(/cardSelected/g)).toHaveLength(1);
  });

  it('should not glow selection-mode cards without playable cards', () => {
    const html = renderToStaticMarkup(createElement(CardHand, {
      cards: [ace, two], selectedCards: [], onCardClick: () => undefined,
    }));
    expect(html).not.toContain('cardPlayable');
  });
});
