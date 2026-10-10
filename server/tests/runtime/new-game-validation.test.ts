import { afterEach, describe, expect, it } from 'vitest';
import { svLegalPlays } from '@shared/rules/sevens';
import { cpGreedyArrangement } from '@shared/rules/chinesepoker-arrange';
import type { AnyGameState, GameType, PlayerInfo, Seat } from '@shared/types';
import { createDeck, shuffleDeck } from '../../src/engine/deck';
import * as sevens from '../../src/managers/games/sevens-game';
import { ldCanChallenge, ldMustChallenge } from '@shared/rules/liarsdeck';
import * as chinesepoker from '../../src/managers/games/chinesepoker-game';
import * as liarsdeck from '../../src/managers/games/liarsdeck-game';
import * as blackjack from '../../src/managers/games/blackjack-game';
import * as holdem from '../../src/managers/games/holdem-game';
import { heLegalActions } from '@shared/rules/holdem';
import { BJ_BET_STEP, BJ_MIN_BET, bjLegalActions, bjMaxBet } from '@shared/rules/blackjack';
import {
  isBlackjackResult, isChinesePokerResult, isHoldemResult, isLiarsDeckResult, isRuntimeSnapshot, isSevensResult,
} from '../../src/runtime/validate';
import type { RuntimeSnapshot } from '../../src/runtime/types';

const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
const CODE = 'VAL123';
const PLAYERS = Object.fromEntries(SEATS.map((seat) => [seat, {
  id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
}])) as Record<Seat, PlayerInfo>;

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Wraps a game in a minimal persisted table, as the coordinator saves it. */
function persists(game: AnyGameState, gameType: GameType): boolean {
  const playing = game.phase !== 'scoring';
  const snapshot: RuntimeSnapshot = {
    players: SEATS.map((seat) => ({ info: PLAYERS[seat], currentRoomCode: CODE, disconnectedAt: null })),
    rooms: [{
      info: {
        code: CODE, gameType, status: playing ? 'playing' : 'waiting', createdAt: 1,
        hostId: 'N', abortVote: null, abortVoteCooldownUntil: null,
        seats: Object.fromEntries(SEATS.map((seat) => [seat, { player: PLAYERS[seat], isReady: playing }])) as
          RuntimeSnapshot['rooms'][number]['info']['seats'],
      },
      memberIds: [...SEATS],
    }],
    games: [JSON.parse(JSON.stringify(game)) as AnyGameState],
    chat: [{ roomCode: CODE, messages: [] }],
  };
  return isRuntimeSnapshot(snapshot);
}

describe('persisted Sevens games', () => {
  afterEach(() => sevens.restoreGames([]));

  function playSevens(steps: number): void {
    for (let step = 0; step < steps; step++) {
      const game = sevens.getGameState(CODE)!;
      if (game.phase === 'scoring') return;
      const seat = game.currentTurnSeat;
      const legal = svLegalPlays(game.hands[seat], game.table, game.log.length === 0);
      const result = legal[0] ? sevens.play(CODE, seat, legal[0]) : sevens.cover(CODE, seat, game.hands[seat][0]);
      expect(result.success).toBe(true);
    }
  }

  it('accepts every committed state through settlement', () => {
    sevens.startGame(CODE, PLAYERS, shuffleDeck(createDeck(), seeded(3)));
    for (let step = 0; step <= 52; step++) {
      expect(persists(sevens.getGameState(CODE)!, 'sevens')).toBe(true);
      playSevens(1);
    }
    const game = sevens.getGameState(CODE)!;
    expect(game.phase).toBe('scoring');
    expect(isSevensResult(game.result)).toBe(true);
  });

  it('rejects covered cards in the log, impossible tables, and altered penalties', () => {
    sevens.startGame(CODE, PLAYERS, shuffleDeck(createDeck(), seeded(5)));
    playSevens(52);
    const game = sevens.getGameState(CODE)!;
    const cover = game.log.findIndex((entry) => entry.type === 'cover');
    if (cover >= 0) {
      const leaked = structuredClone(game);
      Object.assign(leaked.log[cover], { card: game.covered[game.log[cover].seat][0] });
      expect(persists(leaked, 'sevens')).toBe(false);
    }
    const table = structuredClone(game);
    table.table.spades = { low: 7, high: 7 };
    expect(persists(table, 'sevens')).toBe(false);
    const result = structuredClone(game);
    result.result!.penalties.N += 1;
    expect(persists(result, 'sevens')).toBe(false);
  });

  it('rejects a cover made while the seat still had a legal play', () => {
    sevens.startGame(CODE, PLAYERS, shuffleDeck(createDeck(), seeded(7)));
    playSevens(1);
    const game = structuredClone(sevens.getGameState(CODE)!);
    const seat = game.currentTurnSeat;
    const legal = svLegalPlays(game.hands[seat], game.table, false);
    expect(legal.length).toBeGreaterThan(0);
    const card = game.hands[seat][0];
    game.hands[seat] = game.hands[seat].slice(1);
    game.covered[seat].push(card);
    game.log.push({ type: 'cover', seat, timestamp: 2 });
    game.currentTurnSeat = SEATS[(SEATS.indexOf(seat) + 3) % 4];
    expect(persists(game, 'sevens')).toBe(false);
  });
});

