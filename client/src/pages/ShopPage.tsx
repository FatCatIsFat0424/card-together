import { useState } from 'react';
import type { ReactNode } from 'react';
import type { AccountProfile } from '@shared/types';
import Tooltip from '@mui/material/Tooltip';
import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import { apiRequest } from '../api';
import { GAME_COIN_REWARD } from '@shared/constants';
import { useAccountStore } from '../stores/account-store';
import { useI18nStore } from '../stores/i18n-store';
import { AVATAR_BORDERS } from '../shop-catalog';
import type { AvatarBorderId } from '../shop-catalog';
import { AvatarBorder } from '../components/AvatarBorder';
import { AppIcon } from '../components/AppIcon';
import styles from './ShopPage.module.css';

export function ShopPage(): ReactNode {
  const account = useAccountStore((state) => state.account);
  const { t, locale } = useI18nStore();
  const [pendingPurchase, setPendingPurchase] = useState<AvatarBorderId | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ message: string; severity: 'success' | 'error' } | null>(null);
  if (!account) return null;
  const format = (value: number): string => value.toLocaleString(locale);
  const avatar = { avatar: account.avatar, image: account.avatarImage, color: account.color };
  const owned = (id: AvatarBorderId): boolean => account.ownedAvatarBorders?.includes(id) ?? false;
  const purchaseItem = AVATAR_BORDERS.find((border) => border.id === pendingPurchase);
  const purchaseOwned = purchaseItem ? owned(purchaseItem.id) : false;
  const purchaseAffordable = purchaseItem ? (account.coins ?? 0) >= purchaseItem.price : false;
  const purchase = async (border: AvatarBorderId): Promise<void> => {
    if (busy || owned(border)) return;
    setBusy(true);
    const result = await apiRequest<{ account: AccountProfile }>('/api/auth/shop/avatar-borders', 'POST', { border });
    setBusy(false);
    setPendingPurchase(null);
    if (useAccountStore.getState().account?.id !== account.id) return;
    if (result.success) {
      useAccountStore.getState().setAccount(result.account);
      setNotice({ message: t('shop.purchased'), severity: 'success' });
    } else setNotice({ message: result.status === 409 ? t('shop.insufficient') : result.error, severity: 'error' });
  };

  return <main className={styles.page}>
    <header className={styles.header}>
      <div className={styles.heading}>
        <span className={styles.shopIcon}><AppIcon name="shop" /></span>
        <div><h1>{t('shop.title')}</h1><p>{t('shop.description')}</p></div>
      </div>
      <Tooltip title={t('shop.earn', { n: String(GAME_COIN_REWARD) })} describeChild arrow>
        <section className={styles.wallet} aria-labelledby="shop-wallet-title" tabIndex={0}>
          <span id="shop-wallet-title">{t('shop.balance')}</span>
          <strong><AppIcon name="coins" />{format(account.coins ?? 0)}</strong>
        </section>
      </Tooltip>
    </header>
    <section className={styles.catalog} aria-labelledby="shop-catalog-title">
      <div className={styles.catalogHeader}><h2 id="shop-catalog-title">{t('shop.catalog')}</h2>
        <span>{t('shop.itemCount', { n: String(AVATAR_BORDERS.length) })}</span></div>
      <ul className={styles.products}>{AVATAR_BORDERS.map((border) => {
        const productName = t(`shop.item.${border.id}.name`);
        return <li key={border.id} className={styles.product}>
          <div className={`${styles.productArt} ${styles[border.category]}`}>
            <span className={styles.category}>{t(`shop.category.${border.category}`)}</span>
            <AvatarBorder border={border.id} {...avatar} />
          </div>
          <div className={styles.productBody}>
            <h3>{productName}</h3>
            <p className={styles.description}>{t(`shop.item.${border.id}.description`)}</p>
            <div className={styles.productFooter}>
              <span className={styles.price} aria-label={t('shop.price', { n: format(border.price) })}>
                <AppIcon name="coins" />{format(border.price)}</span>
            </div>
            <button type="button" className={`btn btn-primary ${styles.buy}`} disabled={busy || owned(border.id)}
              aria-label={t(owned(border.id) ? 'shop.ownedNamed' : 'shop.buyNamed', { name: productName })}
              onClick={() => setPendingPurchase(border.id)}>
              {t(owned(border.id) ? 'shop.owned' : busy ? 'common.loading' : 'shop.buy')}
            </button>
          </div>
        </li>;
      })}</ul>
    </section>
    {purchaseItem && <Dialog open fullWidth maxWidth="xs"
      aria-labelledby="shop-purchase-title" aria-describedby="shop-purchase-description"
      onClose={() => { if (!busy) setPendingPurchase(null); }}
      slotProps={{ paper: { className: styles.purchaseDialog } }}>
      <DialogTitle id="shop-purchase-title">{t('shop.confirmTitle')}</DialogTitle>
      <DialogContent dividers className={styles.purchaseContent}>
        <div className={styles.purchaseArt}><AvatarBorder border={purchaseItem.id} {...avatar} /></div>
        <p id="shop-purchase-description">{t('shop.confirmDescription', {
          name: t(`shop.item.${purchaseItem.id}.name`), n: format(purchaseItem.price),
        })}</p>
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
          onClick={() => void purchase(purchaseItem.id)}>
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
