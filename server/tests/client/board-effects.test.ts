import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DICE_STYLES, PIECE_STYLES } from '@shared/constants';
import { gomokuBoard } from '@shared/rules/board/boards';
import { nodeId } from '@shared/rules/board/board-model';
import type { NodeId } from '@shared/rules/board/board-model';
import type { PlayerVisibleGameState } from '@shared/types';

const equipped = vi.hoisted(() => ({ account: null as Record<string, unknown> | null }));
vi.mock('../../../client/src/stores/account-store', () => ({
  useAccountStore: (select: (state: { account: Record<string, unknown> | null }) => unknown) => select(equipped),
  selectConnectionReady: () => true,
}));
const motion = vi.hoisted(() => ({ reducedMotion: false }));
vi.mock('../../../client/src/stores/motion-store', () => ({
  useMotionStore: (select: (state: { reducedMotion: boolean }) => unknown) => select(motion),
}));

import { contrast } from '../../../client/src/cosmetics/colour';
import { MAX_EFFECT_PARTICLES, PIECE_DESIGNS, PIECE_EFFECT_CONTRAST } from '../../../client/src/cosmetics/piece-styles/piece-designs';
import { PieceStylePreview } from '../../../client/src/cosmetics/piece-styles/PieceStylePreview';
import { DiceStylePreview } from '../../../client/src/cosmetics/dice-styles/DiceStylePreview';
import { DICE_DESIGNS } from '../../../client/src/cosmetics/dice-styles/dice-designs';
import { SERIES_TOKENS } from '../../../client/src/cosmetics/series-tokens';
import {
  BOARD_FX_LIMITS, boardFxOf, boardFxPlan, boardFxTiming, burstParticles, flipDelays, newBoardRecords,
} from '../../../client/src/games/board/board-effects';
import { boardFxGroup } from '../../../client/src/games/board/BoardEffects';
import { StonePiece } from '../../../client/src/games/board/BoardPieces';
import { BoardView } from '../../../client/src/games/board/BoardView';

const ANIMATED = new Set(['starfleet', 'shrine', 'ironfront', 'neoncity', 'crownrealm']);
const snapshot = (gameType: string, log: readonly unknown[]): PlayerVisibleGameState =>
  ({ gameType, log } as unknown as PlayerVisibleGameState);
const xq = (to: string, capture = false): unknown => ({ seat: 'S', from: '0,0', to, capture, piece: 1, timestamp: 0 });

afterEach(() => {
  equipped.account = null;
  motion.reducedMotion = false;
});

