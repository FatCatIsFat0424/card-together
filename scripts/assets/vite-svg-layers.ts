import { readFile } from 'node:fs/promises';
import type { Plugin } from 'vite';
import { splitAnimatedSvg } from '../../client/src/cosmetics/art-layers/svg-layers.ts';
import type { ArtLayer, SplitSvg } from '../../client/src/cosmetics/art-layers/svg-layers.ts';

const QUERY = '?layers';

/** Minimal escaping keeps inlined SVG compressible; single quotes avoid escaping attribute quotes. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml,${svg.replace(/"/g, "'").replace(/[^\w\-.~!$&'()*+,;=:@/?]/gu, encodeURIComponent)}`;
}

function withUrls(layers: readonly ArtLayer[]): ArtLayer[] {
  return layers.map((layer) => 'image' in layer
    ? { ...layer, image: svgDataUrl(layer.image) }
    : { ...layer, layers: withUrls(layer.layers) });
}

/**
 * Serves `*.svg?layers` imports: the artwork split into composited layers whose images are data URLs,
 * or null when nothing in it animates. Unsupported artwork fails the build.
 */
export function svgLayersPlugin(): Plugin {
  return {
    name: 'card-together:svg-layers',
    enforce: 'pre',
    async load(id) {
      if (!id.endsWith(`.svg${QUERY}`)) return null;
      const file = id.slice(0, -QUERY.length);
      this.addWatchFile(file);
      let art: SplitSvg | null;
      try {
        art = splitAnimatedSvg(await readFile(file, 'utf8'));
      } catch (error) {
        throw new Error(`Cannot split ${file} into layers: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
      return `export default ${JSON.stringify(art && { ...art, layers: withUrls(art.layers) })};`;
    },
  };
}
