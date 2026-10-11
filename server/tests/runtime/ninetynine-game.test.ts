import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card, NinetyNineGameState, NinetyNineMatchResult, PlayerInfo, Seat } from '@shared/types';
import { nnApply, nnIsPlayable, nnRank, nnRequiresChoice, nnWinners } from '@shared/rules/ninetynine';
import type { NnChoice } from '@shared/rules/ninetynine';
import { createDeck, shuffleDeck } from '../../src/engine/deck';
import * as ninetynine from '../../src/managers/games/ninetynine-game';
import { isNinetyNineResult, isRuntimeSnapshot } from '../../src/runtime/validate';
import type { RuntimeSnapshot } from '../../src/runtime/types';

const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
const CODE = 'ABC123';
const PLAYERS: Record<Seat, PlayerInfo> = {
  N: player('north'), E: player('east'), S: player('south'), W: player('west'),
};

function player(id: string): PlayerInfo {
  return { id, username: id, nickname: id, color: '#123456', avatar: 'cat', avatarImage: null };
}

function card(suit: Card['suit'], rank: Card['rank']): Card {
  return { suit, rank };
}

const same = (a: Card, b: Card): boolean => a.suit === b.suit && a.rank === b.rank;

/** Deck layout: N, E, S, W hands (5 each), then the stock top-first; unset slots are filled in order. */
function deckWith(hands: Partial<Record<Seat, Card[]>>, stock: Card[] = [], decks = 1): Card[] {
  const slots: (Card | null)[] = Array.from({ length: 52 * decks }, () => null);
  SEATS.forEach((seat, index) => (hands[seat] ?? []).forEach((entry, offset) => { slots[index * 5 + offset] = entry; }));
  stock.forEach((entry, offset) => { slots[20 + offset] = entry; });
  const rest = Array.from({ length: decks }, () => createDeck()).flat();
  for (const slot of slots) if (slot) rest.splice(rest.findIndex((entry) => same(slot, entry)), 1);
  return slots.map((slot) => slot ?? rest.shift()!);
}

const TWO_DECKS = { twoDecks: true };

function game(): NinetyNineGameState {
  const state = ninetynine.getGameState(CODE);
  if (!state) throw new Error('Expected a 99 game');
  return state;
}

/** The game wrapped in a minimal persisted table, as the coordinator would save it. */
function persists(): boolean {
  const state = game();
  const playing = state.phase === 'playing';
  const snapshot: RuntimeSnapshot = {
    players: SEATS.map((seat) => ({ info: PLAYERS[seat], currentRoomCode: CODE, disconnectedAt: null })),
    rooms: [{
      info: {
        code: CODE, gameType: 'ninetynine', status: playing ? 'playing' : 'waiting', createdAt: 1,
        hostId: 'north', abortVote: null, abortVoteCooldownUntil: null,
        seats: { N: { player: PLAYERS.N, isReady: playing }, E: { player: PLAYERS.E, isReady: playing },
          S: { player: PLAYERS.S, isReady: playing }, W: { player: PLAYERS.W, isReady: playing } },
      },
      memberIds: SEATS.map((seat) => PLAYERS[seat].id),
    }],
    games: [structuredClone(state)],
    chat: [{ roomCode: CODE, messages: [] }],
  };
  return isRuntimeSnapshot(snapshot);
}

