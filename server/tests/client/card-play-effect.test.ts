import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { getPresentationFrames } from '@shared/game-presentation';
import type { PresentationFrame } from '@shared/game-presentation';
import type { Card, GameType, NapoleonCard, PlayerVisibleGameState, Rank, Suit } from '@shared/types';
import { CardPlayEffect } from '../../../client/src/games/CardPlayEffect';
import { GamePresentation } from '../../../client/src/games/GamePresentation';
import { CARD_EFFECT_DURATION_MS, cardEffectElapsed, cardPlayEffect } from '../../../client/src/games/card-play-effect';
import type { CardPlayEffectKind } from '../../../client/src/games/card-play-effect';
import { presentationMoment } from '../../../client/src/games/presentation-state';

vi.mock('../../../client/src/stores/account-store', () => ({
  useAccountStore: (select: (state: { account: null }) => unknown) => select({ account: null }),
}));

const card = (rank: Rank, suit: Suit = 'spades'): Card => ({ rank, suit });
const play = (cards: readonly Card[], extra: Partial<PresentationFrame> = {}): PresentationFrame => ({
  key: 'action:0', kind: 'play', durationMs: 1300, cards, seat: 'N', ...extra,
});

/** Minimal public snapshots keep tests independent of unrelated game setup and private state. */
function game(gameType: GameType, context: Record<string, unknown> = {}): PlayerVisibleGameState {
  return { gameType, log: [], contract: null, secretaryCard: null, seats: ['N', 'E', 'S', 'W'],
    ...context } as unknown as PlayerVisibleGameState;
}

function napoleon(tricks: number, players: number, played: NapoleonCard, secretaryCard: NapoleonCard | null = null): {
  state: PlayerVisibleGameState; frame: PresentationFrame;
} {
  const log = Array.from({ length: tricks }, (_, index) => ({ type: 'trick_end', trickIndex: index + 1 }));
  return {
    state: game('napoleon', { seats: ['N', 'E', 'S', 'W', 'P5', 'P6'].slice(0, players), secretaryCard,
      contract: { suit: 'hearts' },
      log: [...log, { type: 'play', seat: 'N', card: played }, { type: 'trick_end', trickIndex: tricks + 1 }],
      tricks: Array.from({ length: tricks + 1 }, () => ({})),
    }),
    frame: play([], { key: `action:${tricks}`, napoleonCards: [played] }),
  };
}

