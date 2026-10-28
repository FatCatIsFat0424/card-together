import { afterEach, describe, expect, it } from 'vitest';
import { GAME_SEAT_ORDER } from '@shared/constants';
import type { Card, GameSeat, PlayerInfo, TenHalfGameState } from '@shared/types';
import { gameDefinition } from '@shared/games/registry';
import { bjMatchHands } from '@shared/rules/blackjack';
import { getBotAction } from '../../src/bots/bot-decisions';
import type { BotAction } from '../../src/bots/bot-decisions';
import { gameBot } from '../../src/bots/bot-registry';
import { firstLegalAction } from '../../src/runtime/automated-action';
import { createDeck } from '../../src/engine/deck';
import { tenHalfAdapter } from '../../src/managers/games/tenhalf-adapter';
import * as tenhalf from '../../src/managers/games/tenhalf-game';
import { coherentTenHalfGame, isTenHalfResult, tenHalfGame } from '../../src/managers/games/tenhalf-validation';
import { gameValidator } from '../../src/managers/games/validation-registry';

const CODE = 'TENHF1';

function player(seat: GameSeat, bot = false): PlayerInfo {
  return { id: seat.toLowerCase(), username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
    ...(bot ? { isBot: true } : {}) };
}

function seated(seats: readonly GameSeat[], bots = false): Partial<Record<GameSeat, PlayerInfo>> {
  return Object.fromEntries(seats.map((seat) => [seat, player(seat, bots)]));
}

const card = (rank: Card['rank'], suit: Card['suit'] = 'spades'): Card => ({ suit, rank });
const key = (value: Card): string => `${value.suit}${value.rank}`;

/** A random source that makes the shuffle put `top` first. Holes go to the dealt seats, then draws follow. */
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

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function game(): TenHalfGameState {
  const state = tenhalf.getGameState(CODE);
  if (!state) throw new Error('Expected a Ten and a Half game');
  return state;
}

const start = (seats: readonly GameSeat[], banker: GameSeat = seats[0], bots = false): void => {
  tenhalf.startGame(CODE, seated(seats, bots), 60_000, 1_000, () => (seats.indexOf(banker) + 0.5) / seats.length);
};

function bet(seat: GameSeat, amount: number, random?: () => number, now = 1_500): { success: boolean; reason?: string } {
  return tenhalf.bet(CODE, seat, amount, false, now, random);
}

const coherent = (): boolean => coherentTenHalfGame(structuredClone(game()));

afterEach(() => tenhalf.abortGame(CODE));

describe('Ten and a Half setup', () => {
  it('starts every seat with 1000 chips, a random first banker, and an open betting window', () => {
    start(['N', 'E', 'S'], 'E');
    expect(game()).toMatchObject({ phase: 'betting', hand: 0, banker: 'E', betDeadline: 61_000 });
    expect(GAME_SEAT_ORDER.map((seat) => game().chips[seat])).toEqual([1000, 1000, 1000, 0, 0, 0, 0, 0]);
    expect(gameDefinition('tenhalf')).toMatchObject({ category: 'cards', equipment: ['cards', 'chips'],
      seats: { minPlayers: 2, maxPlayers: 8, flexible: true } });
    expect(coherent()).toBe(true);
  });

  it('accepts 2 to 8 players and lasts two banker rotations', () => {
    expect([2, 3, 8].map((count) => bjMatchHands(count, true))).toEqual([4, 6, 16]);
  });
});

