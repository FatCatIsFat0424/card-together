import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import useMediaQuery from '@mui/material/useMediaQuery';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@shared/constants';
import type { AccountProfile, AvatarBorderId, MatchHistory } from '@shared/types';
import { apiRequest } from '../api';
import { resizeImage } from '../image-resize';
import { uploadImage } from '../media';
import type { MediaPurpose } from '../media';
import { clearAccount, useAccountStore } from '../stores/account-store';
import { useI18nStore } from '../stores/i18n-store';
import { MatchHistoryList } from '../components/MatchHistoryList';
import { EquipmentSettings } from '../components/EquipmentSettings';
import { EmojiLibrary } from '../components/EmojiLibrary';
import { OpacitySlider } from '../components/OpacitySlider';
import { AccountProfilePreview } from '../components/AccountProfilePreview';
import { AppCheckbox } from '../components/AppCheckbox';
import { AudioSettings } from '../components/AudioSettings';
import { Button } from '../components/Button';
import { Tabs, tabElementId } from '../components/Tabs';
import styles from './AccountPages.module.css';
import editorStyles from './AccountPage.module.css';

type MediaField = 'avatarImage' | 'seatBackground' | 'tableBackground' | 'cardBack';
type OpacityField = 'tableBackgroundOpacity' | 'cardBackOpacity';
type SettingField = MediaField | OpacityField | 'matchesPublic';

const ACCOUNT_TABS = ['profile', 'history', 'emoji', 'sound', 'password'] as const;
/** Phone and narrow layouts start the long profile sections folded. */
const COMPACT_QUERY = '(max-width: 52rem), (max-height: 500px) and (min-width: 600px)';
type AccountTab = typeof ACCOUNT_TABS[number];

const RESIZE = {
  avatarImage: { size: 256, square: true, quality: 0.9, fallbackType: 'image/png' },
  seatBackground: { size: 1280, square: false, quality: 0.85, fallbackType: 'image/jpeg' },
  tableBackground: { size: 1920, square: false, quality: 0.85, fallbackType: 'image/jpeg' },
  // JPEG fallback keeps a 512-pixel photo well under the 512 KiB card back limit.
  cardBack: { size: 512, square: false, quality: 0.85, fallbackType: 'image/jpeg' },
} as const;

const PURPOSE: Record<MediaField, MediaPurpose> = {
  avatarImage: 'avatar', seatBackground: 'background', tableBackground: 'background', cardBack: 'cardBack',
};

