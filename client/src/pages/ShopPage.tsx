import { useState } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { AccountProfile, EquipmentSlot, ShopItem, ShopItemId } from '@shared/types';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import Dialog from '@mui/material/Dialog';
import { apiRequest } from '../api';
import { equipmentSlotFor, SHOP_SERIES, shopItemSeries } from '@shared/constants';
import { useAccountStore } from '../stores/account-store';
import { useI18nStore } from '../stores/i18n-store';
import { SHOP_ITEMS, getShopItem, ownsShopItem } from '../shop-catalog';
import { useMotionStore } from '../stores/motion-store';
import {
  BORDER_SERIES, OTHER_SERIES, resolveShopView, shopGroupQuery, shopProducts, shopSeriesQuery, shopTypeCount, shopTypeQuery,
} from '../shop-filters';
import type { ShopGroupId, ShopSeriesFilter } from '../shop-filters';
import { FitArt, ShopProductArt, ShopProductPreview } from '../components/ShopProductArt';
import { AppIcon } from '../components/AppIcon';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { CoinBalance } from '../components/CoinBalance';
import { Tabs, tabElementId } from '../components/Tabs';
import { dialogPaperClass, dialogParts } from '../styles/dialog';
import styles from './ShopPage.module.css';

function equipmentPatch(item: ShopItem): Partial<Pick<AccountProfile, 'avatarBorder' | EquipmentSlot>> | null {
  if (item.type === 'avatarBorder') return { avatarBorder: item.id };
  const slot = equipmentSlotFor(item.type);
  return slot ? { [slot]: item.id } : null;
}

function equipped(account: AccountProfile, item: ShopItem): boolean {
  if (item.type === 'avatarBorder') return account.avatarBorder === item.id;
  const slot = equipmentSlotFor(item.type);
  return slot !== null && account[slot] === item.id;
}

function seriesFilter(value: string): ShopSeriesFilter {
  const options: readonly ShopSeriesFilter[] = [...BORDER_SERIES, ...SHOP_SERIES, OTHER_SERIES];
  return options.find((entry) => entry === value) ?? 'all';
}

