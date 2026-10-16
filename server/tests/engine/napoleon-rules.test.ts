import { describe, expect, it } from 'vitest';
import type {
  BidSuit, Card, GameSeat, NapoleonCard, NapoleonContract, NapoleonTrick, NapoleonTrickRecord, Suit,
} from '@shared/types';
import {
  applyNapoleonBid, compareNapoleonBids, createNapoleonBidding, createNapoleonDeck, dealNapoleon,
  isNapoleonCard, isNapoleonFinalTrick, napoleonBidError, napoleonBiddingEnd, napoleonCardKey, napoleonDealSize,
  napoleonDiscardError, napoleonOutcome, napoleonPlayError, napoleonSummonOptions, napoleonTrickWinner,
  napoleonValidBids, napoleonValidCards, sortNapoleonHand,
} from '@shared/rules/napoleon';
import type { NapoleonPlayView } from '@shared/rules/napoleon';

const SEATS: GameSeat[] = ['N', 'E', 'S', 'W'];
const card = (rank: Card['rank'], suit: Suit = 'spades'): NapoleonCard => ({ suit, rank });
const BIG: NapoleonCard = { joker: 'big' };
const SMALL: NapoleonCard = { joker: 'small' };

function view(options: {
  trump?: BidSuit;
  secretary?: NapoleonCard;
  trick?: NapoleonTrick | null;
  tricks?: NapoleonTrickRecord[];
  jokerSummon?: boolean;
  seats?: GameSeat[];
} = {}): NapoleonPlayView {
  const contract: NapoleonContract = { level: 12, suit: options.trump ?? 'hearts', napoleon: 'N' };
  return {
    seats: options.seats ?? SEATS,
    options: { jokerSummon: options.jokerSummon ?? true },
    contract,
    secretaryCard: options.secretary ?? card(14, 'clubs'),
    trick: options.trick === undefined ? { leadSeat: 'N', plays: [], leadSuit: null, summon: null } : options.trick,
    tricks: options.tricks ?? [],
  };
}

function trick(leadSuit: Suit, plays: [GameSeat, NapoleonCard][], summon: NapoleonTrick['summon'] = null): NapoleonTrick {
  return { leadSeat: plays[0]?.[0] ?? 'N', leadSuit, summon, plays: plays.map(([seat, played]) => ({ seat, card: played })) };
}

/** Completed tricks that only move the trick index forward. */
function filler(count: number): NapoleonTrickRecord[] {
  return Array.from({ length: count }, () => ({ ...trick('diamonds', [['N', card(5, 'diamonds')]]), leadSuit: 'diamonds', winnerSeat: 'N' }));
}

describe('Napoleon deal', () => {
  it('uses 54 distinct cards with two jokers', () => {
    const deck = createNapoleonDeck();
    expect(deck).toHaveLength(54);
    expect(new Set(deck.map(napoleonCardKey)).size).toBe(54);
    expect(deck.filter((entry) => 'joker' in entry)).toEqual([BIG, SMALL]);
  });

  it.each([[4, 13, 2], [5, 10, 4], [6, 8, 6]])('deals %i players %i cards and leaves %i face down', (players, hand, kitty) => {
    const seats = (['N', 'E', 'S', 'W', 'P5', 'P6'] as GameSeat[]).slice(0, players);
    const dealt = dealNapoleon(seats, createNapoleonDeck());
    expect(napoleonDealSize(players)).toEqual({ hand, kitty });
    for (const seat of seats) expect(dealt.hands[seat]).toHaveLength(hand);
    expect(dealt.kitty).toHaveLength(kitty);
  });

  it('rejects unsupported player counts and incomplete decks', () => {
    expect(() => napoleonDealSize(3)).toThrow(RangeError);
    expect(() => dealNapoleon(SEATS, createNapoleonDeck().slice(1))).toThrow(RangeError);
  });

  it('validates card payloads strictly', () => {
    expect(isNapoleonCard(BIG)).toBe(true);
    expect(isNapoleonCard(card(11, 'hearts'))).toBe(true);
    expect(isNapoleonCard({ joker: 'red' })).toBe(false);
    expect(isNapoleonCard({ suit: 'hearts', rank: 1 })).toBe(false);
    expect(isNapoleonCard({ suit: 'hearts', rank: 2, extra: true })).toBe(false);
  });

  it('sorts jokers first and the trump suit before the others', () => {
    expect(sortNapoleonHand([card(2, 'spades'), card(14, 'diamonds'), SMALL, BIG], 'diamonds'))
      .toEqual([BIG, SMALL, card(14, 'diamonds'), card(2, 'spades')]);
  });
});

