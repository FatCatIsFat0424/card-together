import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dialogPaperClass, dialogParts } from '../../../client/src/styles/dialog';

const CLIENT = join(__dirname, '../../../client/src');
const read = (path: string): string => readFileSync(join(CLIENT, path), 'utf8');

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

describe('dialog sizing', () => {
  it('builds the paper class from the size and the dialog\'s own classes', () => {
    const wide = dialogPaperClass('wide', 'own', false, undefined);
    expect(wide.split(' ')).toHaveLength(3);
    expect(wide).toContain('own');
    expect(dialogPaperClass('narrow')).not.toBe(dialogPaperClass('medium'));
    expect(dialogPaperClass('medium')).not.toMatch(/false|undefined/);
    expect(new Set(Object.values(dialogParts)).size).toBe(3);
  });

  it('caps every dialog to the screen minus an equal inset and scrolls only the body', () => {
    const css = read('styles/dialog.module.css');
    expect(css).toContain('max-height: calc(100dvh - 2 * var(--dialog-inset))');
    expect(css).toContain('max-width: calc(100vw - 2 * var(--dialog-inset))');
    expect(css).toContain('margin: var(--dialog-inset)');
    expect(css).toMatch(/\.body(\.body)+ \{[^}]*overflow-y: auto/);
    expect(css).toMatch(/\.header\.header \{[^}]*flex: none/);
    expect(css).toMatch(/\.footer \{[^}]*flex: none/);
  });

  it('uses a 16px inset, tightened to 12px on phones and short landscape', () => {
    const global = read('styles/global.css');
    expect(global).toMatch(/:root \{[^}]*--dialog-inset: 16px/s);
    expect(global.match(/--dialog-inset: 12px/g)?.length).toBeGreaterThanOrEqual(2);
    expect(global).toMatch(/\.MuiDialog-paper:not\(\.MuiDialog-paperFullScreen\) \{[^}]*max-height: calc\(100dvh/);
  });

  it('applies the shared classes to every centered dialog outside the game table', () => {
    const missing = sources(CLIENT).filter((path) => !path.startsWith(`${join(CLIENT, 'games')}/`))
      .filter((path) => /<Dialog\b(?![^>]*\bfullScreen\b)/.test(readFileSync(path, 'utf8').replace(/\s+/g, ' ')))
      .filter((path) => !readFileSync(path, 'utf8').includes('dialogPaperClass'))
      .map((path) => relative(CLIENT, path));
    expect(missing).toEqual([]);
  });
});
