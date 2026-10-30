import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GAME_TYPES } from '../../../shared/src/constants/game-rules';
import type { PlayerVisibleGameState } from '@shared/types';
import { DEMO_GAME_TYPES, DEMO_SCENES, demoChapters, isDemoGameType } from '../../../client/src/game-demos';
import { demoVideoFile } from '../../../client/src/game-demo-catalog';
import { gameDemoTranslations } from '../../../client/src/game-demo-i18n';
import { GameDemoPlayer, GameDemo } from '../../../client/src/components/GameDemo';
import storedFixtures from '../../../scripts/game-demos/fixtures.json';
import { expandDemoFixture } from '../../../scripts/game-demos/demo-fixture';
import type { ExpandedDemoFixture } from '../../../scripts/game-demos/demo-fixture';
import type { DemoFixture } from '../../../scripts/game-demos/demo-fixture-types';
import { generateBettingFixtures } from '../../../scripts/game-demos/betting-fixtures';
import { generateBoardFixtures } from '../../../scripts/game-demos/boards-fixtures';
import { generateCardsFixtures } from '../../../scripts/game-demos/cards-fixtures';
import type { DemoGameType } from '../../../client/src/game-demos';

const fixtures = { games: Object.fromEntries(DEMO_GAME_TYPES.map((game) => [game,
  expandDemoFixture(storedFixtures.games[game as keyof typeof storedFixtures.games] as unknown as DemoFixture),
])) as Record<DemoGameType, ExpandedDemoFixture> };

describe('beginner walkthroughs', () => {
  it('has a lesson for every mode and shows it only with an imported video, unloaded until opened', () => {
    expect([...DEMO_GAME_TYPES].sort()).toEqual([...GAME_TYPES].sort());
    expect(GAME_TYPES.every(isDemoGameType)).toBe(true);
    const html = renderToStaticMarkup(createElement(GameDemo, { gameType: 'bridge' }));
    if (demoVideoFile('bridge')) expect(html).toContain('<summary>');
    else expect(html).toBe('');
    expect(html).not.toContain('<video');
  });

  for (const game of DEMO_GAME_TYPES) {
    it(`${game}: includes an accessible player, chapters, subtitles, and transcript`, () => {
      const file = `${game}-${'a'.repeat(24)}.mp4`;
      const html = renderToStaticMarkup(createElement(GameDemoPlayer, { gameType: game, file }));
      expect(html).toContain('controls=""');
      expect(html).toContain('preload="none"');
      expect(html).not.toContain('autoPlay');
      expect(html).toContain(`/game-demos/${file}`);
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
    });

    it(`${game}: keeps both subtitle languages in step with the recorded copy`, () => {
      // Videos show the zh-TW copy, so optional rule and outcome cards must exist in both locales or neither.
      for (const scene of DEMO_SCENES[game]) {
        const [zh, en] = [gameDemoTranslations['zh-TW'][scene.text], gameDemoTranslations.en[scene.text]];
        expect([!!en.rule, !!en.outcome], scene.text).toEqual([!!zh.rule, !!zh.outcome]);
      }
    });

    it(`${game}: completes a legal fixed path without observer visibility`, () => {
      const fixture = fixtures.games[game];
      const snapshots = [fixture.initial, ...fixture.steps.map((step) => step.after)] as unknown as readonly PlayerVisibleGameState[];
      for (const snapshot of snapshots) {
        expect(snapshot.mySeat).toBe(fixture.focusSeat);
        expect(snapshot).not.toHaveProperty('observedHands');
        expect(snapshot).not.toHaveProperty('observedDice');
        expect(snapshot).not.toHaveProperty('observer');
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

  it('regenerates every new walkthrough through legal manager actions', () => {
    const generated = { ...generateBettingFixtures(), ...generateBoardFixtures(), ...generateCardsFixtures() };
    for (const [game, fixture] of Object.entries(generated)) {
      expect(fixture).toEqual(storedFixtures.games[game as keyof typeof storedFixtures.games]);
    }
  });

  it('does not expose secretary identity or opponents’ arrangements prematurely', () => {
    const napoleon = fixtures.games.napoleon;
    const beforeReveal = napoleon.steps.find((step) => step.index === 10)!.after;
    if (beforeReveal.gameType !== 'napoleon') throw new Error('Unexpected fixture.');
    expect(beforeReveal.secretarySeat).toBeNull();
    for (const step of fixtures.games.chinesepoker.steps.slice(0, -1)) {
      expect(step.after.result).toBeNull();
      if (step.actingSeat !== 'N') expect(step.action).toEqual({ type: 'arrange' });
    }
  });
});
