import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { splitAnimatedSvg } from '../../../client/src/cosmetics/art-layers/svg-layers';
import type { ArtLayer, ArtLayerGroup, ArtLayerImage, SplitSvg } from '../../../client/src/cosmetics/art-layers/svg-layers';
import { LayeredArt } from '../../../client/src/cosmetics/art-layers/LayeredArt';
import { CardBackArt, CardBackArtContext } from '../../../client/src/cosmetics/art-layers/CardBackArt';
import { layeredShopArt } from '../../../client/src/cosmetics/art-layers/shop-art-layers';
import { layeredSeriesEmblem } from '../../../client/src/cosmetics/art-layers/emblem-art-layers';
import { svgDataUrl } from '../../../scripts/assets/vite-svg-layers';
import { borderOrbitKeyframes } from '../../../client/src/cosmetics/seat-frames/border-orbit';

const STYLE = '<style>svg:target *{animation:none!important}'
  + '.orbit{transform-box:fill-box;transform-origin:center;animation:orbit 24s linear infinite}'
  + '.pulse{animation:pulse 3.6s ease-in-out infinite}.drift{animation:drift 7s ease-in-out infinite alternate}'
  + '@keyframes orbit{to{transform:rotate(360deg)}}@keyframes pulse{0%,100%{opacity:.45}50%{opacity:1}}'
  + '@keyframes drift{to{transform:translate(8px,-5px)}}'
  + '@media(prefers-reduced-motion:reduce){*{animation:none!important}}</style>';

function svg(body: string): string {
  return `<svg id="still" xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">${STYLE}${body}</svg>`;
}

function split(body: string): SplitSvg {
  const art = splitAnimatedSvg(svg(body));
  if (!art) throw new Error('Expected layers');
  return art;
}

function images(layers: readonly ArtLayer[]): ArtLayerImage[] {
  return layers.flatMap((layer) => 'image' in layer ? [layer] : images(layer.layers));
}

const SHOP = resolve(__dirname, '../../../client/src/assets/shop');

