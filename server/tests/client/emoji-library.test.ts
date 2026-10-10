import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EmojiRecord } from '@shared/types';

// The real modules read window.location at import time for API URLs.
vi.mock('../../../client/src/media', () => ({
  mediaUrl: (id: string): string => `/api/media/${id}`,
  uploadImage: vi.fn(),
}));
vi.mock('../../../client/src/api', () => ({ apiRequest: vi.fn() }));
// Zustand renders its initial state on the server, so the library state comes from a stub.
const library = vi.hoisted(() => ({ emojis: [] as EmojiRecord[] }));
vi.mock('../../../client/src/stores/emoji-store', () => {
  const state = (): object => ({ emojis: library.emojis, load: async () => {}, setEmojis: () => {} });
  return { useEmojiStore: Object.assign((select: (value: object) => unknown) => select(state()), { getState: state }) };
});

import { EmojiGrid, EmojiLibrary, EmojiSelectionBar } from '../../../client/src/components/EmojiLibrary';
import { filesFromDataTransfer } from '../../../client/src/dropped-files';
import { filterEmojis, selectWithRange } from '../../../client/src/emoji-selection';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

const MEDIA = `${'a'.repeat(64)}.png`;
const EMOJIS: EmojiRecord[] = ['wave', 'Wave-2', 'cat.v2'].map((name, index) => ({
  id: `id-${index}`, accountId: 'alice', name, mediaId: MEDIA, createdAt: index,
}));
const IDS = ['a', 'b', 'c', 'd', 'e'];

function grid(selecting: boolean, selected: string[] = []): string {
  return renderToStaticMarkup(createElement(EmojiGrid, {
    emojis: EMOJIS, selecting, selected: new Set(selected), editing: null, busy: false,
    onEdit: vi.fn(), onRename: vi.fn(), onRemove: vi.fn(), onToggle: vi.fn(),
  }));
}

function bar(selectedCount: number, confirming = false): string {
  return renderToStaticMarkup(createElement(EmojiSelectionBar, {
    selectedCount, visibleCount: 3, confirming, busy: false, onSelectAll: vi.fn(), onClear: vi.fn(),
    onDelete: vi.fn(), onConfirm: vi.fn(), onCancel: vi.fn(),
  }));
}

function fileEntry(name: string): FileSystemFileEntry {
  return {
    isFile: true, isDirectory: false, name,
    file: (resolve: (file: File) => void) => resolve(new File(['x'], name, { type: 'image/png' })),
  } as unknown as FileSystemFileEntry;
}

function folderEntry(name: string, batches: FileSystemEntry[][]): FileSystemDirectoryEntry {
  return {
    isFile: false, isDirectory: true, name,
    createReader: () => {
      const pending = [...batches, []];
      return { readEntries: (resolve: (entries: FileSystemEntry[]) => void) => resolve(pending.shift() ?? []) };
    },
  } as unknown as FileSystemDirectoryEntry;
}

function transfer(entries: (FileSystemEntry | null)[], files: File[] = []): DataTransfer {
  return {
    items: entries.map((entry) => ({ kind: 'file', webkitGetAsEntry: () => entry })),
    files,
  } as unknown as DataTransfer;
}

afterEach(() => {
  useI18nStore.setState({ locale: 'zh-TW' });
  library.emojis = [];
});