describe('Napoleon auction', () => {
  it('offers levels 9 to 16 above the highest bid', () => {
    const start = createNapoleonBidding('E');
    expect(napoleonValidBids(start)).toHaveLength(1 + 8 * 5);
    const after = applyNapoleonBid(start, SEATS, 'E', { type: 'bid', level: 9, suit: 'nt' });
    expect(napoleonValidBids(after)[1]).toEqual({ type: 'bid', level: 10, suit: 'clubs' });
    expect(napoleonBidError(after, 'S', { type: 'bid', level: 9, suit: 'spades' })).not.toBeNull();
    expect(napoleonBidError(after, 'W', { type: 'pass' })).not.toBeNull();
    expect(napoleonBidError(start, 'E', { type: 'bid', level: 8 as 9, suit: 'clubs' })).not.toBeNull();
    expect(compareNapoleonBids({ level: 10, suit: 'clubs' }, { level: 9, suit: 'nt' })).toBeGreaterThan(0);
  });

  it('redeals when every seat passes and ends after the others pass a bid', () => {
    let bidding = createNapoleonBidding('N');
    for (const seat of SEATS.slice(0, 3)) bidding = applyNapoleonBid(bidding, SEATS, seat, { type: 'pass' });
    expect(napoleonBiddingEnd(bidding, 4)).toBe('continue');
    expect(napoleonBiddingEnd(applyNapoleonBid(bidding, SEATS, 'W', { type: 'pass' }), 4)).toBe('all_pass');

    bidding = applyNapoleonBid(bidding, SEATS, 'W', { type: 'bid', level: 11, suit: 'spades' });
    for (const seat of SEATS.slice(0, 2)) bidding = applyNapoleonBid(bidding, SEATS, seat, { type: 'pass' });
    expect(napoleonBiddingEnd(bidding, 4)).toBe('continue');
    bidding = applyNapoleonBid(bidding, SEATS, 'S', { type: 'pass' });
    expect(napoleonBiddingEnd(bidding, 4)).toBe('contract');
  });

  it('ends at once on 16 NT', () => {
    const bidding = applyNapoleonBid(createNapoleonBidding('N'), SEATS, 'N', { type: 'bid', level: 16, suit: 'nt' });
    expect(napoleonBiddingEnd(bidding, 4)).toBe('contract');
  });
});

describe('Napoleon exchange', () => {
  it('requires exactly the face-down count of distinct held cards', () => {
    const hand = [card(2), card(3), card(4)];
    expect(napoleonDiscardError(hand, [card(2), card(3)], 2)).toBeNull();
    expect(napoleonDiscardError(hand, [card(2)], 2)).not.toBeNull();
    expect(napoleonDiscardError(hand, [card(2), card(2)], 2)).not.toBeNull();
    expect(napoleonDiscardError(hand, [card(2), card(5)], 2)).not.toBeNull();
  });
});

describe('Napoleon play legality', () => {
  it('requires a named suit only when leading the secretary card or a joker', () => {
    const lead = view();
    const hand = [BIG, card(14, 'clubs'), card(5, 'spades')];
    expect(napoleonPlayError(lead, 'E', hand, { card: BIG }, null)).not.toBeNull();
    expect(napoleonPlayError(lead, 'E', hand, { card: BIG, leadSuit: 'spades' }, null)).toBeNull();
    expect(napoleonPlayError(lead, 'E', hand, { card: card(14, 'clubs'), leadSuit: 'hearts' }, null)).toBeNull();
    expect(napoleonPlayError(lead, 'E', hand, { card: card(5, 'spades'), leadSuit: 'hearts' }, null)).not.toBeNull();
  });

  it('must follow the led suit, except with the secretary card or a joker', () => {
    const following = view({ trick: trick('spades', [['N', card(9, 'spades')]]) });
    const hand = [card(5, 'spades'), card(5, 'hearts'), SMALL, card(14, 'clubs')];
    expect(napoleonPlayError(following, 'E', hand, { card: card(5, 'hearts') }, null)).not.toBeNull();
    expect(napoleonPlayError(following, 'E', hand, { card: SMALL }, null)).toBeNull();
    expect(napoleonPlayError(following, 'E', hand, { card: card(14, 'clubs') }, null)).toBeNull();
    expect(napoleonValidCards(following, 'E', hand)).toEqual([card(5, 'spades'), SMALL, card(14, 'clubs')]);
  });

  it('does not oblige the holder of a secretary card of the led suit to follow', () => {
    const following = view({ secretary: card(14, 'spades'), trick: trick('spades', [['N', card(9, 'spades')]]) });
    expect(napoleonPlayError(following, 'E', [card(14, 'spades'), card(5, 'hearts')], { card: card(5, 'hearts') }, null)).toBeNull();
  });

  it('forces the summoned card', () => {
    const summoned = view({ trick: trick('hearts', [['N', card(2, 'hearts')]], 'bigJoker') });
    expect(napoleonPlayError(summoned, 'E', [BIG, card(5, 'hearts')], { card: card(5, 'hearts') }, null)).not.toBeNull();
    expect(napoleonPlayError(summoned, 'E', [BIG, card(5, 'hearts')], { card: BIG }, null)).toBeNull();
    expect(napoleonPlayError(summoned, 'S', [card(5, 'hearts')], { card: card(5, 'hearts') }, null)).toBeNull();
  });
});

