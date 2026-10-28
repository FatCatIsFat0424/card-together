import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { AccountProfile, ShopItem, ShopItemId } from '@shared/types';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import Dialog from '@mui/material/Dialog';
import { apiRequest } from '../api';
import type { ApiResult } from '../api';
import { SHOP_STICKERS, shopItemSeries } from '@shared/constants';
import { useAccountStore } from '../stores/account-store';
import { useI18nStore } from '../stores/i18n-store';
import { SHOP_ITEMS, getShopItem, ownsShopItem } from '../shop-catalog';
import { useMotionStore } from '../stores/motion-store';
import {
  BORDER_SERIES, OTHER_SERIES, isCollectionFilter, resolveShopView, shopGroupQuery, shopProducts, shopSeriesCounts,
  shopSeriesQuery, shopTypeCount, shopTypeQuery,
} from '../shop-filters';
import type { ShopGroupId } from '../shop-filters';
import { equipPatch, equipmentTarget, equippedId, isEquipped, replacementFor } from '../shop-equipment';
import type { EquipmentTarget } from '../shop-equipment';
import { isAnimatedSeries, shopSeriesArtwork } from '../shop-series';
import { FitArt, ShopProductArt, ShopProductPreview, ShopThumb } from '../components/ShopProductArt';
import { EquipmentThumb, equipmentValueName } from '../components/EquipmentThumb';
import { ShopSeriesPicker } from '../components/ShopSeriesPicker';
import { ShopSticker } from '../components/ShopSticker';
import { AppIcon } from '../components/AppIcon';
import { Button, buttonClassName } from '../components/Button';
import { Chip } from '../components/Chip';
import { CoinBalance } from '../components/CoinBalance';
import { Tabs, tabElementId } from '../components/Tabs';
import { dialogPaperClass, dialogParts } from '../styles/dialog';
import styles from './ShopPage.module.css';

/** What the toast's "switch back" button restores: the previous value of each slot a purchase or equip changed. */
type Undo = Partial<Record<EquipmentTarget, string | null>>;

interface Notice {
  readonly message: string;
  readonly severity: 'success' | 'error';
  readonly undo?: Undo;
}

