import { useState } from 'react';
import type { ReactNode } from 'react';
import type { AccountProfile } from '@shared/types';
import { Link } from 'react-router-dom';
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
  const [selected, setSelected] = useState<AvatarBorderId | null>('cat');
  const [pendingPurchase, setPendingPurchase] = useState<AvatarBorderId | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ message: string; severity: 'success' | 'error' } | null>(null);
  if (!account) return null;
  const item = AVATAR_BORDERS.find((border) => border.id === selected);
  const name = item ? t(`shop.item.${item.id}.name`) : t('shop.original');
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
  const tryOn = (border: AvatarBorderId): void => {
    setSelected(border);
    if (window.matchMedia('(max-width: 52rem)').matches) {
      document.getElementById('shop-preview')?.scrollIntoView({
        block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      });
    }
  };

  return <main className={styles.page}>
    <header className={styles.header}>
      <div className={styles.heading}>
        <span className={styles.shopIcon}><AppIcon name="shop" /></span>
        <div><h1>{t('shop.title')}</h1><p>{t('shop.description')}</p></div>
      </div>
      <span className={styles.earning}><AppIcon name="coins" />{t('shop.earn', { n: String(GAME_COIN_REWARD) })}</span>
    </header>
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <section id="shop-preview" className={styles.preview} aria-labelledby="shop-preview-title">
          <h2 id="shop-preview-title">{t('shop.preview')}</h2>
          <div className={styles.previewStage}><AvatarBorder border={selected} {...avatar} size="preview" /></div>
          <p className={styles.nickname} style={{ color: account.color }}>{account.nickname}</p>
          <p className={styles.username}>@{account.username}</p>
          <div className={styles.previewDetails} aria-live="polite" aria-atomic="true">
            <h3>{name}</h3>
            {item && <>
              <p>{t(`shop.item.${item.id}.description`)}</p>
              <span className={styles.price}><AppIcon name="coins" />{t('shop.price', { n: format(item.price) })}</span>
              <span className={styles.games}>{t('shop.games', { n: format(Math.ceil(item.price / GAME_COIN_REWARD)) })}</span>
            </>}
          </div>
          <button type="button" className={`btn btn-outline ${styles.reset}`} disabled={!selected}
            onClick={() => setSelected(null)}><AppIcon name="refresh" />{t('shop.reset')}</button>
        </section>
        <section className={styles.wallet} aria-labelledby="shop-wallet-title">
          <span id="shop-wallet-title">{t('shop.balance')}</span>
          <strong><AppIcon name="coins" />{format(account.coins ?? 0)}</strong>
          <p>{t('shop.inventoryHelp')}</p>
          <Link to="/account">{t('shop.manage')}</Link>
        </section>
      </aside>
      <section className={styles.catalog} aria-labelledby="shop-catalog-title">
        <div className={styles.catalogHeader}><h2 id="shop-catalog-title">{t('shop.catalog')}</h2>
          <span>{t('shop.itemCount', { n: String(AVATAR_BORDERS.length) })}</span></div>
        <ul className={styles.products}>{AVATAR_BORDERS.map((border) => {
          const active = selected === border.id;
          const productName = t(`shop.item.${border.id}.name`);
          return <li key={border.id} className={`${styles.product} ${active ? styles.selected : ''}`}>
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
                <button type="button" className={`btn ${active ? 'btn-primary' : 'btn-outline'}`}
                  aria-label={t('shop.tryOnNamed', { name: productName })} aria-pressed={active}
                  aria-controls="shop-preview" onClick={() => tryOn(border.id)}>
                  {active && <AppIcon name="check" />}{t(active ? 'shop.tryingOn' : 'shop.tryOn')}
                </button>
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
    </div>
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
