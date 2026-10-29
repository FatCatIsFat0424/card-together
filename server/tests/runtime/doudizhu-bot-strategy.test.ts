import { afterEach, describe, expect, it } from 'vitest';
import type { CardOrJoker, DouDizhuVisibleState, GameSeat, PlayerInfo } from '@shared/types';
import { cardKey, joker } from '@shared/rules/cards';
import { ddzCanPlay, ddzResolve, sortDdzHand } from '@shared/rules/doudizhu';
import { getBotAction, getEasyBotAction } from '../../src/bots/bot-decisions';
import type { BotAction } from '../../src/bots/bot-decisions';
import { gameBot } from '../../src/bots/bot-registry';
import { douDizhuSearch } from '../../src/bots/doudizhu-search';
import { handStrength, handTurns, unseenCards } from '../../src/bots/doudizhu-strategy';
import { createSearchPool } from '../../src/bots/search/search-worker-pool';
import { seededRandom } from '../../src/bots/search/seeded-random';
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

afterEach(() => doudizhu.abortGame(CODE));

describe('Dou Dizhu hand evaluation', () => {
  it('counts the plays a hand needs to empty', () => {
    expect(handTurns(hand('3 3 3 4 4 4 5 6 7 8 9 10 J'))).toBeLessThanOrEqual(3);
    expect(handTurns(hand('3 5 8 J K'))).toBe(5);
    expect(handTurns(hand('SJ BJ'))).toBe(1);
    expect(handTurns(hand('7 7 7 7'))).toBe(1);
    expect(handTurns(hand('3 4 5 6 7 8'))).toBe(1);
  });

  it('rates jokers, 2s, and bombs as strength', () => {
    expect(handStrength(hand('SJ BJ 2 2 A 5'))).toBeGreaterThan(handStrength(hand('3 4 5 6 7 8')));
    expect(handStrength(hand('9 9 9 9'))).toBeGreaterThan(0);
  });
});

describe('Dou Dizhu Easy bot', () => {
  it('leads the smallest combination and answers with the smallest play that beats the last', () => {
    table('3 3 8 9 K', '4 5 6', '7 8 9');
    expect(action(getEasyBotAction(view('N')))).toMatchObject({ type: 'play' });
    expect(action(getEasyBotAction(view('N')))?.cards).toHaveLength(2);
    doudizhu.abortGame(CODE);
    table('4 4', '3 9 K', '5 7 A', { seat: 'N', cards: '8' });
    expect(action(getEasyBotAction(view('E')))).toMatchObject({ type: 'play', cards: [expect.objectContaining({ rank: 9 })] });
  });

  it('passes when nothing beats the last play', () => {
    table('A A', '3 4 5', '3 4 5 6', { seat: 'N', cards: '2' });
    expect(action(getEasyBotAction(view('E')))).toEqual({ type: 'pass' });
  });

  it('bids from hand strength and never bids lower than the minimum', () => {
    doudizhu.startGame(CODE, Object.fromEntries(SEATS.map((seat) => [seat, bot(seat)])), { variant: 'score' }, 1_000, seeded(5));
    for (const difficulty of ['easy', 'hard'] as const) {
      const decided = action(getBotAction(view('N'), () => 0.5, difficulty));
      expect(decided?.type).toBe('bid');
      expect([0, 1, 2, 3]).toContain(decided?.score);
    }
  });
});