describe('persisted Chinese Poker games', () => {
  afterEach(() => chinesepoker.restoreGames([]));

  it('accepts arranging and finished states', () => {
    chinesepoker.startGame(CODE, PLAYERS, 60_000, shuffleDeck(createDeck(), seeded(9)));
    for (const seat of SEATS) {
      expect(persists(chinesepoker.getGameState(CODE)!, 'chinesepoker')).toBe(true);
      const game = chinesepoker.getGameState(CODE)!;
      expect(chinesepoker.arrange(CODE, seat, cpGreedyArrangement(game.hands[seat]), false).success).toBe(true);
    }
    const game = chinesepoker.getGameState(CODE)!;
    expect(game.phase).toBe('scoring');
    expect(persists(game, 'chinesepoker')).toBe(true);
    expect(isChinesePokerResult(game.result)).toBe(true);
  });

  it('rejects foreign arrangements, missing submissions, and altered scores', () => {
    chinesepoker.startGame(CODE, PLAYERS, 60_000, shuffleDeck(createDeck(), seeded(11)));
    const arranging = chinesepoker.getGameState(CODE)!;
    expect(chinesepoker.arrange(CODE, 'N', cpGreedyArrangement(arranging.hands.N), false).success).toBe(true);
    const foreign = structuredClone(chinesepoker.getGameState(CODE)!);
    foreign.arrangements.N = cpGreedyArrangement(foreign.hands.E);
    expect(persists(foreign, 'chinesepoker')).toBe(false);
    const unlogged = structuredClone(chinesepoker.getGameState(CODE)!);
    unlogged.log = [];
    expect(persists(unlogged, 'chinesepoker')).toBe(false);
    const leaked = structuredClone(chinesepoker.getGameState(CODE)!);
    Object.assign(leaked.log[0], { arrangement: leaked.arrangements.N });
    expect(persists(leaked, 'chinesepoker')).toBe(false);
    for (const seat of SEATS.slice(1)) {
      const game = chinesepoker.getGameState(CODE)!;
      expect(chinesepoker.arrange(CODE, seat, cpGreedyArrangement(game.hands[seat]), false).success).toBe(true);
    }
    const scored = structuredClone(chinesepoker.getGameState(CODE)!);
    scored.result!.scores.N += 1;
    expect(persists(scored, 'chinesepoker')).toBe(false);
    const stored = structuredClone(chinesepoker.getGameState(CODE)!.result!);
    expect(isChinesePokerResult(stored)).toBe(true);
    // Stored history checks arithmetic, not today's row values, so rule changes keep old records valid.
    const rescored = {
      ...stored,
      matchups: stored.matchups.map((matchup) => ({ ...matchup, points: matchup.points * 3 })),
      scores: { N: stored.scores.N * 3, E: stored.scores.E * 3, S: stored.scores.S * 3, W: stored.scores.W * 3 },
    };
    expect(isChinesePokerResult(rescored)).toBe(true);
    const unbalanced = structuredClone(stored);
    unbalanced.scores.N += 1;
    expect(isChinesePokerResult(unbalanced)).toBe(false);
    const truncated = structuredClone(chinesepoker.getGameState(CODE)!);
    truncated.log = truncated.log.slice(0, 5);
    expect(persists(truncated, 'chinesepoker')).toBe(false);
  });
});

