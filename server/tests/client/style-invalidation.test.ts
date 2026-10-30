import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const CLIENT = join(__dirname, '../../../client/src');

function stylesheets(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return stylesheets(path);
    return path.endsWith('.css') ? [path] : [];
  });
}

/** Selectors of a stylesheet, without comments and declaration blocks; at-rule preludes come along harmlessly. */
function selectors(css: string): string[] {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').split(/\{[^{}]*\}/).flatMap((chunk) => chunk.split('{'))
    .map((selector) => selector.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** Splits a selector list at its top-level commas, leaving `:is(a, b)` and `:not(a, b)` whole. */
function complexSelectors(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < list.length; index += 1) {
    if (list[index] === '(') depth += 1;
    else if (list[index] === ')') depth -= 1;
    else if (list[index] === ',' && depth === 0) {
      parts.push(list.slice(start, index));
      start = index + 1;
    }
  }
  return [...parts, list.slice(start)].map((part) => part.trim());
}

const STRUCTURAL = /:(?:first-child|last-child|only-child|nth-child|nth-last-child|first-of-type|last-of-type|only-of-type|nth-of-type|nth-last-of-type|empty)\b/;

describe('style invalidation', () => {
  it('never pairs :has() with a structural pseudo-class, which restyles the whole page on every DOM change', () => {
    const offenders = stylesheets(CLIENT).flatMap((path) => selectors(readFileSync(path, 'utf8'))
      .flatMap(complexSelectors)
      .filter((selector) => selector.includes(':has(') && STRUCTURAL.test(selector))
      .map((selector) => `${relative(CLIENT, path)}: ${selector}`));
    expect(offenders).toEqual([]);
  });
});
