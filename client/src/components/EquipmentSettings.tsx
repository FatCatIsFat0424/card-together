import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AccountProfile, ShopItemId } from '@shared/types';
import { CARD_BACKS, TABLE_BACKGROUNDS, SEAT_BACKGROUNDS, NAMEPLATES, ownsShopItem } from '@shared/constants';
import { apiRequest } from '../api';
import { useAccountStore } from '../stores/account-store';
import { useI18nStore } from '../stores/i18n-store';
import styles from '../pages/AccountPage.module.css';

const EQUIPMENT = [
  { field: 'cardBackStyle', type: 'cardBack', items: CARD_BACKS },
  { field: 'tableBackgroundStyle', type: 'tableBackground', items: TABLE_BACKGROUNDS },
  { field: 'seatBackgroundStyle', type: 'seatBackground', items: SEAT_BACKGROUNDS },
  { field: 'nameplate', type: 'nameplate', items: NAMEPLATES },
] as const;
type EquipmentField = typeof EQUIPMENT[number]['field'];

export function EquipmentSettings({ account }: { readonly account: AccountProfile }): ReactNode {
  const { t } = useI18nStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const pending = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  const equip = async (field: EquipmentField, id: ShopItemId | null): Promise<void> => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setSaved(false);
    const result = await apiRequest<{ account: AccountProfile }>('/api/auth/profile', 'PATCH', { [field]: id });
    pending.current = false;
    if (!active.current || useAccountStore.getState().account?.id !== account.id) return;
    setBusy(false);
    if (result.success) {
      useAccountStore.getState().setAccount(result.account);
      setSaved(true);
    } else setError(result.error);
  };

  return <section className={styles.equipment} aria-labelledby="profile-equipment-heading">
    <h2 id="profile-equipment-heading">{t('shop.equipment')}</h2>
    <p>{t('shop.equippedNotice')}</p>
    <div className={styles.equipmentGrid}>
      {EQUIPMENT.map(({ field, type, items }) => <div key={field}>
        <label htmlFor={`equipment-${field}`}>{t(`shop.type.${type}`)}</label>
        <select id={`equipment-${field}`} value={account[field] ?? ''} disabled={busy}
          onChange={(event) => {
            const owned = items.find((item) => item.id === event.target.value && ownsShopItem(account, item));
            void equip(field, owned?.id ?? null);
          }}>
          <option value="">{type === 'nameplate' ? t('shop.noNameplate') : t('shop.useUpload')}</option>
          {items.filter((item) => ownsShopItem(account, item)).map((item) =>
            <option key={item.id} value={item.id}>{t(`shop.item.${item.id}.name`)}</option>)}
        </select>
      </div>)}
    </div>
    {busy && <p role="status">{t('common.loading')}</p>}
    {saved && <p role="status">{t('profile.saved')}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
