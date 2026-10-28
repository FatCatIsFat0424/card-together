import { afterEach, describe, expect, it } from 'vitest';
import type { Card, GameSeat, PlayerInfo, TenHalfAction, TenHalfVisibleState } from '@shared/types';
import { BJ_MAX_BET, BJ_MIN_BET } from '@shared/rules/blackjack';
import { getBotAction, getEasyBotAction } from '../../src/bots/bot-decisions';
import type { BotAction } from '../../src/bots/bot-decisions';
import { tenHalfDecision, unseenDraws } from '../../src/bots/tenhalf-strategy';
import { createDeck } from '../../src/engine/deck';
import * as tenhalf from '../../src/managers/games/tenhalf-game';

const CODE = 'TENHB1';

const player = (seat: GameSeat): PlayerInfo => ({
  id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null, isBot: true,
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

/** Banker N plus players E and S; `top` lists the hole cards of N, E, S and then the draws. */
function deal(top: readonly Card[]): void {
  tenhalf.startGame(CODE, { N: player('N'), E: player('E'), S: player('S') }, 60_000, 1_000, () => 0);
  tenhalf.bet(CODE, 'E', 50, true, 1_500);
  tenhalf.bet(CODE, 'S', 50, true, 1_500, rigged(top));
}

const view = (seat: GameSeat): TenHalfVisibleState => tenhalf.getPlayerVisibleState(CODE, seat)!;
const act = (type: BotAction | null): string | null => (type?.type === 'game-action' && type.request.gameType === 'tenhalf'
  && type.request.action.type === 'act' ? type.request.action.action : null);
const decide = (seat: GameSeat, difficulty: 'easy' | 'hard'): TenHalfAction | null => act(getBotAction(view(seat), () => 0.5, difficulty)) as TenHalfAction | null;

afterEach(() => tenhalf.abortGame(CODE));

describe('Ten and a Half Easy bot', () => {
  it('bets the minimum and draws below 7.5 points', () => {
    tenhalf.startGame(CODE, { N: player('N'), E: player('E') }, 60_000, 1_000, () => 0);
    expect(getEasyBotAction(view('E'))).toMatchObject({ request: { action: { type: 'bet', amount: BJ_MIN_BET } } });
    expect(getEasyBotAction(view('N'))).toBeNull();
  });

  it('hits on a hole card worth less than 7.5 and stands from 7.5', () => {
    deal([card(5), card(8), card(3)]);
    expect(decide('E', 'easy')).toBe('stand');
    tenhalf.abortGame(CODE);
    deal([card(5), card(7), card(3)]);
    expect(decide('E', 'easy')).toBe('hit');
  });

  it('stays quiet when it is not its turn', () => {
    deal([card(5), card(7), card(8)]);
    expect(decide('S', 'easy')).toBeNull();
    expect(decide('N', 'easy')).toBeNull();
  });
});

describe('Ten and a Half Hard bot', () => {
  it('bets within the table limits', () => {
    tenhalf.startGame(CODE, { N: player('N'), E: player('E') }, 60_000, 1_000, () => 0);
    for (const sample of [0, 0.5, 0.99]) {
      const action = getBotAction(view('E'), () => sample, 'hard');
      const amount = action?.type === 'game-action' && action.request.action.type === 'bet' ? action.request.action.amount : 0;
      expect(amount).toBeGreaterThanOrEqual(BJ_MIN_BET);
      expect(amount).toBeLessThanOrEqual(BJ_MAX_BET);
      expect(amount % 10).toBe(0);
    }
  });

  it('draws on a tiny hand and stands on a strong one', () => {
    deal([card(5), card(2), card(10)]);
    expect(decide('E', 'hard')).toBe('hit');
    tenhalf.abortGame(CODE);
    deal([card(5), card(10), card(2)]);
    expect(decide('E', 'hard')).toBe('stand');
  });

  it('stands on 10 points and never draws into a certain loss', () => {
    deal([card(4), card(10), card(9)]);
    expect(decide('E', 'hard')).toBe('stand');
    expect(decide('S', 'hard')).toBeNull();
  });

  it('decides from its own view only: other face-down cards change nothing', () => {
    deal([card(5), card(6), card(10)]);
    const first = decide('E', 'hard');
    tenhalf.abortGame(CODE);
    deal([card(13, 'hearts'), card(6), card(2, 'clubs')]);
    expect(decide('E', 'hard')).toBe(first);
  });

  it('counts the cards it can see out of the deck: its own hole card and every face-up card', () => {
    deal([card(5), card(6), card(10), card(14, 'hearts')]);
    tenhalf.act(CODE, 'E', 'hit');
    const draws = unseenDraws(view('S'));
    expect(draws.reduce((sum, entry) => sum + entry.chance, 0)).toBeCloseTo(1);
    // 52 - S's own 10, - E's face-up ace = 50 unseen cards; aces (2 half points) now number three.
    expect(draws.find((entry) => entry.halves === 2)?.chance).toBeCloseTo(3 / 50);
    expect(draws.find((entry) => entry.halves === 20)?.chance).toBeCloseTo(3 / 50);
  });

  it('plays the banker against the visible hands', () => {
    deal([card(3), card(10), card(10, 'hearts')]);
    tenhalf.act(CODE, 'E', 'stand');
    tenhalf.act(CODE, 'S', 'stand');
    // A banker holding 3 must catch two likely 10-point players, so it draws.
    expect(decide('N', 'hard')).toBe('hit');
  });

  it('decides fast enough for a full table', () => {
    deal([card(2), card(2, 'hearts'), card(3)]);
    const started = performance.now();
    for (let run = 0; run < 50; run++) tenHalfDecision(view('E'));
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
