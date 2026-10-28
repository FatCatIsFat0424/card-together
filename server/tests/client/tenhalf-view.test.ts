import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPresentationFrames } from '@shared/game-presentation';
import type { Card, GameSeat, PlayerInfo, TenHalfVisibleState } from '@shared/types';
import { createDeck } from '../../src/engine/deck';
import * as tenhalf from '../../src/managers/games/tenhalf-game';
import {
  autoBetSeats, holeOf, recentTenHalfMoves, replayTenHalf, tenHalfCanAct, tenHalfHandNumber, tenHalfNeedsBet, tenHalfSeatOut,
  tenHalfView,
} from '../../../client/src/games/tenhalf/tenhalf-view';
import { deriveRoundHistory } from '../../../client/src/games/round-history';

const CODE = 'TENHV1';
const player = (seat: GameSeat): PlayerInfo => ({
  id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
});
const card = (rank: Card['rank'], suit: Card['suit'] = 'spades'): Card => ({ suit, rank });
const key = (value: Card): string => `${value.suit}${value.rank}`;

function rigged(top: readonly Card[]): () => number {
  const rest = createDeck().filter((value) => !top.some((wanted) => key(wanted) === key(value)));
  const target = [...top, ...rest];
  const deck = createDeck();
  const draws: number[] = [];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = deck.findIndex((value) => key(value) === key(target[i]));
    draws.push((j + 0.5) / (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  let index = 0;
  return () => draws[index++];
}

const view = (seat: GameSeat): TenHalfVisibleState => structuredClone(tenhalf.getPlayerVisibleState(CODE, seat)!);

/** Banker N (3), E (10, stands) and S (K, draws a 4 and stands): both players beat the banker. */
function playHand(): void {
  tenhalf.startGame(CODE, { N: player('N'), E: player('E'), S: player('S') }, 60_000, 1_000, () => 0);
  tenhalf.bet(CODE, 'E', 20, false, 1_500);
  tenhalf.bet(CODE, 'S', 30, true, 1_500, rigged([card(3), card(10, 'hearts'), card(13, 'clubs'), card(4, 'diamonds')]));
  tenhalf.act(CODE, 'E', 'stand');
  tenhalf.act(CODE, 'S', 'hit');
  tenhalf.act(CODE, 'S', 'stand');
  tenhalf.act(CODE, 'N', 'stand');
}

beforeEach(playHand);
afterEach(() => tenhalf.abortGame(CODE));

describe('Ten and a Half table view', () => {
  it('rebuilds the table up to a log entry without revealing later cards', () => {
    const game = view('S');
    const deal = game.log.findIndex((entry) => entry.type === 'deal');
    const afterDeal = replayTenHalf(game.log, game.seats, deal + 1);
    expect(afterDeal).toMatchObject({ hand: 1, banker: 'N', turn: 'E', revealed: false, betting: false });
    expect(afterDeal.chips).toMatchObject({ N: 1000, E: 980, S: 970 });
    expect(afterDeal.holes.E).toBeNull();
    const showdown = game.log.findIndex((entry) => entry.type === 'showdown');
    const shown = replayTenHalf(game.log, game.seats, showdown + 1);
    expect(shown).toMatchObject({ revealed: true, settlement: null });
    expect(shown.holes).toMatchObject({ N: card(3), E: card(10, 'hearts'), S: card(13, 'clubs') });
    const settled = replayTenHalf(game.log, game.seats, game.log.length);
    expect(settled.settlement?.net).toMatchObject({ N: -50, E: 20, S: 30 });
    expect(settled.chips).toMatchObject({ N: 950, E: 1020, S: 1030 });
  });

  it('follows the presentation frame instead of the live state', () => {
    const game = view('S');
    const frames = getPresentationFrames({ ...game, presentation: { id: 'p', startedAt: 0, logStart: 0 } });
    const deal = frames.find((frame) => frame.kind === 'deal')!;
    expect(deal.seat).toBe('N');
    const shownThen = tenHalfView(game, deal);
    expect(shownThen.holes.N).toBeNull();
    expect(shownThen.ups.S).toEqual([]);
    const live = tenHalfView(game, null);
    expect(live).toMatchObject({ betting: true, hand: 1, banker: 'N', currentBanker: 'E', revealed: true });
    expect(tenHalfHandNumber(live)).toBe(2);
  });

  it('shows the viewer’s own face-down card early and everyone’s after the showdown', () => {
    tenhalf.abortGame(CODE);
    tenhalf.startGame(CODE, { N: player('N'), E: player('E') }, 60_000, 1_000, () => 0);
    tenhalf.bet(CODE, 'E', 10, false, 1_500, rigged([card(3), card(9)]));
    const playing = view('E');
    const table = tenHalfView(playing, null);
    expect(holeOf(table, playing, 'E')).toEqual({ card: card(9), hidden: true });
    expect(holeOf(table, playing, 'N')).toEqual({ card: null, hidden: true });
    expect(holeOf(table, playing, 'N', { N: [card(3)] })).toEqual({ card: card(3), hidden: true });
    tenhalf.act(CODE, 'E', 'stand');
    tenhalf.act(CODE, 'N', 'stand');
    const finished = view('E');
    expect(holeOf(tenHalfView(finished, null), finished, 'N')).toEqual({ card: card(3), hidden: false });
  });

  it('knows who may act, bet, or sits out', () => {
    const game = view('S');
    expect(tenHalfCanAct(game, true)).toBe(false);
    expect(tenHalfNeedsBet({ ...game, betDeadline: 5_000, betPlaced: { ...game.betPlaced, S: false }, myBet: null }))
      .toBe(true);
    expect(tenHalfNeedsBet({ ...game, betDeadline: 5_000, banker: 'S' })).toBe(false);
    expect(tenHalfNeedsBet({ ...game, observer: 'spectator', betDeadline: 5_000 })).toBe(false);
    const live = tenHalfView(game, null);
    expect(tenHalfSeatOut({ ...live, chips: { ...live.chips, S: 5 } }, 'S')).toBe(true);
    expect(tenHalfSeatOut({ ...live, chips: { ...live.chips, E: 5 }, currentBanker: 'E' }, 'E')).toBe(false);
  });

  it('lists the newest moves first and marks automatic bets', () => {
    const game = view('S');
    expect(recentTenHalfMoves(game.log, 3).map((entry) => entry.type)).toEqual(['settle', 'showdown', 'stand']);
    expect(recentTenHalfMoves(game.log, 0)).toEqual([]);
    expect(autoBetSeats(game.log, game.log.length)).toEqual(['S']);
  });
});

describe('Ten and a Half round history', () => {
  it('lists the deal, draws, showdown, and settlement of each hand', () => {
    const game = view('S');
    const rounds = deriveRoundHistory(game);
    expect(rounds).toHaveLength(1);
    expect(rounds[0].complete).toBe(true);
    expect(rounds[0].actions.map((action) => [action.kind, action.seat])).toEqual([
      ['deal', 'N'], ['deal', 'E'], ['deal', 'S'], ['stand', 'E'], ['hit', 'S'], ['stand', 'S'], ['stand', 'N'],
      ['showdown', 'N'], ['showdown', 'E'], ['showdown', 'S'], ['settle', 'N'], ['settle', 'E'], ['settle', 'S'],
    ]);
    const [, east, south] = rounds[0].actions;
    expect(east).toMatchObject({ bet: 20 });
    expect(south).toMatchObject({ bet: 30, auto: true });
    expect(rounds[0].actions.find((action) => action.kind === 'showdown' && action.seat === 'S')).toMatchObject({
      handTotal: 9, handKind: 'points', cards: [card(13, 'clubs'), card(4, 'diamonds')] });
    expect(rounds[0].actions.find((action) => action.kind === 'settle' && action.seat === 'E')).toMatchObject({
      net: 20, outcomes: ['win'] });
    expect(rounds[0].actions.find((action) => action.kind === 'settle' && action.seat === 'N')).toMatchObject({
      net: -50, dealer: true });
  });
});
