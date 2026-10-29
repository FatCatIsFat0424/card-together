import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Dialog from '@mui/material/Dialog';
import Popover from '@mui/material/Popover';
import useMediaQuery from '@mui/material/useMediaQuery';
import type { AccountProfile, ShopItemType } from '@shared/types';
import { ACHIEVEMENT_NAMEPLATES } from '@shared/constants/shop';
import { EQUIPMENT_SLOTS, SHOP_ITEMS, ownsShopItem } from '@shared/constants';
import { apiRequest } from '../api';
import { resizeImage } from '../image-resize';
import { uploadImage } from '../media';
import type { MediaPurpose } from '../media';
import { UPLOAD_FIELDS, isUploadSlot } from '../shop-equipment';
import type { EquipmentTarget, Replacement, UploadSlot } from '../shop-equipment';
import { useAccountStore } from '../stores/account-store';
import { useI18nStore } from '../stores/i18n-store';
import { dialogPaperClass, dialogParts } from '../styles/dialog';
import { AppIcon } from './AppIcon';
import { EquipmentThumb, equipmentValueName } from './EquipmentThumb';
import { IconButton } from './IconButton';
import { OpacitySlider } from './OpacitySlider';
import styles from './EquipmentSettings.module.css';

/** Phone and narrow layouts open the picker as a full-width dialog instead of a popover beside the tile. */
const COMPACT_QUERY = '(max-width: 52rem), (max-height: 500px) and (min-width: 600px)';

type OpacityField = 'tableBackgroundOpacity' | 'cardBackOpacity';

/** Slots grouped as the profile shows them; `visibility` says who sees the group's products. */
export const EQUIPMENT_GROUPS = [
  { id: 'personal', visibility: 'public', slots: ['avatarBorder', 'nameplate', 'chatFrame'] },
  { id: 'table', visibility: null, slots: ['tableBackgroundStyle', 'seatBackgroundStyle', 'seatFrame', 'victoryEffect', 'soundPack'] },
  { id: 'cards', visibility: 'private', slots: ['cardBackStyle', 'cardFaceStyle', 'chipStyle'] },
  { id: 'chess', visibility: 'private', slots: ['pieceStyle', 'boardStyle'] },
  { id: 'dice', visibility: 'private', slots: ['diceStyle'] },
] as const satisfies readonly {
  readonly id: string; readonly visibility: 'public' | 'private' | null; readonly slots: readonly EquipmentTarget[];
}[];

const OPACITY_FIELDS: Readonly<Partial<Record<EquipmentTarget, OpacityField>>> = {
  tableBackgroundStyle: 'tableBackgroundOpacity', cardBackStyle: 'cardBackOpacity',
};

const RESIZE = {
  seatBackgroundStyle: { size: 1280, square: false, quality: 0.85, fallbackType: 'image/jpeg' },
  tableBackgroundStyle: { size: 1920, square: false, quality: 0.85, fallbackType: 'image/jpeg' },
  // JPEG fallback keeps a 512-pixel photo well under the 512 KiB card back limit.
  cardBackStyle: { size: 512, square: false, quality: 0.85, fallbackType: 'image/jpeg' },
} as const;

const PURPOSE: Record<UploadSlot, MediaPurpose> = {
  seatBackgroundStyle: 'background', tableBackgroundStyle: 'background', cardBackStyle: 'cardBack',
};

export interface EquipmentSlotView {
  readonly target: EquipmentTarget;
  readonly type: ShopItemType;
  /** What the slot shows now. An equipped product the account no longer owns counts as none. */
  readonly current: Replacement;
  /** Titles and products that can be equipped, in catalog order. */
  readonly owned: readonly string[];
  /** Products of this type not owned yet. */
  readonly more: number;
  /** An uploaded image fills this slot while no product does. */
  readonly hasUpload: boolean;
}

function typeOf(target: EquipmentTarget): ShopItemType {
  return target === 'avatarBorder' ? 'avatarBorder' : EQUIPMENT_SLOTS[target];
}