describe('Ten and a Half betting', () => {
  it('rejects the banker, repeats, bad amounts, and late bets, but accepts automatic late bets', () => {
    start(['N', 'E', 'S']);
    expect(bet('N', 20)).toMatchObject({ success: false, reason: 'The banker does not bet' });
    expect(bet('E', 15)).toMatchObject({ success: false, reason: 'Invalid bet' });
    expect(bet('E', 500)).toMatchObject({ success: false, reason: 'Invalid bet' });
    expect(bet('E', 20, undefined, 61_000)).toMatchObject({ success: false, reason: 'Betting is closed' });
    expect(bet('E', 20)).toEqual({ success: true });
    expect(bet('E', 30)).toMatchObject({ success: false, reason: 'Already bet' });
    expect(tenhalf.act(CODE, 'E', 'hit')).toMatchObject({ success: false, reason: 'Not in playing phase' });
    expect(tenhalf.bet(CODE, 'S', 40, true, 99_000, rigged([card(5), card(10), card(13)]))).toEqual({ success: true });
    expect(game().phase).toBe('playing');
  });

  it('keeps bets hidden until the deal and then deals one hidden card to each seat in the hand', () => {
    start(['N', 'E', 'S']);
    bet('E', 20);
    expect(tenhalf.getPlayerVisibleState(CODE, 'S')?.betPlaced).toMatchObject({ E: true, S: false });
    expect(tenhalf.getPlayerVisibleState(CODE, 'S')?.myBet).toBeNull();
    expect(tenhalf.getPlayerVisibleState(CODE, 'E')?.myBet).toBe(20);
    bet('S', 30, rigged([card(5), card(10, 'hearts'), card(13, 'clubs')]));
    expect(game()).toMatchObject({ phase: 'playing', hand: 1, dealt: ['N', 'E', 'S'], currentTurnSeat: 'E', betDeadline: null,
      chips: { N: 1000, E: 980, S: 970 }, bets: { N: 0, E: 20, S: 30 } });
    expect(game().log.map((entry) => entry.type)).toEqual(['bet', 'bet', 'deal']);
    expect(coherent()).toBe(true);
  });

  it('lets a seat with fewer than 10 chips sit out while the others play', () => {
    start(['N', 'E', 'S']);
    game().chips.S = 5;
    expect(bet('S', 10)).toMatchObject({ success: false, reason: 'Not enough chips to bet' });
    bet('E', 20);
    expect(tenhalf.pendingBetSeats(game())).toEqual([]);
    expect(game().phase).toBe('playing');
    expect(game().dealt).toEqual(['N', 'E']);
  });
});

describe('Ten and a Half hidden cards', () => {
  function dealtGame(): void {
    start(['N', 'E', 'S']);
    bet('E', 20);
    bet('S', 30, rigged([card(5, 'spades'), card(10, 'hearts'), card(13, 'clubs'), card(4, 'diamonds')]));
  }

  it('shows each seat only its own face-down card until the showdown', () => {
    dealtGame();
    for (const seat of ['N', 'E', 'S'] as const) {
      const view = tenhalf.getPlayerVisibleState(CODE, seat)!;
      expect(view.holeSeats).toEqual(['N', 'E', 'S']);
      for (const other of ['N', 'E', 'S'] as const) {
        expect(view.holes[other]).toEqual(other === seat ? game().holes[other] : null);
      }
      const others = (['N', 'E', 'S'] as const).filter((other) => other !== seat);
      for (const other of others) expect(JSON.stringify(view)).not.toContain(JSON.stringify(game().holes[other]));
    }
  });

  it('never writes a face-down card to the public log before the showdown', () => {
    dealtGame();
    tenhalf.act(CODE, 'E', 'stand');
    tenhalf.act(CODE, 'S', 'hit');
    const hidden = (['N', 'E', 'S'] as const).map((seat) => JSON.stringify(game().holes[seat]));
    const log = JSON.stringify(game().log);
    for (const entry of hidden) expect(log).not.toContain(entry);
    expect(game().log.map((entry) => entry.type)).not.toContain('showdown');
  });

  it('reveals every card at the showdown and leaves them visible while the next hand is bet', () => {
    dealtGame();
    for (const seat of ['E', 'S', 'N'] as const) tenhalf.act(CODE, seat, 'stand');
    const view = tenhalf.getPlayerVisibleState(CODE, 'S')!;
    expect(game().phase).toBe('betting');
    expect(view.holes).toMatchObject({ N: card(5, 'spades'), E: card(10, 'hearts'), S: card(13, 'clubs') });
    const showdown = game().log.find((entry) => entry.type === 'showdown');
    expect(showdown).toMatchObject({ holes: { N: card(5, 'spades'), E: card(10, 'hearts'), S: card(13, 'clubs') } });
  });

  it('adds every face-down card to god view only', () => {
    dealtGame();
    const view = tenhalf.getPlayerVisibleState(CODE, 'E')!;
    const observed = tenHalfAdapter.withObserverView(view, game(), 'spectator');
    expect(observed.observer).toBe('spectator');
    expect(observed.observedHands).toEqual({ N: [card(5, 'spades')], E: [card(10, 'hearts')], S: [card(13, 'clubs')] });
    expect(view).not.toHaveProperty('observedHands');
  });
});

