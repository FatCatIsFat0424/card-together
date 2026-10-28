import { afterEach, describe, expect, it } from 'vitest';
import { matchStanding } from '@shared/rules/match-standing';
import { gameFacts } from '@shared/stats/registry';
import { STATS_RECORDS } from '@shared/stats/definitions';
import type { Card, GameSeat, PlayerInfo, ReplaySnapshot, TenHalfMatchResult } from '@shared/types';
import { createDeck } from '../../src/engine/deck';
import * as tenhalf from '../../src/managers/games/tenhalf-game';

const CODE = 'TENHS1';
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

afterEach(() => tenhalf.abortGame(CODE));

describe('Ten and a Half statistics', () => {
  function resultOf(seats: readonly GameSeat[]): TenHalfMatchResult {
    const game = tenhalf.getGameState(CODE)!;
    return { gameType: 'tenhalf', seats: [...seats], chips: game.chips, hands: game.hand, winners: ['E'] };
  }

  it('records the stack, special hands shown, the best hand win, busts, and banker net from the log', () => {
    tenhalf.startGame(CODE, { N: player('N'), E: player('E') }, 60_000, 1_000, () => 0);
    // Hand 1, banker N: E holds five face cards (x5) against a 3. Hand 2, banker E: N busts.
    tenhalf.bet(CODE, 'E', 10, false, 1_500, rigged([card(3), card(13), card(12), card(11), card(13, 'hearts'), card(12, 'hearts')]));
    for (let draw = 0; draw < 4; draw++) tenhalf.act(CODE, 'E', 'hit');
    tenhalf.act(CODE, 'N', 'stand');
    tenhalf.getGameState(CODE)!.betDeadline = 99_000;
    tenhalf.bet(CODE, 'N', 10, false, 2_000, rigged([card(10, 'hearts'), card(4), card(2, 'clubs')]));
    tenhalf.act(CODE, 'N', 'hit');
    tenhalf.act(CODE, 'E', 'stand');
    const frame = tenhalf.getPlayerVisibleState(CODE, 'N') as unknown as ReplaySnapshot;
    const result = resultOf(['N', 'E']);
    const east = gameFacts('tenhalf', result, 'E', frame);
    expect(east.values).toMatchObject({ topChips: result.chips.E, bestHand: 50 });
    expect(east.counts).toEqual({ specialHands: 1, handsPlayed: 1 });
    expect(east.sums).toEqual({ bankerNet: 10 });
    const north = gameFacts('tenhalf', result, 'N', frame);
    expect(north.values).toMatchObject({ bestHand: -10 });
    expect(north.counts).toEqual({ handsPlayed: 1, busts: 1 });
    expect(north.sums).toEqual({ bankerNet: -50 });
  });

  it('defines only the version 1 records the extractor can produce', () => {
    expect(STATS_RECORDS.tenhalf.map((record) => record.id)).toEqual(['topChips', 'specialHands', 'bestHand', 'bankerNet']);
    expect(STATS_RECORDS.tenhalf.every((record) => record.version === 1)).toBe(true);
  });

  it('counts a tie for the most chips as a win for every tied seat', () => {
    const result: TenHalfMatchResult = { gameType: 'tenhalf', seats: ['N', 'E', 'S'], hands: 6, winners: ['N', 'E'],
      chips: { N: 1100, E: 1100, S: 800, W: 0, P5: 0, P6: 0, P7: 0, P8: 0 } };
    expect(matchStanding(result, 'N')).toMatchObject({ rank: 1, tied: true, won: true, score: 100, players: 3 });
    expect(matchStanding(result, 'E')).toMatchObject({ rank: 1, won: true });
    expect(matchStanding(result, 'S')).toMatchObject({ rank: 3, won: false, score: -200 });
  });
});
