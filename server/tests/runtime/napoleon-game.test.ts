import { beforeEach, describe, expect, it } from 'vitest';
import { GAME_SEAT_ORDER } from '@shared/constants';
import {
  createNapoleonDeck, isNapoleonCard, napoleonCardKey, napoleonDealSize, napoleonPlayedCards, sameNapoleonCard,
} from '@shared/rules/napoleon';
import type {
  Card, GameSeat, NapoleonAction, NapoleonCard, NapoleonGameState, NapoleonTrickRecord, NapoleonVisibleState,
  PlayerInfo, Suit,
} from '@shared/types';
import type { RuntimeSnapshot } from '../../src/runtime/types';
import * as napoleon from '../../src/managers/games/napoleon-game';
import { firstLegalAction } from '../../src/runtime/automated-action';
import { isNapoleonResult, isRuntimeSnapshot } from '../../src/runtime/validate';

const CODE = 'NAP001';
const REVIEW_MS = 30_000;
const ALL_SEATS: readonly GameSeat[] = ['N', 'E', 'S', 'W', 'P5', 'P6'];
const BIG: NapoleonCard = { joker: 'big' };
const SMALL: NapoleonCard = { joker: 'small' };
const card = (rank: Card['rank'], suit: Suit): NapoleonCard => ({ suit, rank });

function player(seat: GameSeat, isBot = false): PlayerInfo {
  return isBot
    ? { id: `bot:00000000-0000-4000-8000-00000000000${GAME_SEAT_ORDER.indexOf(seat)}`, username: seat, nickname: seat,
      color: '#123456', avatar: 'owl', avatarImage: null, isBot: true }
    : { id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null };
}

function players(count: number, bots: readonly GameSeat[] = []): Partial<Record<GameSeat, PlayerInfo>> {
  return Object.fromEntries(ALL_SEATS.slice(0, count).map((seat) => [seat, player(seat, bots.includes(seat))]));
}

/** A deck that deals the wanted cards to each seat and to the table; the rest fill in deck order. */
function rigged(count: number, wanted: Partial<Record<GameSeat | 'kitty', readonly NapoleonCard[]>>): NapoleonCard[] {
  const seats = ALL_SEATS.slice(0, count);
  const { hand, kitty } = napoleonDealSize(count);
  const taken = Object.values(wanted).flat();
  const spare = createNapoleonDeck().filter((entry) => !taken.some((other) => sameNapoleonCard(entry, other)));
  const fill = (cards: readonly NapoleonCard[] = [], size: number): NapoleonCard[] =>
    [...cards, ...spare.splice(0, size - cards.length)];
  const hands = seats.map((seat) => fill(wanted[seat], hand));
  return [...hands.flat(), ...fill(wanted.kitty, kitty)];
}

function game(): NapoleonGameState {
  const state = napoleon.getGameState(CODE);
  if (!state) throw new Error('Expected a Napoleon game');
  return state;
}

function view(seat: GameSeat): NapoleonVisibleState {
  const visible = napoleon.getPlayerVisibleState(CODE, seat);
  if (!visible) throw new Error('Expected a visible state');
  return visible;
}

function act(seat: GameSeat, action: NapoleonAction, now = 1_000): ReturnType<typeof napoleon.act> {
  return napoleon.act(CODE, seat, action, REVIEW_MS, now, () => rigged(game().seats.length, {}));
}

function expectOk(seat: GameSeat, action: NapoleonAction): void {
  expect(act(seat, action)).toEqual({ success: true });
}

const pass: NapoleonAction = { type: 'bid', action: { type: 'pass' } };
const bid = (level: 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16, suit: Suit | 'nt'): NapoleonAction =>
  ({ type: 'bid', action: { type: 'bid', level, suit } });

/** The current bidder bids, then everyone else passes. */
function auction(level: 9 | 12 | 13 | 16, suit: Suit | 'nt'): GameSeat {
  const bidder = game().currentTurnSeat!;
  expectOk(bidder, bid(level, suit));
  while (game().phase === 'bidding') expectOk(game().currentTurnSeat!, pass);
  return bidder;
}

