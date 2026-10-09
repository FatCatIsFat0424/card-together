/** Case-insensitive name filter; a blank query keeps every entry. */
export function filterEmojis<T extends { readonly name: string }>(emojis: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  return needle ? emojis.filter((emoji) => emoji.name.toLowerCase().includes(needle)) : [...emojis];
}

/**
 * Toggles `id`. With `range` and a visible `anchor`, every ID from the anchor to `id` in
 * `orderedIds` takes the toggled state, like shift-click in file managers.
 */
export function selectWithRange(
  selected: ReadonlySet<string>,
  orderedIds: readonly string[],
  id: string,
  anchor: string | null,
  range: boolean,
): Set<string> {
  const next = new Set(selected);
  const select = !selected.has(id);
  const end = orderedIds.indexOf(id);
  const start = range && anchor !== null ? orderedIds.indexOf(anchor) : -1;
  const ids = start === -1 || end === -1
    ? [id] : orderedIds.slice(Math.min(start, end), Math.max(start, end) + 1);
  for (const each of ids) {
    if (select) next.add(each);
    else next.delete(each);
  }
  return next;
}
