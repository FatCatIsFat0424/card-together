import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import type { AccountProfile } from '@shared/types';
import { ACHIEVEMENT_NAMEPLATES } from '@shared/constants/shop';
import {
  CARD_BACKS, CARD_FACES, CHAT_FRAMES, CHIP_STYLES, NAMEPLATES, SEAT_BACKGROUNDS, SEAT_FRAMES, SOUND_PACKS,
  TABLE_BACKGROUNDS, VICTORY_EFFECTS, ownsShopItem,
} from '@shared/constants';
import { apiRequest } from '../api';
import type { TranslationKey } from '../i18n';
import { useAccountStore } from '../stores/account-store';
import { useI18nStore } from '../stores/i18n-store';
import { AppIcon } from './AppIcon';
import styles from '../pages/AccountPage.module.css';

// Paired in the same order as the live preview: table, seat, chat, then effects.
const EQUIPMENT = [
  { field: 'cardBackStyle', type: 'cardBack', items: CARD_BACKS },
  { field: 'cardFaceStyle', type: 'cardFace', items: CARD_FACES },
  { field: 'tableBackgroundStyle', type: 'tableBackground', items: TABLE_BACKGROUNDS },
  { field: 'chipStyle', type: 'chipStyle', items: CHIP_STYLES },
  { field: 'seatBackgroundStyle', type: 'seatBackground', items: SEAT_BACKGROUNDS },
  { field: 'seatFrame', type: 'seatFrame', items: SEAT_FRAMES },
  { field: 'nameplate', type: 'nameplate', items: NAMEPLATES },
  { field: 'chatFrame', type: 'chatFrame', items: CHAT_FRAMES },
  { field: 'victoryEffect', type: 'victoryEffect', items: VICTORY_EFFECTS },
  { field: 'soundPack', type: 'soundPack', items: SOUND_PACKS },
] as const;
type Equipment = typeof EQUIPMENT[number];
type EquipmentField = Equipment['field'];
/** Image styles fall back to an uploaded image; newer products fall back to the built-in design. */
const UPLOAD_FALLBACK: readonly string[] = ['cardBack', 'tableBackground', 'seatBackground'];

export interface EquipmentChoice {
  readonly field: EquipmentField;
  readonly label: TranslationKey;
  /** The equipped ID, or '' for the unequipped choice. */
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: TranslationKey }[];
}

/** Only owned products (and earned titles) can be chosen; the first option always unequips. */
export function equipmentChoices(account: AccountProfile): EquipmentChoice[] {
  return EQUIPMENT.map(({ field, type, items }: Equipment) => {
    const empty: TranslationKey = type === 'nameplate' ? 'shop.noNameplate'
      : UPLOAD_FALLBACK.includes(type) ? 'shop.useUpload' : 'shop.useDefault';
    const earned = field === 'nameplate'
      ? ACHIEVEMENT_NAMEPLATES.filter((item) => account.ownedAchievementNameplates?.includes(item.id))
        .map((item) => ({ value: item.id, label: `shop.title.${item.id}` as const }))
      : [];
    const owned = items.filter((item) => ownsShopItem(account, item))
      .map((item) => ({ value: item.id, label: `shop.item.${item.id}.name` as const }));
    const options = [{ value: '', label: empty }, ...earned, ...owned];
    const equipped = account[field] ?? '';
    return {
      field, label: `shop.type.${type}`, options,
      value: options.some((option) => option.value === equipped) ? equipped : '',
    };
  });
}

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

  const equip = async (choice: EquipmentChoice, value: string): Promise<void> => {
    // Values come from the rendered options, so anything else is ignored rather than sent.
    if (pending.current || !choice.options.some((option) => option.value === value)) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setSaved(false);
    const result = await apiRequest<{ account: AccountProfile }>('/api/auth/profile', 'PATCH',
      { [choice.field]: value || null });
    pending.current = false;
    if (!active.current || useAccountStore.getState().account?.id !== account.id) return;
    setBusy(false);
    if (result.success) {
      useAccountStore.getState().setAccount(result.account);
      setSaved(true);
    } else setError(result.error);
  };

  return <section className={styles.equipment} aria-labelledby="profile-equipment-heading">
    <div className={styles.equipmentHeader}>
      <h2 id="profile-equipment-heading">{t('shop.equipment')}</h2>
      <Link to="/shop" className={styles.shopLink}><AppIcon name="shop" />{t('shop.visit')}</Link>
    </div>
    <p>{t('shop.equipmentHelp')}</p>
    <div className={styles.equipmentGrid}>
      {equipmentChoices(account).map((choice) => {
        const labelId = `equipment-${choice.field}-label`;
        return <FormControl key={choice.field} fullWidth size="small" className={styles.selectField}>
          <InputLabel id={labelId} shrink>{t(choice.label)}</InputLabel>
          <Select id={`equipment-${choice.field}`} labelId={labelId} label={t(choice.label)} value={choice.value}
            displayEmpty disabled={busy}
            MenuProps={{ disableScrollLock: true, slotProps: { paper: { className: styles.selectMenu } } }}
            onChange={(event) => void equip(choice, String(event.target.value))}>
            {choice.options.map((option) =>
              <MenuItem key={option.value} value={option.value}>{t(option.label)}</MenuItem>)}
          </Select>
        </FormControl>;
      })}
    </div>
    {busy && <p role="status">{t('common.loading')}</p>}
    {saved && <p role="status">{t('profile.saved')}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
