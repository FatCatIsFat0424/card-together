import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { EmojiRecord, ProvidedEmoji } from '@shared/types';
import type { MessageContent } from '@shared/types/direct-message';
import { SHOP_STICKERS, STICKER_PACKS, splitEmojiText } from '@shared/constants';
import type { ShopStickerId } from '@shared/types';
import { useAccountStore } from '../stores/account-store';
import { ShopSticker } from './ShopSticker';
import { mediaUrl } from '../media';
import { providedEmojiUrl } from '../provided-emoji';
import { useI18nStore } from '../stores/i18n-store';
import { AppIcon } from './AppIcon';
import styles from './ChatPanel.module.css';

export type StickerPayload = { stickerId: string } | { providedSticker: string } | { shopSticker: ShopStickerId };

/** `src` is null when the reference cannot be turned into a trusted URL. */
export function StickerImage({ name, src, small = false }: {
  name: string; src: string | null; small?: boolean;
}): ReactNode {
  const [failed, setFailed] = useState(false);
  const { t } = useI18nStore();
  return <span className={`${styles.stickerImage} ${small ? styles.smallImage : ''}`}>
    {failed || !src ? <span role="img" aria-label={name}>{t('sticker.unavailable')}: {name}</span>
      : <img src={src} alt={name} onError={() => setFailed(true)} />}
  </span>;
}

/** Text stays text; only emoji the server attached to this message become images. */
export function ChatMessageBody({ message }: { message: MessageContent }): ReactNode {
  if (message.shopSticker) return <ShopSticker id={message.shopSticker} />;
  if (message.sticker) {
    return <StickerImage name={message.sticker.name} src={mediaUrl(message.sticker.mediaId)} />;
  }
  if (message.providedSticker) {
    return <StickerImage name={message.providedSticker.name}
      src={providedEmojiUrl(message.providedSticker.file)} />;
  }
  return splitEmojiText(message.content, message.emojis, message.providedEmojis).map((segment, index) => {
    if (typeof segment === 'string') return segment;
    const src = 'mediaId' in segment ? mediaUrl(segment.mediaId) : providedEmojiUrl(segment.file);
    const token = `:${segment.name}:`;
    return src ? <img key={index} className={styles.emoji} src={src} alt={token} title={token} /> : token;
  });
}

export interface EmojiPickerProps {
  readonly personal: readonly EmojiRecord[];
  readonly provided: readonly ProvidedEmoji[];
  readonly busy: boolean;
  readonly onInsert: (name: string) => void;
  readonly onSendSticker: (payload: StickerPayload) => void;
  /** Starting state, for restoring a picker and for tests. */
  readonly initialMode?: 'emoji' | 'sticker';
  readonly initialQuery?: string;
  readonly className?: string;
}

interface PickerItem {
  readonly key: string;
  readonly title: string;
  readonly art: ReactNode;
  readonly shop: boolean;
  readonly onPick: () => void;
}

interface PickerSection {
  readonly id: string;
  /** Tab text, or a pack's first sticker as its thumbnail. */
  readonly tab: ReactNode;
  readonly label: string;
  readonly items: readonly PickerItem[];
  /** Shown instead of the grid when the section is empty. */
  readonly empty?: ReactNode;
}

/**
 * The emoji and sticker picker shared by room chat and private messages: one 48px row holds the
 * emoji/sticker switch, scrollable categories (owned sticker packs as thumbnails), search and the
 * sticker shop; searching turns that row into a search field and lists matches from every category.
 */
