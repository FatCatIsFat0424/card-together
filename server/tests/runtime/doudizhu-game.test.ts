import { afterEach, describe, expect, it } from 'vitest';
import type { CardOrJoker, DouDizhuGameState, GameSeat, PlayerInfo } from '@shared/types';
import { cardKey, joker } from '@shared/rules/cards';
import { createDdzDeck, ddzIdentify, sortDdzHand } from '@shared/rules/doudizhu';
import { gameDefinition } from '@shared/games/registry';
import { frameTiming } from '@shared/games/presentation';
import { getPresentationFrames } from '@shared/game-presentation';
import { getBotAction } from '../../src/bots/bot-decisions';
import type { BotAction } from '../../src/bots/bot-decisions';
import { firstLegalAction } from '../../src/runtime/automated-action';
import { douDizhuAdapter } from '../../src/managers/games/doudizhu-adapter';
import * as doudizhu from '../../src/managers/games/doudizhu-game';
import { coherentDouDizhuGame, douDizhuGame, isDouDizhuResult } from '../../src/managers/games/doudizhu-validation';
import { gameValidator } from '../../src/managers/games/validation-registry';

const CODE = 'DDZG01';
const SEATS: GameSeat[] = ['N', 'E', 'S'];

function player(seat: GameSeat, bot = true): PlayerInfo {
  return { id: seat.toLowerCase(), username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
    ...(bot ? { isBot: true } : {}) };
}

const players = (): Partial<Record<GameSeat, PlayerInfo>> => Object.fromEntries(SEATS.map((seat) => [seat, player(seat)]));

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function game(): DouDizhuGameState {
  const state = doudizhu.getGameState(CODE);
  if (!state) throw new Error('Expected a Dou Dizhu game');
  return state;
}

const start = (variant: 'score' | 'grab' = 'score', seed = 1): void =>
  doudizhu.startGame(CODE, players(), { variant }, 1_000, seeded(seed));

const view = (seat: GameSeat) => doudizhu.getPlayerVisibleState(CODE, seat)!;

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

/** Applies a bot decision through the game functions, the way the facade would. */
function apply(seat: GameSeat, action: BotAction, random: () => number = seeded(7)): { success: boolean } {
  if (action.type !== 'game-action' || action.request.gameType !== 'doudizhu') throw new Error('Unexpected action');
  const move = action.request.action;
  switch (move.type) {
    case 'bid': return doudizhu.bid(CODE, seat, move.score, 2_000, random);
    case 'claim': return doudizhu.claim(CODE, seat, move.take, 2_000, random);
    case 'play': return doudizhu.play(CODE, seat, move.cards, 2_000, random);
    case 'pass': return doudizhu.pass(CODE, seat, 2_000);
  }
}

/** Plays the whole match with the given difficulty, checking stored state after every deal. */
function playMatch(difficulty: 'easy' | 'hard', variant: 'score' | 'grab', seed: number): void {
  start(variant, seed);
  const random = seeded(seed + 100);
  let guard = 0;
  while (game().phase !== 'scoring') {
    if (guard++ > 3000) throw new Error('Match did not finish');
    const seat = game().currentTurnSeat;
    const action = getBotAction(view(seat), random, difficulty) ?? firstLegalAction(view(seat));
    expect(action, `${seat} has an action`).not.toBeNull();
    const before = game().log.length;
    expect(apply(seat, action!, random).success, JSON.stringify(action)).toBe(true);
    if (game().log.slice(before).some((entry) => entry.type === 'deal_end')) {
      expect(coherentDouDizhuGame(game()), `coherent after deal`).toBe(true);
    }
  }
}

afterEach(() => doudizhu.abortGame(CODE));

