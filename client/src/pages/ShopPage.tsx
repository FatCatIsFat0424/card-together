import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { AccountProfile, EquipmentSlot, ShopItem, ShopItemId, ShopItemType } from '@shared/types';
import Tooltip from '@mui/material/Tooltip';
import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import { apiRequest } from '../api';
import { GAME_COIN_REWARD, equipmentSlotFor } from '@shared/constants';
import { useAccountStore } from '../stores/account-store';
import { useI18nStore } from '../stores/i18n-store';
import { SHOP_ITEMS, getShopItem, ownsShopItem } from '../shop-catalog';
import { ShopProductArt } from '../components/ShopProductArt';
import { AppIcon } from '../components/AppIcon';
import styles from './ShopPage.module.css';

const BORDER_SERIES = ['ears', 'metal', 'special'] as const;
const PRODUCT_TYPES = [
  'avatarBorder', 'nameplate', 'chatFrame', 'stickerPack', 'cardBack', 'cardFace', 'tableBackground', 'chipStyle',
  'seatBackground', 'seatFrame', 'victoryEffect', 'soundPack',
] as const satisfies readonly ShopItemType[];

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

export function ShopPage(): ReactNode {
  const account = useAccountStore((state) => state.account);
  const { t, locale } = useI18nStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const [pendingPurchase, setPendingPurchase] = useState<ShopItemId | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ message: string; severity: 'success' | 'error' } | null>(null);
  const categoryList = useRef<HTMLUListElement>(null);
  const selectedSeries = BORDER_SERIES.find((series) => series === searchParams.get('series')) ?? 'all';
  const selectedType = PRODUCT_TYPES.find((type) => type === searchParams.get('type'))
    ?? (selectedSeries !== 'all' ? 'avatarBorder' : 'all');
  useEffect(() => {
    const list = categoryList.current;
    if (!list) return;
    const revealSelection = (): void => {
      const selected = list.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
      if (!selected || list.scrollWidth <= list.clientWidth) return;
      const container = list.getBoundingClientRect();
      const button = selected.getBoundingClientRect();
      if (button.left < container.left || button.right > container.right) {
        list.scrollLeft += button.left - container.left - (list.clientWidth - button.width) / 2;
      }
    };
    revealSelection();
    const observer = new ResizeObserver(revealSelection);
    observer.observe(list);
    return () => observer.disconnect();
  }, [selectedType]);
  const products = SHOP_ITEMS.filter((item) => (selectedType === 'all' || item.type === selectedType)
    && (selectedType !== 'avatarBorder' || selectedSeries === 'all'
      || (item.type === 'avatarBorder' && item.category === selectedSeries)));
  const selectType = (type: ShopItemType | 'all'): void => {
    const next = new URLSearchParams(searchParams);
    if (type === 'all') next.delete('type');
    else next.set('type', type);
    next.delete('series');
    setSearchParams(next, { preventScrollReset: true });
  };
  const selectSeries = (series: typeof selectedSeries): void => {
    const next = new URLSearchParams(searchParams);
    next.set('type', 'avatarBorder');
    if (series === 'all') next.delete('series');
    else next.set('series', series);
    setSearchParams(next, { preventScrollReset: true });
  };
  if (!account) return null;
  const format = (value: number): string => value.toLocaleString(locale);
  const purchaseItem = getShopItem(pendingPurchase);
  const purchaseOwned = purchaseItem ? ownsShopItem(account, purchaseItem) : false;
  const purchaseAffordable = purchaseItem ? (account.coins ?? 0) >= purchaseItem.price : false;
  const purchase = async (item: ShopItem): Promise<void> => {
    if (busy || ownsShopItem(account, item)) return;
    setBusy(true);
    const result = await apiRequest<{ account: AccountProfile }>('/api/auth/shop/items', 'POST', { item: item.id });
    setBusy(false);
    setPendingPurchase(null);
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
    if (useAccountStore.getState().account?.id !== account.id) return;
    if (result.success) {
      useAccountStore.getState().setAccount(result.account);
      setNotice({ message: t('shop.equippedNotice'), severity: 'success' });
    } else setNotice({ message: result.error, severity: 'error' });
  };

  return <main className={styles.page}>
    <header className={styles.header}>
      <div className={styles.heading}>
        <span className={styles.shopIcon}><AppIcon name="shop" /></span>
        <h1>{t('shop.title')}</h1>
      </div>
      <Tooltip title={t('shop.earn', { n: String(GAME_COIN_REWARD) })} describeChild arrow>
        <section className={styles.wallet} aria-labelledby="shop-wallet-title" tabIndex={0}>
          <span id="shop-wallet-title">{t('shop.balance')}</span>
          <strong><AppIcon name="coins" />{format(account.coins ?? 0)}</strong>
        </section>
      </Tooltip>
    </header>
    <div className={styles.shopLayout}>
      <nav className={styles.sidebar} aria-label={t('shop.categories')}>
        <ul ref={categoryList} className={styles.filters}>{(['all', ...PRODUCT_TYPES] as const).map((type) => {
          const count = type === 'all' ? SHOP_ITEMS.length : SHOP_ITEMS.filter((item) => item.type === type).length;
          return <li key={type}><button type="button" className={styles.filter}
            aria-pressed={selectedType === type} aria-controls="shop-catalog"
            onClick={() => selectType(type)}>
            <span>{t(type === 'all' ? 'shop.allProducts' : `shop.type.${type}`)}</span>
            <span className={styles.filterCount}>{format(count)}</span>
          </button></li>;
        })}</ul>
      </nav>
      <section id="shop-catalog" className={styles.catalog} aria-labelledby="shop-catalog-title">
        <div className={styles.catalogHeader} aria-live="polite" aria-atomic="true">
          <div>
            <h2 id="shop-catalog-title">{t(selectedType === 'all' ? 'shop.allProducts'
              : selectedType === 'avatarBorder' && selectedSeries !== 'all' ? `shop.category.${selectedSeries}` : `shop.type.${selectedType}`)}</h2>
            {/* Borders preview on the avatar itself, so they need no visibility note. */}
            {selectedType !== 'all' && selectedType !== 'avatarBorder'
              && <p className={styles.catalogSubtitle}>{t(`shop.visibility.${selectedType}`)}</p>}
          </div>
          {/* Category buttons already show totals; only a series filter changes the count. */}
          {selectedType === 'avatarBorder' && selectedSeries !== 'all'
            && <span>{t('shop.itemCount', { n: format(products.length) })}</span>}</div>
        {selectedType === 'avatarBorder' && <div className={styles.seriesFilters} role="group" aria-label={t('shop.allSeries')}>
          {(['all', ...BORDER_SERIES] as const).map((series) => <button key={series} type="button"
            className={styles.filter} aria-pressed={selectedSeries === series} aria-controls="shop-catalog"
            onClick={() => selectSeries(series)}>
            {t(series === 'all' ? 'shop.allSeries' : `shop.category.${series}`)}
          </button>)}
        </div>}
        <ul className={styles.products}>{products.map((item) => {
          const productName = t(`shop.item.${item.id}.name`);
          const owned = ownsShopItem(account, item);
          const active = equipped(account, item);
          const canEquip = owned && item.type !== 'stickerPack';
          return <li key={item.id} className={styles.product}>
            <div className={`${styles.productArt} ${item.type === 'avatarBorder' ? styles[item.category] : styles[item.type]}`}>
              <span className={styles.category}>{t(item.type === 'avatarBorder' ? `shop.category.${item.category}` : `shop.type.${item.type}`)}</span>
              {owned && <span className={styles.ownedTag}>{t(active ? 'shop.equipped' : 'shop.owned')}</span>}
              <ShopProductArt item={item} account={account} />
            </div>
            <div className={styles.productBody}>
              <h3>{productName}</h3>
              <p className={styles.description}>{t(`shop.item.${item.id}.description`)}</p>
              <div className={styles.productFooter}>
                <span className={styles.price} aria-label={t('shop.price', { n: format(item.price) })}>
                  <AppIcon name="coins" />{format(item.price)}</span>
              </div>
              <button type="button" className={`btn btn-primary ${styles.buy}`} disabled={busy || active || (owned && !canEquip)}
                aria-label={t(active ? 'shop.equippedNamed' : canEquip ? 'shop.equipNamed'
                  : owned ? 'shop.ownedNamed' : 'shop.buyNamed', { name: productName })}
                onClick={() => { if (canEquip) void equip(item); else setPendingPurchase(item.id); }}>
                {t(busy ? 'common.loading' : active ? 'shop.equipped' : canEquip ? 'shop.equip' : owned ? 'shop.owned' : 'shop.buy')}
              </button>
            </div>
          </li>;
        })}</ul>
      </section>
    </div>
    {purchaseItem && <Dialog open fullWidth maxWidth="xs"
      aria-labelledby="shop-purchase-title" aria-describedby="shop-purchase-description"
      onClose={() => { if (!busy) setPendingPurchase(null); }}
      slotProps={{ paper: { className: styles.purchaseDialog } }}>
      <DialogTitle id="shop-purchase-title">{t('shop.confirmTitle')}</DialogTitle>
      <DialogContent dividers className={styles.purchaseContent}>
        <div className={styles.purchaseArt}><ShopProductArt item={purchaseItem} account={account} /></div>
        <p id="shop-purchase-description">{t('shop.confirmDescription', {
          name: t(`shop.item.${purchaseItem.id}.name`), n: format(purchaseItem.price),
        })}</p>
        <p className={styles.visibility}>{purchaseItem.type !== 'avatarBorder'
          && `${t(`shop.visibility.${purchaseItem.type}`)} `}{t('shop.permanent')}</p>
        {purchaseOwned ? <Alert severity="info">{t('shop.owned')}</Alert>
          : purchaseAffordable ? <p className={styles.purchaseBalance}>{t('shop.balanceAfter', {
            n: format((account.coins ?? 0) - purchaseItem.price),
          })}</p>
            : <Alert severity="warning">{t('shop.insufficient')}</Alert>}
      </DialogContent>
      <DialogActions disableSpacing className={styles.purchaseActions}>
        <button type="button" className="btn btn-outline" disabled={busy}
          onClick={() => setPendingPurchase(null)} autoFocus>{t('common.cancel')}</button>
        <button type="button" className="btn btn-primary" disabled={busy || purchaseOwned || !purchaseAffordable}
          onClick={() => void purchase(purchaseItem)}>
          {t(busy ? 'common.loading' : 'shop.confirmBuy')}
        </button>
      </DialogActions>
    </Dialog>}
    <Snackbar open={notice !== null} autoHideDuration={5000} onClose={() => setNotice(null)}>
      <Alert severity={notice?.severity ?? 'success'} onClose={() => setNotice(null)} variant="filled">
        {notice?.message}
      </Alert>
    </Snackbar>
  </main>;
}
