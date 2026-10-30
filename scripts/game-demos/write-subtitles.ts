import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEMO_GAME_TYPES, DEMO_RECORDINGS, DEMO_SCENES } from '../../client/src/game-demos';
import { gameDemoTranslations } from '../../client/src/game-demo-i18n';
import type { Locale } from '../../client/src/i18n';

const output = fileURLToPath(new URL('../../client/public/game-demos/', import.meta.url));
mkdirSync(output, { recursive: true });

function timestamp(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${String(Math.floor(whole / 3600)).padStart(2, '0')}:${String(Math.floor(whole / 60) % 60).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}.${String(Math.round((seconds - whole) * 1000)).padStart(3, '0')}`;
}

for (const game of DEMO_GAME_TYPES) {
  for (const locale of ['zh-TW', 'en'] satisfies readonly Locale[]) {
    let elapsed = DEMO_RECORDINGS[game].leadIn;
    const cues: string[] = [];
    for (const [index, scene] of DEMO_SCENES[game].entries()) {
      const copy = gameDemoTranslations[locale][scene.text];
      const start = index === 0 ? 0 : elapsed;
      const end = index === DEMO_SCENES[game].length - 1 ? DEMO_RECORDINGS[game].duration : elapsed + scene.seconds;
      if (copy.outcome && scene.until) {
        const interval = (scene.seconds - 3.5) / (scene.until - scene.step);
        const reveal = elapsed + 3.5 + (scene.until - scene.step - 1) * interval;
        const revealEnd = reveal + Math.min(7, interval * .7);
        cues.push(`${timestamp(start)} --> ${timestamp(reveal)}\n${copy.title}\n${copy.caption}`);
        cues.push(`${timestamp(reveal)} --> ${timestamp(copy.rule ? revealEnd : end)}\n${copy.outcome}`);
        if (copy.rule) cues.push(`${timestamp(revealEnd)} --> ${timestamp(end)}\n${copy.rule}`);
        elapsed = end;
        continue;
      }
      const middle = copy.rule ? elapsed + scene.seconds * .55 : end;
      cues.push(`${timestamp(start)} --> ${timestamp(middle)}\n${copy.title}\n${copy.caption}`);
      if (copy.rule) cues.push(`${timestamp(middle)} --> ${timestamp(end)}\n${copy.rule}`);
      elapsed = end;
    }
    writeFileSync(`${output}${game}.${locale}.vtt`, `WEBVTT\n\n${cues.join('\n\n')}\n`);
  }
}