/** One view per slot: only owned products (and earned titles) can be chosen. */
export function equipmentSlots(account: AccountProfile): EquipmentSlotView[] {
  return EQUIPMENT_GROUPS.flatMap((group) => group.slots).map((target): EquipmentSlotView => {
    const type = typeOf(target);
    const items = SHOP_ITEMS.filter((item) => item.type === type);
    const earned = target === 'nameplate'
      ? ACHIEVEMENT_NAMEPLATES.filter((item) => account.ownedAchievementNameplates?.includes(item.id)).map((item) => item.id as string)
      : [];
    const owned = [...earned, ...items.filter((item) => ownsShopItem(account, item)).map((item) => item.id as string)];
    const equipped = account[target] ?? null;
    const hasUpload = isUploadSlot(target) && !!account[UPLOAD_FIELDS[target]];
    const current: Replacement = equipped && owned.includes(equipped) ? { kind: 'item', id: equipped }
      : hasUpload ? { kind: 'custom' } : { kind: 'default' };
    return { target, type, current, owned, more: items.length - items.filter((item) => ownsShopItem(account, item)).length, hasUpload };
  });
}

interface EquipmentSettingsProps {
  readonly account: AccountProfile;
  /** Live opacity while a slider is dragged, so the preview follows before the value saves. */
  readonly opacityDraft?: Readonly<Partial<Record<OpacityField, number>>>;
  readonly onOpacityDraft?: (field: OpacityField, value: number | undefined) => void;
}