/** Wraps the live game in a room with the same seats, as persistence validates it. */
function snapshot(state: NapoleonGameState): RuntimeSnapshot {
  const playing = state.phase !== 'scoring';
  const occupants = Object.values(state.players).filter((entry): entry is PlayerInfo => entry !== undefined);
  const humans = occupants.filter((entry) => !entry.isBot).map((entry) => entry.id);
  const seat = (position: GameSeat): { player: PlayerInfo | null; isReady: boolean } => {
    const occupant = state.players[position] ?? null;
    return { player: occupant, isReady: Boolean(occupant?.isBot) || (playing && Boolean(occupant)) };
  };
  return {
    players: occupants.filter((entry) => !entry.isBot).map((info) => ({ info, currentRoomCode: CODE, disconnectedAt: null })),
    rooms: [{
      info: {
        code: CODE, gameType: 'napoleon', status: playing ? 'playing' : 'waiting', createdAt: 1, hostId: humans[0],
        abortVote: null, abortVoteCooldownUntil: null, seats: { N: seat('N'), E: seat('E'), S: seat('S'), W: seat('W') },
        additionalSeats: (['P5', 'P6'] as const).map(seat),
      },
      memberIds: occupants.map((entry) => entry.id),
    }],
    games: [structuredClone(state)],
    chat: [],
  };
}

/** Every card object anywhere in a JSON value. */
function cardsIn(value: unknown): NapoleonCard[] {
  if (Array.isArray(value)) return value.flatMap(cardsIn);
  if (typeof value !== 'object' || value === null) return [];
  if (isNapoleonCard(value)) return [value];
  return Object.values(value).flatMap(cardsIn);
}

/** Each seat sees only its hand, public plays, the secretary card, and the discards it may see. */
function expectPrivate(state: NapoleonGameState): void {
  const napoleonSeat = state.contract?.napoleon;
  const exchanged = !['bidding', 'exchanging'].includes(state.phase);
  const secretaryPlayed = state.secretaryCard !== null
    && napoleonPlayedCards(state).some((entry) => sameNapoleonCard(entry, state.secretaryCard!));
  for (const seat of state.seats) {
    const visible = view(seat);
    const allowed = [...(state.hands[seat] ?? []), ...napoleonPlayedCards(state),
      ...(state.secretaryCard ? [state.secretaryCard] : []),
      ...(exchanged && (seat === napoleonSeat || state.seats.length === 4 || state.phase === 'scoring') ? state.kitty : [])];
    for (const shown of cardsIn(JSON.parse(JSON.stringify(visible)))) {
      expect(allowed.some((entry) => sameNapoleonCard(entry, shown)), `${seat} sees ${napoleonCardKey(shown)}`).toBe(true);
    }
    expect(visible).not.toHaveProperty('hands');
    expect(visible).not.toHaveProperty('kitty');
    expect(visible).not.toHaveProperty('observedHands');
    expect(visible.secretarySeat).toBe(state.secretarySeat !== null
      && (seat === state.secretarySeat || secretaryPlayed || state.phase === 'scoring') ? state.secretarySeat : null);
    expect(visible.pickedUp).toEqual(state.phase === 'exchanging' && seat === napoleonSeat ? state.pickedUp : null);
    expect(visible.handCounts).toEqual(Object.fromEntries(state.seats.map((other) => [other, state.hands[other]?.length])));
  }
}

function expectValid(): void {
  expect(isRuntimeSnapshot(snapshot(game()))).toBe(true);
}