describe('animated SVG layer splitting', () => {
  it('keeps paint order: a static part sinks below animation only where it overlaps none', () => {
    const art = split('<rect width="200" height="100" fill="#123"/>'
      + '<circle class="pulse" cx="50" cy="50" r="10" fill="#f00"/>'
      + '<rect x="45" y="45" width="10" height="10" fill="#0f0"/>'
      + '<rect x="150" y="40" width="20" height="20" fill="#00f"/>');
    const layers = images(art.layers);
    expect(layers.map((layer) => layer.motions.length)).toEqual([0, 1, 0]);
    // The far square joins the background; the square over the pulse stays above it.
    expect(layers[0].image).toContain('x="150"');
    expect(layers[0].image).not.toContain('x="45"');
    expect(layers[2].image).toContain('x="45"');
    expect(layers[1].motions[0]).toMatchObject({ duration: 3600, direction: 'normal' });
    expect(layers[1].motions[0].keyframes.map((frame) => frame.opacity)).toEqual([0.45, 1, 0.45]);
    expect(layers[1].motions[0].keyframes.every((frame) => frame.easing === 'ease-in-out')).toBe(true);
  });

  it('moves animation out of the images and crops each layer to its content', () => {
    const art = split('<rect width="200" height="100" fill="#123"/>'
      + '<circle class="pulse" cx="50" cy="50" r="10" fill="#f00" opacity=".5"/>');
    const [background, pulse] = images(art.layers);
    expect(background.box).toEqual([0, 0, 100, 100]);
    for (const layer of [background, pulse]) {
      expect(layer.image).not.toMatch(/<style|class=|id="still"/);
    }
    // The animation replaces the element's own opacity, as CSS animations override the attribute.
    expect(pulse.image).not.toContain('opacity');
    // Moving layers span at least 30% of the artwork each way, centred on their content.
    const [left, top, width, height] = pulse.box;
    expect(width).toBe(30);
    expect(height).toBe(30);
    expect(left + width / 2).toBeCloseTo(25, 0);
    expect(top + height / 2).toBeCloseTo(50, 0);
    expect(pulse.image).toMatch(/viewBox="\d+ \d+ \d+ \d+"/);
  });

  it('converts rotation origins and translations through parent transforms', () => {
    const art = split('<rect width="200" height="100" fill="#123"/>'
      + '<g transform="translate(100 50) scale(2)"><g class="orbit" fill="none" stroke="#fff">'
      + '<circle r="20"/></g></g>'
      + '<g transform="translate(20 20) scale(2)"><g class="drift"><rect width="5" height="5" fill="#fff"/></g></g>');
    const [, orbit, drift] = images(art.layers);
    const [, , orbitWidth, orbitHeight] = orbit.box;
    expect(orbit.motions[0].origin).toBe('50% 50%');
    expect(orbit.motions[0].keyframes.map((frame) => frame.transform)).toEqual(['rotate(0deg)', 'rotate(360deg)']);
    expect(orbitWidth * 2).toBeCloseTo(orbitHeight, 0);
    // translate(8px, -5px) inside scale(2) moves 16 by -10 artwork units, relative to the cropped box.
    const boxWidth = drift.box[2] * 2;
    const boxHeight = drift.box[3];
    expect(drift.motions[0].keyframes.at(-1)?.transform)
      .toBe(`translate(${Math.round(16 / boxWidth * 1e6) / 1e4}%, ${Math.round(-10 / boxHeight * 1e6) / 1e4}%)`);
    expect(drift.motions[0].direction).toBe('alternate');
  });

  it('nests motions and keeps a translucent group whole where its parts overlap', () => {
    const nested = split('<rect width="200" height="100" fill="#123"/>'
      + '<g class="drift"><rect x="10" y="10" width="20" height="20" fill="#fff"/>'
      + '<circle class="pulse" cx="60" cy="20" r="5" fill="#f00"/></g>');
    expect(images(nested.layers).map((layer) => layer.motions.map((motion) => motion.duration)))
      .toEqual([[], [7000], [7000, 3600]]);
    const grouped = split('<rect width="200" height="100" fill="#123"/>'
      + '<g opacity=".6" fill="none" stroke="#fff"><circle cx="100" cy="50" r="30"/>'
      + '<path class="orbit" d="M100 50L70 30A36 36 0 0 1 136 50Z" fill="#fff"/></g>');
    const group = grouped.layers.find((layer): layer is ArtLayerGroup => 'opacity' in layer);
    expect(group?.opacity).toBe(0.6);
    // The group applies the opacity once to the composite, so its images drop the attribute.
    for (const layer of images(group!.layers)) expect(layer.image).not.toContain('opacity');
    expect(images(group!.layers).map((layer) => layer.motions.length)).toEqual([0, 1]);
  });

  it('returns null for still artwork and rejects markup it cannot reproduce', () => {
    expect(splitAnimatedSvg(svg('<rect width="200" height="100" fill="#123"/>'))).toBeNull();
    expect(() => split('<text class="pulse">A</text>')).toThrow(/Unsupported element <text>/);
    expect(() => split('<rect class="pulse" width="5" height="5" filter="url(#f)"/>')).toThrow(/Unsupported attribute filter/);
    expect(() => split('<g transform="scale(2 1)"><circle class="orbit" r="5"/></g>')).toThrow(/non-uniform/);
    expect(() => split('<circle class="pulse" r="5"/><circle class="unknown" r="2"/>')).toThrow(/\.unknown/);
  });

  it('splits every animated card back, table, and emblem within a bounded number of layers', () => {
    const counts = Object.fromEntries(readdirSync(SHOP)
      .filter((file) => /^(?:card-back|table)-.*\.svg$|^series-.*-emblem\.svg$/.test(file)).sort()
      .flatMap((file) => {
        const art = splitAnimatedSvg(readFileSync(resolve(SHOP, file), 'utf8'));
        return art ? [[file, images(art.layers).length]] : [];
      }));
    expect(counts).toEqual({
      'card-back-crownrealm.svg': 4,
      'card-back-ironfront.svg': 5,
      'card-back-neoncity.svg': 6,
      'card-back-shrine.svg': 4,
      'card-back-starfleet.svg': 6,
      'series-neoncity-emblem.svg': 2,
      'series-starfleet-emblem.svg': 2,
      'table-crownrealm.svg': 2,
      'table-ironfront.svg': 5,
      'table-neoncity.svg': 6,
      'table-shrine.svg': 4,
      'table-starfleet.svg': 4,
    });
    expect(layeredShopArt('card-back-starfleet')?.layers.length).toBe(6);
    expect(layeredShopArt('card-back-aurora')).toBeNull();
    expect(layeredSeriesEmblem('neoncity')).not.toBeNull();
    expect(layeredSeriesEmblem('shrine')).toBeNull();
  });

  it('inlines layer images as compact data URLs', () => {
    const url = svgDataUrl('<svg xmlns="http://www.w3.org/2000/svg"><path fill="url(#a)" d="M0 0h1"/><!-- 50% --></svg>');
    expect(url).toBe("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%3E%3Cpath%20fill='url(%23a)'%20d='M0%200h1'/%3E%3C!--%2050%25%20--%3E%3C/svg%3E");
    for (const layer of images(layeredShopArt('table-neoncity')!.layers)) expect(layer.image).toMatch(/^data:image\/svg\+xml,%3Csvg/);
  });
});