describe('Ninety-Nine gameplay', () => {
  beforeEach(() => ninetynine.restoreGames([]));

  it('should validate plays and draw back to five cards', () => {
    const deck = deckWith({ N: [card('hearts', 10), card('clubs', 12), card('spades', 5), card('clubs', 2), card('hearts', 3)] });
    ninetynine.startGame(CODE, PLAYERS, deck, 'N');
    expect(game()).toMatchObject({ phase: 'playing', currentTurnSeat: 'N', total: 0, direction: 'ccw' });
    expect(game().stock).toHaveLength(32);
    expect(persists()).toBe(true);

    expect(ninetynine.play(CODE, 'E', card('clubs', 2))).toEqual({ success: false, reason: 'Not your turn' });
    expect(ninetynine.play(CODE, 'N', card('diamonds', 2))).toEqual({ success: false, reason: 'Card not in hand' });
    expect(ninetynine.play(CODE, 'N', card('hearts', 10))).toEqual({ success: false, reason: 'Choose plus or minus' });
    expect(ninetynine.play(CODE, 'N', card('clubs', 2), 'plus')).toEqual({ success: false, reason: 'This card takes no choice' });
    expect(ninetynine.play(CODE, 'N', card('spades', 5))).toEqual({ success: false, reason: 'Choose the next player' });
    expect(ninetynine.play(CODE, 'N', card('spades', 5), undefined, 'N')).toEqual({ success: false, reason: 'Invalid target' });
    expect(ninetynine.play(CODE, 'N', card('clubs', 2), undefined, 'S')).toEqual({ success: false, reason: 'This card takes no target' });

    expect(ninetynine.play(CODE, 'N', card('hearts', 10), 'minus')).toEqual({ success: true });
    expect(game().total).toBe(0);
    expect(game().hands.N).toHaveLength(5);
    expect(game().stock).toHaveLength(31);
    // Counter-clockwise from N is W.
    expect(game().currentTurnSeat).toBe('W');
    expect(game().log.at(-1)).toMatchObject({ type: 'play', seat: 'N', choice: 'minus', target: null, total: 0 });
    expect(ninetynine.getPlayerVisibleState(CODE, 'E')).toMatchObject({ lastPlayed: card('hearts', 10), stockCount: 31 });
    expect(ninetynine.getPlayerVisibleState(CODE, 'E')).not.toHaveProperty('stock');
    expect(persists()).toBe(true);
  });

  it('should reverse on 4, pass on J and designate on 5', () => {
    const deck = deckWith({
      N: [card('hearts', 4)], E: [card('clubs', 11)], S: [card('spades', 5)], W: [card('clubs', 2)],
    });
    ninetynine.startGame(CODE, PLAYERS, deck, 'N');
    expect(ninetynine.play(CODE, 'N', card('hearts', 4))).toEqual({ success: true });
    expect(game()).toMatchObject({ direction: 'cw', currentTurnSeat: 'E', total: 0 });
    // J = PASS: total unchanged, play moves on to the next seat (S) as normal.
    expect(ninetynine.play(CODE, 'E', card('clubs', 11))).toEqual({ success: true });
    expect(game()).toMatchObject({ currentTurnSeat: 'S', total: 0 });
    expect(persists()).toBe(true);

    expect(ninetynine.play(CODE, 'S', card('spades', 5), undefined, 'E')).toEqual({ success: true });
    expect(game()).toMatchObject({ currentTurnSeat: 'E', total: 0, direction: 'cw' });
    expect(game().log.at(-1)).toMatchObject({ type: 'play', seat: 'S', target: 'E' });
    expect(persists()).toBe(true);
  });

  it('should eliminate a seat that cannot play when the turn lands on it', () => {
    const busted = [card('clubs', 9), card('hearts', 8), card('diamonds', 7), card('clubs', 6), card('diamonds', 9)];
    const deck = deckWith({ N: [card('spades', 13)], W: busted, S: [card('spades', 4)] });
    ninetynine.startGame(CODE, PLAYERS, deck, 'N');
    expect(ninetynine.play(CODE, 'N', card('spades', 13))).toEqual({ success: true });
    expect(game()).toMatchObject({ total: 99, eliminated: ['W'], currentTurnSeat: 'S', phase: 'playing' });
    expect(game().hands.W).toEqual([]);
    // The busted hand lies under the K, which stays the last played card.
    expect(game().discard).toEqual([...busted, card('spades', 13)]);
    expect(game().log.at(-1)).toMatchObject({ type: 'eliminated', seat: 'W' });
    expect(ninetynine.play(CODE, 'W', busted[0])).toEqual({ success: false, reason: 'Not your turn' });
    expect(persists()).toBe(true);

    // Turn order now skips W.
    expect(ninetynine.play(CODE, 'S', card('spades', 4))).toEqual({ success: true });
    expect(game().direction).toBe('cw');
    expect(['N', 'E', 'S']).toContain(game().currentTurnSeat);
    expect(persists()).toBe(true);
  });

  it.each([
    { drawnCard: 'a former stock card', drawPreviousTop: false },
    { drawnCard: 'the previous discard top', drawPreviousTop: true },
  ])('should reshuffle except its top card and draw $drawnCard when the stock runs out', ({ drawPreviousTop }) => {
    const deck = deckWith({ N: [card('clubs', 2)], W: [card('clubs', 3)] });
    ninetynine.startGame(CODE, PLAYERS, deck, 'N');
    expect(ninetynine.play(CODE, 'N', card('clubs', 2))).toEqual({ success: true });
    const state = game();
    state.discard = [...state.stock, ...state.discard];
    state.stock = [];
    const recycled = [...state.discard];
    const remainingHand = state.hands.W.filter((entry) => !same(entry, card('clubs', 3)));
    expect(persists()).toBe(true);

    const random = vi.spyOn(Math, 'random').mockReturnValue(0.999);
    if (drawPreviousTop) random.mockReturnValueOnce(0);
    try {
      expect(ninetynine.play(CODE, 'W', card('clubs', 3))).toEqual({ success: true });
    } finally {
      random.mockRestore();
    }
    expect(game().discard).toEqual([card('clubs', 3)]);
    expect(game().stock).toHaveLength(31);
    expect(game().hands.W).toHaveLength(5);
    expect(game().hands.W.slice(0, 4)).toEqual(remainingHand);
    const drawn = game().hands.W.slice(4);
    expect(drawn).toEqual([drawPreviousTop ? card('clubs', 2) : recycled[0]]);
    expect([...game().stock, ...drawn]).toEqual(expect.arrayContaining(recycled));
    expect(persists()).toBe(true);
  });

  it('should play a whole game to a single winner', () => {
    ninetynine.startGame(CODE, PLAYERS, shuffleDeck(createDeck()));
    for (let moves = 0; game().phase === 'playing' && moves < 2000; moves += 1) {
      const state = game();
      const seat = state.currentTurnSeat;
      // Highest reachable total, to bust players quickly.
      const options = state.hands[seat].filter((entry) => nnIsPlayable(state.total, entry)).flatMap((entry) =>
        (nnRequiresChoice(entry) ? ['plus', 'minus'] as NnChoice[] : [undefined])
          .map((choice) => ({ entry, choice, total: nnApply(state.total, entry, choice).total }))
          .filter((option) => option.total <= 99));
      const best = options.reduce((top, option) => (option.total > top.total ? option : top));
      const target = best.entry.rank === 5
        ? SEATS.find((other) => other !== seat && !state.eliminated.includes(other)) : undefined;
      expect(ninetynine.play(CODE, seat, best.entry, best.choice, target)).toEqual({ success: true });
      expect(persists()).toBe(true);
    }
    const { result, eliminated } = game();
    expect(game().phase).toBe('scoring');
    if (!result || !('winnerSeat' in result)) throw new Error('Expected a last survivor');
    expect(eliminated).toHaveLength(3);
    expect(result.eliminationOrder).toEqual(eliminated);
    expect(eliminated).not.toContain(result.winnerSeat);
    expect(result.finalTotal).toBe(game().total);
    expect(ninetynine.play(CODE, result.winnerSeat, game().hands[result.winnerSeat][0])).toMatchObject({ success: false });
  });

  it('should reject an incoherent persisted game', () => {
    ninetynine.startGame(CODE, PLAYERS, shuffleDeck(createDeck()));
    game().hands.N.pop();
    expect(persists()).toBe(false);
    ninetynine.startGame(CODE, PLAYERS, shuffleDeck(createDeck()));
    game().eliminated.push('E');
    expect(persists()).toBe(false);
  });

  it('should keep standard rules for legacy games without options', () => {
    const deck = deckWith({ N: [card('clubs', 2)], W: [card('clubs', 3)] });
    ninetynine.startGame(CODE, PLAYERS, deck, 'N');
    const legacy = structuredClone(game());
    Reflect.deleteProperty(legacy, 'options');
    ninetynine.restoreGames([legacy]);
    expect(persists()).toBe(true);
    expect(ninetynine.getPlayerVisibleState(CODE, 'E')?.options).toEqual({ twoDecks: false });
    expect(ninetynine.play(CODE, 'N', card('clubs', 2))).toEqual({ success: true });
    const state = game();
    state.discard = [...state.stock, ...state.discard];
    state.stock = [];
    expect(ninetynine.play(CODE, 'W', card('clubs', 3))).toEqual({ success: true });
    expect(game()).toMatchObject({ phase: 'playing', result: null });
    expect(game().stock).toHaveLength(31);
    expect(persists()).toBe(true);
  });
});