describe('emoji library selection helpers', () => {
  it('should filter names case-insensitively and keep everything for a blank query', () => {
    expect(filterEmojis(EMOJIS, ' WAVE ').map((emoji) => emoji.name)).toEqual(['wave', 'Wave-2']);
    expect(filterEmojis(EMOJIS, '.v2').map((emoji) => emoji.name)).toEqual(['cat.v2']);
    expect(filterEmojis(EMOJIS, '  ')).toEqual(EMOJIS);
    expect(filterEmojis(EMOJIS, '')).not.toBe(EMOJIS);
  });

  it('should toggle single items and apply shift ranges in either direction', () => {
    expect([...selectWithRange(new Set(), IDS, 'b', null, false)]).toEqual(['b']);
    expect([...selectWithRange(new Set(['b']), IDS, 'b', 'b', false)]).toEqual([]);
    expect([...selectWithRange(new Set(['b']), IDS, 'd', 'b', true)].sort()).toEqual(['b', 'c', 'd']);
    expect([...selectWithRange(new Set(['e']), IDS, 'c', 'e', true)].sort()).toEqual(['c', 'd', 'e']);
    expect([...selectWithRange(new Set(IDS), IDS, 'b', 'd', true)].sort()).toEqual(['a', 'e']);
    expect([...selectWithRange(new Set(), IDS, 'c', 'hidden', true)]).toEqual(['c']);
    const original = new Set(['a']);
    selectWithRange(original, IDS, 'b', 'a', true);
    expect([...original]).toEqual(['a']);
  });

  it('should collect dropped files and walk nested folders across read batches', async () => {
    const folder = folderEntry('pack', [
      [fileEntry('one.png'), folderEntry('nested', [[fileEntry('two.png')]])],
      [fileEntry('three.png')],
    ]);
    const files = await filesFromDataTransfer(transfer([fileEntry('loose.png'), folder]));
    expect(files.map((file) => file.name)).toEqual(['loose.png', 'one.png', 'two.png', 'three.png']);

    const fallback = [new File(['x'], 'plain.gif', { type: 'image/gif' })];
    expect(await filesFromDataTransfer(transfer([null], fallback))).toEqual(fallback);
    expect(await filesFromDataTransfer({ files: fallback } as unknown as DataTransfer)).toEqual(fallback);
  });
});

describe('emoji library UI', () => {
  it('should render accessible checkbox tiles with selected state only in select mode', () => {
    useI18nStore.setState({ locale: 'en' });
    const selecting = grid(true, ['id-1']);
    const inputs = selecting.match(/<input\b[^>]*type="checkbox"[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(3);
    expect(inputs.filter((input) => input.includes('checked=""'))).toHaveLength(1);
    expect(inputs.find((input) => input.includes('checked=""'))).toContain('aria-label="Select :Wave-2:"');
    expect(selecting).toContain('aria-label="Select :Wave-2:"');
    expect(selecting).not.toContain('Rename');

    const browsing = grid(false);
    expect(browsing).not.toContain('type="checkbox"');
    expect(browsing.match(/>Rename</g)).toHaveLength(3);
    expect(browsing).toContain('alt=":cat.v2:"');
  });

  it('should show selection actions and a single confirmation for bulk delete', () => {
    useI18nStore.setState({ locale: 'en' });
    const actions = bar(2);
    expect(actions).toContain('2 selected');
    expect(actions).toContain('Select all (3)');
    expect(actions).toContain('Clear selection');
    expect(actions).toContain('Delete selected (2)');
    expect(bar(0)).toMatch(/disabled="">Delete selected \(0\)/);
    expect(bar(2, true)).toContain('Delete 2 emoji? This cannot be undone.');

    useI18nStore.setState({ locale: 'zh-TW' });
    expect(bar(2)).toContain('刪除所選（2）');
    expect(bar(2, true)).toContain('確定刪除 2 個表情？刪除後無法復原。');
  });

  it('should offer the filter, select mode and drop or paste import on a non-empty library', () => {
    useI18nStore.setState({ locale: 'en' });
    library.emojis = EMOJIS;
    const html = renderToStaticMarkup(createElement(EmojiLibrary));
    expect(html).toContain('role="group" aria-label="Emoji library: drop or paste images to import"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('type="search"');
    expect(html).toContain('placeholder="Filter by name"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('>Select<');
    expect(html).toContain('paste images with Ctrl/Cmd+V');
    expect(html.match(/>Rename</g)).toHaveLength(3);

    library.emojis = [];
    const empty = renderToStaticMarkup(createElement(EmojiLibrary));
    expect(empty).not.toContain('type="search"');
    expect(empty).not.toContain('>Select<');
  });
});
