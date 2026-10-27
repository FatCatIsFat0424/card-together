import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectFiles } from './selection';

/** Smallest literal text size the interface allows; smaller text is unreadable on phones. */
export const MINIMUM_FONT_SIZE_PX = 12;

/** A comment containing this phrase on the declaration's line or the line above allows a smaller literal. */
export const EXEMPTION_PHRASE = 'single-glyph';

const ROOT_FONT_SIZE_PX = 16;
const LENGTH = /(-?\d*\.?\d+)(px|rem)\b/g;

export function fontSizeStylesheets(root: string): string[] {
  return collectFiles(root, ['client/src']).filter((path) => path.endsWith('.css'));
}

function toPixels(value: string): number[] {
  return [...value.matchAll(LENGTH)].map((match) => Number(match[1]) * (match[2] === 'rem' ? ROOT_FONT_SIZE_PX : 1));
}

/**
 * Smallest literal size a declaration value can resolve to, or undefined when it is not statically known.
 * Only `px` and `rem` literals count; `em`, percentages, `var()` and `calc()` depend on context and are skipped.
 * `clamp()` is judged by its minimum and `min()` by every argument, because either can pick the smallest.
 */
export function literalFontSize(value: string): number | undefined {
  const text = value.trim().replace(/\s*!important$/, '');
  if (/^(?:clamp|min)\(/.test(text)) {
    const first = /^clamp\(/.test(text) ? text.slice(6).split(',')[0] : text.slice(4);
    if (/(?:var|calc)\(/.test(first)) return undefined;
    const sizes = toPixels(first);
    return sizes.length ? Math.min(...sizes) : undefined;
  }
  if (/^-?\d*\.?\d+(?:px|rem)$/.test(text)) return toPixels(text)[0];
  return undefined;
}

/** Size token of a `font` shorthand such as `600 10px/1.2 Inter`; `inherit` and keywords have none. */
function shorthandSize(value: string): string | undefined {
  return /(?:^|\s)(-?\d*\.?\d+(?:px|rem))(?:\/|\s|$)/.exec(value.trim())?.[1];
}

export interface FontSizeViolation {
  readonly path: string;
  readonly line: number;
  readonly declaration: string;
}

export function fontSizeViolations(path: string, css: string): FontSizeViolation[] {
  const lines = css.split('\n');
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) { lineStarts.push(offset); offset += line.length + 1; }
  const lineOf = (index: number): number => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (lineStarts[middle] <= index) low = middle; else high = middle - 1;
    }
    return low;
  };
  const exemption = new RegExp(`/\\*[^*]*${EXEMPTION_PHRASE}[^*]*\\*/`);
  const exempt = (line: number): boolean => [lines[line], lines[line - 1]]
    .some((text) => text !== undefined && exemption.test(text));
  const violations: FontSizeViolation[] = [];
  for (const match of css.matchAll(/(?<![\w-])(font-size|font)\s*:\s*([^;{}]+)/g)) {
    const property = match[1];
    const value = property === 'font' ? shorthandSize(match[2]) : match[2];
    if (value === undefined) continue;
    const size = literalFontSize(value);
    if (size === undefined || size >= MINIMUM_FONT_SIZE_PX) continue;
    const line = lineOf(match.index ?? 0);
    if (exempt(line)) continue;
    violations.push({ path, line: line + 1, declaration: `${property}: ${match[2].trim()}` });
  }
  return violations;
}

export function fontSizeErrors(root: string, paths: readonly string[] = fontSizeStylesheets(root)): string[] {
  return paths.flatMap((path) => fontSizeViolations(path, readFileSync(join(root, path), 'utf8')))
    .map(({ path, line, declaration }) =>
      `${path}:${line}: ${declaration} is below ${MINIMUM_FONT_SIZE_PX}px; use a larger size or mark a ${EXEMPTION_PHRASE} badge with a comment`);
}