describe('Dou Dizhu Hard bot', () => {
  it('goes out when it can', () => {
    table('9 9', '3 4', '5 6', undefined);
    expect(action(getBotAction(view('N'), () => 0.5, 'hard'))).toMatchObject({ type: 'play' });
    expect(action(getBotAction(view('N'), () => 0.5, 'hard'))?.cards).toHaveLength(2);
  });

  it('does not beat its farmer partner’s play', () => {
    table('4 4 5 5 6 6 K', '3 3 4 6 8', '9 9 A A K J', { seat: 'E', cards: '7 7' });
    // S is a farmer after E's play: it could beat 7 7 with 9 9, but its partner E is winning the round.
    const decided = action(getBotAction(view('S'), () => 0.5, 'hard'));
    expect(decided).toEqual({ type: 'pass' });
  });

  it('beats the landlord when it can do so cheaply', () => {
    table('3 3 4 5 6 K', '4 4 5 7 9', '9 9 A A K J', { seat: 'N', cards: '7 7' });
    const decided = action(getBotAction(view('E'), () => 0.5, 'hard'));
    expect(decided).toEqual({ type: 'pass' });
    game().currentTurnSeat = 'S';
    const second = action(getBotAction(view('S'), () => 0.5, 'hard'));
    expect(second).toMatchObject({ type: 'play' });
  });

  it('feeds a partner who is about to go out with a low single', () => {
    table('5 5 6 6 7 7 8 8 K K', '3', '4 9 9 K K A', undefined);
    const state = game();
    state.currentTurnSeat = 'S';
    state.landlord = 'N';
    const decided = action(getBotAction(view('S'), () => 0.5, 'hard'));
    expect(decided).toMatchObject({ type: 'play' });
    expect(decided?.cards).toHaveLength(1);
    expect(decided?.cards?.[0]).toMatchObject({ rank: 4 });
  });

  it('only produces legal actions across whole games, including search decisions', () => {
    for (const seed of [31, 32]) {
      doudizhu.startGame(CODE, Object.fromEntries(SEATS.map((seat) => [seat, bot(seat)])), { variant: 'score' }, 1_000, seeded(seed));
      const random = seeded(seed + 1);
      let guard = 0;
      while (game().phase !== 'scoring' && guard++ < 2000) {
        const seat = game().currentTurnSeat;
        const visible = view(seat);
        const chosen = guard % 5 === 0
          ? douDizhuSearch(visible, { random, budget: { maxDepth: undefined, timeLeftMs: () => 10, expired: () => true } })
          : getBotAction(visible, random, guard % 2 ? 'hard' : 'easy');
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
  it('is declared for the worker pool with a time budget', () => {
    const search = gameBot('doudizhu').search;
    expect(search?.budgetMs).toBeGreaterThan(0);
    expect(search?.strategy.exportName).toBe('douDizhuSearch');
  });

  it('stays inside its time budget and plays a legal move', () => {
    table('3 3 4 5 6 7 8 9 K K A 2 SJ', '3 4 4 5 6 7 8 9 10 J Q', '5 6 7 8 9 10 J Q K A 2 2 BJ', { seat: 'N', cards: '7' });
    const visible = view('E');
    const started = Date.now();
    const budgetMs = 120;
    const chosen = douDizhuSearch(visible, { random: seeded(3), budget: { maxDepth: undefined,
      timeLeftMs: () => Math.max(0, budgetMs - (Date.now() - started)), expired: () => Date.now() - started >= budgetMs } });
    expect(Date.now() - started).toBeLessThan(budgetMs + 400);
    const move = action(chosen);
    expect(move).not.toBeNull();
    if (move?.type === 'play') expect(ddzCanPlay(visible.myHand, move.cards ?? [], visible.lastPlay?.combo ?? null)).toBe(true);
  });

  it('runs through the worker pool and returns a legal action', async () => {
    table('3 3 4 5 6 7 8 9 K K A 2 SJ', '3 4 4 5 6 7 8 9 10 J Q', '5 6 7 8 9 10 J Q K A 2 2 BJ', { seat: 'N', cards: '7' });
    const visible = view('E');
    const pool = createSearchPool({ workers: 1, memoryMb: 256, queueLimit: 2 });
    try {
      const spec = gameBot('doudizhu').search!;
      const outcome = await pool.run({ strategy: spec.strategy, visible, budgetMs: 300, seed: 5 });
      expect(outcome.status).toBe('ok');
      const move = outcome.status === 'ok' ? action(outcome.action) : null;
      expect(move).not.toBeNull();
      if (move?.type === 'play') expect(ddzCanPlay(visible.myHand, move.cards ?? [], visible.lastPlay?.combo ?? null)).toBe(true);
    } finally {
      await pool.close();
    }
    expect(seededRandom(1)()).toBeGreaterThanOrEqual(0);
  });
});
