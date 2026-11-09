import { beforeEach, describe, expect, it } from 'vitest';
import type { YachtTurn, YachtVisibleState } from '@shared/games/yacht/types';
import type { YachtBox, YachtFace } from '@shared/rules/yacht';
import { t } from '../../../client/src/i18n';
import { useI18nStore } from '../../../client/src/stores/i18n-store';
import { yachtClient } from '../../../client/src/games/yacht/yacht-client';
import {
  boxLabel, boxShortLabel, diceSeat, ownTurn, potentialSeat, recentScores, rerolled, rollsLeft, rowState, seatCells, seatTotals,
} from '../../../client/src/games/yacht/yacht-view';
import { YACHT_BOXES } from '@shared/rules/yacht';

const open = (dice: readonly number[], rolls: number, held = [false, false, false, false, false], done = false): YachtTurn =>
  ({ dice: dice as YachtFace[], held, rolls, done });

function game(overrides: Partial<YachtVisibleState> = {}): YachtVisibleState {
  return {
    gameType: 'yacht', phase: 'playing', mySeat: 'N', seats: ['N', 'E', 'S'], options: { mode: 'turns' }, round: 3,
    currentTurnSeat: 'E', roundDeadline: null,
    turns: { N: open([], 0), E: open([2, 2, 5, 5, 5], 2), S: open([], 0) },
    cards: { N: { boxes: { ones: 3, twos: 6 }, extraYachts: 0 }, E: { boxes: { yacht: 50, ones: 2 }, extraYachts: 1 },
      S: { boxes: {}, extraYachts: 0 } },
    log: [], result: null, ...overrides,
  };
}