describe('Dou Dizhu setup', () => {
  it('deals 17 cards to each of three seats and keeps the bottom and other hands hidden', () => {
    start();
    expect(SEATS.map((seat) => game().hands[seat].length)).toEqual([17, 17, 17]);
    expect(game().bottom).toHaveLength(3);
    const all = [...SEATS.flatMap((seat) => game().hands[seat]), ...game().bottom];
    expect(new Set(all.map(cardKey)).size).toBe(54);
    const east = view('E');
    expect(east.myHand).toEqual(game().hands.E);
    expect(east.bottom).toBeNull();
    expect(east.handCounts).toMatchObject({ N: 17, E: 17, S: 17 });
    const text = JSON.stringify(east);
    for (const card of game().hands.N) {
      if (!game().hands.E.some((own) => cardKey(own) === cardKey(card))) {
        expect(text).not.toContain(JSON.stringify(card));
      }
    }
    expect(game().phase).toBe('calling');
    expect(game().currentTurnSeat).toBe('N');
  });

  it('is a three-seat flexible game with a six-deal match', () => {
    const definition = gameDefinition('doudizhu');
    expect(definition.seats).toMatchObject({ minPlayers: 3, maxPlayers: 3, flexible: true });
    expect(definition.matchHands).toBe(6);
  });
});

describe('Dou Dizhu score auction', () => {
  it('rejects out-of-turn, lower, and wrong-variant actions', () => {
    start();
    expect(doudizhu.bid(CODE, 'E', 1).success).toBe(false);
    expect(doudizhu.bid(CODE, 'N', 2).success).toBe(true);
    expect(doudizhu.bid(CODE, 'E', 2).success).toBe(false);
    expect(doudizhu.claim(CODE, 'E', true).success).toBe(false);
    expect(doudizhu.play(CODE, 'E', game().hands.E.slice(0, 1)).success).toBe(false);
    expect(doudizhu.bid(CODE, 'E', 3).success).toBe(true);
  });

  it('makes the highest bidder landlord, hands over the bottom, and reveals it to everyone', () => {
    start();
    const bottom = [...game().bottom];
    doudizhu.bid(CODE, 'N', 1);
    doudizhu.bid(CODE, 'E', 0);
    doudizhu.bid(CODE, 'S', 2);
    expect(game()).toMatchObject({ phase: 'playing', landlord: 'S', base: 2, currentTurnSeat: 'S' });
    expect(game().hands.S).toHaveLength(20);
    expect(bottom.every((card) => game().hands.S.some((own) => cardKey(own) === cardKey(card)))).toBe(true);
    expect(view('N').bottom?.map(cardKey).sort()).toEqual(bottom.map(cardKey).sort());
    expect(view('N').handCounts).toMatchObject({ N: 17, E: 17, S: 20 });
    expect(game().log.at(-1)).toMatchObject({ type: 'landlord', seat: 'S', base: 2, forced: false });
  });

  it('ends at once on a bid of 3', () => {
    start();
    doudizhu.bid(CODE, 'N', 0);
    doudizhu.bid(CODE, 'E', 3);
    expect(game()).toMatchObject({ phase: 'playing', landlord: 'E', base: 3 });
  });

  it('deals again when nobody bids, rotating the opener, and forces a landlord after three redeals', () => {
    start();
    for (const seat of ['N', 'E', 'S'] as const) doudizhu.bid(CODE, seat, 0);
    expect(game()).toMatchObject({ phase: 'calling', deal: 1, redeals: 1, firstCaller: 'E', currentTurnSeat: 'E' });
    expect(game().log.map((entry) => entry.type).slice(-5)).toEqual(['bid', 'bid', 'bid', 'redeal', 'deal']);
    for (const seat of ['E', 'S', 'N'] as const) doudizhu.bid(CODE, seat, 0);
    for (const seat of ['S', 'N', 'E'] as const) doudizhu.bid(CODE, seat, 0);
    expect(game()).toMatchObject({ redeals: 3, firstCaller: 'N', phase: 'calling' });
    for (const seat of ['N', 'E', 'S'] as const) doudizhu.bid(CODE, seat, 0);
    expect(game()).toMatchObject({ phase: 'playing', landlord: 'N', base: 1, redeals: 3 });
    expect(game().log.at(-1)).toMatchObject({ type: 'landlord', forced: true });
    expect(coherentDouDizhuGame(game())).toBe(true);
  });
});