describe('Ten and a Half play', () => {
  it('settles a hand against the banker and passes the deal clockwise', () => {
    start(['N', 'E', 'S']);
    bet('E', 20);
    // N holds 5, E holds 10, S holds K and draws a 4.
    bet('S', 30, rigged([card(5, 'spades'), card(10, 'hearts'), card(13, 'clubs'), card(4, 'diamonds')]));
    expect(tenhalf.act(CODE, 'S', 'stand')).toMatchObject({ success: false, reason: 'Not your turn' });
    expect(tenhalf.act(CODE, 'N', 'stand')).toMatchObject({ success: false, reason: 'Not your turn' });
    expect(tenhalf.act(CODE, 'E', 'stand')).toEqual({ success: true });
    expect(tenhalf.act(CODE, 'E', 'hit')).toMatchObject({ success: false });
    expect(tenhalf.act(CODE, 'S', 'hit')).toEqual({ success: true });
    expect(game().ups.S).toEqual([card(4, 'diamonds')]);
    expect(game().done.S).toBe(false);
    expect(coherent()).toBe(true);
    tenhalf.act(CODE, 'S', 'stand');
    expect(game().currentTurnSeat).toBe('N');
    tenhalf.act(CODE, 'N', 'stand');
    expect(game().log.map((entry) => entry.type)).toEqual(
      ['bet', 'bet', 'deal', 'stand', 'hit', 'stand', 'stand', 'showdown', 'settle']);
    // E (10) beats N (5); S (4.5) loses to N.
    expect(game().chips).toMatchObject({ N: 1010, E: 1020, S: 970 });
    expect(game()).toMatchObject({ phase: 'betting', hand: 1, banker: 'E', betDeadline: null });
    expect(coherent()).toBe(true);
  });

  it('pays a five-face hand five times and ends it on the fifth card', () => {
    start(['N', 'E']);
    bet('E', 10, rigged([card(3), card(13, 'spades'), card(12, 'spades'), card(11, 'spades'), card(13, 'hearts'),
      card(12, 'hearts')]));
    for (let draw = 0; draw < 3; draw++) expect(tenhalf.act(CODE, 'E', 'hit')).toEqual({ success: true });
    expect(game().done.E).toBe(false);
    expect(game().log.at(-1)).toMatchObject({ type: 'hit', done: false });
    tenhalf.act(CODE, 'E', 'hit');
    expect(game().log.filter((entry) => entry.type === 'hit').at(-1)).toMatchObject({ done: true });
    expect(game().currentTurnSeat).toBe('N');
    tenhalf.act(CODE, 'N', 'stand');
    expect(game().chips).toMatchObject({ E: 1050, N: 950 });
    expect(game().log.at(-1)).toMatchObject({ type: 'settle', outcomes: { E: 'win' }, net: { E: 50, N: -50 } });
  });

  it('ends a hand that busts and charges the banker’s multiple', () => {
    start(['N', 'E']);
    bet('E', 10, rigged([card(4), card(10, 'hearts'), card(2, 'clubs'), card(13)]));
    tenhalf.act(CODE, 'E', 'hit');
    expect(game().done.E).toBe(true);
    expect(game().log.at(-1)).toMatchObject({ type: 'hit', done: true });
    expect(tenhalf.act(CODE, 'E', 'hit')).toMatchObject({ success: false });
    tenhalf.act(CODE, 'N', 'hit');
    // The banker draws a K to 4.5 and wins the bust player's bet.
    tenhalf.act(CODE, 'N', 'stand');
    expect(game().chips).toMatchObject({ E: 990, N: 1010 });
  });

  it('gives a banker with ten and a half double winnings against every player', () => {
    start(['N', 'E', 'S']);
    bet('E', 20);
    bet('S', 20, rigged([card(10), card(9, 'hearts'), card(8, 'clubs'), card(13)]));
    tenhalf.act(CODE, 'E', 'stand');
    tenhalf.act(CODE, 'S', 'stand');
    tenhalf.act(CODE, 'N', 'hit');
    expect(game().chips).toMatchObject({ N: 1080, E: 960, S: 960 });
  });

  it('runs the banker’s turn even when every player busted', () => {
    start(['N', 'E']);
    bet('E', 10, rigged([card(4), card(10, 'hearts'), card(10, 'clubs')]));
    tenhalf.act(CODE, 'E', 'hit');
    expect(game().currentTurnSeat).toBe('N');
    expect(game().phase).toBe('playing');
  });
});