describe('Napoleon summons', () => {
  const hand = [card(2, 'hearts'), card(3, 'hearts'), card(7, 'spades')];

  it('lets a led trump 2 or 3 call the big or small joker', () => {
    expect(napoleonSummonOptions(view(), 'E', hand, card(2, 'hearts'), null)).toEqual(['bigJoker']);
    expect(napoleonSummonOptions(view(), 'E', hand, card(3, 'hearts'), null)).toEqual(['smallJoker']);
    expect(napoleonSummonOptions(view(), 'E', hand, card(7, 'spades'), null)).toEqual([]);
  });

  it('cannot call jokers in no trump, with the option off, or when the joker is the secretary card', () => {
    expect(napoleonSummonOptions(view({ trump: 'nt' }), 'E', [card(2, 'hearts')], card(2, 'hearts'), null)).toEqual([]);
    expect(napoleonSummonOptions(view({ jokerSummon: false }), 'E', hand, card(2, 'hearts'), null)).toEqual([]);
    expect(napoleonSummonOptions(view({ secretary: BIG }), 'E', hand, card(2, 'hearts'), null)).toEqual([]);
  });

  it('cannot call a joker the leader holds or that was already played', () => {
    expect(napoleonSummonOptions(view(), 'E', [...hand, BIG], card(2, 'hearts'), null)).toEqual([]);
    const played = view({ tricks: [{ ...trick('clubs', [['N', BIG]]), leadSuit: 'clubs', winnerSeat: 'N' }] });
    expect(napoleonSummonOptions(played, 'E', hand, card(2, 'hearts'), null)).toEqual([]);
  });

  it('lets a secretary card that is the trump 2 call the big joker when led', () => {
    const secretaryTwo = view({ secretary: card(2, 'hearts') });
    expect(napoleonSummonOptions(secretaryTwo, 'E', hand, card(2, 'hearts'), null)).toEqual(['bigJoker']);
    expect(napoleonPlayError(secretaryTwo, 'E', hand, { card: card(2, 'hearts'), leadSuit: 'clubs', summon: 'bigJoker' }, null))
      .toBeNull();
  });

  it('lets only the Napoleon call a secretary held by someone else', () => {
    expect(napoleonSummonOptions(view(), 'N', hand, card(7, 'spades'), [])).toEqual(['secretary']);
    expect(napoleonSummonOptions(view(), 'E', hand, card(7, 'spades'), null)).toEqual([]);
    expect(napoleonSummonOptions(view(), 'N', [...hand, card(14, 'clubs')], card(7, 'spades'), [])).toEqual([]);
    expect(napoleonSummonOptions(view(), 'N', hand, card(7, 'spades'), [card(14, 'clubs')])).toEqual([]);
  });

  it('forbids calling the secretary with a trump 2 or 3 lead', () => {
    expect(napoleonSummonOptions(view(), 'N', hand, card(2, 'hearts'), [])).toEqual(['bigJoker']);
    expect(napoleonPlayError(view(), 'N', hand, { card: card(2, 'hearts'), summon: 'secretary' }, [])).not.toBeNull();
    expect(napoleonSummonOptions(view({ jokerSummon: false }), 'N', hand, card(2, 'hearts'), [])).toEqual(['secretary']);
  });
});

