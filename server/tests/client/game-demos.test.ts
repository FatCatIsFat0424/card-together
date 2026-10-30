import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PlayerVisibleGameState } from '@shared/types';
import { DEMO_GAME_TYPES, DEMO_SCENES, demoChapters, hasGameDemo } from '../../../client/src/game-demos';
import { gameDemoTranslations } from '../../../client/src/game-demo-i18n';
import { GameDemoPlayer, GameDemo } from '../../../client/src/components/GameDemo';
import fixtures from '../../../scripts/game-demos/fixtures.json';

describe('beginner walkthroughs', () => {
  it('only offers the four approved courses and leaves closed videos unloaded', () => {
    expect(DEMO_GAME_TYPES).toEqual(['bridge', 'napoleon', 'chinesepoker', 'liarsdice']);
    expect(hasGameDemo('gomoku')).toBe(false);
    expect(renderToStaticMarkup(createElement(GameDemo, { gameType: 'gomoku' }))).toBe('');
    const html = renderToStaticMarkup(createElement(GameDemo, { gameType: 'bridge' }));
    expect(html).toContain('<summary>');
    expect(html).not.toContain('<video');
  });

  for (const game of DEMO_GAME_TYPES) {
    it(`${game}: includes an accessible player, chapters, subtitles, and transcript`, () => {
      const html = renderToStaticMarkup(createElement(GameDemoPlayer, { gameType: game }));
      expect(html).toContain('controls=""');
      expect(html).toContain('preload="none"');
      expect(html).not.toContain('autoPlay');
      expect(html).toContain(`${game}.mp4`);
      expect(html).toContain('srcLang="en"');
      expect(html).toContain('srcLang="zh-TW"');
      const chapters = demoChapters(game);
      expect(chapters[0].start).toBe(0);
      expect(chapters.at(-1)?.text).toMatch(/-end$/);
      for (const locale of ['zh-TW', 'en'] as const) {
        const subtitle = readFileSync(new URL(`../../../client/public/game-demos/${game}.${locale}.vtt`, import.meta.url), 'utf8');
        expect(subtitle).toMatch(/^WEBVTT\n/);
        for (const scene of DEMO_SCENES[game]) {
          expect(subtitle).toContain(gameDemoTranslations[locale][scene.text].caption);
        }
      }
      expect(existsSync(new URL(`../../../client/public/game-demos/${game}.mp4`, import.meta.url))).toBe(true);
    });

    it(`${game}: completes a legal fixed path without observer visibility`, () => {
      const fixture = fixtures.games[game];
      const snapshots = [fixture.initial, ...fixture.steps.map((step) => step.after)] as unknown as readonly PlayerVisibleGameState[];
      for (const snapshot of snapshots) {
        expect(snapshot.mySeat).toBe(fixture.focusSeat);
        expect(snapshot).not.toHaveProperty('observedHands');
        expect(snapshot).not.toHaveProperty('observedDice');
        expect(snapshot).not.toHaveProperty('hands');
      }
      expect(snapshots.at(-1)?.phase).toBe('scoring');
      expect(snapshots.at(-1)?.result).toEqual(fixture.result);
      expect(DEMO_SCENES[game].at(-1)?.step).toBe(fixture.steps.length);
      expect(fixture.steps.map((step) => step.index)).toEqual(fixture.steps.map((_, index) => index + 1));
      const shown = DEMO_SCENES[game].flatMap((scene) => scene.until
        ? Array.from({ length: scene.until - scene.step }, (_, index) => scene.step + index + 1) : []);
      expect(shown).toEqual(fixture.steps.map((step) => step.index));
    });
  }

  it('does not expose secretary identity or opponents’ arrangements prematurely', () => {
    const napoleon = fixtures.games.napoleon;
    const beforeReveal = napoleon.steps.find((step) => step.index === 10)!.after;
    expect(beforeReveal.secretarySeat).toBeNull();
    for (const step of fixtures.games.chinesepoker.steps.slice(0, -1)) {
      expect(step.after.result).toBeNull();
      if (step.actingSeat !== 'N') expect(step.action).toEqual({ type: 'arrange' });
    }
  });
});
