import { afterEach, describe, expect, it } from 'vitest';
import type { CardOrJoker, DouDizhuVisibleState, GameSeat, PlayerInfo } from '@shared/types';
import { cardKey, joker } from '@shared/rules/cards';
import { createDdzDeck, ddzCanPlay, ddzMoves, ddzResolve, sortDdzHand } from '@shared/rules/doudizhu';
import type { DdzCombo } from '@shared/rules/doudizhu';
import { getBotAction } from '../../src/bots/bot-decisions';
import type { BotAction } from '../../src/bots/bot-decisions';
import { gameBot } from '../../src/bots/bot-registry';
import { solveEndgame } from '../../src/bots/doudizhu-endgame';
import { cardsFor, cardTotal, planHand, rankMoves, toCounts } from '../../src/bots/doudizhu-hand';
import { dealGuesser } from '../../src/bots/doudizhu-inference';
import { matchValue } from '../../src/bots/doudizhu-match';
import { douDizhuSearch } from '../../src/bots/doudizhu-search';
import { handStrength, unseenCards } from '../../src/bots/doudizhu-strategy';
import { copyWorld } from '../../src/bots/doudizhu-world';
import type { World } from '../../src/bots/doudizhu-world';
import { createSearchPool } from '../../src/bots/search/search-worker-pool';
import { seededRandom } from '../../src/bots/search/seeded-random';
import type { SearchContext } from '../../src/bots/search/search-types';
import * as doudizhu from '../../src/managers/games/doudizhu-game';
import { firstLegalAction } from '../../src/runtime/automated-action';

const CODE = 'DDZB01';
const SEATS: GameSeat[] = ['N', 'E', 'S'];

const bot = (seat: GameSeat): PlayerInfo => ({ id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat',
  avatarImage: null, isBot: true });

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function hand(text: string): CardOrJoker[] {
  const used = new Map<string, number>();
  const suits = ['spades', 'hearts', 'clubs', 'diamonds'] as const;
  return text.split(/\s+/).filter(Boolean).map((token): CardOrJoker => {
    if (token === 'SJ') return joker('small');
    if (token === 'BJ') return joker('big');
    const rank = ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[token] ?? Number(token);
    const seen = used.get(token) ?? 0;
    used.set(token, seen + 1);
    return { suit: suits[seen], rank: rank as 2 };
  });
}

/** A budget of `ms` from now, or one that never expires. */
function context(seed: number, ms = Infinity): SearchContext {
  const started = Date.now();
  return {
    random: seededRandom(seed),
    budget: {
      maxDepth: undefined,
      timeLeftMs: () => Math.max(0, ms - (Date.now() - started)),
      expired: () => Date.now() - started >= ms,
    },
  };
}

const view = (seat: GameSeat): DouDizhuVisibleState => doudizhu.getPlayerVisibleState(CODE, seat)!;
const game = () => doudizhu.getGameState(CODE)!;

const action = (value: BotAction | null): { type: string; cards?: readonly CardOrJoker[]; score?: number; take?: boolean } | null =>
  value?.type === 'game-action' && value.request.gameType === 'doudizhu' ? value.request.action : null;

/** A playing table: N is landlord with `n`, E and S hold `e` and `s`; `last` is the play to answer. */
function table(n: string, e: string, s: string, lead?: { seat: GameSeat; cards: string }): void {
  doudizhu.startGame(CODE, Object.fromEntries(SEATS.map((seat) => [seat, bot(seat)])), { variant: 'score' }, 1_000, seeded(2));
  doudizhu.bid(CODE, 'N', 3);
  const state = game();
  state.hands.N = sortDdzHand(hand(n));
  state.hands.E = sortDdzHand(hand(e));
  state.hands.S = sortDdzHand(hand(s));
  if (lead) {
    const cards = hand(lead.cards);
    state.lastPlay = { seat: lead.seat, cards, combo: ddzResolve(cards, null)! };
    state.currentTurnSeat = SEATS[(SEATS.indexOf(lead.seat) + 1) % 3];
    state.passes = 0;
  }
}