describe("persisted Liar's Deck games", () => {
  afterEach(() => liarsdeck.restoreGames([]));

  /** Plays random legal actions: calls about a third of the time it may, otherwise plays one to three cards. */
  function playLiarsDeck(random: () => number): void {
    const game = liarsdeck.getGameState(CODE)!;
    const seat = game.currentTurnSeat;
    const counts = Object.fromEntries(SEATS.map((entry) => [entry, game.hands[entry].length])) as Record<Seat, number>;
    const call = ldMustChallenge(seat, counts, game.lastPlay)
      || (ldCanChallenge(seat, game.lastPlay) && random() < 0.35);
    const size = 1 + Math.floor(random() * Math.min(3, game.hands[seat].length));
    const result = call ? liarsdeck.challenge(CODE, seat, random)
      : liarsdeck.play(CODE, seat, game.hands[seat].slice(0, size).map((card) => card.id));
    expect(result.success).toBe(true);
  }

  function finishedGame(seed: number): ReturnType<typeof liarsdeck.getGameState> {
    const random = seeded(seed);
    liarsdeck.startGame(CODE, PLAYERS, random);
    for (let step = 0; step < 500 && liarsdeck.getGameState(CODE)!.phase !== 'scoring'; step++) {
      expect(persists(liarsdeck.getGameState(CODE)!, 'liarsdeck')).toBe(true);
      playLiarsDeck(random);
    }
    return liarsdeck.getGameState(CODE);
  }

  it('accepts every committed state through the last survivor', () => {
    for (const seed of [3, 8, 21]) {
      const game = finishedGame(seed)!;
      expect(game.phase).toBe('scoring');
      expect(persists(game, 'liarsdeck')).toBe(true);
      expect(isLiarsDeckResult(game.result)).toBe(true);
    }
  });

  it('rejects altered reveals, trigger pulls, bullets, and results', () => {
    const game = finishedGame(5)!;
    const challenge = game.log.findIndex((entry) => entry.type === 'challenge');
    const reveal = structuredClone(game);
    const entry = reveal.log[challenge];
    if (entry.type !== 'challenge') throw new Error('Expected a challenge');
    Object.assign(entry, { lied: !entry.lied });
    expect(persists(reveal, 'liarsdeck')).toBe(false);
    const survivor = game.result!.winnerSeat;
    const bullets = structuredClone(game);
    bullets.bullets[survivor] = game.shots[survivor];
    expect(persists(bullets, 'liarsdeck')).toBe(false);
    const result = structuredClone(game);
    result.result = { ...result.result!, rounds: result.result!.rounds + 1 };
    expect(persists(result, 'liarsdeck')).toBe(false);
  });

  it('rejects a playing state with duplicated cards or a misplaced turn', () => {
    liarsdeck.startGame(CODE, PLAYERS, seeded(13));
    const game = liarsdeck.getGameState(CODE)!;
    const duplicate = structuredClone(game);
    duplicate.hands.N[0] = { ...duplicate.hands.E[0] };
    expect(persists(duplicate, 'liarsdeck')).toBe(false);
    const turn = structuredClone(game);
    turn.currentTurnSeat = SEATS[(SEATS.indexOf(game.currentTurnSeat) + 1) % 4];
    expect(persists(turn, 'liarsdeck')).toBe(false);
    const wrongFace = structuredClone(game);
    wrongFace.hands.N[0] = { id: wrongFace.hands.N[0].id, face: wrongFace.hands.N[0].face === 'K' ? 'Q' : 'K' };
    expect(persists(wrongFace, 'liarsdeck')).toBe(false);
  });
});

