import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEMO_GAME_TYPES } from '../../client/src/game-demos';
import type { Locale } from '../../client/src/i18n';
import { demoVtt } from './subtitles';

const output = fileURLToPath(new URL('../../client/public/game-demos/', import.meta.url));
mkdirSync(output, { recursive: true });

for (const game of DEMO_GAME_TYPES) {
  for (const locale of ['zh-TW', 'en'] satisfies readonly Locale[]) {
    writeFileSync(`${output}${game}.${locale}.vtt`, demoVtt(game, locale));
  }
}