/** `visible` with every card outside the three hands logged as played, so the seat knows each hand exactly. */
function openView(visible: DouDizhuVisibleState): DouDizhuVisibleState {
  const known = new Set(SEATS.flatMap((seat) => game().hands[seat]).map(cardKey));
  const played = createDdzDeck().filter((card) => !known.has(cardKey(card)));
  return { ...visible, bottom: null, log: [...visible.log, ...played.map((card) => ({
    type: 'play' as const, seat: 'N' as GameSeat, cards: [card], combo: ddzResolve([card], null)!, timestamp: 1,
  }))] };
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

afterEach(() => doudizhu.abortGame(CODE));

describe('Dou Dizhu hand model', () => {
  it('plans the fewest plays to empty a hand', () => {
    expect(planHand(toCounts(hand('3 3 3 4 4 4 5 6 7 8 9 10 J'))).turns).toBeLessThanOrEqual(3);
    expect(planHand(toCounts(hand('3 5 8 J K'))).turns).toBe(5);
    expect(planHand(toCounts(hand('SJ BJ'))).turns).toBe(1);
    expect(planHand(toCounts(hand('7 7 7 7'))).turns).toBe(1);
    expect(planHand(toCounts(hand('3 4 5 6 7 8'))).turns).toBe(1);
    expect(planHand(toCounts(hand('3 3 4 4 5 5 9'))).turns).toBe(2);
    expect(planHand(toCounts(hand('2 2 A A'))).score).toBeGreaterThan(planHand(toCounts(hand('3 3 4 4'))).score);
  });

  it('rates jokers, 2s, and bombs as auction strength', () => {
    expect(handStrength(hand('SJ BJ 2 2 A 5'))).toBeGreaterThan(handStrength(hand('3 4 5 6 7 8')));
    expect(handStrength(hand('9 9 9 9'))).toBeGreaterThan(0);
  });

  it('lists only legal plays, every kicker choice, and every shape the rules enumerate', () => {
    const random = seededRandom(17);
    for (let round = 0; round < 300; round++) {
      const cards = shuffled(createDdzDeck(), random).slice(0, 4 + Math.floor(random() * 17));
      const counts = toCounts(cards);
      const previous: (DdzCombo | null)[] = [null, ...ddzMoves(shuffled(createDdzDeck(), random).slice(0, 20), null)
        .map((move) => move.combo).filter((_, index) => index % 7 === 0)];
      for (const combo of previous) {
        const moves = rankMoves(counts, combo, 'all');
        for (const move of moves) expect(ddzCanPlay(cards, cardsFor(cards, move)!, combo)).toBe(true);
        const shapes = new Set(moves.map((move) => `${move.combo.type}${move.combo.power}.${move.combo.length}`));
        for (const reference of ddzMoves(cards, combo)) {
          expect(shapes.has(`${reference.combo.type}${reference.combo.power}.${reference.combo.length}`)).toBe(true);
        }
      }
    }
    const kickers = rankMoves(toCounts(hand('9 9 9 3 5 K')), null, 'all').filter((move) => move.combo.type === 'tripleSingle');
    expect(kickers.map((move) => move.ranks[3]).sort((a, b) => a - b)).toEqual([0, 2, 10]);
    expect(rankMoves(toCounts(hand('9 9 9 3 5 K')), null, 'cheap').filter((move) => move.combo.type === 'tripleSingle')).toHaveLength(1);
  });

  it('solves small endings exactly and leaves the world as it was', () => {
    const world = (landlord: string, east: string, south: string, turn: number): World => {
      const hands = [toCounts(hand(landlord)), toCounts(hand(east)), toCounts(hand(south))];
      return { hands, sizes: hands.map(cardTotal), landlord: 0, turn, last: null, lastSeat: turn, passes: 0, bombs: 0,
        plays: [1, 1, 1], winner: -1 };
    };
    // The landlord leads its rocket, then its last single.
    const winning = world('SJ BJ 3', '4 5', '6 7', 0);
    const before = copyWorld(winning);
    expect(solveEndgame(winning, new Map())).toBe(true);
    expect(winning).toEqual(before);
    // East leads its pair and goes out with the single nobody can beat.
    expect(solveEndgame(world('3 4 5', '9 9 2', '6 7', 1), new Map())).toBe(false);
    // Too large an ending is not solved.
    expect(solveEndgame(world('3 4 5 6 7 8 9 10 J Q K', '3 4 5 6 7 8 9 10 J', '3 4 5 6 7 8 9', 0), new Map(),
      { totalCards: 20, nodes: 1000 })).toBeNull();
  });
});

describe('Dou Dizhu match value', () => {
  it('values winning the match and, once it is settled, points', () => {
    const early = matchValue([10, 0, 0], 0, 3, seededRandom(1));
    expect(early([2, -1, -1])).toBeGreaterThan(early([-2, 1, 1]));
    // On the last deal, losing a small deal still wins the match for a big leader.
    const last = matchValue([10, 0, 0], 0, 0, seededRandom(1));
    expect(last([-2, 1, 1])).toBeGreaterThan(0.9);
    expect(last([-2, 1, 1])).toBeLessThan(last([2, -1, -1]));
    expect(matchValue([10, 0, 0], 1, 0, seededRandom(1))([4, -2, -2])).toBeLessThan(0.1);
    expect(matchValue([0, 0, 0], 0, 0, seededRandom(1))([0, 0, 0])).toBe(1);
  });
});

describe('Dou Dizhu bot', () => {
  it('bids from hand strength and never bids lower than the minimum', () => {
    doudizhu.startGame(CODE, Object.fromEntries(SEATS.map((seat) => [seat, bot(seat)])), { variant: 'score' }, 1_000, seeded(5));
    const decided = action(getBotAction(view('N'), () => 0.5));
    expect(decided?.type).toBe('bid');
    expect([0, 1, 2, 3]).toContain(decided?.score);
  });

  it('goes out when it can', () => {
    table('9 9', '3 4', '5 6', undefined);
    expect(action(getBotAction(view('N'), () => 0.5))).toMatchObject({ type: 'play' });
    expect(action(getBotAction(view('N'), () => 0.5))?.cards).toHaveLength(2);
    expect(action(douDizhuSearch(view('N'), context(1, 50)))?.cards).toHaveLength(2);
  });

  it('varies adjacent ordinary ranks while preserving the hand plan and high controls', () => {
    table('3 4 9 2', '5 6 7 8', '9 10 J Q');
    const visible = view('N');
    const before = structuredClone(visible);
    const ranks = new Set<number>();
    for (let seed = 1; seed <= 64; seed++) {
      const chosen = action(getBotAction(visible, seededRandom(seed)));
      expect(chosen?.type).toBe('play');
      expect(chosen?.cards).toHaveLength(1);
      const card = chosen!.cards![0];
      expect('rank' in card && [3, 4].includes(card.rank)).toBe(true);
      if ('rank' in card) ranks.add(card.rank);
      expect(action(getBotAction(visible, seededRandom(seed)))).toEqual(chosen);
    }
    expect(ranks.size).toBe(2);
    expect(visible).toEqual(before);
  });

  it('does not beat its farmer partner’s play', () => {
    table('4 4 5 5 6 6 K', '3 3 4 6 8', '9 9 A A K J', { seat: 'E', cards: '7 7' });
    // S is a farmer after E's play: it could beat 7 7 with 9 9, but its partner E is winning the round.
    expect(action(getBotAction(view('S'), () => 0.5))).toEqual({ type: 'pass' });
  });

  it('protects a partner close to going out, unless it can finish', () => {
    table('3 4 5 6 7 8 9 K', '3 5', '6 6 6 7 7 7 8 8 8 9 10 J Q K A 2 BJ', { seat: 'E', cards: '3' });
    for (let seed = 1; seed <= 16; seed++) expect(action(getBotAction(view('S'), seededRandom(seed)))).toEqual({ type: 'pass' });
    game().hands.S = hand('BJ');
    expect(action(douDizhuSearch(view('S'), context(4, 200)))).toMatchObject({ type: 'play' });
  });

  it('covers a low partner play when a last-card landlord is next, instead of cooperating into a loss', () => {
    table('4', '6 8', '5 A K', { seat: 'E', cards: '3' });
    const visible = openView(view('S'));
    for (let seed = 1; seed <= 8; seed++) {
      for (const chosen of [action(getBotAction(visible, seededRandom(seed))), action(douDizhuSearch(visible, context(seed, 300)))]) {
        expect(chosen?.type).toBe('play');
        expect(ddzCanPlay(visible.myHand, chosen!.cards!, visible.lastPlay!.combo)).toBe(true);
      }
    }
  });

  it('beats the landlord when it can do so cheaply', () => {
    table('3 3 4 5 6 K', '4 4 5 7 9', '9 9 A A K J', { seat: 'N', cards: '7 7' });
    expect(action(getBotAction(view('E'), () => 0.5))).toEqual({ type: 'pass' });
    game().currentTurnSeat = 'S';
    expect(action(getBotAction(view('S'), () => 0.5))).toMatchObject({ type: 'play' });
  });

  it('feeds a partner who is about to go out with a low single', () => {
    table('5 5 6 6 7 7 8 8 K K', '3', '4 9 9 K K A', undefined);
    game().currentTurnSeat = 'S';
    const decided = action(getBotAction(view('S'), () => 0.5));
    expect(decided).toMatchObject({ type: 'play' });
    expect(decided?.cards).toEqual(hand('4'));
  });

  it('only produces legal actions across whole games in both variants, including search decisions', () => {
    for (const [seed, variant] of [[31, 'score'], [32, 'grab']] as const) {
      doudizhu.startGame(CODE, Object.fromEntries(SEATS.map((seat) => [seat, bot(seat)])), { variant }, 1_000, seeded(seed));
      const random = seeded(seed + 1);
      let guard = 0;
      while (game().phase !== 'scoring' && guard++ < 2000) {
        const seat = game().currentTurnSeat;
        const visible = view(seat);
        const before = structuredClone(visible);
        const chosen = guard % 3 === 0 ? douDizhuSearch(visible, context(guard, guard % 2 ? 0 : 15)) : getBotAction(visible, random);
        expect(visible).toEqual(before);
        const move = action(chosen);
        expect(move, `${seat} acts`).not.toBeNull();
        if (move?.type === 'play') expect(ddzCanPlay(visible.myHand, move.cards ?? [], visible.lastPlay?.combo ?? null)).toBe(true);
        if (move?.type === 'pass') expect(visible.lastPlay).not.toBeNull();
        const result = move?.type === 'bid' ? doudizhu.bid(CODE, seat, move.score as 0, 2_000, random)
          : move?.type === 'claim' ? doudizhu.claim(CODE, seat, move.take as boolean, 2_000, random)
            : move?.type === 'play' ? doudizhu.play(CODE, seat, move.cards ?? [], 2_000, random)
              : doudizhu.pass(CODE, seat, 2_000);
        expect(result.success).toBe(true);
      }
      expect(game().phase).toBe('scoring');
      doudizhu.abortGame(CODE);
    }
  });

  it('knows only the cards it cannot see', () => {
    table('3 3 4', '5 6', '7 8');
    const unseen = unseenCards(view('E')).map(cardKey);
    for (const card of view('E').myHand) expect(unseen).not.toContain(cardKey(card));
    expect(unseen).toHaveLength(54 - view('E').myHand.length);
  });
});

describe('Dou Dizhu automation', () => {
  it('times out to a pass in the auction, a pass when following, and the smallest play when leading', () => {
    doudizhu.startGame(CODE, Object.fromEntries(SEATS.map((seat) => [seat, bot(seat)])), { variant: 'score' }, 1_000, seeded(5));
    const human = { isBot: false, strategy: () => null };
    const timeout = gameBot('doudizhu').turnTimeout!;
    expect(action(timeout(view('N'), human))).toEqual({ type: 'bid', score: 0 });
    doudizhu.abortGame(CODE);
    doudizhu.startGame(CODE, Object.fromEntries(SEATS.map((seat) => [seat, bot(seat)])), { variant: 'grab' }, 1_000, seeded(5));
    expect(action(timeout(view('N'), human))).toEqual({ type: 'claim', take: false });
    doudizhu.abortGame(CODE);
    table('3 3 8 9 K', '4 5 6', '7 8 9', { seat: 'N', cards: '8' });
    expect(action(timeout(view('E'), human))).toEqual({ type: 'pass' });
    doudizhu.abortGame(CODE);
    table('3 3 8 9 K', '4 5 6', '7 8 9');
    const lead = action(timeout(view('N'), human));
    expect(lead).toMatchObject({ type: 'play' });
    expect(lead?.cards).toHaveLength(2);
    expect(action(firstLegalAction(view('N')))).toMatchObject({ type: 'play' });
  });
});

describe('Dou Dizhu search bot', () => {
  it('guesses complete hands with public bottom cards fixed to the landlord, without spectator information', () => {
    doudizhu.startGame(CODE, Object.fromEntries(SEATS.map((seat) => [seat, bot(seat)])), { variant: 'score' }, 1_000, seeded(42));
    doudizhu.bid(CODE, 'N', 3);
    const visible = view('E');
    const before = structuredClone(visible);
    Object.defineProperty(visible, 'observedHands', { get: () => { throw new Error('Spectator data read.'); } });
    const guesser = dealGuesser(visible);
    const samples = new Set<string>();
    const bottom = toCounts(visible.bottom!);
    for (let seed = 1; seed <= 32; seed++) {
      const deal = guesser.guess(seededRandom(seed))!;
      for (let rank = 0; rank < 15; rank++) expect(deal.hands[0][rank]).toBeGreaterThanOrEqual(bottom[rank]);
      SEATS.forEach((seat, index) => expect(cardTotal(deal.hands[index])).toBe(visible.handCounts[seat]));
      expect(deal.hands[1]).toEqual(toCounts(visible.myHand));
      const all = deal.hands.reduce((sum, counts) => sum.map((value, rank) => value + counts[rank]), new Array<number>(15).fill(0));
      expect(all).toEqual([...toCounts(createDdzDeck())]);
      expect(guesser.guess(seededRandom(seed))).toEqual(deal);
      samples.add(deal.hands[2].join());
    }
    expect(samples.size).toBeGreaterThan(24);
    expect({ ...visible, observedHands: undefined }).toEqual({ ...before, observedHands: undefined });
  });

  it('reads a pass over a cheap single as a sign the seat could not beat it', () => {
    table('5 6 7 8 9 10 J Q K A A 2 2', '3', 'SJ BJ');
    // Every other card is out, so S guesses among N's twelve cards and E's one.
    const opened = openView(view('S'));
    const lead = game().hands.N.filter((card) => 'rank' in card && card.rank === 5);
    // N led its 5 and E passed: E probably does not hold a card from 6 up to K.
    const informedView: DouDizhuVisibleState = { ...opened, handCounts: { ...opened.handCounts, N: opened.handCounts.N - 1 },
      log: [...opened.log, { type: 'play', seat: 'N', cards: lead, combo: ddzResolve(lead, null)!, timestamp: 1 },
        { type: 'pass', seat: 'E', timestamp: 1 }] };
    const plainView: DouDizhuVisibleState = { ...informedView, log: informedView.log.slice(0, -1) };
    const plain = dealGuesser(plainView);
    const informed = dealGuesser(informedView);
    expect(informed.evidence).toBe(plain.evidence + 1);
    const middle = (counts: Uint8Array): number => counts.slice(3, 11).reduce((sum, count) => sum + count, 0);
    let plainMiddle = 0;
    let informedMiddle = 0;
    for (let seed = 1; seed <= 300; seed++) {
      plainMiddle += middle(plain.guess(seededRandom(seed))!.hands[1]);
      informedMiddle += middle(informed.guess(seededRandom(seed))!.hands[1]);
    }
    expect(informedMiddle).toBeLessThan(plainMiddle * 0.85);
  });

  it('bids strong hands and passes weak ones by simulation, in both auction variants', () => {
    for (const variant of ['score', 'grab'] as const) {
      doudizhu.startGame(CODE, Object.fromEntries(SEATS.map((seat) => [seat, bot(seat)])), { variant }, 1_000, seeded(5));
      const deck = createDdzDeck();
      const pick = (text: string): CardOrJoker[] => hand(text).map((card) => deck.find((other) => cardKey(other) === cardKey(card))!);
      game().hands.N = sortDdzHand(pick('SJ BJ 2 2 2 A A K K Q Q J 10 9 8 7 7'));
      const strong = action(douDizhuSearch(view('N'), context(3, 800)));
      expect(strong).toEqual(variant === 'score' ? { type: 'bid', score: 3 } : { type: 'claim', take: true });
      game().hands.N = sortDdzHand(pick('3 3 4 5 5 6 7 8 9 9 10 J J Q 4 6 8'));
      const weak = action(douDizhuSearch(view('N'), context(3, 800)));
      expect(weak).toEqual(variant === 'score' ? { type: 'bid', score: 0 } : { type: 'claim', take: false });
      doudizhu.abortGame(CODE);
    }
  });

  it('is declared for the worker pool with a time budget', () => {
    const search = gameBot('doudizhu').search;
    expect(search?.budgetMs).toBeGreaterThan(0);
    expect(search?.budgetMs).toBeLessThanOrEqual(1500);
    expect(search?.strategy.exportName).toBe('douDizhuSearch');
  });

  it('stays inside its time budget, plays a legal move, and repeats itself on the same seed without a clock', () => {
    table('3 3 4 5 6 7 8 9 K K A 2 SJ', '3 4 4 5 6 7 8 9 10 J Q', '5 6 7 8 9 10 J Q K A 2 2 BJ', { seat: 'N', cards: '7' });
    const visible = view('E');
    const started = Date.now();
    const move = action(douDizhuSearch(visible, context(3, 120)));
    expect(Date.now() - started).toBeLessThan(120 + 300);
    expect(move).not.toBeNull();
    if (move?.type === 'play') expect(ddzCanPlay(visible.myHand, move.cards ?? [], visible.lastPlay?.combo ?? null)).toBe(true);
    // A small ending is solved on every guess, so with an unlimited clock the seed alone decides.
    table('3 3 9 K', '4 4 8', '5 6 A', { seat: 'N', cards: '3' });
    const small = view('E');
    const limited = (seed: number): SearchContext => {
      let calls = 0;
      const base = context(seed);
      return { ...base, budget: { ...base.budget, expired: () => ++calls > 400 } };
    };
    expect(action(douDizhuSearch(small, limited(9)))).toEqual(action(douDizhuSearch(small, limited(9))));
  });

  it('runs through the worker pool and returns a legal action', async () => {
    table('3 3 4 5 6 7 8 9 K K A 2 SJ', '3 4 4 5 6 7 8 9 10 J Q', '5 6 7 8 9 10 J Q K A 2 2 BJ', { seat: 'N', cards: '7' });
    const visible = view('E');
    const pool = createSearchPool({ workers: 1, memoryMb: 256, queueLimit: 2 });
    try {
      const spec = gameBot('doudizhu').search!;
      const outcome = await pool.run({ strategy: spec.strategy, visible, budgetMs: spec.budgetMs, seed: 5 });
      expect(outcome.status).toBe('ok');
      const move = outcome.status === 'ok' ? action(outcome.action) : null;
      expect(move).not.toBeNull();
      if (move?.type === 'play') expect(ddzCanPlay(visible.myHand, move.cards ?? [], visible.lastPlay?.combo ?? null)).toBe(true);
    } finally {
      await pool.close();
    }
  });
});
