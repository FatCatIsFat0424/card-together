import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { getPresentationFrames } from '@shared/game-presentation';
import type { PresentationFrame } from '@shared/game-presentation';
import type { DiceFace, LiarsDiceLogEntry, LiarsDiceMatchResult, LiarsDiceVisibleState } from '@shared/types';
import { useI18nStore } from '../../../client/src/stores/i18n-store';
import { Die } from '../../../client/src/games/liarsdice/Dice';
import { DEFAULT_DICE_THEME, diceThemeVars } from '../../../client/src/games/liarsdice/dice-theme';
import { LiarsDiceFrame } from '../../../client/src/games/liarsdice/LiarsDiceFrame';
import {
  defaultBid, dieMatches, liarsDiceMode, liarsDiceView, recentLiarsDiceMoves, replayLiarsDice, sortDice,
} from '../../../client/src/games/liarsdice/liarsdice-view';
import { deriveLiarsDiceRounds } from '../../../client/src/games/liarsdice/liarsdice-rounds';
import { createRoundBuilder } from '../../../client/src/games/round-builder';
import { liarsDiceClient } from '../../../client/src/games/liarsdice/liarsdice-client';

const empty = { N: 0, E: 0, S: 0, W: 0, P5: 0, P6: 0, P7: 0, P8: 0 };
const cups = (dice: Partial<typeof empty>): typeof empty => ({ ...empty, ...dice });
const reveal = (dice: Record<string, DiceFace[]>): Extract<LiarsDiceLogEntry, { type: 'challenge' }>['dice'] =>
  ({ N: [], E: [], S: [], W: [], P5: [], P6: [], P7: [], P8: [], ...dice });

/** N bid 3 twos, S called with ones wild and lost nothing: N had them; E bid ones next round. */
const log: LiarsDiceLogEntry[] = [
  { type: 'round', round: 1, starter: 'N', counts: cups({ N: 2, E: 1, S: 2 }), timestamp: 1 },
  { type: 'bid', seat: 'N', quantity: 3, face: 2, timestamp: 2 },
  { type: 'bid', seat: 'E', quantity: 2, face: 1, timestamp: 3 },
  { type: 'challenge', seat: 'S', target: 'E', quantity: 2, face: 1, wild: false,
    dice: reveal({ N: [2, 2], E: [3], S: [1, 4] }), count: 1, bidTrue: false, loser: 'E', eliminated: true, timestamp: 4 },
  { type: 'round', round: 2, starter: 'S', counts: cups({ N: 2, S: 2 }), timestamp: 5 },
];

function game(overrides: Partial<LiarsDiceVisibleState> = {}): LiarsDiceVisibleState {
  return {
    gameType: 'liarsdice', phase: 'playing', mySeat: 'N', seats: ['N', 'E', 'S'], myDice: [5, 3],
    diceCounts: cups({ N: 2, S: 2 }), round: 2, bid: null, onesWild: true, currentTurnSeat: 'S', eliminated: ['E'], log,
    presentation: { id: 'p', startedAt: 0, logStart: 1, timingVersion: 3 }, result: null, ...overrides,
  };
}