describe('Ninety-Nine with two decks and no reshuffle', () => {
  beforeEach(() => ninetynine.restoreGames([]));

  const busted = (suit: Card['suit']): Card[] => [card(suit, 9), card(suit, 8), card(suit, 7), card(suit, 6), card(suit, 3)];

  it('should deal from 104 shuffled cards with two copies of each', () => {
    ninetynine.startGame(CODE, PLAYERS, undefined, 'N', TWO_DECKS);
    const state = game();
    expect(state.options).toEqual(TWO_DECKS);
    expect(state.stock).toHaveLength(104 - 20);
    const all = [...SEATS.flatMap((seat) => state.hands[seat]), ...state.stock];
    for (const entry of createDeck()) expect(all.filter((other) => same(other, entry))).toHaveLength(2);
    expect(ninetynine.getPlayerVisibleState(CODE, 'E')).toMatchObject({ options: TWO_DECKS, stockCount: 84 });
    expect(persists()).toBe(true);
  });

  it('should play one of two identical hand cards', () => {
    const deck = deckWith({ N: [card('clubs', 2), card('clubs', 2)] }, [], 2);
    ninetynine.startGame(CODE, PLAYERS, deck, 'N', TWO_DECKS);
    expect(ninetynine.play(CODE, 'N', card('clubs', 2))).toEqual({ success: true });
    expect(game().hands.N.filter((entry) => same(entry, card('clubs', 2)))).toHaveLength(1);
    expect(game().hands.N).toHaveLength(5);
    expect(persists()).toBe(true);
  });

  it('should settle with every survivor tied when the last stock card is drawn', () => {
    const deck = deckWith({ N: [card('spades', 13)], W: busted('clubs'), S: [card('spades', 4)] }, [], 2);
    ninetynine.startGame(CODE, PLAYERS, deck, 'N', TWO_DECKS);
    expect(ninetynine.play(CODE, 'N', card('spades', 13))).toEqual({ success: true });
    expect(game()).toMatchObject({ total: 99, eliminated: ['W'], currentTurnSeat: 'S' });
    // Leave one card in the stock; the rest already sit under the discard top.
    const state = game();
    state.discard = [...state.stock.slice(1), ...state.discard];
    state.stock = state.stock.slice(0, 1);
    expect(persists()).toBe(true);

    expect(ninetynine.play(CODE, 'S', card('spades', 4))).toEqual({ success: true });
    expect(game()).toMatchObject({ phase: 'scoring', currentTurnSeat: 'S', stock: [] });
    expect(game().hands.S).toHaveLength(5);
    expect(game().result).toEqual({
      gameType: 'ninetynine', winners: ['N', 'E', 'S'], eliminationOrder: ['W'], finalTotal: 99,
    });
    expect(isNinetyNineResult(game().result)).toBe(true);
    expect(persists()).toBe(true);
    expect(ninetynine.play(CODE, 'E', game().hands.E[0])).toMatchObject({ success: false });
  });

  it('should still end with the last survivor when it comes first', () => {
    const deck = deckWith({ N: [card('spades', 13)], W: busted('clubs'), S: busted('hearts'), E: busted('diamonds') }, [], 2);
    ninetynine.startGame(CODE, PLAYERS, deck, 'N', TWO_DECKS);
    expect(ninetynine.play(CODE, 'N', card('spades', 13))).toEqual({ success: true });
    expect(game().result).toEqual({
      gameType: 'ninetynine', winnerSeat: 'N', eliminationOrder: ['W', 'S', 'E'], finalTotal: 99,
    });
    expect(game().stock).toHaveLength(83);
    expect(persists()).toBe(true);
  });

  it('should play whole games to a valid ending', () => {
    for (let round = 0; round < 5; round += 1) {
      ninetynine.startGame(CODE, PLAYERS, undefined, undefined, TWO_DECKS);
      for (let moves = 0; game().phase === 'playing' && moves < 200; moves += 1) {
        const state = game();
        const seat = state.currentTurnSeat;
        // Lowest reachable total, so the stock usually runs out before three players bust.
        const options = state.hands[seat].filter((entry) => nnIsPlayable(state.total, entry)).flatMap((entry) =>
          (nnRequiresChoice(entry) ? ['plus', 'minus'] as NnChoice[] : [undefined])
            .map((choice) => ({ entry, choice, total: nnApply(state.total, entry, choice).total }))
            .filter((option) => option.total <= 99));
        const best = options.reduce((low, option) => (option.total < low.total ? option : low));
        const target = best.entry.rank === 5
          ? SEATS.find((other) => other !== seat && !state.eliminated.includes(other)) : undefined;
        expect(ninetynine.play(CODE, seat, best.entry, best.choice, target)).toEqual({ success: true });
        expect(persists()).toBe(true);
      }
      expect(game().phase).toBe('scoring');
      expect(isNinetyNineResult(game().result)).toBe(true);
    }
  });

  it('should reject persisted states that break the fixed stock', () => {
    const deck = deckWith({ N: [card('spades', 13)], W: busted('clubs'), S: [card('spades', 4)] }, [], 2);
    ninetynine.startGame(CODE, PLAYERS, deck, 'N', TWO_DECKS);
    expect(ninetynine.play(CODE, 'N', card('spades', 13))).toEqual({ success: true });
    const playing = structuredClone(game());

    // An empty stock while playing would have needed a reshuffle.
    game().discard = [...game().stock, ...game().discard];
    game().stock = [];
    expect(persists()).toBe(false);

    // A third copy of a card.
    ninetynine.restoreGames([structuredClone(playing)]);
    game().stock[0] = { ...game().hands.N[0] };
    game().stock[1] = { ...game().hands.N[0] };
    expect(persists()).toBe(false);

    // Single-deck rules cannot hold 104 cards.
    ninetynine.restoreGames([structuredClone(playing)]);
    Reflect.deleteProperty(game(), 'options');
    expect(persists()).toBe(false);

    for (const options of [null, {}, { twoDecks: 'true' }, { twoDecks: true, extra: true }]) {
      ninetynine.restoreGames([structuredClone(playing)]);
      Object.assign(game(), { options });
      expect(persists()).toBe(false);
    }

    // A tie needs the stock to have run out, and lists exactly the survivors.
    ninetynine.restoreGames([structuredClone(playing)]);
    game().discard = [...game().stock.slice(1), ...game().discard];
    game().stock = game().stock.slice(0, 1);
    expect(ninetynine.play(CODE, 'S', card('spades', 4))).toEqual({ success: true });
    const settled = structuredClone(game());
    Object.assign(game(), { result: { ...settled.result, winners: ['N', 'S'], eliminationOrder: ['W', 'E'] } });
    expect(persists()).toBe(false);
    ninetynine.restoreGames([structuredClone(settled)]);
    Object.assign(game(), { phase: 'playing', result: null });
    expect(persists()).toBe(false);
  });
});

