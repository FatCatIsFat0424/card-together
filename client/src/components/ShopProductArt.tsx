import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ShopItem } from '@shared/types';
import { SHOP_STICKERS } from '@shared/constants';
import { useMotionStore } from '../stores/motion-store';
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
import { PieceStylePreview } from '../cosmetics/piece-styles/PieceStylePreview';
import { BoardStylePreview } from '../cosmetics/board-styles/BoardStylePreview';
import { DiceStylePreview } from '../cosmetics/dice-styles/DiceStylePreview';
import { useStillArt } from '../cosmetics/art-layers/art-layers';
import { layeredShopArt } from '../cosmetics/art-layers/shop-art-layers';
import { layeredSeatPreview } from '../cosmetics/art-layers/seat-preview-art-layers';
import { LayeredArt } from '../cosmetics/art-layers/LayeredArt';
import { observeShopPreview } from './shop-preview-visibility';
import { observeArtFit } from './art-fit';
import styles from '../pages/ShopPage.module.css';

interface ShopProductArtProps {
  readonly item: ShopItem;
  readonly account: PreviewAccount;
}

/** Shrinks a preview, with its overhanging decoration, to fit its tile; backgrounds fill the tile instead. */
export function FitArt({ fill, interactive = false, children }: {
  readonly fill: boolean;
  /** The details dialog keeps the preview's own controls, such as the sound sample button. */
  readonly interactive?: boolean;
  readonly children: ReactNode;
}): ReactNode {
  const box = useRef<HTMLDivElement>(null);
  const art = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const outer = box.current;
    const inner = art.current;
    if (fill || !outer || !inner) return;
    return observeArtFit({ outer, inner });
  }, [fill]);
  // Tile previews are decorative; the dialog holds the interactive copy (such as the sound sample button).
  return <div ref={box} className={styles.artScale} inert={!interactive}>
    <div ref={art} className={fill ? styles.artFill : styles.artFit}>{children}</div>
  </div>;
}

/**
 * Keeps the product, description and purchase controls in place while distant artwork is unloaded.
 * Every type defers its artwork: the tile copy is decorative, and unmounting it also stops its animations.
 */
export function ShopProductPreview({ item, account, className, children }: ShopProductArtProps & {
  readonly className: string;
  readonly children: ReactNode;
}): ReactNode {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver !== 'function');
  useEffect(() => {
    if (!container.current) return;
    // Routes scroll inside their viewport, so expand that root instead of the clipped document.
    return observeShopPreview(container.current, setVisible, container.current.closest('main')?.parentElement ?? null);
  }, []);
  return <div ref={container} className={className}>
    {children}
    {visible && <FitArt fill={item.type === 'tableBackground' || item.type === 'seatBackground'}>
      <ShopProductArt item={item} account={account} tile /></FitArt>}
  </div>;
}

/** Class of a small square preview box; callers size it with `--thumb-w` and `--thumb-h` (40px by default). */
export const SHOP_THUMB_CLASS = styles.thumb;

/** A product preview shrunk into a thumbnail, with the same deferred mounting as product tiles. */
export function ShopThumb({ item, account, className }: ShopProductArtProps & { readonly className?: string }): ReactNode {
  return <ShopProductPreview item={item} account={account} className={[styles.thumb, className].filter(Boolean).join(' ')}>
    {null}
  </ShopProductPreview>;
}

/** Uses the same assets and identity components as equipped products. */
export function ShopProductArt({ item, account, tile = false }: ShopProductArtProps & {
  /** Product tiles are short, so the nameplate sample sits under a smaller avatar to keep its text legible. */
  readonly tile?: boolean;
}): ReactNode {
  const reducedMotion = useMotionStore((state) => state.reducedMotion);
  const stillArt = useStillArt();
  switch (item.type) {
    case 'cardFace': return <CardFacePreview id={item.id} account={account} />;
    case 'soundPack': return <SoundPackPreview id={item.id} account={account} />;
    case 'seatFrame': return <SeatFramePreview id={item.id} account={account} />;
    case 'victoryEffect': return <VictoryEffectPreview id={item.id} account={account} />;
    case 'chipStyle': return <ChipStylePreview id={item.id} account={account} />;
    case 'chatFrame': return <ChatFramePreview id={item.id} account={account} />;
    case 'pieceStyle': return <PieceStylePreview id={item.id} account={account} />;
    case 'boardStyle': return <BoardStylePreview id={item.id} account={account} />;
    case 'diceStyle': return <DiceStylePreview id={item.id} account={account} />;
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
      <Avatar avatar={account.avatar} image={account.avatarImage} border={account.avatarBorder} color={account.color}
        size={tile ? 'row' : 'large'} />
      <Nameplate id={item.id} />
    </div>;
  }
  const artwork = shopArtworkUrl(item.id, reducedMotion);
  const layers = !stillArt ? layeredShopArt(item.id) ?? layeredSeatPreview(item.id) : null;
  if (item.type === 'cardBack') return layers
    ? <LayeredArt art={layers} fit="cover" className={styles.cardBackArt} />
    : <img className={styles.cardBackArt} src={artwork} alt="" />;
  return <div className={item.type === 'seatBackground' ? styles.seatArt : styles.tableArt}>
    {layers ? <LayeredArt art={layers} fit="cover" className={styles.backgroundArt} />
      : <img src={artwork} alt="" />}
    {item.type === 'seatBackground'
      // Border decorations reach past the avatar, so the seat avatar shrinks to stay inside the scene.
      ? <FitArt fill={false}>
        <Avatar avatar={account.avatar} image={account.avatarImage} border={account.avatarBorder} color={account.color} size="large" />
      </FitArt>
      : <span className={styles.tableCards} aria-hidden="true"><span /><span /><span /></span>}
  </div>;
}