describe('Ten and a Half match', () => {
  function drive(seats: readonly GameSeat[], choose: (seat: GameSeat) => BotAction | null, onStep?: () => void): void {
    for (let step = 0; step < 5_000 && game().phase !== 'scoring'; step++) {
      let acted = false;
      for (const seat of seats) {
        const visible = tenhalf.getPlayerVisibleState(CODE, seat);
        const action = visible && choose(seat);
        if (!action) continue;
        const request = action.type === 'game-action' ? action.request : null;
        if (request?.gameType !== 'tenhalf') throw new Error('Expected a Ten and a Half action');
        const result = request.action.type === 'bet'
          ? tenhalf.bet(CODE, seat, request.action.amount, true)
          : tenhalf.act(CODE, seat, request.action.action);
        expect(result, `${seat} ${JSON.stringify(request.action)}`).toEqual({ success: true });
        onStep?.();
        acted = true;
        break;
      }
      if (!acted) throw new Error('The match stalled');
    }
  }

  const total = (): number => GAME_SEAT_ORDER.reduce((sum, seat) => sum + game().chips[seat], 0);

  it.each([2, 3, 5, 8])('lets every one of %i seats bank equally often and conserves the chips', (count) => {
    const seats = GAME_SEAT_ORDER.slice(0, count);
    start(seats, seats[count - 1]);
    drive(seats, (seat) => firstLegalAction(tenhalf.getPlayerVisibleState(CODE, seat)!));
    const banked = new Map<GameSeat, number>();
    for (const entry of game().log) if (entry.type === 'deal') banked.set(entry.banker, (banked.get(entry.banker) ?? 0) + 1);
    expect(game().result).toMatchObject({ gameType: 'tenhalf', hands: count * 2, seats });
    expect(seats.map((seat) => banked.get(seat))).toEqual(seats.map(() => 2));
    expect(total()).toBe(1000 * count);
    expect(coherent()).toBe(true);
  });

  it('ends early once fewer than two seats can bet', () => {
    start(['N', 'E']);
    game().chips.N = 5;
    bet('E', 10, rigged([card(3), card(9)]));
    tenhalf.act(CODE, 'E', 'stand');
    tenhalf.act(CODE, 'N', 'stand');
    // The short banker can only pay what it has, which leaves it unable to bet again.
    expect(game().chips).toMatchObject({ N: 0, E: 1005 });
    expect(game().phase).toBe('scoring');
    expect(game().result).toMatchObject({ hands: 1, winners: ['E'] });
  });

  it.each(['easy', 'hard'] as const)('plays full %s-bot matches with only legal actions at 2 to 8 seats', (difficulty) => {
    for (const count of [2, 3, 4, 6, 8]) {
      const seats = GAME_SEAT_ORDER.slice(0, count);
      start(seats, seats[0], true);
      const random = seeded(count * 17);
      let steps = 0;
      drive(seats, (seat) => getBotAction(tenhalf.getPlayerVisibleState(CODE, seat)!, random, difficulty), () => {
        steps += 1;
        if (steps % 7 === 0) expect(coherent()).toBe(true);
      });
      expect(game().result).not.toBeNull();
      expect(total()).toBe(1000 * count);
      expect(coherent()).toBe(true);
      expect(isTenHalfResult(structuredClone(game().result))).toBe(true);
      tenhalf.abortGame(CODE);
    }
  });

  it('times out to the minimum bet and to standing', () => {
    start(['N', 'E', 'S']);
    const bot = gameBot('tenhalf');
    const betting = tenhalf.getPlayerVisibleState(CODE, 'E')!;
    expect(bot.deadlineExpired?.(betting, { isBot: false, strategy: () => null })).toMatchObject({
      type: 'game-action', request: { gameType: 'tenhalf', action: { type: 'bet', amount: 10 } } });
    expect(bot.firstLegal(tenhalf.getPlayerVisibleState(CODE, 'N')!)).toBeNull();
    bet('E', 50);
    bet('S', 50);
    const turn = tenhalf.getPlayerVisibleState(CODE, 'E')!;
    expect(bot.turnTimeout?.(turn, { isBot: false, strategy: () => null })).toMatchObject({
      request: { action: { type: 'act', action: 'stand' } } });
    expect(bot.turnTimeout?.(tenhalf.getPlayerVisibleState(CODE, 'S')!, { isBot: false, strategy: () => null })).toBeNull();
  });
});

