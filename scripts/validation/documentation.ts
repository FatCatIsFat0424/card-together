import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { collectFiles } from './selection';

export const DOCUMENTATION_ROOTS = ['AGENTS.md', 'CLAUDE.md', 'README.md', 'CHANGELOG.md', 'CONTRIBUTING.md',
  'docs', 'client/public', 'client/src/assets'];

export function documentationPaths(root: string): string[] {
  return collectFiles(root, DOCUMENTATION_ROOTS).filter((path) => path.endsWith('.md'));
}

/** Matches the anchors GitHub generates for Markdown headings (github-slugger). */
export function githubSlug(heading: string): string {
  const text = heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/`([^`]*)`/g, '$1');
  return text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');
}

export function headingAnchors(markdown: string): Set<string> {
  const anchors = new Set<string>();
  const counts = new Map<string, number>();
  let fence: string | undefined;
  for (const line of markdown.split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && (!fence || (marker[0] === fence[0] && marker.length >= fence.length))) {
      fence = fence ? undefined : marker;
      continue;
    }
    if (fence) continue;
    const heading = /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line)?.[1];
    if (heading === undefined) continue;
    const base = githubSlug(heading);
    const seen = counts.get(base) ?? 0;
    counts.set(base, seen + 1);
    anchors.add(seen ? `${base}-${seen}` : base);
  }
  return anchors;
}

export function documentationErrors(root: string, paths: readonly string[]): string[] {
  const errors: string[] = [];
  const anchors = new Map<string, Set<string>>();
  const anchorsOf = (path: string): Set<string> => {
    let found = anchors.get(path);
    if (!found) { found = headingAnchors(readFileSync(join(root, path), 'utf8')); anchors.set(path, found); }
    return found;
  };
  for (const path of paths) {
    const text = readFileSync(join(root, path), 'utf8');
    if (/^(?:<<<<<<< |>>>>>>> )/m.test(text) || /[\t ]+$/m.test(text)) errors.push(`Whitespace or conflict markers in ${path}`);
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const [target, fragment] = match[1].split('#', 2);
      if (/^(?:[a-z]+:|\/)/i.test(target)) continue;
      const linked = target ? relative(root, resolve(root, dirname(path), target)).split(sep).join('/') : path;
      if (target && !present(join(root, linked))) {
        errors.push(`${path}: missing link target ${match[1]}`); continue;
      }
      if (fragment === undefined || !linked.endsWith('.md')) continue;
      let anchor: string;
      try { anchor = decodeURIComponent(fragment); } catch { errors.push(`${path}: malformed anchor ${match[1]}`); continue; }
      if (!anchorsOf(linked).has(anchor)) errors.push(`${path}: missing heading anchor ${match[1]}`);
    }
  }
  return errors;
}

function present(path: string): boolean {
  try { lstatSync(path); return true; } catch { return false; }
}
