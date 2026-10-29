import { gameSeatValues } from '../helpers/game-seat-values';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameType, PlayerInfo, Seat } from '@shared/types';
import * as games from '../../src/managers/game-manager';
import { getTurnSeat } from '../../src/managers/game-clock';
import { applyAutomatedAction, firstLegalAction } from '../../src/runtime/automated-action';

const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
const PLAYERS = Object.fromEntries(SEATS.map((seat) => [seat, {
  id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
}])) as Record<Seat, PlayerInfo>;
const CODE = 'FALL01';

describe('first legal automated action', () => {
  afterEach(() => { games.restoreGames([]); vi.restoreAllMocks(); });

  it.each<GameType>(['bridge', 'bigtwo', 'redpoints', 'ninetynine', 'sevens', 'chinesepoker', 'liarsdeck', 'blackjack', 'holdem', 'crazyeights', 'stud', 'gofish'])(
    'is accepted on every turn of a %s game until it ends', (type) => {
      let seed = 17;
      vi.spyOn(Math, 'random').mockImplementation(() => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      });
      games.startGame(CODE, type, PLAYERS);
      // Ninety-Nine reshuffles its discards, so random games can run for several hundred turns.
      for (let step = 0; step < 5_000; step += 1) {
        const game = games.getGameState(CODE)!;
        // Chinese Poker has no turn; every seat that has not arranged acts.
        const seat = game.gameType === 'chinesepoker'
          ? SEATS.find((pending) => game.arrangements[pending] === null) ?? null
          : game.gameType === 'blackjack' && game.phase === 'betting'
            ? SEATS.find((pending) => game.players[pending] && game.bets[pending] === null && game.chips[pending] >= 10) ?? null
            : getTurnSeat(game);
        if (!seat || game.phase === 'scoring') break;
        // Presentations only delay actions; skip them so the whole game can be replayed.
        delete game.presentation;
        // Fallback bidding always passes, so open once to reach play instead of redealing forever.
        if (game.gameType === 'bridge' && game.phase === 'bidding' && !game.bidding?.highestBid) {
          expect(games.handleBid(CODE, (seat as Seat), { type: 'bid', level: 1, suit: 'clubs' }, true)).toEqual({ success: true });
          continue;
        }
        const visible = games.getPlayerVisibleState(CODE, seat)!;
        const action = firstLegalAction(visible);
        expect(action).not.toBeNull();
        expect(applyAutomatedAction(CODE, seat, action!)).toEqual({ success: true });
      }
      expect(games.getGameState(CODE)!.phase).toBe('scoring');
      expect(firstLegalAction(games.getPlayerVisibleState(CODE, 'N')!)).toBeNull();
    });

  it('plays the first Liar card and challenges when only the current player holds cards', () => {
    games.startGame(CODE, 'liarsdeck', PLAYERS);
    const game = games.getGameState(CODE)!;
    const seat = getTurnSeat(game)!;
    const visible = games.getPlayerVisibleState(CODE, seat)!;
    if (visible.gameType !== 'liarsdeck') throw new Error('Expected Liar visible state');
    expect(firstLegalAction(visible)).toEqual({ type: 'liarsdeck-play', cardIds: [visible.myHand[0].id] });
    const opponent = SEATS.find((other) => other !== seat)!;
    const lastPlay = { seat: opponent, count: 1 };
    expect(firstLegalAction({ ...visible,
      handCounts: { N: 0, E: 0, S: 0, W: 0, [seat]: visible.myHand.length }, lastPlay,
    })).toEqual({ type: 'liarsdeck-challenge' });
  });

  it('bets the Blackjack minimum only for an eligible pending non-dealer', () => {
    games.startGame(CODE, 'blackjack', PLAYERS);
    const visible = games.getPlayerVisibleState(CODE, 'N')!;
    if (visible.gameType !== 'blackjack') throw new Error('Expected Blackjack visible state');
    expect(firstLegalAction(visible)).toEqual({ type: 'blackjack-bet', amount: 10 });
    expect(firstLegalAction({ ...visible, myBet: 10 })).toBeNull();
    expect(firstLegalAction({ ...visible, chips: { ...visible.chips, N: 5 } })).toBeNull();
    expect(firstLegalAction({ ...visible, dealerSeat: 'N' })).toBeNull();
    const dealer = { ...visible, phase: 'playing' as const, dealerSeat: 'N' as const,
      currentTurnSeat: 'N' as const, holeHidden: false,
      dealer: [{ suit: 'spades', rank: 10 }, { suit: 'hearts', rank: 6 }] as const };
    expect(firstLegalAction(dealer)).toEqual({ type: 'blackjack-dealer', action: 'hit' });
    expect(firstLegalAction({ ...dealer, dealer: [{ suit: 'spades', rank: 10 }, { suit: 'hearts', rank: 7 }] }))
      .toEqual({ type: 'blackjack-dealer', action: 'stand' });
    expect(firstLegalAction({ ...dealer, holeHidden: true })).toBeNull();

  });

  it('checks for free in Hold’em and folds facing a bet, only on its own turn', () => {
    games.startGame(CODE, 'holdem', PLAYERS);
    const seat = getTurnSeat(games.getGameState(CODE)!)!;
    const visible = games.getPlayerVisibleState(CODE, seat)!;
    if (visible.gameType !== 'holdem') throw new Error('Expected Holdem visible state');
    const before = structuredClone(visible);
    const streetBets = { N: 0, E: 0, S: 0, W: 0 };
    expect(firstLegalAction(gameSeatValues({ ...visible, currentBet: 0, streetBets }))).toEqual({ type: 'holdem-action', action: { type: 'check' } });
    expect(firstLegalAction(gameSeatValues({ ...visible, currentBet: 20, streetBets }))).toEqual({ type: 'holdem-action', action: { type: 'fold' } });
    expect(firstLegalAction({ ...visible, currentTurnSeat: SEATS.find((other) => other !== seat)! })).toBeNull();
    expect(visible).toEqual(before);
  });

});
