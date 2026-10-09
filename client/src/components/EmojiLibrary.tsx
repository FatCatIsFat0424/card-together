import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent, DragEvent, FormEvent, ReactNode } from 'react';
import type { EmojiRecord, MediaId } from '@shared/types';
import { EMOJI_MAX_BYTES, EMOJI_NAME_MAX_LENGTH, MAX_EMOJIS_PER_ACCOUNT } from '@shared/constants';
import { apiRequest } from '../api';
import { filesFromDataTransfer } from '../dropped-files';
import { emojiNameFromFile } from '../emoji-names';
import { filterEmojis, selectWithRange } from '../emoji-selection';
import { resizeImage } from '../image-resize';
import { mediaUrl, uploadImage } from '../media';
import { useEmojiStore } from '../stores/emoji-store';
import { useI18nStore } from '../stores/i18n-store';
import { joinNames } from '../games/seat-names';
import styles from './EmojiLibrary.module.css';

const ACCEPT = 'image/png,image/gif,image/webp,image/jpeg';
// HTML patterns use the `v` flag, which requires `-` to be escaped inside a class.
const NAME_INPUT_PATTERN = '[A-Za-z0-9_][A-Za-z0-9_.\\-]{1,63}';
const BATCH = 50;

export type EmojiEditing = { id: string; mode: 'rename'; name: string } | { id: string; mode: 'delete' };

interface EmojiGridProps {
  emojis: readonly EmojiRecord[];
  selecting: boolean;
  selected: ReadonlySet<string>;
  editing: EmojiEditing | null;
  busy: boolean;
  onEdit: (editing: EmojiEditing | null) => void;
  onRename: (event: FormEvent<HTMLFormElement>, id: string, name: string) => void;
  onRemove: (id: string) => void;
  /** `range` is true for a shift-click. */
  onToggle: (id: string, range: boolean) => void;
}