describe('Ninety-Nine results', () => {
  const base = { gameType: 'ninetynine', finalTotal: 99 };

  it('should accept the legacy single winner and tied survivors', () => {
    expect(isNinetyNineResult({ ...base, winnerSeat: 'E', eliminationOrder: ['N', 'S', 'W'] })).toBe(true);
    expect(isNinetyNineResult({ ...base, winners: ['E', 'W'], eliminationOrder: ['N', 'S'] })).toBe(true);
    expect(isNinetyNineResult({ ...base, winners: ['N', 'E', 'S', 'W'], eliminationOrder: [] })).toBe(true);
  });

  it.each([
    { winnerSeat: 'E', winners: ['E', 'W'], eliminationOrder: ['N', 'S'] },
    { eliminationOrder: ['N', 'S'] },
    { winners: ['E'], eliminationOrder: ['N', 'S', 'W'] },
    { winners: ['W', 'E'], eliminationOrder: ['N', 'S'] },
    { winners: ['E', 'W'], eliminationOrder: ['N', 'E'] },
    { winners: ['E', 'W'], eliminationOrder: ['N'] },
    { winnerSeat: 'E', eliminationOrder: ['N', 'S'] },
  ])('should reject malformed result %j', (shape) => {
    expect(isNinetyNineResult({ ...base, ...shape })).toBe(false);
  });

  it('should rank tied winners first and eliminated seats in reverse order', () => {
    const tied: NinetyNineMatchResult = {
      gameType: 'ninetynine', winners: ['N', 'S'], eliminationOrder: ['W', 'E'], finalTotal: 97,
    };
    expect(nnWinners(tied)).toEqual(['N', 'S']);
    expect(SEATS.map((seat) => nnRank(tied, seat))).toEqual([1, 3, 1, 4]);
    const legacy: NinetyNineMatchResult = {
      gameType: 'ninetynine', winnerSeat: 'E', eliminationOrder: ['N', 'S', 'W'], finalTotal: 99,
    };
    expect(nnWinners(legacy)).toEqual(['E']);
    expect(SEATS.map((seat) => nnRank(legacy, seat))).toEqual([4, 1, 3, 2]);
  });
});
