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

interface EmojiPickerSectionsProps {
  mode: 'emoji' | 'sticker';
  /** Lowercase search text; empty shows everything. */
  query: string;
  personal: readonly EmojiRecord[];
  provided: readonly ProvidedEmoji[];
  busy: boolean;
  onInsert: (name: string) => void;
  onSendSticker: (payload: StickerPayload) => void;
}

/** The personal library, then site-provided emoji when the build includes any. */
export function EmojiPickerSections({
  mode, query, personal, provided, busy, onInsert, onSendSticker,
}: EmojiPickerSectionsProps): ReactNode {
  const { t } = useI18nStore();
  const inventory = useAccountStore((state) => state.account?.ownedShopItems);
  const ownedPacks = STICKER_PACKS.filter((pack) => inventory?.includes(pack.id));
  const owned = new Set(personal.map((emoji) => emoji.name));
  // Names are case-sensitive, but search is not.
  const matches = (name: string): boolean => name.toLowerCase().includes(query);
  const personalMatches = personal.filter((emoji) => matches(emoji.name));
  // A personal emoji wins a name clash in text, so inserting the provided one would mislead.
  const providedMatches = provided.filter((emoji) => matches(emoji.name) &&
    (mode === 'sticker' || !owned.has(emoji.name)));
  const grouped = provided.length > 0;
  return (
    <div className={styles.pickerBody}>
      {mode === 'sticker' && <>
        <h3 className={styles.pickerHeading}>{t('shop.stickerPacks')}</h3>
        {ownedPacks.length === 0 ? <p className={styles.pickerEmpty}>
          <Link to="/shop?type=stickerPack">{t('shop.browseStickers')}</Link>
        </p> : ownedPacks.map((pack) => {
          const stickers = SHOP_STICKERS.filter((sticker) => sticker.packId === pack.id &&
            (matches(sticker.id) || matches(t(`shop.sticker.${sticker.id}`))));
          return <div key={pack.id}>
            <h4 className={styles.pickerHeading}>{t(`shop.item.${pack.id}.name`)}</h4>
            {stickers.length === 0 ? <p className={styles.pickerEmpty}>{t('emoji.noMatch')}</p> :
              <div className={styles.shopStickerGrid} role="group" aria-label={t(`shop.item.${pack.id}.name`)}>
                {stickers.map((sticker) => <button key={sticker.id} type="button"
                  className={styles.pickerItem} title={t(`shop.sticker.${sticker.id}`)} disabled={busy}
                  onClick={() => onSendSticker({ shopSticker: sticker.id })}>
                  <ShopSticker id={sticker.id} small />
                </button>)}
              </div>}
          </div>;
        })}
      </>}
      {(grouped || mode === 'sticker') && <h3 className={styles.pickerHeading}>{t('emoji.personal')}</h3>}
      {personalMatches.length === 0 ? (
        <p className={styles.pickerEmpty}>
          {personal.length === 0 ? t('emoji.empty') : t('emoji.noMatch')}{' '}
          <Link to="/account">{t('emoji.manage')}</Link>
        </p>
      ) : (
        <div className={styles.pickerGrid} role="group" aria-label={t('emoji.personal')}>
          {personalMatches.map((emoji) => (
            <button key={emoji.id} type="button" className={styles.pickerItem}
              title={`:${emoji.name}:`} disabled={mode === 'sticker' && busy}
              onClick={() => mode === 'emoji' ? onInsert(emoji.name) : onSendSticker({ stickerId: emoji.id })}>
              <StickerImage name={emoji.name} src={mediaUrl(emoji.mediaId)} small />
            </button>
          ))}
        </div>
      )}
      {grouped && <h3 className={styles.pickerHeading}>{t('emoji.provided')}</h3>}
      {grouped && (providedMatches.length === 0 ? (
        <p className={styles.pickerEmpty}>{t('emoji.noMatch')}</p>
      ) : (
        <div className={styles.pickerGrid} role="group" aria-label={t('emoji.provided')}>
          {providedMatches.map((emoji) => (
            <button key={emoji.name} type="button" className={styles.pickerItem}
              title={`:${emoji.name}:`} disabled={mode === 'sticker' && busy}
              onClick={() => mode === 'emoji'
                ? onInsert(emoji.name) : onSendSticker({ providedSticker: emoji.name })}>
              <StickerImage name={emoji.name} src={providedEmojiUrl(emoji.file)} small />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
