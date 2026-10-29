import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PresentationFrame } from '@shared/game-presentation';
import type { Card, OldMaidLogEntry, OldMaidMatchResult, OldMaidVisibleState } from '@shared/types';
import { useI18nStore } from '../../../client/src/stores/i18n-store';
import { OldMaidFrame } from '../../../client/src/games/oldmaid/OldMaidFrame';
import {
  fanRows, finishPlace, oldMaidMode, oldMaidView, recentOldMaidMoves, replayOldMaid, seatOut,
} from '../../../client/src/games/oldmaid/oldmaid-view';
import { deriveOldMaidRounds } from '../../../client/src/games/oldmaid/oldmaid-rounds';
import { createRoundBuilder } from '../../../client/src/games/round-builder';
import { oldMaidClient } from '../../../client/src/games/oldmaid/oldmaid-client';
import { oldMaidStatistics } from '../../../client/src/games/oldmaid/statistics';
import { oldMaidDefinition } from '../../../shared/src/games/oldmaid/definition';

const zero = { N: 0, E: 0, S: 0, W: 0, P5: 0, P6: 0, P7: 0, P8: 0 };
const seats = (values: Partial<typeof zero>): typeof zero => ({ ...zero, ...values });
const c = (rank: Card['rank'], suit: Card['suit'] = 'hearts'): Card => ({ suit, rank });
const none = { N: [], E: [], S: [], W: [], P5: [], P6: [], P7: [], P8: [] };

/** Deal 1: N and E start with 3 and 2 cards, S with 2. N takes E's second card and pairs it; E empties on S's draw. */
const log: OldMaidLogEntry[] = [
  { type: 'deal', deal: 1, starter: 'N', discards: { ...none, N: [c(4), c(4, 'clubs')], S: [c(9), c(9, 'clubs')] },
    counts: seats({ N: 3, E: 2, S: 2 }), finished: [], timestamp: 1 },
  { type: 'draw', seat: 'N', from: 'E', index: 1, discarded: [c(7), c(7, 'clubs')], finished: [], timestamp: 2 },
  { type: 'draw', seat: 'E', from: 'S', index: 0, discarded: [], finished: [], timestamp: 3 },
  { type: 'draw', seat: 'S', from: 'N', index: 0, discarded: [c(2), c(2, 'clubs')], finished: ['S'], timestamp: 4 },
  { type: 'settle', deal: 1, order: ['S', 'N', 'E'], loser: 'E', points: seats({ S: 2, N: 1 }),
    totals: seats({ S: 2, N: 1 }), timestamp: 5 },
  { type: 'deal', deal: 2, starter: 'E', discards: none, counts: seats({ N: 4, E: 3, S: 3 }), finished: [], timestamp: 6 },
];

function game(overrides: Partial<OldMaidVisibleState> = {}): OldMaidVisibleState {
  return {
    gameType: 'oldmaid', phase: 'playing', mySeat: 'N', seats: ['N', 'E', 'S'], deal: 2, totalDeals: 3,
    myHand: [c(5), { joker: 'big' }, c(11)], handCounts: seats({ N: 3, E: 3, S: 3 }), finished: [], currentTurnSeat: 'E',
    drawFrom: 'S', totals: seats({ S: 2, N: 1 }), log,
    presentation: { id: 'p', startedAt: 0, logStart: 1, timingVersion: 3 }, result: null, ...overrides,
  };
}