describe('board effect triggers', () => {
  it('reads every board game\'s move record', () => {
    expect(boardFxOf(xq('0,1', true))).toEqual({ from: '0,0', to: '0,1', capture: true, flips: [] });
    expect(boardFxOf({ seat: 'S', to: '3,3', flips: ['3,4', '3,5'] })).toEqual({ to: '3,3', capture: false, flips: ['3,4', '3,5'] });
    // A Banqi flip turns the token over in place; a blind attack moves onto it.
    expect(boardFxOf({ seat: 'S', to: '2,1', revealed: 4 })).toEqual({ to: '2,1', capture: false, flips: ['2,1'] });
    expect(boardFxOf({ seat: 'S', from: '2,2', to: '2,1', revealed: 4, capture: true, blind: true }))
      .toMatchObject({ from: '2,2', to: '2,1', capture: true, flips: [] });
    expect(boardFxOf({ seat: 'S', from: '0,6', to: '0,5', battle: 'lose' })).toMatchObject({ capture: true });
    expect(boardFxOf({ seat: 'S', flips: [] })).toBeNull();
    expect(boardFxOf(null)).toBeNull();
  });

  it('plays nothing on the first snapshot, a jump, a shrink, or another game', () => {
    const one = snapshot('xiangqi', [xq('0,1')]);
    expect(boardFxPlan(null, one)).toBeNull();
    expect(boardFxPlan(snapshot('xiangqi', []), snapshot('xiangqi', [xq('0,1'), xq('0,2'), xq('0,3'), xq('0,4')]))).toBeNull();
    expect(boardFxPlan(snapshot('xiangqi', [xq('0,1'), xq('0,2')]), one)).toBeNull();
    expect(boardFxPlan(one, one)).toBeNull();
    expect(boardFxPlan(snapshot('gomoku', []), one)).toBeNull();
    expect(newBoardRecords(snapshot('xiangqi', []), snapshot('xiangqi', [xq('0,1'), xq('0,2')]))).toHaveLength(2);
  });

  it('plays the newest board move when a pass follows it', () => {
    const plan = boardFxPlan(snapshot('reversi', []), snapshot('reversi', [{ seat: 'S', to: '3,3', flips: ['3,4'] }, { seat: 'N', flips: [] }]));
    expect(plan).toEqual({ to: '3,3', capture: false, flips: ['3,4'] });
  });

  it('keeps every effect within its limits', () => {
    expect(burstParticles(50, 0.7)).toHaveLength(BOARD_FX_LIMITS.particles);
    const delays = flipDelays(20);
    expect(delays).toHaveLength(BOARD_FX_LIMITS.flips);
    expect(delays[delays.length - 1] + BOARD_FX_LIMITS.flipMs).toBeLessThanOrEqual(BOARD_FX_LIMITS.flipSequenceMs);
    expect(boardFxTiming({ from: 'a' as NodeId, to: 'b' as NodeId, capture: true, flips: [] }))
      .toEqual({ hideMs: BOARD_FX_LIMITS.slideMs, totalMs: BOARD_FX_LIMITS.effectMs });
    expect(boardFxTiming({ to: 'b' as NodeId, capture: false, flips: [] }).hideMs).toBe(0);
    expect(boardFxTiming({ to: 'b' as NodeId, capture: false, flips: Array.from({ length: 20 }, () => 'c' as NodeId) }).totalMs)
      .toBeLessThanOrEqual(BOARD_FX_LIMITS.flipSequenceMs);
  });

  it('hides only the moving pieces and animates at most twelve turned discs', () => {
    const flips = Array.from({ length: 14 }, (_, index) => nodeId(index, 0));
    const now = new Map<NodeId, string>([[nodeId(0, 1), 'placed'], ...flips.map((node) => [node, 'light'] as [NodeId, string])]);
    const before = new Map<NodeId, string>(flips.map((node) => [node, 'dark']));
    const group = boardFxGroup({ to: nodeId(0, 1), capture: false, flips }, now, before)!;
    expect(group.flips).toHaveLength(BOARD_FX_LIMITS.flips);
    expect(group.flips[0]).toMatchObject({ before: 'dark', after: 'light' });
    expect(group.hides).toEqual(flips.slice(0, BOARD_FX_LIMITS.flips));
    const move = boardFxGroup({ from: nodeId(0, 0), to: nodeId(0, 1), capture: true, flips: [] }, now, before)!;
    expect(move.hides).toEqual([nodeId(0, 1)]);
    expect(boardFxGroup({ to: nodeId(9, 9), capture: false, flips: [] }, now, before)).toBeNull();
  });
});

describe('effect tiers', () => {
  it.each(PIECE_STYLES)('$id has bounded effects in its series colours', ({ id, design }) => {
    const { effects } = PIECE_DESIGNS[id];
    expect(effects.count).toBeLessThanOrEqual(MAX_EFFECT_PARTICLES);
    expect(effects.loop).toBe(ANIMATED.has(design));
    if (!effects.loop) expect(effects.aura).toBe('ring');
    expect(contrast(effects.colour, SERIES_TOKENS[design].board)).toBeGreaterThanOrEqual(PIECE_EFFECT_CONTRAST);
  });

  it.each(DICE_STYLES)('$id dice land with effects, looping only for animated series', ({ id, design }) => {
    expect(DICE_DESIGNS[id].effects?.loop).toBe(ANIMATED.has(design));
  });
});

describe('effects and reduced motion', () => {
  const view = (): string => renderToStaticMarkup(createElement(BoardView, {
    board: gomokuBoard(), surface: 'go', label: 'Board', selected: nodeId(3, 3),
    pieces: [{ node: nodeId(3, 3), key: 's', piece: createElement(StonePiece, { tone: 'dark' }) }],
  }));

  it('adds the effect layer only for piece styles and drops it under reduced motion', () => {
    expect(view()).not.toContain('<div');
    equipped.account = { pieceStyle: 'pieces-starfleet' };
    expect(view()).toMatch(/^<div/);
    motion.reducedMotion = true;
    expect(view()).not.toContain('<div');
  });

  it('demonstrates effects in shop previews, except under reduced motion', () => {
    const piece = (): string => renderToStaticMarkup(createElement(PieceStylePreview, { id: 'pieces-neoncity', account: null as never }));
    const dice = (): string => renderToStaticMarkup(createElement(DiceStylePreview, { id: 'dice-sakura', account: null as never }));
    expect(piece()).toMatch(/class="[^"]*auraNeon[^"]*loop/);
    expect(dice()).toMatch(/class="[^"]*land/);
    motion.reducedMotion = true;
    expect(piece()).not.toContain('aura');
    expect(dice()).not.toMatch(/class="[^"]*land/);
  });
});