describe('Napoleon trick winner', () => {
  it('ranks secretary, big joker, small joker, trump, then the led suit', () => {
    const base = view();
    expect(napoleonTrickWinner(base, trick('spades', [['N', card(14, 'spades')], ['E', card(2, 'hearts')], ['S', card(13, 'spades')]]), 0)).toBe('E');
    expect(napoleonTrickWinner(base, trick('spades', [['N', card(14, 'hearts')], ['E', SMALL], ['S', BIG]]), 0)).toBe('S');
    expect(napoleonTrickWinner(base, trick('spades', [['N', BIG], ['E', card(14, 'clubs')]]), 0)).toBe('E');
    expect(napoleonTrickWinner(base, trick('spades', [['N', card(5, 'spades')], ['E', card(14, 'diamonds')]]), 0)).toBe('N');
  });

  it('has no trump in no trump', () => {
    expect(napoleonTrickWinner(view({ trump: 'nt' }),
      trick('spades', [['N', card(5, 'spades')], ['E', card(14, 'hearts')]]), 0)).toBe('N');
  });

  it('makes jokers weakest in the final three tricks', () => {
    const finalTrick = view({ tricks: filler(10) });
    expect(isNapoleonFinalTrick(10, 4)).toBe(true);
    expect(isNapoleonFinalTrick(9, 4)).toBe(false);
    expect(napoleonTrickWinner(finalTrick, trick('spades', [['N', card(3, 'spades')], ['E', BIG]]), 10)).toBe('N');
    expect(napoleonTrickWinner(finalTrick, trick('spades', [['N', card(3, 'spades')], ['E', card(9, 'clubs')], ['S', BIG]]), 10)).toBe('N');
    // A led joker counts as the lowest card of the named suit.
    expect(napoleonTrickWinner(finalTrick, trick('spades', [['N', BIG], ['E', card(2, 'spades')]]), 10)).toBe('E');
    expect(napoleonTrickWinner(finalTrick, trick('spades', [['N', SMALL], ['E', card(9, 'clubs')], ['S', BIG]]), 10)).toBe('N');
    expect(napoleonTrickWinner(finalTrick, trick('spades', [['N', BIG], ['E', card(2, 'hearts')]]), 10)).toBe('E');
    // The secretary card stays strongest.
    expect(napoleonTrickWinner(finalTrick, trick('spades', [['N', card(14, 'spades')], ['E', card(14, 'clubs')]]), 10)).toBe('E');
  });

  it('applies the final three tricks by player count', () => {
    expect(isNapoleonFinalTrick(7, 5)).toBe(true);
    expect(isNapoleonFinalTrick(6, 5)).toBe(false);
    expect(isNapoleonFinalTrick(5, 6)).toBe(true);
    expect(isNapoleonFinalTrick(4, 6)).toBe(false);
  });

  it('keeps a joker secretary card strongest', () => {
    const jokerSecretary = view({ secretary: SMALL, tricks: filler(10) });
    expect(napoleonTrickWinner(jokerSecretary, trick('spades', [['N', card(14, 'hearts')], ['E', SMALL], ['S', BIG]]), 10)).toBe('E');
  });
});

describe('Napoleon settlement', () => {
  const contract: NapoleonContract = { level: 9, suit: 'hearts', napoleon: 'N' };
  const won = (winnerSeat: GameSeat, cards: NapoleonCard[]): NapoleonTrickRecord => ({
    ...trick('spades', cards.map((played, index) => [SEATS[index % 4], played])), leadSuit: 'spades', winnerSeat,
  });
  const points = (count: number): NapoleonCard[] => (['spades', 'hearts', 'diamonds', 'clubs'] as Suit[])
    .flatMap((suit) => [14, 13, 12, 11].map((rank) => card(rank as Card['rank'], suit))).slice(0, count);

  it('counts the Napoleon and secretary against the contract', () => {
    const cards = points(16);
    const tricks = [won('N', cards.slice(0, 4)), won('E', cards.slice(4, 9)), won('S', cards.slice(9, 14))];
    const outcome = napoleonOutcome(SEATS, contract, 'E', tricks, cards.slice(14));
    expect(outcome.napoleonPoints).toBe(9);
    expect(outcome.discardPoints).toBe(2);
    expect(outcome.defenderPoints).toBe(7);
    expect(outcome.napoleonWins).toBe(true);
    expect(outcome.winners).toEqual(['N', 'E']);
  });

  it('gives discarded points to the defenders and plays alone without a secretary', () => {
    const cards = points(16);
    const outcome = napoleonOutcome(SEATS, contract, null, [won('N', cards.slice(0, 8))], cards.slice(8, 10));
    expect(outcome.napoleonPoints).toBe(8);
    expect(outcome.defenderPoints).toBe(2);
    expect(outcome.napoleonWins).toBe(false);
    expect(outcome.winners).toEqual(['E', 'S', 'W']);
  });
});
