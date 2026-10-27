import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { planGates } from '../../../scripts/validation/check';
import { fontSizeErrors, fontSizeStylesheets, fontSizeViolations, literalFontSize } from '../../../scripts/validation/font-size';
import { parseOptions, selectChecks } from '../../../scripts/validation/selection';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

async function fixture(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'card-validation-font-size-'));
  directories.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

const declarations = (css: string): string[] => fontSizeViolations('a.css', css).map((violation) => violation.declaration);

describe('font size literals', () => {
  it.each([
    ['10px', 10], ['0.75rem', 12], ['0.7rem', 11.2], ['12px', 12], ['1.5rem', 24],
    ['clamp(0.6rem, 2vw, 1rem)', 9.6], ['clamp(14px, 1.8vw, 22px)', 14], ['min(11px, 3vw)', 11],
  ])('reads %s as %s px', (value, pixels) => {
    expect(literalFontSize(value)).toBeCloseTo(pixels, 5);
  });

  it.each(['inherit', '1em', '0.5em', '80%', 'var(--text-xs)', 'calc(var(--card-w) * 0.16)',
    'clamp(var(--text-xs), 2cqi, 1rem)', 'clamp(calc(1rem - 2px), 1vw, 2rem)', 'max(10px, 1vw)'])('does not judge %s', (value) => {
    expect(literalFontSize(value)).toBeUndefined();
  });

  it('should flag px and rem literals below 12px, including clamp minimums and the font shorthand', () => {
    expect(declarations([
      '.a { font-size: 10px; }',
      '.b { font-size: 0.7rem; }',
      '.c { font-size: clamp(0.6rem, 2vw, 1rem); }',
      '.d { font: 600 11px/1.2 Inter, sans-serif; }',
      '.e { font-size: 12px; font-size: 0.75rem; font-size: var(--text-xs); }',
      '.f { font: inherit; font-size: calc(var(--avatar) * 0.6); font-size: 0.8em; }',
    ].join('\n'))).toEqual([
      'font-size: 10px', 'font-size: 0.7rem', 'font-size: clamp(0.6rem, 2vw, 1rem)', 'font: 600 11px/1.2 Inter, sans-serif',
    ]);
  });

  it('should report the line of each declaration, including minified rules', () => {
    const violations = fontSizeViolations('a.css', '.a {\n  color: red;\n  font-size: 9px;\n}\n.b { font-size: 16px; font-size: 8px; }\n');
    expect(violations.map((violation) => violation.line)).toEqual([3, 5]);
  });

  it('should allow a single-glyph comment on the same or the previous line, and nothing else', () => {
    const css = [
      '/* single-glyph badge: one dealer letter in a 16px circle */',
      '.a { font-size: 11px; }',
      '.b { font-size: 11px; /* single-glyph check mark */ }',
      '/* small badge */',
      '.c { font-size: 11px; }',
      '/* single-glyph badge */',
      '',
      '.d { font-size: 11px; }',
    ].join('\n');
    expect(fontSizeViolations('a.css', css).map((violation) => violation.line)).toEqual([5, 8]);
  });

  it('should scan client stylesheets and name the file and line in each error', async () => {
    const root = await fixture({
      'client/src/pages/Page.module.css': '.a {\n  font-size: 10px;\n}\n',
      'client/src/styles/global.css': ':root { font-size: 16px; }\n',
      'client/src/pages/Page.tsx': 'const style = { fontSize: 10 };\n',
      'server/src/other.css': '.a { font-size: 8px; }\n',
    });
    expect(fontSizeStylesheets(root)).toEqual(['client/src/pages/Page.module.css', 'client/src/styles/global.css']);
    expect(fontSizeErrors(root)).toEqual([expect.stringContaining('client/src/pages/Page.module.css:2: font-size: 10px is below 12px')]);
  });

  it('should hold for this repository', () => {
    expect(fontSizeErrors(join(__dirname, '../../..'))).toEqual([]);
  });
});

describe('font size gate', () => {
  it('runs in full mode and when a focused change touches the client, not otherwise', async () => {
    const root = await fixture({ 'client/src/a.css': '.a { color: red; }\n', 'server/src/a.ts': 'export {};\n' });
    const ids = (args: string[]): string[] => {
      const options = parseOptions(args);
      return planGates(root, selectChecks(root, options), options).map((gate) => gate.id);
    };
    expect(ids(['full'])).toContain('font-size');
    expect(ids(['focused', '--files', 'client/src/a.css'])).toContain('font-size');
    expect(ids(['focused', '--files', 'server/src/a.ts'])).not.toContain('font-size');
  });
});
