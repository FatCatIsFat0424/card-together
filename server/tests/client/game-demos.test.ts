import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GAME_TYPES } from '../../../shared/src/constants/game-rules';
import type { PlayerVisibleGameState } from '@shared/types';
import { DEMO_GAME_TYPES, DEMO_RECORDINGS, DEMO_SCENES, isDemoGameType } from '../../../client/src/game-demos';
import { demoVideoFile } from '../../../client/src/game-demo-catalog';
import { gameDemoTranslations } from '../../../client/src/game-demo-i18n';
import { GameDemoPlayer, GameDemo, showSubtitles } from '../../../client/src/components/GameDemo';
import storedFixtures from '../../../scripts/game-demos/fixtures.json';
import { expandDemoFixture } from '../../../scripts/game-demos/demo-fixture';
import type { ExpandedDemoFixture } from '../../../scripts/game-demos/demo-fixture';
import type { DemoFixture } from '../../../scripts/game-demos/demo-fixture-types';
import { demoCues, demoVtt } from '../../../scripts/game-demos/subtitles';
import { generateBettingFixtures } from '../../../scripts/game-demos/betting-fixtures';
import { generateBoardFixtures } from '../../../scripts/game-demos/boards-fixtures';
import { generateCardsFixtures } from '../../../scripts/game-demos/cards-fixtures';
import { generateTrickFixtures } from '../../../scripts/game-demos/trick-fixtures';
import { generateDiceFixtures } from '../../../scripts/game-demos/dice-fixtures';
import type { DemoGameType } from '../../../client/src/game-demos';

const fixtures = { games: Object.fromEntries(DEMO_GAME_TYPES.map((game) => [game,
  expandDemoFixture(storedFixtures.games[game as keyof typeof storedFixtures.games] as unknown as DemoFixture),
])) as Record<DemoGameType, ExpandedDemoFixture> };

/** Widest subtitle line: full-width characters count double, so 44 fits 22 Chinese characters. */
const MAX_LINE_WIDTH = { 'zh-TW': 44, en: 52 } as const;

function lineWidth(line: string): number {
  return [...line].reduce((width, character) => width + (/[⺀-￯]/u.test(character) ? 2 : 1), 0);
}

