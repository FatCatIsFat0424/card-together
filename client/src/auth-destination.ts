function ambiguousPath(path: string): boolean {
  return [...path].some((character) => character === '\\'
    || character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127);
}

/** Router state is untrusted: retain only local, unambiguous destinations after authentication. */
export function authDestination(state: unknown): string {
  if (!state || typeof state !== 'object' || !('from' in state) || typeof state.from !== 'string') return '/';
  const from = state.from;
  if (!from.startsWith('/') || from.startsWith('//') || ambiguousPath(from)) return '/';
  try {
    const decoded = decodeURIComponent(from.split(/[?#]/, 1)[0]);
    if (decoded.startsWith('//') || ambiguousPath(decoded)
      || decoded.split('/').some((part) => part === '.' || part === '..')) return '/';
    if (/^\/(?:login|register)(?:\/|$)/.test(decoded)) return '/';
    return from;
  } catch {
    return '/';
  }
}