/** Library tiles: per-item rename/delete, or checkboxes in select mode. */
export function EmojiGrid({
  emojis, selecting, selected, editing, busy, onEdit, onRename, onRemove, onToggle,
}: EmojiGridProps): ReactNode {
  const { t } = useI18nStore();
  return (
    <ul className={styles.grid}>
      {emojis.map((emoji) => {
        const isSelected = selected.has(emoji.id);
        if (selecting) {
          return (
            <li key={emoji.id} className={`${styles.item} ${isSelected ? styles.selected : ''}`}>
              {/* A checkbox-role button so the whole tile toggles and shift-click reaches onClick. */}
              <button type="button" role="checkbox" aria-checked={isSelected} className={styles.selectTile}
                disabled={busy} aria-label={t('emoji.selectItem', { name: emoji.name })}
                onClick={(event) => onToggle(emoji.id, event.shiftKey)}>
                <span className={styles.checkbox} aria-hidden="true">{isSelected ? '\u2713' : ''}</span>
                <img className={styles.image} src={mediaUrl(emoji.mediaId)} alt="" />
                <code className={styles.name}>:{emoji.name}:</code>
              </button>
            </li>
          );
        }
        return (
          <li key={emoji.id} className={styles.item}>
            <img className={styles.image} src={mediaUrl(emoji.mediaId)} alt={`:${emoji.name}:`} />
            {editing?.id === emoji.id && editing.mode === 'rename' ? (
              <form className={styles.renameForm}
                onSubmit={(event) => onRename(event, emoji.id, editing.name)}>
                <input value={editing.name} aria-label={t('emoji.renamePrompt')} autoFocus
                  pattern={NAME_INPUT_PATTERN} maxLength={EMOJI_NAME_MAX_LENGTH} required
                  onChange={(event) => onEdit({ ...editing, name: event.target.value })} />
                <button type="submit" className="btn btn-primary">{t('common.save')}</button>
                <button type="button" className="btn btn-outline"
                  onClick={() => onEdit(null)}>{t('common.cancel')}</button>
              </form>
            ) : editing?.id === emoji.id ? (
              <div className={styles.renameForm}>
                <span>{t('emoji.confirmDelete', { name: emoji.name })}</span>
                <button type="button" className="btn btn-danger"
                  onClick={() => onRemove(emoji.id)}>{t('emoji.delete')}</button>
                <button type="button" className="btn btn-outline"
                  onClick={() => onEdit(null)}>{t('common.cancel')}</button>
              </div>
            ) : (
              <>
                <code className={styles.name}>:{emoji.name}:</code>
                <div className={styles.itemActions}>
                  <button type="button" className={styles.link}
                    onClick={() => onEdit({ id: emoji.id, mode: 'rename', name: emoji.name })}>
                    {t('emoji.rename')}</button>
                  <button type="button" className={styles.link}
                    onClick={() => onEdit({ id: emoji.id, mode: 'delete' })}>
                    {t('emoji.delete')}</button>
                </div>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

interface EmojiSelectionBarProps {
  selectedCount: number;
  visibleCount: number;
  confirming: boolean;
  busy: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onDelete: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Select-mode actions; deleting asks once for the whole selection. */
export function EmojiSelectionBar({
  selectedCount, visibleCount, confirming, busy, onSelectAll, onClear, onDelete, onConfirm, onCancel,
}: EmojiSelectionBarProps): ReactNode {
  const { t } = useI18nStore();
  const count = String(selectedCount);
  if (confirming) {
    return (
      <div className={styles.selectionBar} role="alertdialog" aria-label={t('emoji.deleteSelected', { count })}>
        <span>{t('emoji.confirmDeleteSelected', { count })}</span>
        <button type="button" className="btn btn-danger" disabled={busy} autoFocus
          onClick={onConfirm}>{t('emoji.delete')}</button>
        <button type="button" className="btn btn-outline" disabled={busy}
          onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    );
  }
  return (
    <div className={styles.selectionBar}>
      <span role="status">{t('emoji.selectedCount', { count })}</span>
      <button type="button" className="btn btn-outline" disabled={busy || visibleCount === 0}
        onClick={onSelectAll}>{t('emoji.selectAll', { count: String(visibleCount) })}</button>
      <button type="button" className="btn btn-outline" disabled={busy || selectedCount === 0}
        onClick={onClear}>{t('emoji.clearSelection')}</button>
      <button type="button" className="btn btn-danger" disabled={busy || selectedCount === 0}
        onClick={onDelete}>{t('emoji.deleteSelected', { count })}</button>
    </div>
  );
}

export function EmojiLibrary(): ReactNode {
  const { locale, t } = useI18nStore();
  const emojis = useEmojiStore((state) => state.emojis);
  const load = useEmojiStore((state) => state.load);
  const setEmojis = useEmojiStore((state) => state.setEmojis);
  const [progress, setProgress] = useState('');
  const [report, setReport] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<EmojiEditing | null>(null);
  const [query, setQuery] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [confirmingBulk, setConfirmingBulk] = useState(false);
  const [dragging, setDragging] = useState(false);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const visible = filterEmojis(emojis, query);
  // Hidden entries never count, so changing the filter cannot delete unseen emoji.
  const visibleSelected = visible.filter((emoji) => selected.has(emoji.id));

  useEffect(() => {
    void load();
    // `webkitdirectory` is not in React's attribute types.
    folderInput.current?.setAttribute('webkitdirectory', '');
  }, [load]);

  const importFiles = async (files: File[]): Promise<void> => {
    const images = files.filter((file) => ACCEPT.split(',').includes(file.type));
    if (images.length === 0) return;
    setBusy(true);
    setError('');
    setReport([]);
    const room = MAX_EMOJIS_PER_ACCOUNT - useEmojiStore.getState().emojis.length;
    const skipped = images.slice(Math.max(room, 0)).map((file) => `${file.name} (${t('emoji.full')})`);
    const taken = new Set(useEmojiStore.getState().emojis.map((emoji) => emoji.name));
    const items: { name: string; mediaId: MediaId }[] = [];
    const accepted = images.slice(0, Math.max(room, 0));
    for (const [index, file] of accepted.entries()) {
      setProgress(t('emoji.progress', { done: String(index + 1), total: String(accepted.length) }));
      try {
        if (file.type === 'image/gif' && file.size > EMOJI_MAX_BYTES) throw new Error(t('emoji.tooLarge'));
        const blob = file.type === 'image/gif' ? file
          : await resizeImage(file, { size: 128, square: false, quality: 0.9, fallbackType: 'image/png' });
        items.push({ name: emojiNameFromFile(file.name, taken), mediaId: await uploadImage(blob, 'emoji') });
      } catch (reason) {
        skipped.push(`${file.name} (${reason instanceof Error ? reason.message : t('common.error')})`);
      }
    }
    let created = 0;
    for (let start = 0; start < items.length; start += BATCH) {
      const result = await apiRequest<{ emojis: EmojiRecord[] }>('/api/emojis', 'POST', {
        items: items.slice(start, start + BATCH),
      });
      if (!result.success) {
        setError(result.error);
        break;
      }
      created += result.emojis.length;
      setEmojis([...useEmojiStore.getState().emojis, ...result.emojis]);
    }
    setProgress(t('emoji.imported', { count: String(created) }));
    setReport(skipped);
    setBusy(false);
  };

  const choose = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    void importFiles(files);
  };

  const dragOver = (event: DragEvent<HTMLDivElement>): void => {
    if (busy || !event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  };

  const dragLeave = (event: DragEvent<HTMLDivElement>): void => {
    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
      setDragging(false);
    }
  };

  const drop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    void filesFromDataTransfer(event.dataTransfer).then(importFiles, () => setError(t('common.error')));
  };

  const paste = (event: ClipboardEvent<HTMLDivElement>): void => {
    const files = Array.from(event.clipboardData.files);
    if (busy || files.length === 0) return;
    event.preventDefault();
    void importFiles(files);
  };

  const rename = async (event: FormEvent<HTMLFormElement>, id: string, name: string): Promise<void> => {
    event.preventDefault();
    setError('');
    const result = await apiRequest<{ emoji: EmojiRecord }>(`/api/emojis/${encodeURIComponent(id)}`,
      'PATCH', { name: name.trim() });
    if (!result.success) {
      setError(result.error);
      return;
    }
    setEmojis(useEmojiStore.getState().emojis.map((emoji) => emoji.id === id ? result.emoji : emoji));
    setEditing(null);
  };

  const remove = async (id: string): Promise<void> => {
    setError('');
    const result = await apiRequest(`/api/emojis/${encodeURIComponent(id)}`, 'DELETE');
    if (!result.success) {
      setError(result.error);
      return;
    }
    setEmojis(useEmojiStore.getState().emojis.filter((emoji) => emoji.id !== id));
    setEditing(null);
  };

  const toggleSelecting = (): void => {
    setSelecting(!selecting);
    setSelected(new Set());
    setAnchor(null);
    setConfirmingBulk(false);
    setEditing(null);
  };

  const toggle = (id: string, range: boolean): void => {
    setSelected(selectWithRange(selected, visible.map((emoji) => emoji.id), id, anchor, range));
    setAnchor(id);
    setConfirmingBulk(false);
  };

  const removeSelected = async (): Promise<void> => {
    setBusy(true);
    setError('');
    const result = await apiRequest<{ deleted: string[] }>('/api/emojis/delete', 'POST', {
      ids: visibleSelected.map((emoji) => emoji.id),
    });
    setBusy(false);
    setConfirmingBulk(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    const deleted = new Set(result.deleted);
    setEmojis(useEmojiStore.getState().emojis.filter((emoji) => !deleted.has(emoji.id)));
    setSelected(new Set());
    setAnchor(null);
    setProgress(t('emoji.deleted', { count: String(deleted.size) }));
  };

  return (
    <div className={`${styles.library} ${dragging ? styles.dropActive : ''}`} tabIndex={0}
      role="group" aria-label={t('emoji.dropZone')}
      onDragOver={dragOver} onDragLeave={dragLeave} onDrop={drop} onPaste={paste}>
      <p className={styles.hint}>{t('emoji.help')} ({emojis.length}/{MAX_EMOJIS_PER_ACCOUNT})</p>
      <p className={styles.hint}>{t('emoji.dropHint')}</p>
      <div className={styles.actions}>
        <input ref={filesInput} type="file" multiple accept={ACCEPT} hidden onChange={choose} />
        <input ref={folderInput} type="file" multiple hidden onChange={choose} />
        <button type="button" className="btn btn-outline" disabled={busy}
          onClick={() => filesInput.current?.click()}>{t('emoji.import')}</button>
        <button type="button" className="btn btn-outline" disabled={busy}
          onClick={() => folderInput.current?.click()}>{t('emoji.importFolder')}</button>
        {emojis.length > 0 && (
          <button type="button" className="btn btn-outline" aria-pressed={selecting} disabled={busy}
            onClick={toggleSelecting}>{selecting ? t('emoji.doneSelecting') : t('emoji.select')}</button>
        )}
      </div>
      {progress && <p role="status" className={styles.hint}>{progress}</p>}
      {report.length > 0 && <p className={styles.error}>{t('emoji.skipped', { names: joinNames(report, locale) })}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {emojis.length === 0 ? <p className={styles.hint}>{t('emoji.empty')}</p> : (
        <>
          <input type="search" className={styles.filter} value={query} placeholder={t('emoji.filter')}
            aria-label={t('emoji.filter')} onChange={(event) => {
              setQuery(event.target.value);
              setAnchor(null);
              setConfirmingBulk(false);
            }} />
          {selecting && (
            <>
              <p className={styles.hint}>{t('emoji.selectHint')}</p>
              <EmojiSelectionBar selectedCount={visibleSelected.length} visibleCount={visible.length}
                confirming={confirmingBulk} busy={busy}
                onSelectAll={() => setSelected(new Set(visible.map((emoji) => emoji.id)))}
                onClear={() => {
                  setSelected(new Set());
                  setAnchor(null);
                }}
                onDelete={() => setConfirmingBulk(true)}
                onConfirm={() => void removeSelected()}
                onCancel={() => setConfirmingBulk(false)} />
            </>
          )}
          {visible.length === 0 ? <p className={styles.hint}>{t('emoji.noMatch')}</p> : (
            <EmojiGrid emojis={visible} selecting={selecting} selected={selected} editing={editing}
              busy={busy} onEdit={setEditing} onToggle={toggle}
              onRename={(event, id, name) => void rename(event, id, name)}
              onRemove={(id) => void remove(id)} />
          )}
        </>
      )}
    </div>
  );
}