describe('Dou Dizhu call and grab auction', () => {
  it('doubles the stake for each grab and lets the caller answer once', () => {
    start('grab');
    expect(doudizhu.bid(CODE, 'N', 1).success).toBe(false);
    doudizhu.claim(CODE, 'N', true);
    doudizhu.claim(CODE, 'E', true);
    doudizhu.claim(CODE, 'S', false);
    expect(game()).toMatchObject({ phase: 'calling', currentTurnSeat: 'N' });
    doudizhu.claim(CODE, 'N', true);
    expect(game()).toMatchObject({ phase: 'playing', landlord: 'N', base: 1, grabs: 2 });
  });

  it('gives the landlord to the first caller when nobody grabs, and redeals when nobody calls', () => {
    start('grab');
    doudizhu.claim(CODE, 'N', false);
    doudizhu.claim(CODE, 'E', true);
    doudizhu.claim(CODE, 'S', false);
    doudizhu.claim(CODE, 'N', false);
    expect(game()).toMatchObject({ phase: 'playing', landlord: 'E', grabs: 0 });
    doudizhu.abortGame(CODE);
    start('grab');
    for (const seat of SEATS) doudizhu.claim(CODE, seat, false);
    expect(game()).toMatchObject({ phase: 'calling', redeals: 1 });
  });
});

describe('Dou Dizhu play', () => {
  function playing(): void {
    start();
    doudizhu.bid(CODE, 'N', 3);
    const state = game();
    state.hands.N = sortDdzHand(hand('3 3 4 5 6 7 8 9 K K K A 2 2 SJ BJ 10 J Q J'));
    state.hands.E = sortDdzHand(hand('3 4 5 6 7 8 9 10 J Q A 2 4 5 6 8 9'));
    state.hands.S = sortDdzHand(hand('3 4 5 6 7 7 8 9 10 J Q 10 J Q K A 2'));
  }

  it('requires cards in hand, a legal combination, and a play that beats the last', () => {
    playing();
    expect(doudizhu.play(CODE, 'E', hand('3')).success).toBe(false);
    expect(doudizhu.play(CODE, 'N', hand('Q Q')).success).toBe(false);
    expect(doudizhu.play(CODE, 'N', hand('3 3 4')).success).toBe(false);
    expect(doudizhu.pass(CODE, 'N').success).toBe(false);
    expect(doudizhu.play(CODE, 'N', hand('3 3')).success).toBe(true);
    expect(doudizhu.play(CODE, 'E', hand('4')).success).toBe(false);
    expect(doudizhu.play(CODE, 'E', hand('Q Q')).success).toBe(false);
    expect(game().currentTurnSeat).toBe('E');
  });

  it('ends a round after two passes and gives the lead back to the last player', () => {
    playing();
    doudizhu.play(CODE, 'N', hand('3 3'));
    expect(doudizhu.pass(CODE, 'E').success).toBe(true);
    expect(game().passes).toBe(1);
    expect(doudizhu.pass(CODE, 'S').success).toBe(true);
    expect(game()).toMatchObject({ lastPlay: null, passes: 0, currentTurnSeat: 'N' });
    expect(game().log.slice(-3).map((entry) => entry.type)).toEqual(['pass', 'pass', 'round_end']);
  });

  it('doubles for a bomb and for the rocket', () => {
    playing();
    game().hands.N = sortDdzHand(hand('3 3 3 3 SJ BJ 5'));
    expect(doudizhu.play(CODE, 'N', hand('3 3 3 3')).success).toBe(true);
    doudizhu.pass(CODE, 'E');
    doudizhu.pass(CODE, 'S');
    expect(game().bombs).toBe(1);
    expect(doudizhu.play(CODE, 'N', [joker('small'), joker('big')]).success).toBe(true);
    expect(game().bombs).toBe(2);
    expect(game().lastPlay?.combo.type).toBe('rocket');
  });

  it('settles a spring: the landlord wins before either farmer plays', () => {
    playing();
    game().hands.N = sortDdzHand(hand('3 3'));
    expect(doudizhu.play(CODE, 'N', hand('3 3'), 5_000, seeded(9)).success).toBe(true);
    const end = game().log.find((entry) => entry.type === 'deal_end');
    expect(end).toMatchObject({ deal: 1, landlord: 'N', winner: 'N', landlordWins: true, spring: true, antiSpring: false,
      base: 3, multiplier: 6, scores: { N: 12, E: -6, S: -6 } });
    expect(game()).toMatchObject({ deal: 2, phase: 'calling', redeals: 0, landlord: null, firstCaller: 'E' });
    expect(game().totals).toMatchObject({ N: 12, E: -6, S: -6 });
    expect(SEATS.map((seat) => game().hands[seat].length)).toEqual([17, 17, 17]);
  });

  it('settles an anti-spring when the landlord played only once', () => {
    playing();
    game().hands.E = sortDdzHand(hand('4'));
    doudizhu.play(CODE, 'N', hand('3 3'));
    game().hands.E = sortDdzHand(hand('5 5'));
    expect(doudizhu.play(CODE, 'E', hand('5 5'), 5_000, seeded(9)).success).toBe(true);
    const end = game().log.find((entry) => entry.type === 'deal_end');
    expect(end).toMatchObject({ winner: 'E', landlordWins: false, antiSpring: true, multiplier: 6,
      scores: { N: -12, E: 6, S: 6 } });
  });

  it('shows the cards left in every hand once a deal is settled', () => {
    playing();
    game().hands.N = sortDdzHand(hand('3 3'));
    doudizhu.play(CODE, 'N', hand('3 3'), 5_000, seeded(9));
    const end = game().log.find((entry) => entry.type === 'deal_end');
    expect(end?.type === 'deal_end' && end.hands.N).toEqual([]);
    expect(end?.type === 'deal_end' && end.hands.E.length).toBe(17);
  });
});