describe('Old Maid table view', () => {
  beforeEach(() => useI18nStore.getState().setLocale('en'));

  it('should replay counts, finishers, discarded pairs and points from the public log', () => {
    expect(replayOldMaid(log, 1)).toMatchObject({ deal: 1, counts: seats({ N: 3, E: 2, S: 2 }), finished: [],
      pairs: seats({ N: 1, S: 1 }), lastDraw: null });
    expect(replayOldMaid(log, 2)).toMatchObject({ counts: seats({ N: 2, E: 1, S: 2 }), pairs: seats({ N: 2, S: 1 }),
      lastDraw: { seat: 'N', from: 'E', index: 1 } });
    expect(replayOldMaid(log, 4)).toMatchObject({ counts: seats({ N: 1, E: 2, S: 0 }), finished: ['S'] });
    expect(replayOldMaid(log, 5)).toMatchObject({ totals: seats({ S: 2, N: 1 }), finished: ['S'] });
    expect(replayOldMaid(log, 6)).toMatchObject({ deal: 2, counts: seats({ N: 4, E: 3, S: 3 }), finished: [],
      totals: seats({ S: 2, N: 1 }) });
  });

  it('should show the table as the presentation frame has reached it', () => {
    const state = game();
    const [first, second] = [0, 1].map((i) => ({ key: `p:${i}`, kind: 'deal', durationMs: 1, cards: [] } as PresentationFrame));
    expect(oldMaidView(state, first)).toMatchObject({ deal: 1, handHidden: true, logEnd: 1 });
    expect(oldMaidView(state, second)).toMatchObject({ counts: seats({ N: 2, E: 1, S: 2 }), logEnd: 2, handHidden: true });
    expect(oldMaidView(state, { ...first, key: 'p:5' })).toMatchObject({ deal: 2, handHidden: false, logEnd: 6 });
    expect(oldMaidView(state, null)).toMatchObject({ deal: 2, handHidden: false, logEnd: 6 });
  });

  it('should offer a draw only on the viewer\'s turn with cards to take', () => {
    expect(oldMaidMode(game(), true)).toBe('draw');
    expect(oldMaidMode(game(), false)).toBe('wait');
    expect(oldMaidMode(game({ phase: 'scoring', drawFrom: null }), true)).toBe('wait');
    expect(oldMaidMode(game({ handCounts: seats({ N: 3, E: 3, S: 0 }) }), true)).toBe('wait');
  });

  it('should place finished seats in order and leave the rest as playing', () => {
    expect(finishPlace({ finished: ['S', 'N'] }, 'N')).toBe(2);
    expect(finishPlace({ finished: ['S', 'N'] }, 'E')).toBeNull();
    expect(seatOut({ finished: ['S'] }, 'S')).toBe(true);
    expect(seatOut({ finished: ['S'] }, 'E')).toBe(false);
  });

  it('should wrap a long fan into two rows and keep every position', () => {
    expect(fanRows(5)).toEqual([[0, 1, 2, 3, 4]]);
    expect(fanRows(9)).toHaveLength(1);
    const rows = fanRows(14);
    expect(rows.map((row) => row.length)).toEqual([7, 7]);
    expect(rows.flat()).toEqual(Array.from({ length: 14 }, (_, index) => index));
    expect(fanRows(0)).toEqual([[]]);
  });

  it('should list the newest moves first, up to a limit', () => {
    expect(recentOldMaidMoves(log, 2).map((entry) => entry.type)).toEqual(['deal', 'settle']);
    expect(recentOldMaidMoves(log, 0)).toEqual([]);
  });

  it('should list each deal\'s discards, draws and settlement in the history', () => {
    const builder = createRoundBuilder();
    deriveOldMaidRounds({ gameType: 'oldmaid', phase: 'playing', log, seats: ['N', 'E', 'S'] }, builder);
    expect(builder.rounds).toHaveLength(2);
    expect(builder.rounds[0]).toMatchObject({ number: 1, complete: true });
    expect(builder.rounds[0].actions.map((action) => action.kind)).toEqual(['deal', 'deal', 'deal', 'draw', 'draw', 'draw', 'settle']);
    expect(builder.rounds[0].actions[3]).toMatchObject({ seat: 'N', target: 'E', index: 1, cards: [c(7), c(7, 'clubs')] });
    expect(builder.rounds[0].actions[6]).toMatchObject({ seat: 'E', order: ['S', 'N', 'E'] });
    expect(builder.rounds[1]).toMatchObject({ number: 2, complete: false });
  });

  it('should summarize a result by points and report ties as shared wins', () => {
    const result: OldMaidMatchResult = { gameType: 'oldmaid', seats: ['N', 'E', 'S'], deals: 3, totals: seats({ N: 3, E: 3, S: 3 }),
      dealOrders: [['N', 'S', 'E'], ['S', 'E', 'N'], ['E', 'N', 'S']], winners: ['N', 'E', 'S'] };
    const summary = (seat: 'N' | undefined) => oldMaidClient.result.summary(result, seat, ((key: string) => key) as never);
    expect(oldMaidClient.result.winners(result)).toEqual(['N', 'E', 'S']);
    expect(summary('N')).toMatchObject({ kind: 'winners', winners: ['N', 'E', 'S'], detail: { key: 'history.score', n: '3' } });
    expect(summary(undefined)).toMatchObject({ detail: null });
    expect(oldMaidClient.settlement(game({ result }))).toBe(result);
  });

  it('should average joker losses per match in the statistics', () => {
    const metrics = oldMaidStatistics.metrics({ sums: { jokerLosses: 3 }, matches: 2 } as never);
    expect(metrics).toEqual([{ id: 'jokerLosses', value: 1.5, format: 'decimal', basis: 2 }]);
  });

  it('should keep the owner\'s hand unsorted so its order stays private', () => {
    expect(oldMaidClient.handSort.unsortable).toBe(true);
    expect(oldMaidClient.observedView(game({ observedHands: { E: [{ joker: 'big' }] } })).oldMaidHands).toEqual({ E: [{ joker: 'big' }] });
    expect(oldMaidClient.spectatorPatch({ oldMaidHands: { E: [c(3)] } } as never, 'E')).toEqual({ myHand: [c(3)] });
  });
});

