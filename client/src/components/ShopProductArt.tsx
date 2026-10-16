import type { ReactNode } from 'react';
import type { ShopItem } from '@shared/types';
import { SHOP_STICKERS } from '@shared/constants';
import { shopArtworkUrl } from '../shop-art';
import { Avatar } from './Avatar';
import { AvatarBorder } from './AvatarBorder';
import { Nameplate } from './Nameplate';
import { ShopSticker } from './ShopSticker';
import type { PreviewAccount } from '../cosmetics/preview-props';
import { CardFacePreview } from '../cosmetics/card-faces/CardFacePreview';
import { SoundPackPreview } from '../cosmetics/sound-packs/SoundPackPreview';
import { SeatFramePreview } from '../cosmetics/seat-frames/SeatFramePreview';
import { VictoryEffectPreview } from '../cosmetics/victory-effects/VictoryEffectPreview';
import { ChipStylePreview } from '../cosmetics/chip-styles/ChipStylePreview';
import { ChatFramePreview } from '../cosmetics/chat-frames/ChatFramePreview';
import styles from '../pages/ShopPage.module.css';

/** Uses the same assets and identity components as equipped products. */
export function ShopProductArt({ item, account }: {
  readonly item: ShopItem;
  readonly account: PreviewAccount;
}): ReactNode {
  switch (item.type) {
    case 'cardFace': return <CardFacePreview id={item.id} account={account} />;
    case 'soundPack': return <SoundPackPreview id={item.id} account={account} />;
    case 'seatFrame': return <SeatFramePreview id={item.id} account={account} />;
    case 'victoryEffect': return <VictoryEffectPreview id={item.id} account={account} />;
    case 'chipStyle': return <ChipStylePreview id={item.id} account={account} />;
    case 'chatFrame': return <ChatFramePreview id={item.id} account={account} />;
  }
  if (item.type === 'avatarBorder') {
    return <AvatarBorder border={item.id} avatar={account.avatar} image={account.avatarImage} color={account.color} />;
  }
  if (item.type === 'stickerPack') {
    return <div className={styles.stickerPackArt}>{SHOP_STICKERS.filter((sticker) => sticker.packId === item.id)
      .map((sticker) => <ShopSticker key={sticker.id} id={sticker.id} small />)}</div>;
  }
  if (item.type === 'nameplate') {
    return <div className={styles.nameplateArt}>
      <Avatar avatar={account.avatar} image={account.avatarImage} border={account.avatarBorder} color={account.color} size="large" />
      <Nameplate id={item.id} />
    </div>;
  }
  const artwork = shopArtworkUrl(item.id);
  if (item.type === 'cardBack') return <img className={styles.cardBackArt} src={artwork} alt="" />;
  return <div className={item.type === 'seatBackground' ? styles.seatArt : styles.tableArt}>
    <img src={artwork} alt="" />
    {item.type === 'seatBackground'
      ? <Avatar avatar={account.avatar} image={account.avatarImage} border={account.avatarBorder} color={account.color} size="large" />
      : <span className={styles.tableCards} aria-hidden="true"><span /><span /><span /></span>}
  </div>;
}