describe('Dou Dizhu match', () => {
  it.each([['hard', 'score', 3], ['easy', 'score', 4], ['hard', 'grab', 5], ['easy', 'grab', 6]] as const)(
    'plays %s bots through six deals (%s auction) with zero-sum scores',
    (difficulty, variant, seed) => {
      playMatch(difficulty, variant, seed);
      const state = game();
      expect(state.phase).toBe('scoring');
      expect(state.log.filter((entry) => entry.type === 'deal_end')).toHaveLength(6);
      const total = SEATS.reduce((sum, seat) => sum + state.totals[seat], 0);
      expect(total).toBe(0);
      expect(state.result).toMatchObject({ gameType: 'doudizhu', deals: 6, seats: SEATS });
      const best = Math.max(...SEATS.map((seat) => state.totals[seat]));
      expect(state.result?.winners).toEqual(SEATS.filter((seat) => state.totals[seat] === best));
      expect(isDouDizhuResult(state.result)).toBe(true);
      expect(coherentDouDizhuGame(state)).toBe(true);
    });

  it('has every deal pass the stored-state validator and survive a JSON round trip', () => {
    start('score', 11);
    const random = seeded(12);
    const validator = gameValidator('doudizhu');
    let checked = 0;
    while (game().phase !== 'scoring') {
      const seat = game().currentTurnSeat;
      apply(seat, getBotAction(view(seat), random, 'hard')!, random);
      if (checked++ % 7 === 0) {
        const copy = JSON.parse(JSON.stringify(game())) as DouDizhuGameState;
        expect(douDizhuGame(copy as never, () => true), `shape after ${checked}`).toBe(true);
        expect(validator.coherent(copy), `coherent after ${checked}`).toBe(true);
      }
    }
  });

  it('restores exported games', () => {
    start();
    const exported = JSON.parse(JSON.stringify(doudizhu.exportGames())) as DouDizhuGameState[];
    doudizhu.abortGame(CODE);
    doudizhu.restoreGames(exported);
    expect(game().hands.N).toHaveLength(17);
  });
});