describe('beginner walkthroughs', () => {
  it('covers every mode', () => {
    expect(DEMO_GAME_TYPES.every((game) => GAME_TYPES.includes(game))).toBe(true);
    expect(GAME_TYPES.filter((game) => !isDemoGameType(game))).toEqual([]);
    expect(Object.keys(DEMO_RECORDINGS).sort()).toEqual([...DEMO_GAME_TYPES].sort());
  });

  it('shows a lesson only with an imported video, unloaded until opened', () => {
    for (const game of GAME_TYPES.filter((candidate) => !isDemoGameType(candidate))) {
      expect(renderToStaticMarkup(createElement(GameDemo, { gameType: game }))).toBe('');
    }
    for (const game of DEMO_GAME_TYPES) {
      const html = renderToStaticMarkup(createElement(GameDemo, { gameType: game }));
      if (demoVideoFile(game)) expect(html).toContain('<summary>');
      else expect(html).toBe('');
      expect(html).not.toContain('<video');
    }
  });

  it('shows only the subtitles of the interface language', () => {
    const tracks = [{ language: 'zh-TW', mode: 'disabled' }, { language: 'en', mode: 'disabled' }] as Pick<TextTrack, 'language' | 'mode'>[];
    showSubtitles(tracks, 'en');
    expect(tracks.map((track) => track.mode)).toEqual(['hidden', 'showing']);
    showSubtitles(tracks, 'zh-TW');
    expect(tracks.map((track) => track.mode)).toEqual(['showing', 'hidden']);
  });

  for (const game of DEMO_GAME_TYPES) {
    it(`${game}: plays the video with subtitles in both languages and nothing else`, () => {
      const file = `${game}-${'a'.repeat(24)}.mp4`;
      const html = renderToStaticMarkup(createElement(GameDemoPlayer, { gameType: game, file }));
      expect(html).toContain('controls=""');
      expect(html).toContain('preload="none"');
      expect(html).not.toContain('autoPlay');
      expect(html).toContain(`/game-demos/${file}`);
      // Static rendering uses the default interface language.
      expect(html).toMatch(/srcLang="zh-TW" label="[^"]+" default=""/);
      expect(html).toContain('srcLang="en"');
      expect(html.match(/default=""/g)).toHaveLength(1);
      expect(html).not.toMatch(/<(?:ol|details|button)\b/);
      for (const locale of ['zh-TW', 'en'] as const) {
        const subtitle = readFileSync(new URL(`../../../client/public/game-demos/${game}.${locale}.vtt`, import.meta.url), 'utf8');
        expect(subtitle, 'run scripts/game-demos/write-subtitles.ts').toBe(demoVtt(game, locale));
      }
    });

    it(`${game}: times subtitles against the recording`, () => {
      const scenes = DEMO_SCENES[game];
      const recording = DEMO_RECORDINGS[game];
      const total = scenes.reduce((sum, scene) => sum + scene.seconds, 0);
      if (recording.starts) {
        expect(recording.starts).toHaveLength(scenes.length);
        expect(recording.starts[0]).toBe(recording.leadIn);
        expect(Math.abs(recording.duration - recording.leadIn - total)).toBeLessThan(5);
      } else expect(recording.duration, 'placeholder: lead-in plus course length').toBe(recording.leadIn + total);
      for (const locale of ['zh-TW', 'en'] as const) {
        const cues = demoCues(game, locale);
        expect(cues[0].start).toBe(0);
        expect(cues.at(-1)?.end).toBe(recording.duration);
        for (const [index, cue] of cues.entries()) {
          expect(cue.end).toBeGreaterThan(cue.start);
          if (index > 0) expect(cue.start).toBe(cues[index - 1].end);
        }
      }
      for (const scene of scenes) {
        const [zh, en] = [gameDemoTranslations['zh-TW'][scene.text], gameDemoTranslations.en[scene.text]];
        expect(typeof en, scene.text).toBe(typeof zh);
        if (scene.split !== undefined) {
          expect(typeof zh, `${scene.text} splits a single cue`).not.toBe('string');
          expect(scene.split).toBeGreaterThan(0);
          expect(scene.split).toBeLessThan(scene.seconds);
        }
      }
    });

    it(`${game}: fits the short format`, () => {
      const total = DEMO_SCENES[game].reduce((sum, scene) => sum + scene.seconds, 0);
      expect(total).toBeGreaterThanOrEqual(60);
      expect(total).toBeLessThanOrEqual(90);
      for (const locale of ['zh-TW', 'en'] as const) {
        for (const scene of DEMO_SCENES[game]) {
          const text = gameDemoTranslations[locale][scene.text];
          for (const cue of typeof text === 'string' ? [text] : text) {
            const lines = cue.split('\n');
            expect(lines.length, cue).toBeLessThanOrEqual(2);
            for (const line of lines) expect(lineWidth(line), line).toBeLessThanOrEqual(MAX_LINE_WIDTH[locale]);
          }
        }
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
    const generated = { ...generateBettingFixtures(), ...generateBoardFixtures(), ...generateCardsFixtures(), ...generateTrickFixtures() };
    for (const [game, fixture] of Object.entries(generated)) {
      expect(fixture).toEqual(storedFixtures.games[game as keyof typeof storedFixtures.games]);
    }
  });

  it('regenerates the yacht, dominoes and code breaker walkthroughs through legal manager actions', () => {
    for (const [game, fixture] of Object.entries(generateDiceFixtures())) {
      expect(fixture).toEqual(storedFixtures.games[game as keyof typeof storedFixtures.games]);
    }
  });

  it('records Hearts passing without exposing other players’ selections', () => {
    for (const step of fixtures.games.hearts.steps) {
      if (step.actingSeat === fixtures.games.hearts.focusSeat || !step.action || typeof step.action !== 'object') continue;
      if ('type' in step.action && step.action.type === 'pass') expect(step.action).toEqual({ type: 'pass' });
      expect(step.after).not.toHaveProperty('deals');
    }
  });

  it('keeps the code and the other player’s guesses private until the code breaker match ends', () => {
    const codebreaker = fixtures.games.codebreaker;
    for (const step of codebreaker.steps.slice(0, -1)) {
      if (step.after.gameType !== 'codebreaker') throw new Error('Unexpected fixture.');
      expect(step.after.secret).toBeNull();
      expect(Object.keys(step.after.histories)).toEqual(['N']);
    }
    for (const step of codebreaker.steps) if (step.actingSeat !== 'N') expect(step.action).toEqual({ type: 'guess' });
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