export function AccountPage(): ReactNode {
  const account = useAccountStore((state) => state.account);
  const setAccount = useAccountStore((state) => state.setAccount);
  const { t, locale } = useI18nStore();
  const navigate = useNavigate();
  const compact = useMediaQuery(COMPACT_QUERY, { noSsr: true });
  const [activeTab, setActiveTab] = useState<AccountTab>('profile');
  const [nickname, setNickname] = useState(account?.nickname ?? '');
  const [color, setColor] = useState(account?.color ?? '#4a9eff');
  const [avatarBorder, setAvatarBorder] = useState<AvatarBorderId | null>(account?.avatarBorder ?? null);
  const [borderDirty, setBorderDirty] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [profileError, setProfileError] = useState('');
  const [securityError, setSecurityError] = useState('');
  const [saved, setSaved] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [securityBusy, setSecurityBusy] = useState(false);
  const [history, setHistory] = useState<MatchHistory | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [mediaBusy, setMediaBusy] = useState<MediaField | 'matchesPublic' | null>(null);
  const [mediaError, setMediaError] = useState<{ field: SettingField; message: string } | null>(null);
  const [opacityDraft, setOpacityDraft] = useState<Partial<Record<OpacityField, number>>>({});
  const avatarInput = useRef<HTMLInputElement>(null);
  const backgroundInput = useRef<HTMLInputElement>(null);
  const seatBackgroundInput = useRef<HTMLInputElement>(null);
  const cardBackInput = useRef<HTMLInputElement>(null);
  const accountId = account?.id;

  useEffect(() => {
    if (!accountId) return;
    let active = true;
    void apiRequest<MatchHistory>(`/api/players/${encodeURIComponent(accountId)}/history`).then((result) => {
      if (!active) return;
      if (result.success) setHistory(result);
      else setHistoryError(result.error);
    });
    return () => { active = false; };
  }, [accountId]);

  if (!account) return null;
  const selectedBorder = borderDirty ? avatarBorder : account.avatarBorder ?? null;

  /** Media and visibility settings save immediately, independent of the profile form. */
  const patchSetting = async (
    field: MediaField | 'matchesPublic',
    value: () => Promise<string | boolean | null>,
  ): Promise<void> => {
    setMediaError(null);
    setMediaBusy(field);
    try {
      const result = await apiRequest<{ account: AccountProfile }>('/api/auth/profile', 'PATCH', {
        [field]: await value(),
      });
      if (!result.success) throw new Error(result.error);
      setAccount(result.account);
    } catch (error) {
      setMediaError({ field, message: error instanceof Error ? error.message : t('common.error') });
    } finally {
      setMediaBusy(null);
    }
  };

  const chooseImage = (field: MediaField) => (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void patchSetting(field, async () => uploadImage(await resizeImage(file, RESIZE[field]),
      PURPOSE[field]));
  };

  const mediaFeedback = (field: SettingField): ReactNode =>
    mediaError?.field === field && <p role="alert" className={styles.error}>{mediaError.message}</p>;

  /** Not marked busy: uploads stay usable while an opacity change saves in the background. */
  const saveOpacity = async (field: OpacityField, value: number): Promise<void> => {
    if (value !== account[field]) {
      setMediaError(null);
      const result = await apiRequest<{ account: AccountProfile }>('/api/auth/profile', 'PATCH', {
        [field]: value,
      });
      if (result.success) setAccount(result.account);
      else setMediaError({ field, message: result.error });
    }
    setOpacityDraft((draft) => (draft[field] === value ? { ...draft, [field]: undefined } : draft));
  };

  const opacitySlider = (field: OpacityField, label: string, enabled: boolean): ReactNode => (
    <OpacitySlider id={`profile-${field}`} label={label} value={opacityDraft[field] ?? account[field]}
      disabled={!enabled}
      onChange={(value) => setOpacityDraft((draft) => ({ ...draft, [field]: value }))}
      onCommit={(value) => void saveOpacity(field, value)} />
  );

  const appearance = {
    ...account,
    tableBackgroundOpacity: opacityDraft.tableBackgroundOpacity ?? account.tableBackgroundOpacity,
    cardBackOpacity: opacityDraft.cardBackOpacity ?? account.cardBackOpacity,
  };

  const saveProfile = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setProfileError('');
    setSaved(false);
    setProfileBusy(true);
    const result = await apiRequest<{ account: AccountProfile }>('/api/auth/profile', 'PATCH', {
      nickname: nickname.trim(), color, avatarBorder: selectedBorder,
    });
    setProfileBusy(false);
    if (result.success) {
      setAccount(result.account);
      setNickname(result.account.nickname);
      setBorderDirty(false);
      setSaved(true);
    } else setProfileError(result.error);
  };

  const changePassword = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSecurityError('');
    if (newPassword !== confirmPassword) {
      setSecurityError(t('auth.passwordMismatch'));
      return;
    }
    setSecurityBusy(true);
    const result = await apiRequest('/api/auth/password', 'POST', { currentPassword, newPassword });
    setSecurityBusy(false);
    if (result.success) {
      clearAccount();
      navigate('/login', { replace: true, state: { passwordChanged: true } });
    } else setSecurityError(result.error);
  };

  const signOutAll = async (): Promise<void> => {
    setSecurityBusy(true);
    setSecurityError('');
    const result = await apiRequest('/api/auth/logout-all', 'POST');
    setSecurityBusy(false);
    if (result.success) clearAccount();
    else setSecurityError(result.error);
  };

  return (
    <main className={editorStyles.page}>
      <header className={editorStyles.header}>
        <Tabs<AccountTab> idPrefix="account" controls="account-panel" label={t('nav.account')} value={activeTab}
          className={editorStyles.tabs} onChange={setActiveTab}
          tabs={ACCOUNT_TABS.map((tab) => ({ id: tab, label: t(`profile.tab.${tab}`) }))} />
        <p className={editorStyles.joined}>
          {t('profile.joined')} {new Date(account.createdAt).toLocaleDateString(locale)}
        </p>
      </header>
      <div id="account-panel" role="tabpanel" aria-labelledby={tabElementId('account', activeTab)}>
      <div id="account-panel-profile" hidden={activeTab !== 'profile'}>
        <div className={editorStyles.editor}>
          {compact ? <details className={editorStyles.fold}>
            <summary>{t('profile.livePreview')}</summary>
            <div className={editorStyles.foldBody}>
              <AccountProfilePreview account={{ ...account, avatarBorder: selectedBorder }} nickname={nickname}
                color={color} appearance={appearance} />
            </div>
          </details> : <AccountProfilePreview account={{ ...account, avatarBorder: selectedBorder }} nickname={nickname}
            color={color} appearance={appearance} />}
          <div className={editorStyles.controls}>
            <form className={`${styles.form} ${editorStyles.profileForm}`} onSubmit={(event) => void saveProfile(event)}>
              <div className={editorStyles.identityFields}>
                <div className={styles.field}>
                  <label htmlFor="profile-nickname">{t('lobby.nickname')}</label>
                  <input id="profile-nickname" autoComplete="nickname" value={nickname}
                    onChange={(event) => { setNickname(event.target.value); setSaved(false); }}
                    required minLength={1} maxLength={20} aria-describedby="nickname-help" />
                  <p id="nickname-help" className={styles.hint}>{t('profile.nicknameHelp')}</p>
                </div>
                <div className={styles.field}>
                  <label htmlFor="profile-color">{t('lobby.color')}</label>
                  <input id="profile-color" type="color" className={editorStyles.colorInput} value={color}
                    onChange={(event) => { setColor(event.target.value); setSaved(false); }} />
                </div>
              </div>
              <fieldset className={styles.avatarField}>
                <legend className={styles.legend}>{t('profile.avatar')}</legend>
                <div className={editorStyles.avatarRow}>
                  <div className={editorStyles.compactActions}>
                    <input ref={avatarInput} type="file" accept="image/*" hidden
                      onChange={chooseImage('avatarImage')} />
                    <Button type="button" disabled={mediaBusy !== null}
                      onClick={() => avatarInput.current?.click()}>
                      {mediaBusy === 'avatarImage' ? t('profile.uploading') : t('profile.uploadAvatar')}
                    </Button>
                    {account.avatarImage && <Button type="button"
                      disabled={mediaBusy !== null}
                      onClick={() => void patchSetting('avatarImage', async () => null)}>
                      {t('profile.removeAvatar')}</Button>}
                  </div>
                </div>
                {mediaFeedback('avatarImage')}
              </fieldset>
              <div className={editorStyles.borderRow}>
                <FormControl fullWidth size="small" className={editorStyles.selectField}>
                  <InputLabel id="profile-border-label" shrink>{t('shop.catalog')}</InputLabel>
                  <Select id="profile-border" labelId="profile-border-label" label={t('shop.catalog')}
                    value={selectedBorder ?? ''} displayEmpty
                    MenuProps={{ disableScrollLock: true, slotProps: { paper: { className: editorStyles.selectMenu } } }}
                    onChange={(event) => {
                      const border = account.ownedAvatarBorders?.find((id) => id === event.target.value) ?? null;
                      setAvatarBorder(border); setBorderDirty(true); setSaved(false);
                    }}>
                    <MenuItem value="">{t('shop.original')}</MenuItem>
                    {(account.ownedAvatarBorders ?? []).map((id) =>
                      <MenuItem key={id} value={id}>{t(`shop.item.${id}.name`)}</MenuItem>)}
                  </Select>
                </FormControl>
                <Button type="submit" variant="primary" disabled={profileBusy || !nickname.trim()}>
                  {profileBusy ? t('common.loading') : t('common.save')}
                </Button>
              </div>
              {profileError && <p role="alert" className={styles.error}>{profileError}</p>}
              {saved && <p role="status" className={styles.success}>{t('profile.saved')}</p>}
            </form>
            <details className={editorStyles.fold} open={!compact}>
              <summary>{t('shop.equipment')}</summary>
              <div className={editorStyles.foldBody}><EquipmentSettings key={account.id} account={account} /></div>
            </details>
            <details className={editorStyles.fold} open={!compact}>
              <summary>{t('profile.appearance')}</summary>
              <div className={editorStyles.foldBody}>
            <section className={editorStyles.appearance} aria-labelledby="profile-appearance-heading">
              <h2 id="profile-appearance-heading">{t('profile.appearance')}</h2>
              <p className={styles.hint}>{t('profile.appearanceAutoSave')}</p>
              <div className={editorStyles.imageSetting}>
                <div className={editorStyles.imageHeading}>
                  <h3>{t('profile.seatBackground')}</h3>
                  <div className={editorStyles.compactActions}>
                    <input ref={seatBackgroundInput} type="file" accept="image/*" hidden
                      onChange={chooseImage('seatBackground')} />
                    <Button type="button" disabled={mediaBusy !== null}
                      onClick={() => seatBackgroundInput.current?.click()}>
                      {mediaBusy === 'seatBackground' ? t('profile.uploading') : t('profile.uploadBackground')}
                    </Button>
                    {account.seatBackground && <Button type="button"
                      disabled={mediaBusy !== null}
                      onClick={() => void patchSetting('seatBackground', async () => null)}>
                      {t('profile.removeBackground')}</Button>}
                  </div>
                </div>
                <p className={styles.hint}>{t('profile.seatBackgroundHelp')}</p>
                {mediaFeedback('seatBackground')}
              </div>
              <div className={editorStyles.imageSetting}>
                <div className={editorStyles.imageHeading}>
                  <h3>{t('profile.background')}</h3>
                  <div className={editorStyles.compactActions}>
                    <input ref={backgroundInput} type="file" accept="image/*" hidden
                      onChange={chooseImage('tableBackground')} />
                    <Button type="button" disabled={mediaBusy !== null}
                      onClick={() => backgroundInput.current?.click()}>
                      {mediaBusy === 'tableBackground' ? t('profile.uploading') : t('profile.uploadBackground')}
                    </Button>
                    {account.tableBackground && <Button type="button"
                      disabled={mediaBusy !== null}
                      onClick={() => void patchSetting('tableBackground', async () => null)}>
                      {t('profile.removeBackground')}</Button>}
                  </div>
                </div>
                <p className={styles.hint}>{t('profile.backgroundHelp')}</p>
                {mediaFeedback('tableBackground')}
                {opacitySlider('tableBackgroundOpacity', t('profile.backgroundOpacity'), !!(account.tableBackgroundStyle || account.tableBackground))}
                {mediaFeedback('tableBackgroundOpacity')}
              </div>
              <div className={editorStyles.imageSetting}>
                <div className={editorStyles.imageHeading}>
                  <h3>{t('profile.cardBack')}</h3>
                  <div className={editorStyles.compactActions}>
                    <input ref={cardBackInput} type="file" accept="image/*" hidden
                      onChange={chooseImage('cardBack')} />
                    <Button type="button" disabled={mediaBusy !== null}
                      onClick={() => cardBackInput.current?.click()}>
                      {mediaBusy === 'cardBack' ? t('profile.uploading') : t('profile.uploadCardBack')}
                    </Button>
                    {account.cardBack && <Button type="button"
                      disabled={mediaBusy !== null}
                      onClick={() => void patchSetting('cardBack', async () => null)}>
                      {t('profile.removeCardBack')}</Button>}
                  </div>
                </div>
                <p className={styles.hint}>{t('profile.cardBackHelp')}</p>
                {mediaFeedback('cardBack')}
                {opacitySlider('cardBackOpacity', t('profile.cardBackOpacity'), !!(account.cardBackStyle || account.cardBack))}
                {mediaFeedback('cardBackOpacity')}
              </div>
            </section>
              </div>
            </details>
          </div>
        </div>
      </div>
      <section id="account-panel-history" className={editorStyles.managementPanel} hidden={activeTab !== 'history'}>
        <p className={styles.hint}>{t('history.humanOnly')}</p>
        <label className={`${styles.row} ${editorStyles.historyVisibility}`}>
          <AppCheckbox checked={account.matchesPublic} disabled={mediaBusy !== null}
            onChange={(event) => {
              const value = event.target.checked;
              void patchSetting('matchesPublic', async () => value);
            }} />
          {t('history.public')}
        </label>
        {mediaFeedback('matchesPublic')}
        {historyError ? <p className={styles.error} role="alert">{historyError}</p>
          : history === null ? <p role="status">{t('common.loading')}</p>
          : <MatchHistoryList matches={history.matches} players={history.players} />}
      </section>
      <section id="account-panel-emoji" className={editorStyles.managementPanel} hidden={activeTab !== 'emoji'}>
        <EmojiLibrary />
      </section>
      <section id="account-panel-sound" className={editorStyles.managementPanel} hidden={activeTab !== 'sound'}>
        <AudioSettings showTitle={false} />
      </section>
      <section id="account-panel-password" className={editorStyles.managementPanel} hidden={activeTab !== 'password'}>
        <form className={`${styles.form} ${editorStyles.securityForm}`} onSubmit={(event) => void changePassword(event)}>
          <div className={styles.field}>
            <label htmlFor="current-password">{t('profile.currentPassword')}</label>
            <input id="current-password" type="password" autoComplete="current-password"
              value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)}
              required maxLength={PASSWORD_MAX_LENGTH} />
          </div>
          <div className={styles.field}>
            <label htmlFor="new-password">{t('profile.newPassword')}</label>
            <input id="new-password" type="password" autoComplete="new-password"
              value={newPassword} onChange={(event) => setNewPassword(event.target.value)}
              required minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH}
              aria-describedby="new-password-help" />
            <p id="new-password-help" className={styles.hint}>{t('auth.passwordHelp')}</p>
          </div>
          <div className={styles.field}>
            <label htmlFor="new-password-confirm">{t('auth.confirmPassword')}</label>
            <input id="new-password-confirm" type="password" autoComplete="new-password"
              value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)}
              required minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} />
          </div>
          <p className={styles.hint}>{t('profile.passwordNotice')}</p>
          {securityError && <p role="alert" className={styles.error}>{securityError}</p>}
          <Button type="submit" variant="primary" disabled={securityBusy}>
            {securityBusy ? t('common.loading') : t('profile.changePassword')}
          </Button>
          <Button type="button" disabled={securityBusy}
            onClick={() => void signOutAll()}>{t('auth.signOutAll')}</Button>
        </form>
      </section>
      </div>
    </main>
  );
}