export function EmojiPicker({
  personal, provided, busy, onInsert, onSendSticker, initialMode = 'emoji', initialQuery = '', className = '',
}: EmojiPickerProps): ReactNode {
  const { t } = useI18nStore();
  const [mode, setMode] = useState(initialMode);
  const [query, setQuery] = useState(initialQuery);
  const [searching, setSearching] = useState(initialQuery !== '');
  const [selected, setSelected] = useState<string | null>(null);
  const inventory = useAccountStore((state) => state.account?.ownedShopItems);
  const search = query.trim().toLowerCase();
  const sticker = mode === 'sticker';
  // A personal emoji wins a name clash in text, so inserting the provided one would mislead.
  const owned = new Set(personal.map((emoji) => emoji.name));
  const sections: PickerSection[] = [{
    id: 'personal', tab: t('emoji.personalShort'), label: t('emoji.personal'),
    items: personal.map((emoji) => ({ key: emoji.id, title: `:${emoji.name}:`, shop: false,
      art: <StickerImage name={emoji.name} src={mediaUrl(emoji.mediaId)} small />,
      onPick: () => sticker ? onSendSticker({ stickerId: emoji.id }) : onInsert(emoji.name) })),
    empty: <p className={styles.pickerEmpty}>{t('emoji.empty')} <Link to="/account">{t('emoji.manage')}</Link></p>,
  }];
  if (provided.length > 0) {
    sections.push({ id: 'provided', tab: t('emoji.providedShort'), label: t('emoji.provided'),
      items: provided.filter((emoji) => sticker || !owned.has(emoji.name)).map((emoji) => ({
        key: emoji.name, title: `:${emoji.name}:`, shop: false,
        art: <StickerImage name={emoji.name} src={providedEmojiUrl(emoji.file)} small />,
        onPick: () => sticker ? onSendSticker({ providedSticker: emoji.name }) : onInsert(emoji.name) })) });
  }
  if (sticker) {
    for (const pack of STICKER_PACKS.filter((entry) => inventory?.includes(entry.id))) {
      const stickers = SHOP_STICKERS.filter((entry) => entry.packId === pack.id);
      sections.push({ id: pack.id, label: t(`shop.item.${pack.id}.name`),
        tab: stickers[0] ? <ShopSticker id={stickers[0].id} small /> : t(`shop.item.${pack.id}.name`),
        items: stickers.map((entry) => ({ key: entry.id, title: t(`shop.sticker.${entry.id}`), shop: true,
          art: <ShopSticker id={entry.id} small />, onPick: () => onSendSticker({ shopSticker: entry.id }) })) });
    }
  }
  const active = sections.find((section) => section.id === selected)
    ?? sections.find((section) => section.items.length > 0) ?? sections[0];
  // Names are case-sensitive, but search is not; sticker IDs match too.
  const matches = search ? sections.flatMap((section) => section.items.filter((item) =>
    item.title.toLowerCase().includes(search) || item.key.toLowerCase().includes(search))) : [];
  const shown = search ? matches : active.items;
  const grid = (items: readonly PickerItem[], label: string): ReactNode => <div className={styles.pickerGrid} role="group" aria-label={label}>
    {items.map((item) => <button key={item.key} type="button" className={`${styles.pickerItem} ${item.shop ? styles.shopItem : ''}`}
      title={item.title} aria-label={item.title} disabled={busy && (sticker || item.shop)} onClick={item.onPick}>
      {item.art}
    </button>)}
  </div>;
  const closeSearch = (): void => { setSearching(false); setQuery(''); };

  return <div className={`${styles.picker} ${className}`}>
    <div className={styles.pickerRow}>
      {searching ? <>
        <button type="button" className={styles.pickerIcon} aria-label={t('emoji.closeSearch')} title={t('emoji.closeSearch')}
          onClick={closeSearch}><AppIcon name="back" /></button>
        <label className={styles.pickerSearch}>
          <AppIcon name="search" />
          <input type="search" value={query} autoFocus aria-label={t('emoji.search')} placeholder={t('emoji.search')}
            onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button type="button" className={styles.pickerIcon} aria-label={t('emoji.clearSearch')} title={t('emoji.clearSearch')}
          disabled={!query} onClick={() => setQuery('')}><AppIcon name="close" /></button>
      </> : <>
        <div className={styles.modeSwitch} role="group" aria-label={t('emoji.picker')}>
          <button type="button" aria-pressed={!sticker} onClick={() => setMode('emoji')}>{t('emoji.mode')}</button>
          <button type="button" aria-pressed={sticker} onClick={() => setMode('sticker')}>{t('sticker.mode')}</button>
        </div>
        <div className={styles.categories} role="tablist" aria-label={t('emoji.categories')}>
          {sections.map((section) => <button key={section.id} type="button" role="tab" aria-selected={section.id === active.id}
            aria-label={section.label} title={section.label} className={typeof section.tab === 'string' ? undefined : styles.packTab}
            onClick={() => setSelected(section.id)}>{section.tab}</button>)}
        </div>
        <button type="button" className={styles.pickerIcon} aria-label={t('emoji.search')} title={t('emoji.search')}
          onClick={() => setSearching(true)}><AppIcon name="search" /></button>
        <Link className={styles.pickerIcon} to="/shop?type=stickerPack" aria-label={t('shop.browseStickers')}
          title={t('shop.browseStickers')}><AppIcon name="shop" /></Link>
      </>}
    </div>
    <div className={styles.pickerBody} role={searching ? undefined : 'tabpanel'}>
      {shown.length > 0 ? grid(shown, search ? t('emoji.search') : active.label)
        : search ? <p className={styles.pickerEmpty}>{t('emoji.noMatch')}</p>
          : active.empty ?? <p className={styles.pickerEmpty}>{t('emoji.noMatch')}</p>}
    </div>
  </div>;
}
