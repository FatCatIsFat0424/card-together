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
import { useStillArt } from '../cosmetics/art-layers/art-layers';
import { layeredShopArt } from '../cosmetics/art-layers/shop-art-layers';
import { layeredSeatPreview } from '../cosmetics/art-layers/seat-preview-art-layers';
import { LayeredArt } from '../cosmetics/art-layers/LayeredArt';
import { observeShopPreview } from './shop-preview-visibility';
import styles from '../pages/ShopPage.module.css';

/** Share of the tile's art box that a preview may use; the rest is breathing room. */
const ART_FILL = 0.9;

interface ShopProductArtProps {
  readonly item: ShopItem;
  readonly account: PreviewAccount;
}

/**
 * How far painted descendants reach beyond the element's own box, so ears, antlers, tentacles and
 * emblems count toward the preview size. Elements running animations are skipped: they move in and
 * out of the box and would change the size from one measurement to the next.
 */
export function paintedOverflow(element: HTMLElement): { top: number; right: number; bottom: number; left: number } {
  const base = element.getBoundingClientRect();
  const reach = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const child of element.querySelectorAll('*')) {
    if (typeof child.getAnimations === 'function' && child.getAnimations().length > 0) continue;
    const rect = child.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    reach.top = Math.max(reach.top, base.top - rect.top);
    reach.left = Math.max(reach.left, base.left - rect.left);
    reach.right = Math.max(reach.right, rect.right - base.right);
    reach.bottom = Math.max(reach.bottom, rect.bottom - base.bottom);
  }
  return reach;
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
    const fit = (): void => {
      inner.style.zoom = '';
      inner.style.padding = '';
      const reach = paintedOverflow(inner);
      inner.style.padding = `${reach.top}px ${reach.right}px ${reach.bottom}px ${reach.left}px`;
      const { offsetWidth: width, offsetHeight: height } = inner;
      if (width > 0 && height > 0) inner.style.zoom = String(Math.min(1, ART_FILL * outer.clientWidth / width, ART_FILL * outer.clientHeight / height));
    };
    fit();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    observer?.observe(outer);
    return () => observer?.disconnect();
  }, [fill]);
  // Tile previews are decorative; the dialog holds the interactive copy (such as the sound sample button).
  return <div ref={box} className={styles.artScale} inert={!interactive}>
    <div ref={art} className={fill ? styles.artFill : styles.artFit}>{children}</div>
  </div>;
}

/** Keeps the product, description and purchase controls in place while distant artwork is unloaded. */
export function ShopProductPreview({ item, account, className, children }: ShopProductArtProps & {
  readonly className: string;
  readonly children: ReactNode;
}): ReactNode {
  const container = useRef<HTMLDivElement>(null);
  // Keep sound buttons in keyboard order and text-sized previews at their intrinsic height.
  const persistent = item.type === 'soundPack' || item.type === 'chatFrame' || item.type === 'nameplate';
  const [visible, setVisible] = useState(() => persistent || typeof IntersectionObserver !== 'function');
  useEffect(() => {
    if (persistent || !container.current) return;
    // Routes scroll inside their viewport, so expand that root instead of the clipped document.
    return observeShopPreview(container.current, setVisible, container.current.closest('main')?.parentElement ?? null);
  }, [persistent]);
  return <div ref={container} className={className}>
    {children}
    {(persistent || visible) && <FitArt fill={item.type === 'tableBackground' || item.type === 'seatBackground'}>
      <ShopProductArt item={item} account={account} /></FitArt>}
  </div>;
}

/** Uses the same assets and identity components as equipped products. */
export function ShopProductArt({ item, account }: ShopProductArtProps): ReactNode {
  const reducedMotion = useMotionStore((state) => state.reducedMotion);
  const stillArt = useStillArt();
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
  const artwork = shopArtworkUrl(item.id, reducedMotion);
  const layers = !stillArt ? layeredShopArt(item.id) ?? layeredSeatPreview(item.id) : null;
  if (item.type === 'cardBack') return layers
    ? <LayeredArt art={layers} fit="cover" className={styles.cardBackArt} />
    : <img className={styles.cardBackArt} src={artwork} alt="" />;
  return <div className={item.type === 'seatBackground' ? styles.seatArt : styles.tableArt}>
    {layers ? <LayeredArt art={layers} fit="cover" className={styles.backgroundArt} />
      : <img src={artwork} alt="" />}
    {item.type === 'seatBackground'
      ? <Avatar avatar={account.avatar} image={account.avatarImage} border={account.avatarBorder} color={account.color} size="large" />
      : <span className={styles.tableCards} aria-hidden="true"><span /><span /><span /></span>}
  </div>;
}