export function EquipmentSettings({ account, opacityDraft = {}, onOpacityDraft }: EquipmentSettingsProps): ReactNode {
  const { t } = useI18nStore();
  const compact = useMediaQuery(COMPACT_QUERY, { noSsr: true });
  const [busy, setBusy] = useState<'save' | 'upload' | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<{ target: EquipmentTarget; anchor: HTMLElement } | null>(null);
  const pending = useRef(false);
  const active = useRef(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<UploadSlot | null>(null);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const slots = equipmentSlots(account);
  const openSlot = open ? slots.find((slot) => slot.target === open.target) ?? null : null;

  /** One write per change; the server validates ownership again. */
  const save = async (patch: Partial<Record<keyof AccountProfile, unknown>>, kind: 'save' | 'upload' = 'save'): Promise<boolean> => {
    if (pending.current) return false;
    pending.current = true;
    setBusy(kind);
    setError('');
    const result = await apiRequest<{ account: AccountProfile }>('/api/auth/profile', 'PATCH', patch);
    pending.current = false;
    if (!active.current || useAccountStore.getState().account?.id !== account.id) return false;
    setBusy(null);
    if (result.success) {
      useAccountStore.getState().setAccount(result.account);
      return true;
    }
    setError(result.error);
    return false;
  };

  const choose = async (slot: EquipmentSlotView, value: string | null): Promise<void> => {
    // Values come from the rendered options, so anything else is ignored rather than sent.
    if (value !== null && !slot.owned.includes(value)) return;
    if (await save({ [slot.target]: value })) setOpen(null);
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    const target = uploadTarget.current;
    event.target.value = '';
    if (!file || !target) return;
    try {
      setBusy('upload');
      const id = await uploadImage(await resizeImage(file, RESIZE[target]), PURPOSE[target]);
      // The new image is the one the user wants to see, so it takes the slot from any product.
      if (await save({ [UPLOAD_FIELDS[target]]: id, [target]: null }, 'upload')) setOpen(null);
    } catch (failure) {
      setBusy(null);
      setError(failure instanceof Error ? failure.message : t('common.error'));
    }
  };

  const remove = async (target: UploadSlot): Promise<void> => {
    await save({ [UPLOAD_FIELDS[target]]: null });
  };

  const saveOpacity = async (field: OpacityField, value: number): Promise<void> => {
    if (value !== account[field]) await save({ [field]: value });
    onOpacityDraft?.(field, undefined);
  };

  const picker = openSlot && <SlotPicker slot={openSlot} account={account} busy={busy} compact={compact} error={error}
    opacityDraft={opacityDraft} onClose={() => setOpen(null)}
    onChoose={(value) => void choose(openSlot, value)}
    onUpload={() => { uploadTarget.current = openSlot.target as UploadSlot; fileInput.current?.click(); }}
    onRemove={() => void remove(openSlot.target as UploadSlot)}
    onOpacity={(field, value) => onOpacityDraft?.(field, value)}
    onOpacityCommit={(field, value) => void saveOpacity(field, value)} />;

  return <section className={styles.equipment} aria-labelledby="profile-equipment-heading">
    <div className={styles.header}>
      <h2 id="profile-equipment-heading">{t('shop.equipment')}</h2>
      <Link to="/shop" className={styles.shopLink}><AppIcon name="shop" />{t('shop.visit')}</Link>
    </div>
    <p className={styles.help}>{t('shop.equipmentHelp')}</p>
    {EQUIPMENT_GROUPS.map((group) => <div key={group.id} className={styles.group}>
      <h3 className={styles.groupTitle}>{t(`shop.group.${group.id}`)}
        {group.visibility && <span>{t(`equipment.visibility.${group.visibility}`)}</span>}</h3>
      <div className={styles.tiles}>{group.slots.map((target) => {
        const slot = slots.find((entry) => entry.target === target)!;
        const field = OPACITY_FIELDS[target];
        const customLabel = slot.current.kind !== 'custom' ? null
          : field ? t('equipment.customOpacity', { n: String(opacityDraft[field] ?? account[field]) }) : t('equipment.custom');
        const slotName = t(`shop.type.${slot.type}`);
        const valueName = equipmentValueName(t, target, slot.current);
        return <button key={target} type="button" className={styles.tile} data-slot={target}
          aria-haspopup="dialog" aria-expanded={open?.target === target}
          aria-label={t('equipment.slotNamed', { slot: slotName, value: valueName })}
          onClick={(event) => setOpen({ target, anchor: event.currentTarget })}>
          <span className={styles.tileThumb}>
            <EquipmentThumb target={target} value={slot.current} account={account} className={styles.thumb} />
            {customLabel && <span className={styles.customBadge}>{customLabel}</span>}
          </span>
          <span className={styles.slotName}>{slotName}</span>
          <span className={styles.valueName}>{valueName}</span>
        </button>;
      })}</div>
    </div>)}
    <input ref={fileInput} type="file" accept="image/*" hidden onChange={(event) => void upload(event)} />
    {error && !picker && <p role="alert" className={styles.error}>{error}</p>}
    {compact
      ? <Dialog open={picker !== null} onClose={() => setOpen(null)} aria-labelledby="equipment-picker-title"
        slotProps={{ paper: { className: dialogPaperClass('medium', styles.pickerPaper) } }}>{picker}</Dialog>
      : <Popover open={picker !== null} anchorEl={open?.anchor ?? null} onClose={() => setOpen(null)} disableScrollLock
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { className: styles.popover, role: 'dialog', 'aria-labelledby': 'equipment-picker-title' } }}>{picker}</Popover>}
  </section>;
}

interface SlotPickerProps {
  readonly slot: EquipmentSlotView;
  readonly account: AccountProfile;
  readonly busy: 'save' | 'upload' | null;
  readonly compact: boolean;
  readonly error: string;
  readonly opacityDraft: Readonly<Partial<Record<OpacityField, number>>>;
  readonly onClose: () => void;
  readonly onChoose: (value: string | null) => void;
  readonly onUpload: () => void;
  readonly onRemove: () => void;
  readonly onOpacity: (field: OpacityField, value: number) => void;
  readonly onOpacityCommit: (field: OpacityField, value: number) => void;
}