describe('Dou Dizhu adapter and presentation', () => {
  it('gives the turn to one seat and refills the reserve on a new deal', () => {
    start();
    expect(douDizhuAdapter.turnSeat(game())).toBe('N');
    const advance = douDizhuAdapter.clockBeforeAction?.(game(), 'N');
    for (const seat of SEATS) doudizhu.bid(CODE, seat, 0);
    expect(advance?.(game())).toEqual({ redealt: true });
    const next = douDizhuAdapter.clockBeforeAction?.(game(), 'E');
    doudizhu.bid(CODE, 'E', 1);
    expect(next?.(game())).toEqual({ redealt: false });
  });

  it('adds every hand to god view only', () => {
    start();
    const observed = douDizhuAdapter.withObserverView(view('N'), game(), 'spectator');
    expect(Object.keys(observed.observedHands ?? {}).sort()).toEqual([...SEATS].sort());
    expect(view('N').observedHands).toBeUndefined();
  });

  it('presents deals, the landlord reveal, plays, and settlements without private cards', () => {
    start();
    doudizhu.bid(CODE, 'N', 3);
    game().hands.N = sortDdzHand(hand('3 3'));
    doudizhu.play(CODE, 'N', hand('3 3'), 5_000, seeded(9));
    const state = game();
    state.presentation = { id: 'p', startedAt: 0, logStart: 0, timingVersion: 3 };
    const frames = getPresentationFrames(state);
    expect(frames.map((frame) => frame.kind)).toEqual(['deal', 'call', 'play', 'settle', 'deal']);
    expect(frames[1].napoleonCards).toHaveLength(3);
    expect(frames[2]).toMatchObject({ durationMs: frameTiming(3).playMs, seat: 'N' });
    expect(gameDefinition('doudizhu').presentation.finishSeat(state)).toBeUndefined();
  });
});

describe('Dou Dizhu stored state', () => {
  function live(): DouDizhuGameState {
    start('score', 21);
    doudizhu.bid(CODE, 'N', 2);
    doudizhu.bid(CODE, 'E', 0);
    doudizhu.bid(CODE, 'S', 0);
    const state = game();
    const lead = ddzIdentify(state.hands.N.slice(-1))!;
    doudizhu.play(CODE, 'N', state.hands.N.slice(-1));
    expect(lead.type).toBe('single');
    return JSON.parse(JSON.stringify(game())) as DouDizhuGameState;
  }

  it('accepts a live state', () => {
    const state = live();
    expect(coherentDouDizhuGame(state)).toBe(true);
  });

  it('rejects swapped, duplicated, or missing cards and edited counters', () => {
    const swapped = live();
    swapped.hands.E[0] = swapped.hands.N[0];
    expect(coherentDouDizhuGame(swapped)).toBe(false);
    const missing = live();
    missing.hands.E.pop();
    expect(coherentDouDizhuGame(missing)).toBe(false);
    const totals = live();
    totals.totals.N = 5;
    expect(coherentDouDizhuGame(totals)).toBe(false);
    const turn = live();
    turn.currentTurnSeat = 'S';
    expect(coherentDouDizhuGame(turn)).toBe(false);
    const stake = live();
    stake.bombs = 2;
    expect(coherentDouDizhuGame(stake)).toBe(false);
  });

  it('rejects a forged combination or a bid out of turn in the log', () => {
    const forged = live();
    const play = forged.log.find((entry) => entry.type === 'play');
    if (play?.type === 'play') (play as { combo: unknown }).combo = { ...play.combo, type: 'bomb', size: play.cards.length };
    expect(coherentDouDizhuGame(forged)).toBe(false);
    const bid = live();
    const entry = bid.log.find((item) => item.type === 'bid');
    if (entry?.type === 'bid') (entry as { seat: GameSeat }).seat = 'S';
    expect(coherentDouDizhuGame(bid)).toBe(false);
  });

  it('rejects malformed results', () => {
    const base = { gameType: 'doudizhu', seats: SEATS, scores: { N: 4, E: -2, S: -2, W: 0, P5: 0, P6: 0, P7: 0, P8: 0 },
      deals: 6, winners: ['N'] };
    expect(isDouDizhuResult(base)).toBe(true);
    expect(isDouDizhuResult({ ...base, winners: ['E'] })).toBe(false);
    expect(isDouDizhuResult({ ...base, scores: { ...base.scores, E: -1 } })).toBe(false);
    expect(isDouDizhuResult({ ...base, deals: 5 })).toBe(false);
    expect(isDouDizhuResult({ ...base, seats: ['N', 'E'] })).toBe(false);
  });
});

describe('Dou Dizhu deck', () => {
  it('uses the shared 54-card joker deck', () => {
    expect(createDdzDeck()).toHaveLength(54);
  });
});
