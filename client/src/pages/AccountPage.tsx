import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import useMediaQuery from '@mui/material/useMediaQuery';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@shared/constants';
import type { AccountProfile, MatchHistory } from '@shared/types';
import { apiRequest } from '../api';
import { resizeImage } from '../image-resize';
import { uploadImage } from '../media';
import type { MediaPurpose } from '../media';
import { clearAccount, useAccountStore } from '../stores/account-store';
import { useI18nStore } from '../stores/i18n-store';
import { MatchHistoryList } from '../components/MatchHistoryList';
import { EquipmentSettings } from '../components/EquipmentSettings';
import { EmojiLibrary } from '../components/EmojiLibrary';
import { AccountProfilePreview } from '../components/AccountProfilePreview';
import { AppCheckbox } from '../components/AppCheckbox';
import { AudioSettings } from '../components/AudioSettings';
import { Button } from '../components/Button';
import { PageHeader } from '../components/PageHeader';
import { Tabs, tabElementId } from '../components/Tabs';
import styles from './AccountPages.module.css';
import editorStyles from './AccountPage.module.css';

type MediaField = 'avatarImage';
type OpacityField = 'tableBackgroundOpacity' | 'cardBackOpacity';
type SettingField = MediaField | 'matchesPublic';

const ACCOUNT_TABS = ['profile', 'history', 'emoji', 'sound', 'password'] as const;
/** Phone and narrow layouts start the long profile sections folded. */
const COMPACT_QUERY = '(max-width: 52rem), (max-height: 500px) and (min-width: 600px)';
type AccountTab = typeof ACCOUNT_TABS[number];

const RESIZE = {
  avatarImage: { size: 256, square: true, quality: 0.9, fallbackType: 'image/png' },
} as const;

const PURPOSE: Record<MediaField, MediaPurpose> = { avatarImage: 'avatar' };

export function AccountPage(): ReactNode {
  const account = useAccountStore((state) => state.account);
  const setAccount = useAccountStore((state) => state.setAccount);
  const { t, locale } = useI18nStore();
  const navigate = useNavigate();
  const compact = useMediaQuery(COMPACT_QUERY, { noSsr: true });
  const [activeTab, setActiveTab] = useState<AccountTab>('profile');
  const [nickname, setNickname] = useState(account?.nickname ?? '');
  const [color, setColor] = useState(account?.color ?? '#4a9eff');
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
  const [mediaBusy, setMediaBusy] = useState<SettingField | null>(null);
  const [mediaError, setMediaError] = useState<{ field: SettingField; message: string } | null>(null);
  const [opacityDraft, setOpacityDraft] = useState<Partial<Record<OpacityField, number>>>({});
  const avatarInput = useRef<HTMLInputElement>(null);
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
      nickname: nickname.trim(), color,
    });
    setProfileBusy(false);
    if (result.success) {
      setAccount(result.account);
      setNickname(result.account.nickname);
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

  const joined = new Date(account.createdAt).toLocaleDateString(locale);
  return (
    <main className={editorStyles.page}>
      <PageHeader title={t('nav.account')} icon="person"
        tabs={<Tabs<AccountTab> idPrefix="account" controls="account-panel" label={t('nav.account')} value={activeTab}
          onChange={setActiveTab} tabs={ACCOUNT_TABS.map((tab) => ({ id: tab, label: t(`profile.tab.${tab}`) }))} />}
        summary={`${t('profile.joined')} ${joined}`} compactSummary={t('profile.joinedOn', { date: joined })} />
      <div id="account-panel" role="tabpanel" aria-labelledby={tabElementId('account', activeTab)}>
      <div id="account-panel-profile" hidden={activeTab !== 'profile'}>
        <div className={editorStyles.editor}>
          {compact ? <details className={editorStyles.fold}>
            <summary>{t('profile.livePreview')}</summary>
            <div className={editorStyles.foldBody}>
              <AccountProfilePreview account={account} nickname={nickname}
                color={color} appearance={appearance} />
            </div>
          </details> : <AccountProfilePreview account={account} nickname={nickname}
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
              <div className={editorStyles.saveRow}>
                <Button type="submit" variant="primary" disabled={profileBusy || !nickname.trim()}>
                  {profileBusy ? t('common.loading') : t('common.save')}
                </Button>
              </div>
              {profileError && <p role="alert" className={styles.error}>{profileError}</p>}
              {saved && <p role="status" className={styles.success}>{t('profile.saved')}</p>}
            </form>
            <details className={editorStyles.fold} open={!compact}>
              <summary>{t('shop.equipment')}</summary>
              <div className={editorStyles.foldBody}>
                <EquipmentSettings key={account.id} account={account} opacityDraft={opacityDraft}
                  onOpacityDraft={(field, value) => setOpacityDraft((draft) => ({ ...draft, [field]: value }))} />
              </div>
            </details>
          </div>
        </div>
      </div>
      <section id="account-panel-history" className={editorStyles.managementPanel} hidden={activeTab !== 'history'}>
        <div className={editorStyles.historyMeta}>
          <p className={styles.hint}>{t('history.humanOnly')}</p>
          <label className={`${styles.row} ${editorStyles.historyVisibility}`}>
            <AppCheckbox checked={account.matchesPublic} disabled={mediaBusy !== null}
              onChange={(event) => {
                const value = event.target.checked;
                void patchSetting('matchesPublic', async () => value);
              }} />
            {t('history.public')}
          </label>
        </div>
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