describe("Liar's Dice table view", () => {
  beforeEach(() => useI18nStore.getState().setLocale('en'));

  it('should replay counts, the standing bid, the wild ones and eliminations from the public log', () => {
    expect(replayLiarsDice(log, 2)).toMatchObject({ round: 1, bid: { seat: 'N', quantity: 3, face: 2 }, onesWild: true,
      counts: cups({ N: 2, E: 1, S: 2 }), eliminated: [] });
    expect(replayLiarsDice(log, 3)).toMatchObject({ bid: { seat: 'E', quantity: 2, face: 1 }, onesWild: false });
    expect(replayLiarsDice(log, 4)).toMatchObject({ bid: null, counts: cups({ N: 2, E: 0, S: 2 }), eliminated: ['E'] });
    expect(replayLiarsDice(log, 5)).toMatchObject({ round: 2, onesWild: true, counts: cups({ N: 2, S: 2 }), eliminated: ['E'] });
  });

  it('should keep a challenge unresolved through its call and reveal frames and hide the next roll until presented', () => {
    const state = game();
    const [call, lift, deal] = getPresentationFrames(state).slice(-3);
    expect(call.kind).toBe('challenge');
    expect(liarsDiceView(state, call)).toMatchObject({ round: 1, eliminated: [], bid: { seat: 'E', quantity: 2 }, handHidden: true, logEnd: 3 });
    expect(liarsDiceView(state, call).counts).toEqual(cups({ N: 2, E: 1, S: 2 }));
    expect(liarsDiceView(state, lift)).toMatchObject({ eliminated: [], handHidden: true, logEnd: 3 });
    expect(liarsDiceView(state, deal)).toMatchObject({ round: 2, eliminated: ['E'], handHidden: false, logEnd: 5 });
    expect(liarsDiceView(state, null)).toMatchObject({ round: 2, handHidden: false, logEnd: 5 });
  });

  it('should offer a bid, a bid or a call, and nothing off turn', () => {
    expect(liarsDiceMode(game(), null, true)).toBe('bid');
    expect(liarsDiceMode(game(), { seat: 'S', quantity: 1, face: 2 }, true)).toBe('bidOrCall');
    expect(liarsDiceMode(game(), { seat: 'N', quantity: 1, face: 2 }, true)).toBe('bid');
    expect(liarsDiceMode(game(), null, false)).toBe('wait');
    expect(liarsDiceMode(game({ phase: 'scoring' }), null, true)).toBe('wait');
  });

  it('should match dice to a bid with ones wild only while they are', () => {
    expect(dieMatches(1, 4, true)).toBe(true);
    expect(dieMatches(1, 4, false)).toBe(false);
    expect(dieMatches(1, 1, true)).toBe(true);
    expect(dieMatches(4, 4, false)).toBe(true);
    expect(dieMatches(3, 4, true)).toBe(false);
  });

  it('should show dice high to the left without changing the hand', () => {
    const dice: DiceFace[] = [2, 6, 1, 6, 3];
    expect(sortDice(dice)).toEqual([6, 6, 3, 2, 1]);
    expect(dice).toEqual([2, 6, 1, 6, 3]);
  });

  it('should start the controls from the least raise', () => {
    expect(defaultBid(null, 10)).toEqual({ quantity: 1, face: 2 });
    expect(defaultBid({ quantity: 3, face: 6 }, 10)).toEqual({ quantity: 3, face: 1 });
    expect(defaultBid({ quantity: 2, face: 1 }, 2)).toEqual({ quantity: 2, face: 6 });
  });

  it('should list the newest moves first, up to a limit', () => {
    expect(recentLiarsDiceMoves(log, 2).map((entry) => entry.type)).toEqual(['round', 'challenge']);
    expect(recentLiarsDiceMoves(log, 0)).toEqual([]);
  });

  it('should list each round\'s bids and challenge in the history', () => {
    const builder = createRoundBuilder();
    deriveLiarsDiceRounds({ gameType: 'liarsdice', phase: 'playing', log, seats: ['N', 'E', 'S'] }, builder);
    expect(builder.rounds).toHaveLength(2);
    expect(builder.rounds[0]).toMatchObject({ number: 1, complete: true, diceInPlay: 5 });
    expect(builder.rounds[0].actions.map((action) => action.kind)).toEqual(['bid', 'bid', 'challenge']);
    expect(builder.rounds[0].actions[2]).toMatchObject({ seat: 'S', target: 'E', found: 1, bidTrue: false, loser: 'E', eliminated: true });
    expect(builder.rounds[1]).toMatchObject({ number: 2, complete: false, diceInPlay: 4, actions: [] });
  });

  it('should summarize a result by rank, including eliminated seats', () => {
    const result: LiarsDiceMatchResult = { gameType: 'liarsdice', seats: ['N', 'E', 'S'], winnerSeat: 'S',
      eliminationOrder: ['E', 'N'], dice: cups({ S: 3 }), rounds: 12 };
    const summary = (seat: 'N' | 'E' | 'S' | undefined) => liarsDiceClient.result.summary(result, seat, ((key: string) => key) as never);
    expect(liarsDiceClient.result.winners(result)).toEqual(['S']);
    expect(summary('S')).toMatchObject({ kind: 'winners', winners: ['S'], detail: { key: 'history.rank', n: '1' } });
    expect(summary('N')).toMatchObject({ detail: { n: '2' } });
    expect(summary('E')).toMatchObject({ detail: { n: '3' } });
    expect(summary(undefined)).toMatchObject({ detail: null });
  });
});

describe("Liar's Dice renderer", () => {
  beforeEach(() => useI18nStore.getState().setLocale('en'));

  it('should draw each face with the right number of pips', () => {
    const pips = (value: DiceFace): number => (renderToStaticMarkup(createElement(Die, { value })).match(/class="[^"]*pip[^"]*"/g) ?? [])
      .filter((entry) => !entry.includes('blank')).length;
    expect([1, 2, 3, 4, 5, 6].map((value) => pips(value as DiceFace))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('should carry every colour through theme variables rather than markup', () => {
    const vars = diceThemeVars(DEFAULT_DICE_THEME) as Record<string, string>;
    expect(Object.keys(vars).sort()).toEqual(['--cup-body', '--cup-rim', '--cup-shade', '--die-body', '--die-edge', '--die-match',
      '--die-pip', '--die-pip-one'].sort());
    expect(renderToStaticMarkup(createElement(Die, { value: 5, label: 'five' }))).not.toContain('#');
  });

  const frameOf = (overrides: Partial<PresentationFrame>): PresentationFrame =>
    ({ key: 'p:3', kind: 'bid', durationMs: 1300, cards: [], ...overrides });
  const name = (seat: string): string => `Player ${seat}`;
  const html = (frame: PresentationFrame): string =>
    renderToStaticMarkup(createElement(LiarsDiceFrame, { frame, name }));

  it('should render the roll, bid and call frames', () => {
    expect(html(frameOf({ kind: 'deal', seat: 'N' }))).toContain('Everyone shakes their cups');
    expect(html(frameOf({ kind: 'bid', seat: 'N', liarsDice: { quantity: 4, face: 5 } }))).toContain('>4<');
    const call = html(frameOf({ kind: 'challenge', seat: 'S', target: 'E', liarsDice: { quantity: 2, face: 1 } }));
    expect(call).toContain('Player E');
    expect(call).not.toContain('Found');
  });

  it('should render the lifted cups with every seat\'s dice, the tally and the loser', () => {
    const frame = frameOf({ kind: 'diceReveal', seat: 'S', target: 'E', liarsDice: {
      quantity: 2, face: 1, wild: false, dice: reveal({ N: [2, 2], E: [3], S: [1, 4] }), count: 1, bidTrue: false, loser: 'E',
      eliminated: true } });
    const markup = html(frame);
    expect(markup).toContain('Player N');
    expect(markup).toContain('Found 1 (needed 2)');
    expect(markup).toContain('Player E is out of dice');
    expect((markup.match(/<li /g) ?? [])).toHaveLength(3);
    expect(html(frameOf({ kind: 'diceReveal', liarsDice: { ...frame.liarsDice!, eliminated: false } }))).toContain('Player E loses a die');
    useI18nStore.getState().setLocale('zh-TW');
    expect(html(frame)).toContain('骰子用完，出局');
  });
});
