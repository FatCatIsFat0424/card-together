import { afterEach, describe, expect, it } from 'vitest';
import type { DouDizhuVisibleState, GameSeat, PlayerInfo } from '@shared/types';
import type { PresentationFrame } from '@shared/game-presentation';
import { joker } from '@shared/rules/cards';
import { douDizhuFacts } from '@shared/stats/doudizhu';
import * as doudizhu from '../../src/managers/games/doudizhu-game';
import {
  auctionPrompt, doudizhuView, nextSeat, seatBid, selectedIn, settledDeals, shownHand, toggleCard,
} from '../../../client/src/games/doudizhu/doudizhu-view';
import { deriveDouDizhuRounds } from '../../../client/src/games/doudizhu/doudizhu-rounds';
import { createRoundBuilder } from '../../../client/src/games/round-builder';

const CODE = 'DDZV01';
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

const visible = (seat: GameSeat): DouDizhuVisibleState => structuredClone(doudizhu.getPlayerVisibleState(CODE, seat)!);
const frameAt = (index: number): PresentationFrame => ({ key: `p:${index}`, kind: 'play', durationMs: 1, cards: [] });
const start = (variant: 'score' | 'grab' = 'score'): void =>
  doudizhu.startGame(CODE, Object.fromEntries(SEATS.map((seat) => [seat, bot(seat)])), { variant }, 1_000, seeded(4));

afterEach(() => doudizhu.abortGame(CODE));

describe('Dou Dizhu table view', () => {
  it('shows seat bids while the auction runs and the landlord marker afterwards', () => {
    start();
    doudizhu.bid(CODE, 'N', 1);
    doudizhu.bid(CODE, 'E', 0);
    const calling = doudizhuView(visible('S'), null);
    expect(calling).toMatchObject({ phase: 'calling', turn: 'S', landlord: null });
    expect(seatBid(calling, 'N')).toMatchObject({ key: 'doudizhu.bidScore', params: { n: '1' } });
    expect(seatBid(calling, 'E')).toMatchObject({ key: 'doudizhu.bidPass', tone: 'pass' });
    expect(seatBid(calling, 'S')).toBeNull();
    doudizhu.bid(CODE, 'S', 2);
    const playing = doudizhuView(visible('S'), null);
    expect(playing).toMatchObject({ phase: 'playing', landlord: 'S', turn: 'S' });
    expect(playing.counts).toMatchObject({ N: 17, E: 17, S: 20 });
    expect(seatBid(playing, 'S')).toBeNull();
    expect(playing.bottom).toHaveLength(3);
  });

  it('labels call, grab, and the answers in the grab auction', () => {
    start('grab');
    doudizhu.claim(CODE, 'N', false);
    doudizhu.claim(CODE, 'E', true);
    doudizhu.claim(CODE, 'S', true);
    const table = doudizhuView(visible('N'), null);
    expect(seatBid(table, 'N')?.key).toBe('doudizhu.claimPass');
    expect(seatBid(table, 'E')?.key).toBe('doudizhu.claimCall');
    expect(seatBid(table, 'S')?.key).toBe('doudizhu.claimGrab');
    expect(table.auction).toMatchObject({ done: false, mode: 'grab', turn: 'N' });
    const prompt = auctionPrompt(visible('N'), table);
    expect(prompt).toMatchObject({ mode: 'grab' });
    expect(auctionPrompt(visible('E'), table)).toBeNull();
  });

  it('rebuilds the table up to a presentation frame and keeps the finished deal’s hand', () => {
    start();
    doudizhu.bid(CODE, 'N', 3);
    doudizhu.play(CODE, 'N', doudizhu.getGameState(CODE)!.hands.N.slice(-1), 2_000, seeded(9));
    const game = visible('N');
    const index = game.log.findIndex((entry) => entry.type === 'landlord');
    const shown = doudizhuView(game, frameAt(index));
    expect(shown.phase).toBe('playing');
    expect(shown.lastPlay).toBeNull();
    expect(doudizhuView(game, null).lastPlay).not.toBeNull();
    expect(shownHand(game, shown)).toEqual(game.myHand);
  });

  it('marks the next player after the viewer', () => {
    start();
    expect(nextSeat({ seats: SEATS, mySeat: 'N' })).toBe('E');
    expect(nextSeat({ seats: SEATS, mySeat: 'S' })).toBe('N');
  });

  it('toggles selections and drops cards that left the hand', () => {
    const hand = [joker('big'), { suit: 'clubs', rank: 3 } as const];
    const selected = toggleCard(toggleCard([], hand[0]), hand[1]);
    expect(selected).toHaveLength(2);
    expect(toggleCard(selected, hand[0])).toEqual([hand[1]]);
    expect(selectedIn([hand[1]], selected)).toEqual([hand[1]]);
  });

  it('lists settled deals and builds one history round per deal', () => {
    start();
    doudizhu.bid(CODE, 'N', 3);
    const state = doudizhu.getGameState(CODE)!;
    state.hands.N = [state.hands.N[0]];
    doudizhu.play(CODE, 'N', state.hands.N, 2_000, seeded(9));
    const game = visible('N');
    expect(settledDeals(game.log)).toHaveLength(1);
    const builder = createRoundBuilder();
    deriveDouDizhuRounds({ gameType: 'doudizhu', phase: game.phase, log: game.log, seats: game.seats }, builder);
    expect(builder.rounds).toHaveLength(2);
    expect(builder.rounds[0].complete).toBe(true);
    expect(builder.rounds[0].actions.map((action) => action.kind)).toEqual(
      ['deal', 'bid', 'call', 'play', 'settle', 'settle', 'settle']);
    expect(builder.rounds[1].complete).toBe(false);
  });
});

describe('Dou Dizhu statistics', () => {
  it('counts bombs, rockets, landlord wins, and springs from the public log', () => {
    start();
    doudizhu.bid(CODE, 'N', 3);
    const state = doudizhu.getGameState(CODE)!;
    state.hands.N = [{ suit: 'spades', rank: 3 }, { suit: 'hearts', rank: 3 }];
    doudizhu.play(CODE, 'N', state.hands.N, 2_000, seeded(9));
    const game = doudizhu.getGameState(CODE)!;
    const frame = { ...visible('N'), log: game.log } as never;
    const result = { gameType: 'doudizhu', seats: SEATS, scores: { ...game.totals }, deals: 6, winners: ['N'] } as never;
    const facts = douDizhuFacts(result, 'N', frame);
    expect(facts.counts).toMatchObject({ landlordWins: 1, springs: 1 });
    expect(facts.values.topScore).toBe(game.totals.N);
    expect(douDizhuFacts(result, 'E', frame).counts.springs).toBeUndefined();
  });
});