describe('persisted Blackjack games', () => {
  afterEach(() => blackjack.restoreGames([]));

  /** One random legal decision: a bet from the next seat that owes one, or the acting hand's action. */
  function stepBlackjack(random: () => number): void {
    const game = blackjack.getGameState(CODE)!;
    if (game.phase === 'betting') {
      const seat = blackjack.pendingBetSeats(game)[0];
      const steps = (bjMaxBet(game.chips[seat]) - BJ_MIN_BET) / BJ_BET_STEP;
      const amount = BJ_MIN_BET + Math.floor(random() * (steps + 1)) * BJ_BET_STEP;
      expect(blackjack.bet(CODE, seat, amount, true, 1000, random).success).toBe(true);
      return;
    }
    const seat = game.currentTurnSeat;
    const legal = bjLegalActions(game.hands[seat], game.activeHand, game.chips[seat]);
    expect(blackjack.act(CODE, seat, legal[Math.floor(random() * legal.length)], 1000).success).toBe(true);
  }

  function finishedGame(seed: number): NonNullable<ReturnType<typeof blackjack.getGameState>> {
    const random = seeded(seed);
    blackjack.startGame(CODE, PLAYERS, 15_000, 0);
    for (let step = 0; step < 500 && blackjack.getGameState(CODE)!.phase !== 'scoring'; step++) {
      expect(persists(blackjack.getGameState(CODE)!, 'blackjack')).toBe(true);
      stepBlackjack(random);
    }
    return blackjack.getGameState(CODE)!;
  }

  it('accepts every committed state through the final settlement', () => {
    for (const seed of [2, 9, 31]) {
      const game = finishedGame(seed);
      expect(game.phase).toBe('scoring');
      expect(persists(game, 'blackjack')).toBe(true);
      expect(isBlackjackResult(game.result)).toBe(true);
    }
  });

  it('rejects altered settlements, dealer draws, and results', () => {
    const game = finishedGame(4);
    const settle = game.log.findIndex((entry) => entry.type === 'settle');
    const chips = structuredClone(game);
    const entry = chips.log[settle];
    if (entry.type !== 'settle') throw new Error('Expected a settlement');
    entry.chips.N += 10;
    expect(persists(chips, 'blackjack')).toBe(false);
    const result = structuredClone(game);
    result.result = { ...result.result!, chips: { ...result.result!.chips, E: result.result!.chips.E + 10 } };
    expect(persists(result, 'blackjack')).toBe(false);
    const extraDraw = structuredClone(game);
    const reveal = extraDraw.log.findIndex((value) => value.type === 'reveal');
    extraDraw.log.splice(reveal + 1, 0, { type: 'dealerHit', card: { suit: 'spades', rank: 2 }, timestamp: 1000 });
    expect(persists(extraDraw, 'blackjack')).toBe(false);
  });

  it('rejects duplicated cards, a misplaced turn, and bets from seats that cannot bet', () => {
    const random = seeded(17);
    blackjack.startGame(CODE, PLAYERS, 15_000, 0);
    while (blackjack.getGameState(CODE)!.phase === 'betting') stepBlackjack(random);
    const game = blackjack.getGameState(CODE)!;
    if (game.phase === 'playing') {
      const duplicate = structuredClone(game);
      duplicate.deck[0] = { ...duplicate.dealer[0] };
      expect(persists(duplicate, 'blackjack')).toBe(false);
      const turn = structuredClone(game);
      turn.currentTurnSeat = SEATS[(SEATS.indexOf(game.currentTurnSeat) + 1) % 4];
      expect(persists(turn, 'blackjack')).toBe(false);
      const hidden = structuredClone(game);
      hidden.hole = null;
      expect(persists(hidden, 'blackjack')).toBe(false);
    }
    blackjack.startGame(CODE, PLAYERS, 15_000, 0);
    const betting = blackjack.getGameState(CODE)!;
    const unplaced = structuredClone(betting);
    unplaced.bets.N = 50;
    expect(persists(unplaced, 'blackjack')).toBe(false);
    expect(blackjack.bet(CODE, 'N', 50, true, 0).success).toBe(true);
    expect(persists(blackjack.getGameState(CODE)!, 'blackjack')).toBe(true);
    const over = structuredClone(blackjack.getGameState(CODE)!);
    over.bets.N = 1010;
    expect(persists(over, 'blackjack')).toBe(false);
  });
});