/** Plays the first legal action of whoever must act until the match is settled. */
function playOut(check: () => void = (): void => undefined): void {
  for (let step = 0; step < 400 && game().phase !== 'scoring'; step++) {
    const state = game();
    const seat = state.phase === 'reviewing' ? napoleon.pendingReviewSeats(state)[0] : state.currentTurnSeat;
    if (!seat) throw new Error('Expected a seat to act');
    const action = firstLegalAction(view(seat));
    if (action?.type !== 'napoleon-action') throw new Error('Expected a Napoleon action');
    expectOk(seat, action.action);
    check();
  }
  expect(game().phase).toBe('scoring');
}

describe('Napoleon game flow', () => {
  beforeEach(() => napoleon.restoreGames([]));

  it.each([[4, 13, 2], [5, 10, 4], [6, 8, 6]])('deals %i players %i cards each and %i to the table', (count, hand, kitty) => {
    napoleon.startGame(CODE, players(count), undefined, rigged(count, {}), 'W', 5);
    const state = game();
    expect(state.seats).toEqual(ALL_SEATS.slice(0, count));
    expect(state.kitty).toHaveLength(kitty);
    for (const seat of state.seats) expect(state.hands[seat]).toHaveLength(hand);
    expect(state.log).toEqual([{ type: 'deal', dealerSeat: 'W', timestamp: 5 }]);
    const opener = count === 4 ? 'N' : 'P5';
    expect(state.currentTurnSeat).toBe(opener);
    expect(state.bidding?.currentBidderSeat).toBe(opener);
    expect(view('E').myHand).toEqual(state.hands.E);
    expectPrivate(state);
    expectValid();
  });

  it('rejects starts outside four to six seats and dealers that do not take part', () => {
    expect(() => napoleon.startGame(CODE, players(3))).toThrow(RangeError);
    expect(() => napoleon.startGame(CODE, players(4), undefined, rigged(4, {}), 'P5')).toThrow(RangeError);
  });

  it('redeals with the same dealer when every seat passes, and validates bids', () => {
    napoleon.startGame(CODE, players(4), undefined, rigged(4, { N: [BIG] }), 'S', 0);
    const before = structuredClone(game().hands);
    expect(act('N', pass).success).toBe(false);
    expect(act('W', { type: 'bid', action: { type: 'bid', level: 8 as 9, suit: 'clubs' } }).success).toBe(false);
    for (const seat of ['W', 'N', 'E'] as const) expectOk(seat, pass);
    expect(game().log.filter((entry) => entry.type === 'deal')).toHaveLength(1);
    expectOk('S', pass);
    const state = game();
    expect(state.log.filter((entry) => entry.type === 'deal')).toEqual([
      { type: 'deal', dealerSeat: 'S', timestamp: 0 }, { type: 'deal', dealerSeat: 'S', timestamp: 1_000 }]);
    expect(state.hands).not.toEqual(before);
    expect(state).toMatchObject({ phase: 'bidding', currentTurnSeat: 'W', contract: null });
    expect(state.bidding).toEqual({ bids: [], currentBidderSeat: 'W', highestBid: null, consecutivePassCount: 0 });
    expectValid();
    expectOk('W', bid(10, 'hearts'));
    expect(act('N', bid(10, 'clubs')).success).toBe(false);
    expectOk('N', bid(10, 'nt'));
    for (const seat of ['E', 'S', 'W'] as const) expectOk(seat, pass);
    expect(game().contract).toEqual({ level: 10, suit: 'nt', napoleon: 'N' });
  });

  it('ends the auction at once on 16 NT and hands the table cards to the Napoleon privately', () => {
    const table = [card(14, 'spades'), card(13, 'spades')];
    napoleon.startGame(CODE, players(4), undefined, rigged(4, { kitty: table }), 'W', 0);
    expectOk('N', bid(16, 'nt'));
    const state = game();
    expect(state).toMatchObject({ phase: 'exchanging', currentTurnSeat: 'N', pickedUp: table });
    expect(state.hands.N).toHaveLength(15);
    expect(view('N').pickedUp).toEqual(table);
    expect(view('N').myHand).toEqual(expect.arrayContaining(table));
    expectPrivate(state);
    expectValid();
  });

  it('keeps five-player discards with the Napoleon until settlement and goes straight to the call', () => {
    napoleon.startGame(CODE, players(5), undefined, rigged(5, { E: [card(2, 'hearts'), card(3, 'hearts')] }), 'N', 0);
    expect(auction(12, 'hearts')).toBe('E');
    const hand = game().hands.E!;
    expect(act('N', { type: 'discard', cards: hand.slice(0, 4) }).success).toBe(false);
    expect(act('E', { type: 'discard', cards: hand.slice(0, 3) }).success).toBe(false);
    expect(act('E', { type: 'discard', cards: [hand[0], hand[0], hand[1], hand[2]] }).success).toBe(false);
    expect(act('E', { type: 'discard', cards: [...hand.slice(0, 3), game().hands.N![0]] }).success).toBe(false);
    const discards = hand.slice(-4);
    expectOk('E', { type: 'discard', cards: discards });
    const state = game();
    expect(state).toMatchObject({ phase: 'calling', currentTurnSeat: 'E', reviewDeadline: null, reviewed: [], pickedUp: [] });
    expect(state.kitty).toEqual(expect.arrayContaining(discards));
    expect(state.hands.E).toHaveLength(10);
    expect(state.log.at(-1)).toEqual({ type: 'exchange', seat: 'E', timestamp: 1_000 });
    expect(view('E').discards).toEqual(state.kitty);
    expect(view('N').discards).toBeNull();
    expectPrivate(state);
    expectValid();
  });

  it('asks the other humans to acknowledge public four-player discards; bots acknowledge at once', () => {
    napoleon.startGame(CODE, players(4, ['W']), undefined, rigged(4, {}), 'W', 0);
    expect(auction(9, 'spades')).toBe('N');
    expectOk('N', { type: 'discard', cards: game().hands.N!.slice(-2) });
    let state = game();
    expect(state).toMatchObject({ phase: 'reviewing', currentTurnSeat: null, reviewed: ['W'],
      reviewDeadline: 1_000 + REVIEW_MS });
    expect(napoleon.pendingReviewSeats(state)).toEqual(['E', 'S']);
    for (const seat of state.seats) expect(view(seat).discards).toEqual(state.kitty);
    expectPrivate(state);
    expectValid();
    expect(act('N', { type: 'review' }).success).toBe(false);
    expect(act('W', { type: 'review' }).success).toBe(false);
    expect(act('N', { type: 'call', card: BIG }).success).toBe(false);
    expectOk('S', { type: 'review' });
    expect(act('S', { type: 'review' }).success).toBe(false);
    expect(game().reviewed).toEqual(['S', 'W']);
    expectOk('E', { type: 'review' });
    state = game();
    expect(state).toMatchObject({ phase: 'calling', currentTurnSeat: 'N', reviewDeadline: null, reviewed: ['E', 'S', 'W'] });
    expectValid();
  });

  it('skips the review when every other seat is a bot', () => {
    napoleon.startGame(CODE, players(4, ['E', 'S', 'W']), undefined, rigged(4, {}), 'W', 0);
    auction(9, 'clubs');
    expectOk('N', { type: 'discard', cards: game().hands.N!.slice(0, 2) });
    expect(game()).toMatchObject({ phase: 'calling', currentTurnSeat: 'N', reviewDeadline: null, reviewed: ['E', 'S', 'W'] });
    expectValid();
  });

  it('tells only the secretary who holds the called card until it is played', () => {
    const secretaryCard = card(14, 'hearts');
    napoleon.startGame(CODE, players(5), undefined, rigged(5, { S: [secretaryCard] }), 'P5', 0);
    expect(auction(13, 'spades')).toBe('N');
    expectOk('N', { type: 'discard', cards: game().hands.N!.slice(-4) });
    expect(act('E', { type: 'call', card: secretaryCard }).success).toBe(false);
    expectOk('N', { type: 'call', card: secretaryCard });
    const state = game();
    expect(state).toMatchObject({ phase: 'playing', secretarySeat: 'S', currentTurnSeat: 'N',
      trick: { leadSeat: 'N', plays: [], leadSuit: null, summon: null } });
    expect(state.log.at(-1)).toEqual({ type: 'call', seat: 'N', card: secretaryCard, timestamp: 1_000 });
    expect(view('S').secretarySeat).toBe('S');
    expect(view('N').secretarySeat).toBeNull();
    expect(view('E').secretarySeat).toBeNull();
    expect(view('N').validCards.length).toBeGreaterThan(0);
    expect(view('E').validCards).toEqual([]);
    expectPrivate(state);
    expectValid();
    playOut(() => {
      expectPrivate(game());
      expectValid();
    });
    expect(view('E').secretarySeat).toBe('S');
  });

  it.each(['held', 'discarded'] as const)('leaves the Napoleon alone when the called card was %s', (where) => {
    napoleon.startGame(CODE, players(4), undefined, rigged(4, { N: [BIG] }), 'W', 0);
    auction(9, 'diamonds');
    const hand = game().hands.N!;
    expectOk('N', { type: 'discard', cards: where === 'discarded' ? [BIG, hand.find((entry) => !sameNapoleonCard(entry, BIG))!]
      : hand.filter((entry) => !sameNapoleonCard(entry, BIG)).slice(0, 2) });
    for (const seat of ['E', 'S', 'W'] as const) expectOk(seat, { type: 'review' });
    expectOk('N', { type: 'call', card: BIG });
    expect(game().secretarySeat).toBeNull();
    for (const seat of game().seats) expect(view(seat).secretarySeat).toBeNull();
    expectValid();
    playOut(() => expectValid());
    expect(game().result).toMatchObject({ secretarySeat: null, winners: game().result?.napoleonWins ? ['N'] : ['E', 'S', 'W'] });
  });
});

