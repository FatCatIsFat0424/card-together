import { describe, expect, it } from 'vitest';
import type { Card } from '@shared/types';
import { cardInput, cardTap, validArmedCard } from '../../../client/src/components/card-hand-touch';

const ace: Card = { suit: 'spades', rank: 14 };
const king: Card = { suit: 'hearts', rank: 13 };

describe('two-step touch card play', () => {
  it('should classify pointer types and fall back to the primary pointer', () => {
    expect(cardInput('mouse', true)).toBe('mouse');
    expect(cardInput('touch', false)).toBe('touch');
    expect(cardInput('pen', true)).toBe('pen');
    expect(cardInput(null, true)).toBe('touch');
    expect(cardInput('', false)).toBe('mouse');
  });

  it('should lift a card on the first touch and play it on the second', () => {
    expect(cardTap(null, ace, 'touch')).toEqual({ type: 'arm', card: ace });
    expect(cardTap(ace, { ...ace }, 'touch')).toEqual({ type: 'play', card: ace });
  });

  it('should move the lifted card when another card is touched', () => {
    expect(cardTap(ace, king, 'touch')).toEqual({ type: 'arm', card: king });
  });

  it('should keep precise inputs one-step', () => {
    expect(cardTap(null, ace, 'mouse')).toEqual({ type: 'play', card: ace });
    expect(cardTap(null, ace, 'pen')).toEqual({ type: 'play', card: ace });
    expect(cardTap(king, ace, 'keyboard')).toEqual({ type: 'play', card: ace });
  });

  it('should drop a lifted card that is no longer playable or when the hand is inactive', () => {
    expect(validArmedCard(ace, [ace, king], true)).toBe(ace);
    expect(validArmedCard(ace, [king], true)).toBeNull();
    expect(validArmedCard(ace, [ace], false)).toBeNull();
    expect(validArmedCard(ace, undefined, true)).toBeNull();
    expect(validArmedCard(null, [ace], true)).toBeNull();
  });
});