describe("persisted Texas Hold'em games", () => {
  afterEach(() => holdem.restoreGames([]));

  /** One random legal action for the acting seat, folding rarely so hands reach showdowns and all-ins. */
  function stepHoldem(random: () => number): void {
    const game = holdem.getGameState(CODE)!;
    const seat = game.currentTurnSeat;
    const legal = heLegalActions(game, seat)!;
    const roll = random();
    const action = legal.raise && roll < 0.3
      ? { type: 'raise' as const, to: roll < 0.08 ? legal.raise.max
        : legal.raise.min + Math.floor(random() * (legal.raise.max - legal.raise.min + 1) / 4) }
      : legal.check ? { type: 'check' as const }
        : roll < 0.85 ? { type: 'call' as const } : { type: 'fold' as const };
    expect(holdem.act(CODE, seat, action, 1000, random).success).toBe(true);
  }

  function finishedGame(seed: number): NonNullable<ReturnType<typeof holdem.getGameState>> {
    const random = seeded(seed);
    holdem.startGame(CODE, PLAYERS, random, 0);
    for (let step = 0; step < 3000 && holdem.getGameState(CODE)!.phase !== 'scoring'; step++) {
      expect(persists(holdem.getGameState(CODE)!, 'holdem')).toBe(true);
      stepHoldem(random);
    }
    return holdem.getGameState(CODE)!;
  }

  it('accepts every committed state through the final award', () => {
    for (const seed of [1, 6, 44]) {
      const game = finishedGame(seed);
      expect(game.phase).toBe('scoring');
      expect(persists(game, 'holdem')).toBe(true);
      expect(isHoldemResult(game.result)).toBe(true);
      expect(game.log.some((entry) => entry.type === 'showdown')).toBe(true);
    }
  });

  it('rejects altered awards, illegal raises, and results', () => {
    const game = finishedGame(12);
    const award = game.log.findIndex((entry) => entry.type === 'award');
    const chips = structuredClone(game);
    const entry = chips.log[award];
    if (entry.type !== 'award') throw new Error('Expected an award');
    entry.chips.N += 10;
    expect(persists(chips, 'holdem')).toBe(false);
    const raise = structuredClone(game);
    const raised = raise.log.findIndex((value) => value.type === 'action' && (value.action === 'raise' || value.action === 'bet'));
    expect(raised).toBeGreaterThanOrEqual(0);
    raise.log[raised] = { ...raise.log[raised], to: 1 } as typeof raise.log[number];
    expect(persists(raise, 'holdem')).toBe(false);
    const result = structuredClone(game);
    result.result = { ...result.result!, hands: result.result!.hands - 1 };
    expect(persists(result, 'holdem')).toBe(false);
  });

  it('rejects duplicated cards, a misplaced turn, and leaked button moves', () => {
    holdem.startGame(CODE, PLAYERS, seeded(3), 0);
    const game = holdem.getGameState(CODE)!;
    expect(persists(game, 'holdem')).toBe(true);
    const duplicate = structuredClone(game);
    duplicate.deck[0] = { ...duplicate.hands[game.dealt[0]][0] };
    expect(persists(duplicate, 'holdem')).toBe(false);
    const turn = structuredClone(game);
    turn.currentTurnSeat = SEATS[(SEATS.indexOf(game.currentTurnSeat) + 1) % 4];
    expect(persists(turn, 'holdem')).toBe(false);
    const button = structuredClone(game);
    const first = button.log[0];
    if (first.type !== 'hand') throw new Error('Expected a hand');
    button.log[0] = { ...first, blinds: { N: 0, E: 0, S: 0, W: 0 } };
    expect(persists(button, 'holdem')).toBe(false);
  });
});