export function ShopPage(): ReactNode {
  const account = useAccountStore((state) => state.account);
  const { t, locale } = useI18nStore();
  const reducedMotion = useMotionStore((state) => state.reducedMotion);
  const [searchParams, setSearchParams] = useSearchParams();
  const [detailId, setDetailId] = useState<ShopItemId | null>(null);
  /** The sticker pack just bought: its dialog turns into a success view instead of closing. */
  const [addedPack, setAddedPack] = useState<ShopItemId | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const view = resolveShopView(searchParams, SHOP_ITEMS);
  const products = shopProducts(SHOP_ITEMS, view);
  const navigate = (next: URLSearchParams): void => setSearchParams(next, { preventScrollReset: true });
  if (!account) return null;
  const format = (value: number): string => value.toLocaleString(locale);
  const itemName = (item: ShopItem): string => t(`shop.item.${item.id}.name`);
  const detail = getShopItem(detailId);
  const detailOwned = detail ? ownsShopItem(account, detail) : false;
  const detailEquipped = detail ? isEquipped(account, detail) : false;
  const detailTarget = detail ? equipmentTarget(detail.type) : null;
  const detailAffordable = detail ? (account.coins ?? 0) >= detail.price : false;
  const detailReplacement = detail ? replacementFor(account, detail) : null;

  /** Applies a server result to the open account, unless the user signed in as someone else meanwhile. */
  const settle = (result: ApiResult<{ account: AccountProfile }>, next: (updated: AccountProfile) => void, failure?: string): void => {
    if (useAccountStore.getState().account?.id !== account.id) return;
    if (result.success) {
      useAccountStore.getState().setAccount(result.account);
      next(result.account);
    } else setNotice({ message: failure ?? result.error, severity: 'error' });
  };

  const undoFor = (item: ShopItem): Undo | undefined => {
    const target = equipmentTarget(item.type);
    return target ? { [target]: equippedId(account, target) } : undefined;
  };

  const purchase = async (item: ShopItem, equip: boolean): Promise<void> => {
    if (busy || ownsShopItem(account, item)) return;
    const undo = equip ? undoFor(item) : undefined;
    setBusy(true);
    const result = await apiRequest<{ account: AccountProfile }>('/api/auth/shop/items', 'POST', { item: item.id, equip });
    setBusy(false);
    if (item.type === 'stickerPack' && result.success) {
      // Keep the dialog open on the new stickers; the success view closes it.
      settle(result, () => setAddedPack(item.id));
      return;
    }
    setDetailId(null);
    settle(result, () => setNotice({
      message: t(equip ? 'shop.toast.boughtEquipped' : 'shop.toast.bought', { name: itemName(item) }),
      severity: 'success', undo,
    }), !result.success && result.status === 409 ? t('shop.insufficient') : undefined);
  };

  const equip = async (item: ShopItem): Promise<void> => {
    const patch = equipPatch(item);
    if (busy || !patch || !ownsShopItem(account, item) || isEquipped(account, item)) return;
    const undo = undoFor(item);
    setBusy(true);
    const result = await apiRequest<{ account: AccountProfile }>('/api/auth/profile', 'PATCH', patch);
    setBusy(false);
    setDetailId(null);
    settle(result, () => setNotice({ message: t('shop.toast.equipped', { name: itemName(item) }), severity: 'success', undo }));
  };

  const revert = async (undo: Undo): Promise<void> => {
    if (busy) return;
    setNotice(null);
    setBusy(true);
    const result = await apiRequest<{ account: AccountProfile }>('/api/auth/profile', 'PATCH', undo);
    setBusy(false);
    settle(result, () => setNotice({ message: t('shop.toast.reverted'), severity: 'success' }));
  };

  const borderSeries = BORDER_SERIES.find((series) => series === view.series);
  const collection = isCollectionFilter(view.series) ? view.series : null;
  const tabLabel = t(view.type === 'all' ? `shop.group.${view.group}` : `shop.type.${view.type}`);
  const title = borderSeries ? t(`shop.category.${borderSeries}`) : tabLabel;
  const ownedCount = products.filter((item) => ownsShopItem(account, item)).length;
  const detailSeries = detail ? shopItemSeries(detail) : null;
  const pickSeries = (series: Parameters<typeof shopSeriesQuery>[2]): void =>
    navigate(shopSeriesQuery(searchParams, view.type, series, view.group));

  const banner = (name: string, description: string, art: ReactNode, animated: boolean): ReactNode =>
    <section className={styles.banner} aria-label={name}>
      <span className={styles.bannerArt}>{art}</span>
      <div className={styles.bannerText}>
        <p className={styles.bannerName}>{name}
          {animated && <span className={styles.bannerBadge}>{t('shop.seriesBanner.animated')}</span>}</p>
        <p className={styles.bannerDescription}>{description}</p>
      </div>
      <div className={styles.bannerSide}>
        <span className={styles.bannerOwned}>{t('shop.seriesBanner.owned', { owned: format(ownedCount), total: format(products.length) })}</span>
        <button type="button" className={styles.bannerClear} onClick={() => pickSeries('all')}>
          <AppIcon name="close" />{t('shop.seriesBanner.clear')}</button>
      </div>
    </section>;

  return <main className={styles.page} data-reduced-motion={reducedMotion || undefined}>
    <h1 className={styles.srOnly}>{t('shop.title')}</h1>
    <div className={styles.header}>
      <header className={styles.bar}>
        <Tabs<ShopGroupId> idPrefix="shop-group" controls="shop-catalog" label={t('shop.groups')} value={view.group}
          className={styles.groups} onChange={(group) => navigate(shopGroupQuery(searchParams, group))}
          tabs={view.groups.map((group) => ({ id: group, label: t(`shop.group.${group}`) }))} />
        <ShopSeriesPicker series={view.series} counts={shopSeriesCounts(SHOP_ITEMS, view)} tabLabel={tabLabel}
          onSelect={pickSeries} />
        <CoinBalance className={styles.coins} />
      </header>
      <nav className={styles.types} aria-label={t('shop.categories')}>
        {(['all', ...view.types] as const).map((type) => <Chip key={type} selected={view.type === type}
          count={shopTypeCount(SHOP_ITEMS, view, type)} aria-controls="shop-catalog"
          onClick={() => navigate(shopTypeQuery(searchParams, type, view.group))}>
          {t(type === 'all' ? 'shop.allProducts' : `shop.type.${type}`)}
        </Chip>)}
        {borderSeries && <span className={styles.total} aria-live="polite">
          {t('shop.itemCount', { n: format(products.length) })}</span>}
      </nav>
      {view.type === 'avatarBorder' && <nav className={styles.borders} aria-label={t('shop.borderFilter')}>
        {(['all', ...BORDER_SERIES] as const).map((series) => <Chip key={series} aria-controls="shop-catalog"
          selected={series === 'all' ? borderSeries === undefined : borderSeries === series}
          onClick={() => pickSeries(series)}>
          {t(series === 'all' ? 'shop.borderFilter.all' : `shop.category.${series}`)}
        </Chip>)}
      </nav>}
    </div>
    <section id="shop-catalog" className={styles.catalog} role="tabpanel"
      aria-labelledby={tabElementId('shop-group', view.group)}>
      <h2 id="shop-catalog-title" className={styles.srOnly}>{title}</h2>
      {collection === OTHER_SERIES && banner(t('shop.otherSeries.name'), t('shop.otherSeries.description'),
        <AppIcon name="shop" />, false)}
      {collection && collection !== OTHER_SERIES && banner(t(`shop.series.${collection}.name`),
        t(`shop.series.${collection}.description`),
        <img src={shopSeriesArtwork(collection, true)} alt="" data-animated={isAnimatedSeries(collection) || undefined} />,
        isAnimatedSeries(collection))}
      {/* Borders preview on the avatar itself, so they need no visibility note. */}
      {view.type !== 'all' && view.type !== 'avatarBorder'
        && <p className={styles.note}>{t(`shop.visibility.${view.type}`)}</p>}
      {products.length === 0 && <p className={styles.empty} role="status">{t('shop.emptyCollection')}</p>}
      <ul className={styles.products}>{products.map((item) => {
        const productName = itemName(item);
        const owned = ownsShopItem(account, item);
        const active = isEquipped(account, item);
        const canEquip = owned && item.type !== 'stickerPack';
        const equipNow = canEquip && !active;
        const series = shopItemSeries(item);
        return <li key={item.id} className={styles.product} data-shop-series={series ?? undefined}
          data-shop-type={item.type} data-equipped={active || undefined}>
          <ShopProductPreview item={item} account={account} className={styles.productArt}>
            {owned && <span className={styles.ownedMark} aria-hidden="true"><AppIcon name="check" /></span>}
          </ShopProductPreview>
          <h3 className={styles.name}>{productName}</h3>
          {/* An unequipped owned product shows an equip button; the card itself still opens the details. */}
          {equipNow && <button type="button" className={styles.equip} disabled={busy}
            aria-label={t('shop.equipNamed', { name: productName })} onClick={() => void equip(item)}>{t('shop.equip')}</button>}
          <button type="button" className={styles.open}
            data-state={active ? 'equipped' : equipNow ? 'details' : owned ? 'owned' : 'buy'}
            aria-haspopup="dialog" disabled={busy}
            aria-label={t(active ? 'shop.equippedNamed' : equipNow ? 'shop.detailsNamed'
              : owned ? 'shop.ownedNamed' : 'shop.buyNamed', { name: productName })}
            onClick={() => { setAddedPack(null); setDetailId(item.id); }}>
            {equipNow ? null : owned ? <>{active && <AppIcon name="check" />}{t(active ? 'shop.equipped' : 'shop.owned')}</>
              : <><AppIcon name="coins" />{format(item.price)}</>}
          </button>
        </li>;
      })}</ul>
    </section>
    {detail && <Dialog open aria-labelledby="shop-purchase-title"
      onClose={() => { if (!busy) { setDetailId(null); setAddedPack(null); } }}
      slotProps={{ paper: { className: dialogPaperClass('narrow', styles.dialog) } }}>
      {addedPack === detail.id ? <>
        <div className={`${dialogParts.body} ${styles.added}`}>
          <span className={styles.addedMark} aria-hidden="true"><AppIcon name="check" /></span>
          <h2 id="shop-purchase-title">{t('shop.stickers.added', { name: itemName(detail) })}</h2>
          <div className={styles.addedStickers}>{SHOP_STICKERS.filter((sticker) => sticker.packId === detail.id)
            .map((sticker) => <ShopSticker key={sticker.id} id={sticker.id} small />)}</div>
          <p className={styles.dialogMeta}>{t('shop.stickers.hint')}</p>
        </div>
        <div className={dialogParts.footer}>
          <Link to="/messages" className={buttonClassName('ghost')}><AppIcon name="chat" />{t('shop.stickers.goMessages')}</Link>
          <Button variant="primary" autoFocus onClick={() => { setDetailId(null); setAddedPack(null); }}>{t('shop.done')}</Button>
        </div>
      </> : <>
        <div className={`${dialogParts.body} ${styles.dialogBody}`}>
          <div className={styles.dialogArt}>{detail.type === 'tableBackground' || detail.type === 'seatBackground'
            ? <ShopProductArt item={detail} account={account} />
            : <FitArt fill={false} interactive><ShopProductArt item={detail} account={account} /></FitArt>}</div>
          <div className={styles.dialogText}>
            <h2 id="shop-purchase-title">{itemName(detail)}</h2>
            <p className={styles.dialogMeta}>
              {[t(`shop.type.${detail.type}`), detailSeries ? t(`shop.series.${detailSeries}.name`)
                : detail.type === 'avatarBorder' ? t(`shop.category.${detail.category}`) : null].filter(Boolean).join(' · ')}</p>
            {detailOwned ? <p className={styles.dialogStatus}>{t(detailEquipped ? 'shop.equipped' : 'shop.owned')}</p>
              : <p className={styles.dialogPrice} aria-label={t('shop.price', { n: format(detail.price) })}>
                <AppIcon name="coins" />{format(detail.price)}
                {detailAffordable
                  ? <span className={styles.dialogBalance}>{t('shop.balanceAfter', { n: format((account.coins ?? 0) - detail.price) })}</span>
                  : <span className={styles.dialogWarning} role="alert">
                    {t('shop.shortBy', { n: format(detail.price - (account.coins ?? 0)) })}</span>}</p>}
            {detailReplacement && detailTarget && <div className={styles.replace}>
              <p className={styles.replaceTitle}>{t('shop.dialog.replaces')}</p>
              <div className={styles.replaceRow}>
                <EquipmentThumb target={detailTarget} value={detailReplacement} account={account} />
                <span className={styles.replaceName}>{equipmentValueName(t, detailTarget, detailReplacement)}</span>
                <span className={styles.replaceArrow} aria-hidden="true">→</span>
                <ShopThumb item={detail} account={account} />
                <strong className={styles.replaceName}>{itemName(detail)}</strong>
              </div>
              {detailReplacement.kind === 'custom' && <p className={styles.dialogMeta}>{t('shop.dialog.customKept')}</p>}
            </div>}
          </div>
        </div>
        <div className={dialogParts.footer}>
          <Button className={styles.cancel} disabled={busy} onClick={() => setDetailId(null)} autoFocus>
            {t(detailOwned && !detailTarget || detailEquipped ? 'table.close' : 'common.cancel')}</Button>
          {!detailOwned && detailTarget && <Button disabled={busy || !detailAffordable}
            onClick={() => void purchase(detail, false)}>{t('shop.buyOnly')}</Button>}
          {!detailOwned && <Button variant="primary" icon="coins" disabled={busy || !detailAffordable}
            onClick={() => void purchase(detail, detailTarget !== null)}>
            {t(busy ? 'common.loading' : detailTarget ? 'shop.buyAndEquip' : 'shop.buy')}</Button>}
          {detailOwned && detailTarget && !detailEquipped && <Button variant="primary" disabled={busy}
            onClick={() => void equip(detail)}>{t(busy ? 'common.loading' : 'shop.equip')}</Button>}
        </div>
      </>}
    </Dialog>}
    <Snackbar open={notice !== null} autoHideDuration={notice?.undo ? 8000 : 5000} onClose={(_event, reason) => {
      if (reason !== 'clickaway') setNotice(null);
    }}>
      <Alert severity={notice?.severity ?? 'success'} variant="filled" onClose={() => setNotice(null)}
        action={<>
          {notice?.undo && <button type="button" className={styles.undo} disabled={busy}
            onClick={() => void revert(notice.undo ?? {})}><AppIcon name="undo" />{t('shop.toast.undo')}</button>}
          <button type="button" className={styles.toastClose} aria-label={t('equipment.pickerClose')}
            onClick={() => setNotice(null)}><AppIcon name="close" /></button>
        </>}>
        {notice?.message}
      </Alert>
    </Snackbar>
  </main>;
}