describe('Napoleon summons and tricks', () => {
  beforeEach(() => napoleon.restoreGames([]));

  /** N bids hearts with the trump 2 and 3, discards two low clubs, and calls the club ace from E. */
  function setUp(jokerSummon = true, extra: Partial<Record<GameSeat | 'kitty', readonly NapoleonCard[]>> = {}): void {
    napoleon.startGame(CODE, players(4), { jokerSummon }, rigged(4, {
      N: [card(2, 'hearts'), card(3, 'hearts'), card(4, 'clubs'), card(5, 'clubs'), card(5, 'hearts')],
      E: [card(14, 'clubs'), BIG], S: [SMALL, card(6, 'hearts')], W: [card(7, 'hearts')], ...extra,
    }), 'W', 0);
    auction(9, 'hearts');
    expectOk('N', { type: 'discard', cards: [card(4, 'clubs'), card(5, 'clubs')] });
    for (const seat of ['E', 'S', 'W'] as const) expectOk(seat, { type: 'review' });
    expectOk('N', { type: 'call', card: card(14, 'clubs') });
  }

  it('forces the summoned joker and logs the summon only on the lead', () => {
    setUp();
    expect(act('N', { type: 'play', card: card(3, 'hearts'), summon: 'bigJoker' }).success).toBe(false);
    expect(act('N', { type: 'play', card: card(5, 'hearts'), summon: 'bigJoker' }).success).toBe(false);
    expectOk('N', { type: 'play', card: card(2, 'hearts'), summon: 'bigJoker' });
    expect(game().log.at(-1)).toEqual({ type: 'play', seat: 'N', card: card(2, 'hearts'), summon: 'bigJoker', timestamp: 1_000 });
    expect(view('E').validCards).toEqual([BIG]);
    expect(act('E', { type: 'play', card: card(14, 'clubs') }).success).toBe(false);
    expect(act('E', { type: 'play', card: BIG, leadSuit: 'clubs' }).success).toBe(false);
    expectOk('E', { type: 'play', card: BIG });
    expect(game().log.at(-1)).toEqual({ type: 'play', seat: 'E', card: BIG, timestamp: 1_000 });
    expectOk('S', { type: 'play', card: card(6, 'hearts') });
    expectOk('W', { type: 'play', card: card(7, 'hearts') });
    const state = game();
    expect(state.tricks[0]).toMatchObject({ leadSeat: 'N', leadSuit: 'hearts', summon: 'bigJoker', winnerSeat: 'E' });
    expect(state.log.at(-1)).toEqual({ type: 'trick_end', winnerSeat: 'E', trickIndex: 1, timestamp: 1_000 });
    expect(state).toMatchObject({ currentTurnSeat: 'E', trick: { leadSeat: 'E', plays: [], leadSuit: null, summon: null } });
    expectValid();
  });

  it('summons the joker whenever a trump 2 or 3 is led, even when the play does not ask for it', () => {
    setUp();
    // Hearts are trump and S holds the small joker: leading the heart 3 forces it out.
    expectOk('N', { type: 'play', card: card(3, 'hearts') });
    expect(game().log.at(-1)).toEqual({ type: 'play', seat: 'N', card: card(3, 'hearts'), summon: 'smallJoker', timestamp: 1_000 });
    expect(game().trick).toMatchObject({ summon: 'smallJoker' });
    expectOk('E', { type: 'play', card: card(14, 'clubs') });
    expect(view('S').validCards).toEqual([SMALL]);
    expect(act('S', { type: 'play', card: card(6, 'hearts') }).success).toBe(false);
    expectOk('S', { type: 'play', card: SMALL });
    expectValid();
  });

  it('leaves a trump 2 lead plain when the leader holds the big joker', () => {
    setUp(true, { N: [card(2, 'hearts'), card(3, 'hearts'), card(4, 'clubs'), card(5, 'clubs'), BIG],
      E: [card(14, 'clubs'), card(5, 'hearts')] });
    expectOk('N', { type: 'play', card: card(2, 'hearts') });
    expect(game().log.at(-1)).toEqual({ type: 'play', seat: 'N', card: card(2, 'hearts'), timestamp: 1_000 });
    expect(game().trick).toMatchObject({ summon: null });
  });

  it('rejects joker summons when the option is off, the joker is the leader\'s, or the contract has no trump', () => {
    setUp(false);
    expect(act('N', { type: 'play', card: card(2, 'hearts'), summon: 'bigJoker' }).success).toBe(false);
    napoleon.restoreGames([]);
    setUp(true, { N: [card(2, 'hearts'), card(3, 'hearts'), card(4, 'clubs'), card(5, 'clubs'), BIG],
      E: [card(14, 'clubs'), card(5, 'hearts')] });
    expect(act('N', { type: 'play', card: card(2, 'hearts'), summon: 'bigJoker' }).success).toBe(false);
    expectOk('N', { type: 'play', card: card(3, 'hearts'), summon: 'smallJoker' });
    expectOk('E', { type: 'play', card: card(5, 'hearts') });
    expect(view('S').validCards).toEqual([SMALL]);
  });

  it('summons the secretary card, which then reveals the secretary to everyone', () => {
    setUp();
    expect(act('N', { type: 'play', card: card(2, 'hearts'), summon: 'secretary' }).success).toBe(false);
    expectOk('N', { type: 'play', card: card(5, 'hearts'), summon: 'secretary' });
    expect(view('E').validCards).toEqual([card(14, 'clubs')]);
    expect(view('S').secretarySeat).toBeNull();
    expectOk('E', { type: 'play', card: card(14, 'clubs') });
    for (const seat of game().seats) expect(view(seat).secretarySeat).toBe('E');
    expectValid();
  });

  it('requires a named suit when leading a free card and lets it ignore the led suit', () => {
    setUp();
    expect(act('N', { type: 'play', card: card(5, 'hearts'), leadSuit: 'spades' }).success).toBe(false);
    expectOk('N', { type: 'play', card: card(5, 'hearts') });
    expectOk('E', { type: 'play', card: BIG });
    expectOk('S', { type: 'play', card: card(6, 'hearts') });
    expectOk('W', { type: 'play', card: card(7, 'hearts') });
    expect(game().tricks[0].winnerSeat).toBe('E');
    expect(act('E', { type: 'play', card: card(14, 'clubs') }).success).toBe(false);
    expectOk('E', { type: 'play', card: card(14, 'clubs'), leadSuit: 'diamonds' });
    expect(game().log.at(-1)).toMatchObject({ seat: 'E', leadSuit: 'diamonds' });
    expect(game().trick?.leadSuit).toBe('diamonds');
    expectValid();
  });

  it('weakens jokers in the final three tricks and settles points with the discards to the defenders', () => {
    napoleon.startGame(CODE, players(4), undefined, rigged(4, {}), 'W', 0);
    auction(9, 'spades');
    expectOk('N', { type: 'discard', cards: game().hands.N!.slice(-2) });
    for (const seat of ['E', 'S', 'W'] as const) expectOk(seat, { type: 'review' });
    expectOk('N', { type: 'call', card: card(2, 'diamonds') });
    // Fast-forward to the eleventh trick with hands chosen for the test; earlier tricks only move the index.
    const state = game();
    const filler: NapoleonTrickRecord = { leadSeat: 'N', leadSuit: 'diamonds', summon: null, winnerSeat: 'N',
      plays: (['N', 'E', 'S', 'W'] as const).map((seat) => ({ seat, card: card(9, 'diamonds') })) };
    state.tricks = Array.from({ length: 10 }, () => filler);
    state.hands = {
      N: [BIG, card(14, 'spades'), card(12, 'hearts')], E: [card(2, 'clubs'), card(13, 'clubs'), card(11, 'clubs')],
      S: [card(5, 'spades'), card(3, 'spades'), card(4, 'spades')], W: [card(3, 'diamonds'), card(4, 'diamonds'), card(14, 'diamonds')],
    };
    expectOk('N', { type: 'play', card: BIG, leadSuit: 'clubs' });
    expectOk('E', { type: 'play', card: card(2, 'clubs') });
    expectOk('S', { type: 'play', card: card(5, 'spades') });
    expectOk('W', { type: 'play', card: card(3, 'diamonds') });
    // Spades are trump, so S wins; the led big joker counted only as the club 1.
    expect(game().tricks[10].winnerSeat).toBe('S');
    expectOk('S', { type: 'play', card: card(3, 'spades') });
    expectOk('W', { type: 'play', card: card(4, 'diamonds') });
    expectOk('N', { type: 'play', card: card(14, 'spades') });
    expectOk('E', { type: 'play', card: card(13, 'clubs') });
    expect(game().tricks[11].winnerSeat).toBe('N');
    expectOk('N', { type: 'play', card: card(12, 'hearts') });
    expectOk('E', { type: 'play', card: card(11, 'clubs') });
    expectOk('S', { type: 'play', card: card(4, 'spades') });
    expectOk('W', { type: 'play', card: card(14, 'diamonds') });
    const finished = game();
    expect(finished).toMatchObject({ phase: 'scoring', trick: null, currentTurnSeat: null });
    expect(finished.log.at(-1)).toMatchObject({ type: 'trick_end', winnerSeat: 'S', trickIndex: 13 });
    const result = finished.result!;
    expect(result.secretarySeat).toBe(game().secretarySeat);
    expect(result.points.N).toBe(2);
    expect(result.points.S).toBe(3);
    expect(result.discards).toEqual(finished.kitty);
    expect(result.napoleonPoints + result.defenderPoints).toBe(result.discardPoints + 5);
    for (const seat of finished.seats) {
      expect(view(seat).discards).toEqual(finished.kitty);
      expect(view(seat).secretarySeat).toBe(finished.secretarySeat);
      expect(view(seat).validCards).toEqual([]);
    }
  });
});