describe('special card triggers', () => {
  it('reserves Big Two effects for four of a kind and straight flushes', () => {
    const state = game('bigtwo');
    expect(cardPlayEffect(state, play([card(2)]))).toBeNull();
    expect(cardPlayEffect(state, play([card(2), card(2, 'hearts')]))).toBeNull();
    expect(cardPlayEffect(state, play([card(14)]))).toBeNull();
    const quad = (['spades', 'hearts', 'clubs', 'diamonds'] as const).map((suit) => card(2, suit));
    expect(cardPlayEffect(state, play([...quad, card(3)]))?.kind).toBe('bomb');
    const straight = [card(14), card(2), card(3), card(4), card(5)];
    expect(cardPlayEffect(state, play(straight))?.kind).toBe('straightFlush');
    expect(cardPlayEffect(state, play([card(14, 'hearts'), ...straight.slice(1)]))).toBeNull();
    expect(cardPlayEffect(state, play([card(2), card(2, 'hearts'), card(2, 'clubs'), card(14), card(14, 'hearts')]))).toBeNull();
  });

  it.each([[4, 10], [5, 7], [6, 5]])('uses the public trick prefix at the %i-player joker boundary', (players, boundary) => {
    for (const joker of ['big', 'small'] as const) {
      const before = napoleon(boundary - 1, players, { joker });
      expect(cardPlayEffect(before.state, before.frame)?.kind).toBe(joker === 'big' ? 'bigJoker' : 'smallJoker');
      const after = napoleon(boundary, players, { joker });
      expect(cardPlayEffect(after.state, after.frame)).toBeNull();
    }
  });

  it('keeps the secretary effect in the final tricks and suppresses ordinary trumps', () => {
    for (const secretary of [{ joker: 'small' } as const, card(2, 'hearts')]) {
      const { state, frame } = napoleon(12, 4, secretary, secretary);
      expect(cardPlayEffect(state, frame)?.kind).toBe('secretary');
    }
    const { state, frame } = napoleon(0, 4, card(3, 'hearts'));
    expect(cardPlayEffect(state, frame)).toBeNull();
    expect(cardPlayEffect(game('napoleon', { ...state, contract: { suit: 'nt' } }), frame)).toBeNull();
    expect(cardPlayEffect(state, { ...frame, key: 'invalid' })).toBeNull();
  });

  it.each([
    [card(13), null], [card(14), 'reset'], [card(4), null], [card(5), null], [card(11), null],
  ] as const)('recognizes Ninety-Nine %j as %s', (played, kind) => {
    expect(cardPlayEffect(game('ninetynine'), play([played], { direction: 'cw' }))?.kind ?? null).toBe(kind);
  });

  it('suppresses Ninety-Nine adjustments and ordinary aces', () => {
    const state = game('ninetynine');
    for (const rank of [10, 12] as const) for (const choice of ['plus', 'minus'] as const) {
      expect(cardPlayEffect(state, play([card(rank)], { choice, previousTotal: 7, total: 0 }))).toBeNull();
    }
    expect(cardPlayEffect(state, play([card(14, 'hearts')]))).toBeNull();
    expect(cardPlayEffect(state, play([card(9)]))).toBeNull();
  });

  it('suppresses Sevens openings and endpoints while keeping the existing slay frame', () => {
    for (const closeOnEnd of [false, true]) {
      const state = game('sevens', { options: { closeOnEnd } });
      expect(cardPlayEffect(state, play([card(7)]))).toBeNull();
      for (const rank of [13, 14] as const) {
        expect(cardPlayEffect(state, play([card(rank)]))).toBeNull();
      }
      expect(cardPlayEffect(state, play([card(6)]))).toBeNull();
    }
    expect(cardPlayEffect(game('sevens'), play([card(14)]))).toBeNull();
    const state = game('sevens', { phase: 'playing', options: { closeOnEnd: true },
      log: [{ type: 'play', seat: 'N', card: card(14), timestamp: 1000 }],
      presentation: { id: 'slay', startedAt: 1000, logStart: 0, timingVersion: 3 } });
    const frames = getPresentationFrames(state);
    expect(frames.map((frame) => frame.kind)).toEqual(['play', 'slay']);
    for (const frame of frames) expect(cardPlayEffect(state, frame)).toBeNull();
  });

  it('reserves Red Points feedback for captured red aces in either position', () => {
    const state = game('redpoints');
    for (const cards of [[card(14, 'hearts'), card(9)], [card(9), card(14, 'diamonds')]]) {
      expect(cardPlayEffect(state, play(cards, { kind: 'capture', flipped: true }))?.kind).toBe('redAce');
    }
    expect(cardPlayEffect(state, play([card(5), card(5, 'hearts')], { kind: 'capture' }))).toBeNull();
    expect(cardPlayEffect(state, play([card(13, 'hearts'), card(13, 'diamonds')], { kind: 'capture' }))).toBeNull();
    expect(cardPlayEffect(state, play([card(5), card(5, 'clubs')], { kind: 'capture' }))).toBeNull();
    expect(cardPlayEffect(state, play([card(14, 'hearts')]))).toBeNull();
  });

  it('gives Bridge aces and ruffs no decorative effect', () => {
    const state = game('bridge', { contract: { suit: 'hearts' }, playing: { currentTrick: {} }, log: [
      { type: 'play', seat: 'N', card: card(14, 'hearts') }, { type: 'trick_end' },
      { type: 'play', seat: 'N', card: card(3, 'clubs') },
      { type: 'play', seat: 'E', card: card(14, 'hearts') }, { type: 'trick_end' },
      { type: 'play', seat: 'E', card: card(2, 'hearts') },
    ] });
    const frame = play([card(14, 'hearts')], { key: 'action:3', seat: 'E' });
    expect(cardPlayEffect(state, frame)).toBeNull();
    expect(cardPlayEffect(game('bridge', { ...state, contract: { suit: 'nt' } }), frame)).toBeNull();
    const trumpLead = game('bridge', { contract: { suit: 'hearts' }, log: [
      { type: 'play', card: card(3, 'hearts') }, { type: 'play', card: card(5, 'hearts') },
    ] });
    expect(cardPlayEffect(trumpLead, play([card(3, 'hearts')]))).toBeNull();
    expect(cardPlayEffect(trumpLead, play([card(5, 'hearts')], { key: 'action:1' }))).toBeNull();
    expect(cardPlayEffect(trumpLead, play([card(14)]))).toBeNull();
  });

  it('never repeats effects on collection, notices or results, or consults private state', () => {
    const straightFlush = [card(10), card(11), card(12), card(13), card(14)];
    for (const kind of ['trick', 'round', 'finish', 'slay', 'summon', 'cover', 'pass'] as const) {
      expect(cardPlayEffect(game('bigtwo'), play(straightFlush, { kind }))).toBeNull();
    }
    const state = game('bigtwo');
    for (const key of ['myHand', 'validCards', 'observedHands', 'stock', 'discarded']) {
      Object.defineProperty(state, key, { get: () => { throw new Error(`Private access: ${key}`); } });
    }
    expect(cardPlayEffect(state, play(straightFlush))?.kind).toBe('straightFlush');
    expect(cardPlayEffect(game('holdem'), play([card(14)]))).toBeNull();
  });
});