describe('Old Maid presentation', () => {
  beforeEach(() => useI18nStore.getState().setLocale('en'));

  const name = (seat: string): string => `Player ${seat}`;
  const html = (frame: PresentationFrame): string => renderToStaticMarkup(createElement(OldMaidFrame, { frame, name }));
  it('should derive a deal, draw and settle frame per entry with fixed lengths', () => {
    expect(oldMaidDefinition.presentation.logFrames(game() as never, 0, 'k0', { timingVersion: 3, playMs: 1300, passMs: 1000 }))
      .toEqual([expect.objectContaining({ kind: 'deal', durationMs: 2600, seat: 'N' })]);
    expect(oldMaidDefinition.presentation.logFrames(game() as never, 1, 'k1', { timingVersion: 3, playMs: 1300, passMs: 1000 }))
      .toEqual([expect.objectContaining({ kind: 'draw', durationMs: 1600, seat: 'N', target: 'E', handIndex: 1, cards: [c(7), c(7, 'clubs')] })]);
    expect(oldMaidDefinition.presentation.logFrames(game() as never, 4, 'k4', { timingVersion: 3, playMs: 1300, passMs: 1000 }))
      .toEqual([expect.objectContaining({ kind: 'settle', durationMs: 2800, seat: 'E' })]);
  });

  it('should render the discards per seat, the draw, and the order out', () => {
    const deal = html({ key: 'a', kind: 'deal', durationMs: 1, cards: [], seat: 'N',
      oldMaid: { discards: { N: [c(4), c(4, 'clubs')], S: [c(9), c(9, 'clubs'), c(9, 'spades'), c(9, 'diamonds')] } } });
    expect(deal).toContain('Pairs discarded');
    expect(deal).toContain('Player N');
    expect(deal).toContain('Player S');
    expect(deal).not.toContain('Player E');
    expect(html({ key: 'b', kind: 'deal', durationMs: 1, cards: [], oldMaid: { discards: none } })).toContain('no pairs');

    const draw = html({ key: 'c', kind: 'draw', durationMs: 1, cards: [c(7), c(7, 'clubs')], seat: 'N', target: 'E', handIndex: 1,
      oldMaid: { finished: ['S'] } });
    expect(draw).toContain('takes card 2 from Player E');
    expect(draw).toContain('Pair!');
    expect(draw).toContain('Player S out of cards');
    expect(html({ key: 'd', kind: 'draw', durationMs: 1, cards: [], seat: 'N', target: 'E', handIndex: 0, oldMaid: { finished: [] } }))
      .not.toContain('Pair!');

    const settle = html({ key: 'e', kind: 'settle', durationMs: 1, cards: [], seat: 'E',
      oldMaid: { order: ['S', 'N', 'E'], points: seats({ S: 2, N: 1 }) } });
    expect(settle).toContain('Player S');
    expect(settle).toContain('+2');
    expect(settle).toContain('Joker');
    useI18nStore.getState().setLocale('zh-TW');
    expect(html({ key: 'e', kind: 'settle', durationMs: 1, cards: [], seat: 'E', oldMaid: { order: ['S', 'N', 'E'] } })).toContain('出完順序');
  });

  it('should never put a drawn card on a frame unless it formed a pair', () => {
    const draw = oldMaidDefinition.presentation.logFrames(game() as never, 2, 'k2', { timingVersion: 3, playMs: 1300, passMs: 1000 })[0];
    expect(draw.cards).toEqual([]);
    expect(JSON.stringify(draw)).not.toContain('joker');
  });
});
