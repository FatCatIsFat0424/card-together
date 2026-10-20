import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { cardFaceUrl, napoleonJokerFaceUrls } from '../../../client/src/cosmetics/card-faces/card-faces';
import { deckTheme } from '../../../client/src/cosmetics/card-faces/deck-themes';
import { SeatFrame } from '../../../client/src/cosmetics/seat-frames/SeatFrame';
import { ChipDisc } from '../../../client/src/cosmetics/chip-styles/ChipDisc';
import { ChatFrame } from '../../../client/src/cosmetics/chat-frames/ChatFrame';
import { VICTORY_DESIGNS } from '../../../client/src/cosmetics/victory-effects/victory-designs';
import { seededRandom } from '../../../client/src/cosmetics/victory-effects/victory-particles';
import { victoryPlays } from '../../../client/src/cosmetics/victory-effects/victory-schedule';
import { SOUND_PACK_DEFINITIONS } from '../../../client/src/cosmetics/sound-packs/sound-packs';
import { cueDuration } from '../../../client/src/audio/sound-pack';

const SERIES = ['starfleet', 'shrine', 'ironfront', 'neoncity', 'crownrealm'] as const;

function luminance(hex: string): number {
  const [r, g, b] = hex.slice(1).match(/../g)!.map((part) => {
    const value = parseInt(part, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const light = luminance(a), dark = luminance(b);
  return (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
}

function drawingContext(): { context: CanvasRenderingContext2D; operations: ReturnType<typeof vi.fn>[] } {
  const methods = {
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    arc: vi.fn(), ellipse: vi.fn(), translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(), bezierCurveTo: vi.fn(),
  };
  return { context: methods as unknown as CanvasRenderingContext2D, operations: Object.values(methods) };
}

describe.each(SERIES)('%s campaign cosmetics', (series) => {
  it('keeps contrasting indices and the traditional number of pips', () => {
    const theme = deckTheme(series);
    for (const ink of [theme.ink.red, theme.ink.black]) {
      for (const stock of [...theme.stock, theme.medallion]) expect(contrast(ink, stock)).toBeGreaterThan(4.5);
    }
    for (const rank of [2, 5, 10] as const) {
      const url = cardFaceUrl({ rank, suit: 'hearts' }, `card-face-${series}`);
      const svg = decodeURIComponent(url.split(',')[1]);
      expect(svg.match(/<use href="#suit"/g)).toHaveLength(rank + 2);
      expect(svg).toContain(`fill="${theme.ink.red}" font-family=`);
    }
    for (const rank of [11, 12, 13] as const) {
      const svg = decodeURIComponent(cardFaceUrl({ rank, suit: 'spades' }, `card-face-${series}`).split(',')[1]);
      expect(svg).toContain(theme.courtCrest);
      expect(svg).toContain(`>${{ 11: 'J', 12: 'Q', 13: 'K' }[rank]}</text>`);
    }
    const jokers = napoleonJokerFaceUrls(`card-face-${series}`)!;
    expect(jokers.small).not.toBe(jokers.big);
    expect(decodeURIComponent(jokers.small)).toContain('feColorMatrix type="saturate" values="0"');
  });

  it('keeps message content, links and focusable controls separate from decoration', () => {
    const body = createElement('a', { href: '#message' }, 'Readable message');
    const html = renderToStaticMarkup(createElement(ChatFrame, { id: `chat-frame-${series}`, children: body }));
    expect(html).toContain('<a href="#message">Readable message</a>');
    expect(html).toMatch(/<div class="[^"]*content[^"]*"><a/);
    expect(html.match(/<svg/g)).toHaveLength(2);
    expect(html.match(/focusable="false"/g)).toHaveLength(2);
    expect(html.replace(/<svg.*?<\/svg>/g, '').replace(/<[^>]+>/g, '')).toBe('Readable message');
    const seat = renderToStaticMarkup(createElement(SeatFrame, { frame: `seat-frame-${series}`, turn: true }));
    expect(seat.match(/_corner_/g)).toHaveLength(4);
    expect(seat).toContain('data-turn="true"');
    const chip = renderToStaticMarkup(createElement(ChipDisc, { style: `chips-${series}` }));
    expect(chip).not.toMatch(/\sid="|url\(#|<animate/);
    expect(chip).toContain('focusable="false"');
    // Moving emblem parts are separate images so the browser can animate them without repainting the chip.
    expect(chip.match(/<svg/g)!.length).toBeGreaterThan(1);
    expect(chip).toMatch(/<span class="[^"]*_part_[^"]*_(?:warp|engine|foxfire|propeller|processor|crown)_/);
  });

  it('registers the effect for an equipped winning player', () => {
    expect(victoryPlays(['N'], () => ({ id: 'winner', username: 'winner', nickname: 'Winner', color: '#123456',
      avatar: 'cat', avatarImage: null, victoryEffect: `victory-${series}` })))
      .toEqual([{ seat: 'N', effect: `victory-${series}`, series }]);
  });

  it('simulates and draws bounded moving and static effects without invalid geometry', () => {
    const design = VICTORY_DESIGNS[series];
    for (const density of [0, 0.3, 1, 100, Number.NaN]) {
      const particles = design.spawn(seededRandom(series), density);
      expect(particles.length).toBeGreaterThan(0);
      expect(particles.length).toBeLessThanOrEqual(40);
      expect(new Set(particles.map((item) => item.kind)).size).toBeGreaterThanOrEqual(2);
      const { context, operations } = drawingContext();
      for (let frame = 0; frame < 180; frame++) {
        for (const item of particles) {
          const age = frame / 60 - item.delay;
          if (age < 0 || age >= item.life) continue;
          design.step(item, 1 / 60);
          if (frame % 30 === 0) design.draw(context, item, 0.8, age);
          expect(Math.abs(item.x)).toBeLessThan(600);
          expect(Math.abs(item.y)).toBeLessThan(600);
          expect(item.trail?.length ?? 0).toBeLessThanOrEqual(32);
          for (const value of Object.values(item)) if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
        }
      }
      const still = design.wreath();
      const before = structuredClone(still);
      expect(still.length).toBeLessThanOrEqual(12);
      still.forEach((item) => design.draw(context, item, 1, item.life));
      expect(still).toEqual(before);
      for (const operation of operations) {
        for (const args of operation.mock.calls) {
          for (const value of args) if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
        }
      }
      expect(operations.some((operation) => operation.mock.calls.length > 0)).toBe(true);
    }
  });

  it('follows short and long slash timelines without audio spilling past the impact tail', () => {
    const pack = SOUND_PACK_DEFINITIONS[`sound-${series}`];
    for (const timing of [
      { fireStart: 0.1, fireEnd: 0.7, strike: 0.7, cut: 0.08 },
      { fireStart: 0.5, fireEnd: 2.4, strike: 2.4, cut: 0.2 },
    ]) {
      const sounds = pack.slash(timing);
      expect(sounds.length).toBeLessThanOrEqual(48);
      expect(sounds.every((voice) => voice.at >= timing.fireStart)).toBe(true);
      expect(cueDuration(sounds)).toBeLessThanOrEqual(timing.strike + timing.cut + 1);
      expect(sounds.some((voice) => voice.at === timing.strike + timing.cut)).toBe(true);
    }
  });
});

it('uses five different synthesis topologies and court emblems', () => {
  const topologies = SERIES.map((series) => {
    const tones = SOUND_PACK_DEFINITIONS[`sound-${series}`].turn.filter((voice) => voice.kind === 'tone');
    return tones.map((voice) => ({ wave: voice.wave, glide: voice.glide,
      partial: voice.frequency / tones[0].frequency, filter: voice.filter, attack: voice.attack }));
  });
  expect(new Set(topologies.map((topology) => JSON.stringify(topology))).size).toBe(5);
  expect(new Set(SERIES.map((series) => deckTheme(series).courtCrest)).size).toBe(5);
});