describe('special card feedback timing and rendering', () => {
  it('resumes within the shared frame and skips expired effects', () => {
    expect(cardEffectElapsed(-10, 1300)).toBe(0);
    expect(cardEffectElapsed(650, 1300)).toBe(650);
    expect(cardEffectElapsed(CARD_EFFECT_DURATION_MS, 1300)).toBeNull();
    expect(cardEffectElapsed(400, 400)).toBeNull();
    const state = game('bigtwo', { phase: 'playing', log: [{ type: 'play', seat: 'N', cards: [card(2)] }],
      presentation: { id: 'action', logStart: 0, startedAt: 1000, serverNow: 1600, timingVersion: 3 } });
    const moment = presentationMoment(state, 5000, 5000);
    expect(moment.frame?.key).toBe('action:0');
    expect(5000 - moment.frameStartedAt).toBe(600);
    expect(presentationMoment(state, 5000, 5700).frame).toBeNull();
  });

  it('renders decoration and a static fallback with an elapsed delay', () => {
    const html = renderToStaticMarkup(createElement(CardPlayEffect, {
      effect: { kind: 'reset' }, elapsedMs: 650, durationMs: 1300, reducedMotion: true,
    }));
    expect(html).toContain('data-card-play-effect="reset"');
    expect(html).toContain('--effect-delay:-650ms');
    expect(html).toContain('still');
    expect(html).toContain('<ellipse');
    expect(html.replace(/<[^>]*>/g, '')).toBe('');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('<button');
    expect(renderToStaticMarkup(createElement(CardPlayEffect, {
      effect: { kind: 'straightFlush' }, elapsedMs: 1000, durationMs: 1300, reducedMotion: false,
    }))).toBe('');
  });

  it('keeps every animated and reduced-motion effect free of text', () => {
    const kinds: readonly CardPlayEffectKind[] = ['bomb', 'straightFlush', 'secretary', 'bigJoker', 'smallJoker', 'reset', 'redAce'];
    for (const kind of kinds) for (const reducedMotion of [false, true]) {
      const html = renderToStaticMarkup(createElement(CardPlayEffect, {
        effect: { kind }, elapsedMs: 0, durationMs: 1300, reducedMotion,
      }));
      expect(html).toContain(`data-card-play-effect="${kind}"`);
      expect(html.replace(/<[^>]*>/g, '')).toBe('');
    }
  });

  it('keeps Ninety-Nine game information without effect descriptions', () => {
    for (const played of [card(14), card(13), card(4), card(5), card(11)]) {
      const html = renderToStaticMarkup(createElement(GamePresentation, {
        frame: play([played], { total: 0, previousTotal: 35, direction: 'cw', target: 'E' }),
        bottomSeat: 'N', game: game('ninetynine'),
      }));
      expect(html).toContain('35');
      expect(html).toContain('→');
      expect(html).toContain('↻');
      expect(html).toContain('<strong>東</strong>');
      expect(html.includes('data-card-play-effect')).toBe(played.rank === 14);
      for (const label of ['大牌', '點數歸零', '點數變成', '反轉方向', '指定下一位', '點數不變']) {
        expect(html).not.toContain(label);
      }
    }
  });
});