export function ShopPage(): ReactNode {
  const account = useAccountStore((state) => state.account);
  const { t, locale } = useI18nStore();
  const reducedMotion = useMotionStore((state) => state.reducedMotion);
  const [searchParams, setSearchParams] = useSearchParams();
  const [detailId, setDetailId] = useState<ShopItemId | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ message: string; severity: 'success' | 'error' } | null>(null);
  const view = resolveShopView(searchParams, SHOP_ITEMS);
  const products = shopProducts(SHOP_ITEMS, view);
  const navigate = (next: URLSearchParams): void => setSearchParams(next, { preventScrollReset: true });
  if (!account) return null;
  const format = (value: number): string => value.toLocaleString(locale);
  const detail = getShopItem(detailId);
  const detailOwned = detail ? ownsShopItem(account, detail) : false;
  const detailEquipped = detail ? equipped(account, detail) : false;
  const detailCanEquip = detailOwned && detail?.type !== 'stickerPack';
  const detailAffordable = detail ? (account.coins ?? 0) >= detail.price : false;
  const purchase = async (item: ShopItem): Promise<void> => {
    if (busy || ownsShopItem(account, item)) return;
    setBusy(true);
    const result = await apiRequest<{ account: AccountProfile }>('/api/auth/shop/items', 'POST', { item: item.id });
    setBusy(false);
    setDetailId(null);
    if (useAccountStore.getState().account?.id !== account.id) return;
    if (result.success) {
      useAccountStore.getState().setAccount(result.account);
      setNotice({ message: t('shop.purchased'), severity: 'success' });
    } else setNotice({ message: result.status === 409 ? t('shop.insufficient') : result.error, severity: 'error' });
  };
  const equip = async (item: ShopItem): Promise<void> => {
    const patch = equipmentPatch(item);
    if (busy || !patch || !ownsShopItem(account, item) || equipped(account, item)) return;
    setBusy(true);
    const result = await apiRequest<{ account: AccountProfile }>('/api/auth/profile', 'PATCH', patch);
    setBusy(false);
    setDetailId(null);
    if (useAccountStore.getState().account?.id !== account.id) return;
    if (result.success) {
      useAccountStore.getState().setAccount(result.account);
      setNotice({ message: t('shop.equippedNotice'), severity: 'success' });
    } else setNotice({ message: result.error, severity: 'error' });
  };
  const borderSeries = BORDER_SERIES.find((series) => series === view.series);
  const themedSeries = SHOP_SERIES.find((series) => series === view.series);
  const title = borderSeries ? t(`shop.category.${borderSeries}`)
    : t(view.type === 'all' ? `shop.group.${view.group}` : `shop.type.${view.type}`);
  const seriesDescription = themedSeries ? t(`shop.series.${themedSeries}.description`)
    : view.series === OTHER_SERIES ? t('shop.otherSeries.description') : null;

  return <main className={styles.page} data-reduced-motion={reducedMotion || undefined}>
    <h1 className={styles.srOnly}>{t('shop.title')}</h1>
    <div className={styles.header}>
      <header className={styles.bar}>
        <Tabs<ShopGroupId> idPrefix="shop-group" controls="shop-catalog" label={t('shop.groups')} value={view.group}
          className={styles.groups} onChange={(group) => navigate(shopGroupQuery(searchParams, group))}
          tabs={view.groups.map((group) => ({ id: group, label: t(`shop.group.${group}`) }))} />
        <label className={styles.series}>
          <span>{t('shop.seriesFilter')}</span>
          <select value={view.series} onChange={(event) =>
            navigate(shopSeriesQuery(searchParams, view.type, seriesFilter(event.target.value)))}>
            <option value="all">{t('shop.seriesAll')}</option>
            {SHOP_SERIES.map((series) => <option key={series} value={series}>{t(`shop.series.${series}.name`)}</option>)}
            <option value={OTHER_SERIES}>{t('shop.otherSeries.name')}</option>
            {view.types.includes('avatarBorder') && <optgroup label={t('shop.type.avatarBorder')}>
              {BORDER_SERIES.map((series) => <option key={series} value={series}>{t(`shop.category.${series}`)}</option>)}
            </optgroup>}
          </select>
        </label>
        <CoinBalance className={styles.coins} />
      </header>
      <nav className={styles.types} aria-label={t('shop.categories')}>
        {(['all', ...view.types] as const).map((type) => <Chip key={type} selected={view.type === type}
          count={shopTypeCount(SHOP_ITEMS, view, type)} aria-controls="shop-catalog"
          onClick={() => navigate(shopTypeQuery(searchParams, type, view.group))}>
          {t(type === 'all' ? 'shop.allProducts' : `shop.type.${type}`)}
        </Chip>)}
        {view.series !== 'all' && <span className={styles.total} aria-live="polite">
          {t('shop.itemCount', { n: format(products.length) })}</span>}
      </nav>
    </div>
    <section id="shop-catalog" className={styles.catalog} role="tabpanel"
      aria-labelledby={tabElementId('shop-group', view.group)}>
      <h2 id="shop-catalog-title" className={styles.srOnly}>{title}</h2>
      {/* Borders preview on the avatar itself, so they need no visibility note. */}
      {view.type !== 'all' && view.type !== 'avatarBorder'
        && <p className={styles.note}>{t(`shop.visibility.${view.type}`)}</p>}
      {seriesDescription && <p className={styles.note}>{seriesDescription}</p>}
      {products.length === 0 && <p className={styles.empty} role="status">{t('shop.emptyCollection')}</p>}
      <ul className={styles.products}>{products.map((item) => {
        const productName = t(`shop.item.${item.id}.name`);
        const owned = ownsShopItem(account, item);
        const active = equipped(account, item);
        const canEquip = owned && item.type !== 'stickerPack';
        const series = shopItemSeries(item);
        return <li key={item.id} className={styles.product} data-shop-series={series ?? undefined}
          data-shop-type={item.type} data-equipped={active || undefined}>
          <ShopProductPreview item={item} account={account} className={styles.productArt}>
            {owned && <span className={styles.ownedMark} aria-hidden="true"><AppIcon name="check" /></span>}
          </ShopProductPreview>
          <h3 className={styles.name}>{productName}</h3>
          <button type="button" className={styles.open} data-state={active ? 'equipped' : owned ? 'owned' : 'buy'}
            aria-haspopup="dialog" disabled={busy}
            aria-label={t(active ? 'shop.equippedNamed' : canEquip ? 'shop.equipNamed'
              : owned ? 'shop.ownedNamed' : 'shop.buyNamed', { name: productName })}
            onClick={() => setDetailId(item.id)}>
            {owned ? <>{active && <AppIcon name="check" />}{t(active ? 'shop.equipped' : 'shop.owned')}</>
              : <><AppIcon name="coins" />{format(item.price)}</>}
          </button>
        </li>;
      })}</ul>
    </section>
    {detail && <Dialog open
      aria-labelledby="shop-purchase-title" aria-describedby="shop-purchase-description"
      onClose={() => { if (!busy) setDetailId(null); }}
      slotProps={{ paper: { className: dialogPaperClass('narrow', styles.dialog) } }}>
      <div className={`${dialogParts.body} ${styles.dialogBody}`}>
        <div className={styles.dialogArt}>{detail.type === 'tableBackground' || detail.type === 'seatBackground'
          ? <ShopProductArt item={detail} account={account} />
          : <FitArt fill={false} interactive><ShopProductArt item={detail} account={account} /></FitArt>}</div>
        <div className={styles.dialogText}>
          <h2 id="shop-purchase-title">{t(`shop.item.${detail.id}.name`)}</h2>
          <p className={styles.dialogMeta}>
            {t(detail.type === 'avatarBorder' ? `shop.category.${detail.category}` : `shop.type.${detail.type}`)}</p>
          <p id="shop-purchase-description" className={styles.dialogDescription}>
            {t(`shop.item.${detail.id}.description`)}</p>
          <p className={styles.dialogMeta}>{detail.type !== 'avatarBorder'
            && `${t(`shop.visibility.${detail.type}`)} `}{t('shop.permanent')}</p>
          {detailOwned ? <p className={styles.dialogStatus}>{t(detailEquipped ? 'shop.equipped' : 'shop.owned')}</p>
            : <>
              <p className={styles.dialogPrice} aria-label={t('shop.price', { n: format(detail.price) })}>
                <AppIcon name="coins" />{format(detail.price)}</p>
              {detailAffordable
                ? <p className={styles.dialogMeta}>{t('shop.balanceAfter', { n: format((account.coins ?? 0) - detail.price) })}</p>
                : <p className={styles.dialogWarning} role="alert">{t('shop.insufficient')}</p>}
            </>}
        </div>
      </div>
      <div className={dialogParts.footer}>
        <Button disabled={busy} onClick={() => setDetailId(null)} autoFocus>
          {t(detailOwned && !detailCanEquip || detailEquipped ? 'table.close' : 'common.cancel')}</Button>
        {!detailOwned && <Button variant="primary" disabled={busy || !detailAffordable}
          onClick={() => void purchase(detail)}>{t(busy ? 'common.loading' : 'shop.confirmBuy')}</Button>}
        {detailCanEquip && !detailEquipped && <Button variant="primary" disabled={busy}
          onClick={() => void equip(detail)}>{t(busy ? 'common.loading' : 'shop.equip')}</Button>}
      </div>
    </Dialog>}
    <Snackbar open={notice !== null} autoHideDuration={5000} onClose={() => setNotice(null)}>
      <Alert severity={notice?.severity ?? 'success'} onClose={() => setNotice(null)} variant="filled">
        {notice?.message}
      </Alert>
    </Snackbar>
  </main>;
}