describe('Yacht Dice table view', () => {
  beforeEach(() => useI18nStore.getState().setLocale('en'));

  it('shows the dice of the seat on turn, and each viewer their own in simultaneous rounds', () => {
    expect(diceSeat(game())).toBe('E');
    expect(diceSeat(game({ currentTurnSeat: null, phase: 'scoring', log: [{ type: 'score', round: 13, seat: 'S', box: 'chance',
      score: 20, bonus: false, dice: [1, 1, 1, 1, 1], rolls: 1, timestamp: 1 }] }))).toBe('S');
    expect(diceSeat(game({ options: { mode: 'simultaneous' }, currentTurnSeat: null }))).toBe('N');
    expect(potentialSeat(game())).toBe('E');
    expect(potentialSeat(game({ options: { mode: 'simultaneous' }, currentTurnSeat: null }))).toBe('N');
    expect(potentialSeat(game({ phase: 'scoring' }))).toBeNull();
  });

  it('lets only a seated viewer act, on their own open turn', () => {
    expect(ownTurn(game())).toBeNull();
    expect(ownTurn(game({ mySeat: 'E' }))?.seat).toBe('E');
    expect(ownTurn(game({ mySeat: 'E', observer: 'spectator' }))).toBeNull();
    expect(ownTurn(game({ mySeat: 'E', turns: { E: open([1, 2, 3, 4, 5], 1, undefined, true) } }))).toBeNull();
    expect(ownTurn(game({ mySeat: 'E', phase: 'scoring' }))).toBeNull();
    // Everyone rolls in a simultaneous round, whoever the table last named.
    expect(ownTurn(game({ options: { mode: 'simultaneous' }, currentTurnSeat: null }))?.seat).toBe('N');
  });

  it('describes each row as active, rolling, scored, or waiting', () => {
    expect(['N', 'E', 'S'].map((seat) => rowState(game(), seat as 'N'))).toEqual(['waiting', 'active', 'waiting']);
    const simultaneous = game({ options: { mode: 'simultaneous' }, currentTurnSeat: null,
      turns: { N: open([1, 2, 3, 4, 5], 1, undefined, true), E: open([2, 2, 5, 5, 5], 2), S: open([], 0) } });
    expect(['N', 'E', 'S'].map((seat) => rowState(simultaneous, seat as 'N'))).toEqual(['scored', 'rolling', 'waiting']);
    expect(rowState(game({ phase: 'scoring' }), 'E')).toBe('waiting');
  });

  it('shows potential scores in the active row only, with the joker rule applied', () => {
    const cells = seatCells(game(), 'E', YACHT_BOXES);
    const byBox = Object.fromEntries(cells.map((cell) => [cell.box, cell])) as Record<YachtBox, (typeof cells)[number]>;
    expect(byBox.yacht).toEqual({ box: 'yacht', score: 50, potential: null });
    expect(byBox.ones).toEqual({ box: 'ones', score: 2, potential: null });
    expect(byBox.fullHouse).toEqual({ box: 'fullHouse', score: null, potential: 25 });
    expect(byBox.twos.potential).toBe(4);
    expect(seatCells(game(), 'N', YACHT_BOXES).every((cell) => cell.potential === null)).toBe(true);
    // Dice that are not rolled yet promise nothing.
    expect(seatCells(game({ turns: { E: open([], 0) } }), 'E', YACHT_BOXES).every((cell) => cell.potential === null)).toBe(true);
  });

  it('totals a card with its bonuses and counts the rolls left', () => {
    expect(seatTotals(game(), 'E')).toMatchObject({ upper: 2, extra: 100, total: 2 + 50 + 100 });
    expect(seatTotals(game({ cards: {} }), 'N').total).toBe(0);
    expect([0, 1, 3].map((rolls) => rollsLeft(open([1, 2, 3, 4, 5], rolls)))).toEqual([3, 2, 0]);
  });

  it('marks the dice the latest roll tumbled, from the mask it kept', () => {
    expect(rerolled(open([1, 2, 3, 4, 5], 1))).toEqual([true, true, true, true, true]);
    expect(rerolled(open([1, 2, 3, 4, 5], 2, [true, false, false, true, false]))).toEqual([false, true, true, false, true]);
  });

  it('lists the newest scores first', () => {
    const entry = (round: number): YachtVisibleState['log'][number] => ({ type: 'score', round, seat: 'N', box: 'chance', score: round,
      bonus: false, dice: [1, 1, 1, 1, 1], rolls: 1, timestamp: round });
    expect(recentScores({ log: [entry(1), entry(2), entry(3)] }, 2).map((item) => item.round)).toEqual([3, 2]);
  });

  it('names every box in both languages', () => {
    for (const locale of ['en', 'zh-TW'] as const) {
      for (const box of YACHT_BOXES) {
        expect(t(boxLabel(box), locale)).not.toBe(boxLabel(box));
        expect(t(boxShortLabel(box), locale)).not.toBe(boxShortLabel(box));
      }
    }
    expect([t('gameType.yacht', 'en'), t('gameType.yacht', 'zh-TW')]).toEqual(['Yacht Dice', '快艇骰子']);
    expect(t('yacht.box.yacht', 'zh-TW')).toBe('快艇');
  });
});

describe('Yacht Dice client module', () => {
  it('keeps the turn only in turn mode and mirrors the result for history', () => {
    const base = game();
    expect(yachtClient.restoreSnapshot(base, { state: {} as never, retain: (_previous, next) => next }))
      .toMatchObject({ phase: 'playing', currentTurnSeat: 'E' });
    expect(yachtClient.restoreSnapshot(game({ options: { mode: 'simultaneous' }, currentTurnSeat: null }),
      { state: {} as never, retain: (_previous, next) => next })).toMatchObject({ currentTurnSeat: null });
    const result = { gameType: 'yacht' as const, seats: ['N', 'E'] as ('N' | 'E')[], mode: 'turns' as const, winners: ['N' as const, 'E' as const],
      totals: { N: 200, E: 200 }, upperBonus: {}, yachts: {} };
    expect(yachtClient.result.winners(result)).toEqual(['N', 'E']);
    expect(yachtClient.result.summary(result, 'N', String as never)).toEqual({
      kind: 'winners', winners: ['N', 'E'], detail: { key: 'history.score', n: '200' } });
    expect(yachtClient.result.summary(result, undefined, String as never)).toMatchObject({ detail: null });
    expect(yachtClient.rules.roomContext({ gameOptions: { yacht: { mode: 'simultaneous' } } } as never).option)
      .toEqual({ label: 'yacht.rulesSimultaneous', enabled: true });
    expect(yachtClient.rules.roomContext({} as never).option).toEqual({ label: 'yacht.rulesSimultaneous', enabled: false });
  });
});