describe('Ten and a Half adapter', () => {
  it('shares one betting deadline and gives the turn to a single seat while playing', () => {
    start(['N', 'E', 'S']);
    const betting = game();
    expect(tenHalfAdapter.turnSeat(betting)).toBeNull();
    expect(tenHalfAdapter.sharedDeadline?.window(betting)).toEqual({ key: `${betting.id}:bet:0`, deadline: 61_000 });
    expect(tenHalfAdapter.sharedDeadline?.owingSeats(betting)).toEqual(['E', 'S']);
    bet('E', 10);
    bet('S', 10);
    expect(tenHalfAdapter.turnSeat(game())).toBe('E');
    expect(tenHalfAdapter.sharedDeadline?.window(game())).toBeNull();
    expect(tenHalfAdapter.matchResult(game())).toBeNull();
  });

  it('opens the next betting window only once the settlement was shown', () => {
    start(['N', 'E']);
    bet('E', 10, rigged([card(3), card(9)]));
    tenhalf.act(CODE, 'E', 'stand');
    tenhalf.act(CODE, 'N', 'stand');
    expect(game().betDeadline).toBeNull();
    tenHalfAdapter.afterPresentation?.(game(), 10_000);
    expect(game().betDeadline).toBe(70_000);
  });
});

describe('Ten and a Half stored state', () => {
  function midHand(): TenHalfGameState {
    start(['N', 'E', 'S']);
    bet('E', 20);
    bet('S', 20, rigged([card(5), card(10, 'hearts'), card(13, 'clubs'), card(2, 'hearts')]));
    tenhalf.act(CODE, 'E', 'stand');
    tenhalf.act(CODE, 'S', 'hit');
    return structuredClone(game());
  }

  it('accepts live states and their JSON round trip', () => {
    const state = midHand();
    expect(coherentTenHalfGame(state)).toBe(true);
    const stored = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    expect(tenHalfGame(stored, () => true)).toBe(true);
    expect(gameValidator('tenhalf').shape(stored, () => true)).toBe(true);
  });

  it('rejects a draw whose recorded effect disagrees with the hidden card', () => {
    const state = midHand();
    const hit = state.log.find((entry) => entry.type === 'hit');
    if (hit?.type !== 'hit') throw new Error('Expected a hit');
    Object.assign(hit, { done: true });
    expect(coherentTenHalfGame(state)).toBe(false);
  });

  it('rejects swapped or duplicated cards, edited chips, and the wrong banker', () => {
    const swapped = midHand();
    swapped.holes.N = swapped.holes.E;
    expect(coherentTenHalfGame(swapped)).toBe(false);
    const chips = midHand();
    chips.chips.E += 10;
    expect(coherentTenHalfGame(chips)).toBe(false);
    const banker = midHand();
    banker.banker = 'E';
    expect(coherentTenHalfGame(banker)).toBe(false);
    const turn = midHand();
    turn.currentTurnSeat = 'N';
    expect(coherentTenHalfGame(turn)).toBe(false);
  });

  it('rejects a settled hand whose payouts were edited', () => {
    start(['N', 'E']);
    bet('E', 10, rigged([card(3), card(9)]));
    tenhalf.act(CODE, 'E', 'stand');
    tenhalf.act(CODE, 'N', 'stand');
    const state = structuredClone(game());
    expect(coherentTenHalfGame(state)).toBe(true);
    const settle = state.log.at(-1);
    if (settle?.type !== 'settle') throw new Error('Expected a settlement');
    settle.chips.E += 100;
    expect(coherentTenHalfGame(state)).toBe(false);
  });

  it('rejects malformed results', () => {
    const result = { gameType: 'tenhalf', seats: ['N', 'E'], hands: 4, winners: ['N'],
      chips: { N: 1100, E: 900, S: 0, W: 0, P5: 0, P6: 0, P7: 0, P8: 0 } };
    expect(isTenHalfResult(result)).toBe(true);
    expect(isTenHalfResult({ ...result, winners: ['E'] })).toBe(false);
    expect(isTenHalfResult({ ...result, chips: { ...result.chips, S: 5 } })).toBe(false);
    expect(isTenHalfResult({ ...result, hands: 17 })).toBe(false);
    expect(isTenHalfResult({ ...result, seats: undefined })).toBe(false);
  });
});