/** Owned products of one slot as thumbnails, with the built-in look first and a way to the shop last. */
function SlotPicker({
  slot, account, busy, compact, error, opacityDraft, onClose, onChoose, onUpload, onRemove, onOpacity, onOpacityCommit,
}: SlotPickerProps): ReactNode {
  const { t } = useI18nStore();
  const { target, current } = slot;
  const uploadable = isUploadSlot(target);
  const field = OPACITY_FIELDS[target];
  const disabled = busy !== null;
  const baseValue: Replacement = slot.hasUpload ? { kind: 'custom' } : { kind: 'default' };
  const style = target === 'avatarBorder' ? false : !!account[target];
  const header = <div className={compact ? dialogParts.header : styles.pickerHeader}>
    <div>
      <h2 id="equipment-picker-title">{t(`shop.type.${slot.type}`)}</h2>
    </div>
    <IconButton icon="close" label={t('equipment.pickerClose')} onClick={onClose} />
  </div>;
  const body = <div className={compact ? `${dialogParts.body} ${styles.pickerBody}` : styles.pickerBody}>
    <div className={styles.options} role="listbox" aria-label={t(`shop.type.${slot.type}`)}>
      <div className={styles.option} data-selected={current.kind !== 'item' || undefined}>
        <button type="button" role="option" aria-selected={current.kind !== 'item'} className={styles.optionMain}
          disabled={disabled} onClick={() => onChoose(null)}>
          <EquipmentThumb target={target} value={baseValue} account={account} className={styles.optionThumb} />
          <span className={styles.optionName}>{equipmentValueName(t, target, baseValue)}</span>
          {current.kind !== 'item' && <span className={styles.optionCheck} aria-hidden="true"><AppIcon name="check" /></span>}
        </button>
        {uploadable && slot.hasUpload && <div className={styles.optionActions}>
          <button type="button" disabled={disabled} onClick={onUpload}><AppIcon name="upload" />{t('equipment.replace')}</button>
          <button type="button" disabled={disabled} onClick={onRemove}><AppIcon name="trash" />{t('equipment.remove')}</button>
        </div>}
      </div>
      {uploadable && !slot.hasUpload && <button type="button" className={`${styles.option} ${styles.uploadOption}`}
        disabled={disabled} onClick={onUpload}>
        <AppIcon name="upload" />
        <span className={styles.optionName}>{busy === 'upload' ? t('profile.uploading') : t('equipment.upload')}</span>
      </button>}
      {slot.owned.map((id) => {
        const value: Replacement = { kind: 'item', id };
        const selected = current.kind === 'item' && current.id === id;
        return <div key={id} className={styles.option} data-selected={selected || undefined}>
          <button type="button" role="option" aria-selected={selected} className={styles.optionMain}
            disabled={disabled} onClick={() => onChoose(id)}>
            <EquipmentThumb target={target} value={value} account={account} className={styles.optionThumb} />
            <span className={styles.optionName}>{equipmentValueName(t, target, value)}</span>
            {selected && <span className={styles.optionCheck} aria-hidden="true"><AppIcon name="check" /></span>}
          </button>
        </div>;
      })}
      {slot.more > 0 && <Link to={`/shop?type=${slot.type}`} className={`${styles.option} ${styles.shopOption}`} onClick={onClose}>
        <AppIcon name="shop" />
        <span className={styles.optionName}>{t('equipment.shopMore', { n: String(slot.more) })}</span>
      </Link>}
    </div>
    {busy === 'upload' && !(uploadable && !slot.hasUpload) && <p role="status" className={styles.status}>{t('profile.uploading')}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {field && <OpacitySlider id={`equipment-${field}`}
      label={t(field === 'cardBackOpacity' ? 'profile.cardBackOpacity' : 'profile.backgroundOpacity')}
      value={opacityDraft[field] ?? account[field]} disabled={!(style || slot.hasUpload)}
      onChange={(value) => onOpacity(field, value)} onCommit={(value) => onOpacityCommit(field, value)} />}
  </div>;
  return <div className={styles.picker}>{header}{body}</div>;
}