describe('Napoleon complete matches', () => {
  beforeEach(() => napoleon.restoreGames([]));

  it.each([4, 5, 6])('plays a %i-player match to a valid settlement with private views throughout', (count) => {
    napoleon.startGame(CODE, players(count), undefined, rigged(count, {}), 'N', 0);
    auction(9, 'clubs');
    playOut(() => {
      expectPrivate(game());
      expectValid();
    });
    const state = game();
    const result = state.result!;
    expect(result.seats).toEqual(state.seats);
    expect(result.napoleonPoints + result.defenderPoints).toBe(16);
    expect(result.winners.length).toBeGreaterThan(0);
    expect(isNapoleonResult(result)).toBe(true);
    expect(isNapoleonResult({ ...result, winners: [...result.winners].reverse().slice(1) })).toBe(false);
    expect(isNapoleonResult({ ...result, napoleonWins: !result.napoleonWins })).toBe(false);
    expect(isNapoleonResult({ ...result, discards: result.discards.slice(1) })).toBe(false);
    expect(isNapoleonResult({ ...result, points: { ...result.points, P8: 1 } })).toBe(false);
  });
});

describe('Napoleon persistence validation', () => {
  beforeEach(() => napoleon.restoreGames([]));

  function toCalling(): void {
    napoleon.startGame(CODE, players(4), undefined, rigged(4, { E: [BIG] }), 'W', 0);
    auction(9, 'clubs');
    expectOk('N', { type: 'discard', cards: game().hands.N!.slice(-2) });
    for (const seat of ['E', 'S', 'W'] as const) expectOk(seat, { type: 'review' });
  }

  it('rejects states that contradict the public log or misplace cards', () => {
    toCalling();
    expectOk('N', { type: 'call', card: BIG });
    expectOk('N', { type: 'play', card: view('N').validCards.find((entry) => !('joker' in entry))! });
    expectValid();
    const tamper = (change: (state: NapoleonGameState) => void): boolean => {
      const copy = snapshot(game());
      change(copy.games[0] as NapoleonGameState);
      return isRuntimeSnapshot(copy);
    };
    expect(tamper((state) => { state.secretarySeat = 'S'; })).toBe(false);
    expect(tamper((state) => { state.secretarySeat = null; })).toBe(false);
    expect(tamper((state) => { state.hands.E = [...state.hands.E!.slice(1), state.kitty[0]]; })).toBe(false);
    expect(tamper((state) => { state.kitty = []; })).toBe(false);
    expect(tamper((state) => { state.currentTurnSeat = 'S'; })).toBe(false);
    expect(tamper((state) => { state.log = state.log.filter((entry) => entry.type !== 'exchange'); })).toBe(false);
    expect(tamper((state) => { state.phase = 'calling'; })).toBe(false);
    expect(tamper((state) => { state.contract = { ...state.contract!, level: 10 }; })).toBe(false);
    expect(tamper((state) => { (state.hands as Record<string, unknown>).P7 = []; })).toBe(false);
  });

  it('accepts every phase of a match and rejects unknown options', () => {
    toCalling();
    expectValid();
    const copy = snapshot(game());
    (copy.games[0] as { options: unknown }).options = { jokerSummon: 'yes' };
    expect(isRuntimeSnapshot(copy)).toBe(false);
    const room = snapshot(game());
    room.rooms[0].info = { ...room.rooms[0].info, gameOptions: { napoleon: { jokerSummon: true, extra: 1 } as never } };
    expect(isRuntimeSnapshot(room)).toBe(false);
    const seats = snapshot(game());
    seats.rooms[0].info = { ...seats.rooms[0].info,
      additionalSeats: [...seats.rooms[0].info.additionalSeats!, { player: null, isReady: false }] };
    expect(isRuntimeSnapshot(seats)).toBe(false);
  });
});