describe('layered artwork rendering', () => {
  const art = layeredShopArt('table-shrine')!;

  it('stacks one image per layer, wrapping outer motions around inner ones', () => {
    const html = renderToStaticMarkup(createElement(LayeredArt, { art, fit: 'cover' }));
    expect(html.match(/<img /g)).toHaveLength(images(art.layers).length);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(`--art-aspect:${art.width / art.height}`);
    // The lantern glow pulses inside its drifting lantern: a span carries the outer drift origin.
    expect(html).toMatch(/<span class="[^"]+" style="transform-origin:50% 50%;will-change:transform"><img /);
  });

  it('draws the viewer card back only inside a game that provides layered artwork', () => {
    expect(renderToStaticMarkup(createElement(CardBackArt))).toBe('');
    const back = layeredShopArt('card-back-neoncity')!;
    const html = renderToStaticMarkup(createElement(CardBackArtContext, { value: back }, createElement(CardBackArt)));
    expect(html.match(/<img /g)).toHaveLength(images(back.layers).length);
  });
});

describe('border orbit keyframes', () => {
  it('moves the mark centre clockwise around the rounded frame, turning with the edge', () => {
    const frames = borderOrbitKeyframes({ width: 100, height: 40, radius: 10 }, { width: 6, height: 2 }, 0, 1);
    expect(frames[0]).toMatchObject({ offset: 0, transform: 'translate(7px, -1px) rotate(0deg)' });
    expect(frames.at(-1)).toMatchObject({ offset: 1, transform: 'translate(7px, -1px) rotate(360deg)' });
    const right = frames.find((frame) => String(frame.transform).includes('rotate(90deg)'));
    expect(right?.transform).toBe('translate(97px, 9px) rotate(90deg)');
    expect(frames.every((frame, index) => index === 0 || Number(frame.offset) >= Number(frames[index - 1].offset))).toBe(true);
    const shifted = borderOrbitKeyframes({ width: 100, height: 40, radius: 10 }, { width: 6, height: 2 }, 0.5, 1.5);
    expect(shifted.at(-1)?.transform).toBe(shifted[0].transform?.toString().replace(/rotate\(([\d.]+)deg\)/, (_, angle) => `rotate(${Number(angle) + 360}deg)`));
  });
});
