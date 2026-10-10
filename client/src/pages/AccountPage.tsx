import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@shared/constants';
import type { AccountProfile, AvatarId, MatchHistory } from '@shared/types';
import { apiRequest } from '../api';
import { resizeImage } from '../image-resize';
import { uploadImage } from '../media';
import type { MediaPurpose } from '../media';
import { clearAccount, useAccountStore } from '../stores/account-store';
import { useI18nStore } from '../stores/i18n-store';
import { Avatar, AVATARS } from '../components/Avatar';
import { MatchHistoryList } from '../components/MatchHistoryList';
import { EmojiLibrary } from '../components/EmojiLibrary';
import { OpacitySlider } from '../components/OpacitySlider';
import { AccountProfilePreview } from '../components/AccountProfilePreview';
import styles from './AccountPages.module.css';
import editorStyles from './AccountPage.module.css';

type MediaField = 'avatarImage' | 'tableBackground' | 'cardBack';
type OpacityField = 'tableBackgroundOpacity' | 'cardBackOpacity';
type SettingField = MediaField | OpacityField | 'matchesPublic';

const ACCOUNT_TABS = ['profile', 'history', 'emoji', 'password'] as const;
type AccountTab = typeof ACCOUNT_TABS[number];

const RESIZE = {
  avatarImage: { size: 256, square: true, quality: 0.9, fallbackType: 'image/png' },
  tableBackground: { size: 1920, square: false, quality: 0.85, fallbackType: 'image/jpeg' },
  // JPEG fallback keeps a 512-pixel photo well under the 512 KiB card back limit.
  cardBack: { size: 512, square: false, quality: 0.85, fallbackType: 'image/jpeg' },
} as const;

const PURPOSE: Record<MediaField, MediaPurpose> = {
  avatarImage: 'avatar', tableBackground: 'background', cardBack: 'cardBack',
};

export function AccountPage(): ReactNode {
  const account = useAccountStore((state) => state.account);
  const setAccount = useAccountStore((state) => state.setAccount);
  const { t } = useI18nStore();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<AccountTab>('profile');
  const [nickname, setNickname] = useState(account?.nickname ?? '');
  const [color, setColor] = useState(account?.color ?? '#4a9eff');
  const [avatar, setAvatar] = useState<AvatarId>(account?.avatar ?? 'cat');
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

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let nextIndex: number;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % ACCOUNT_TABS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index + ACCOUNT_TABS.length - 1) % ACCOUNT_TABS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = ACCOUNT_TABS.length - 1;
    else return;
    event.preventDefault();
    const tab = ACCOUNT_TABS[nextIndex];
    setActiveTab(tab);
    document.getElementById(`account-tab-${tab}`)?.focus();
  };

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
      nickname: nickname.trim(), color, avatar,
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

  return (
    <main className={editorStyles.page}>
      <header className={editorStyles.header}>
        <h1>{t('profile.title')}</h1>
        <p>{t('profile.description')}</p>
        <div className={editorStyles.tabs} role="tablist" aria-label={t('nav.account')}>
          {ACCOUNT_TABS.map((tab, index) => (
            <button key={tab} id={`account-tab-${tab}`} type="button" role="tab"
              aria-selected={activeTab === tab} aria-controls={`account-panel-${tab}`}
              tabIndex={activeTab === tab ? 0 : -1} onClick={() => setActiveTab(tab)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}>
              {t(`profile.tab.${tab}`)}
            </button>
          ))}
        </div>
      </header>
      <div id="account-panel-profile" role="tabpanel" aria-labelledby="account-tab-profile"
        hidden={activeTab !== 'profile'}>
        <div className={editorStyles.editor}>
          <AccountProfilePreview account={account} nickname={nickname} avatar={avatar} color={color}
            appearance={appearance} />
          <div className={editorStyles.controls}>
            <div className={editorStyles.sectionHeading}><h2>{t('profile.identity')}</h2></div>
            <form className={styles.form} onSubmit={(event) => void saveProfile(event)}>
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
                <div className={editorStyles.avatarChoices}>
                  {AVATARS.map((option) => (
                    <button key={option} type="button" className={editorStyles.avatarChoice}
                      aria-pressed={avatar === option} aria-label={t(`avatar.${option}`)}
                      onClick={() => { setAvatar(option); setSaved(false); }}>
                      <Avatar avatar={option} size="small" />
                    </button>
                  ))}
                </div>
                <div className={editorStyles.compactActions}>
                  <input ref={avatarInput} type="file" accept="image/*" hidden
                    onChange={chooseImage('avatarImage')} />
                  <button type="button" className="btn btn-outline" disabled={mediaBusy !== null}
                    onClick={() => avatarInput.current?.click()}>
                    {mediaBusy === 'avatarImage' ? t('profile.uploading') : t('profile.uploadAvatar')}
                  </button>
                  {account.avatarImage && <button type="button" className="btn btn-outline"
                    disabled={mediaBusy !== null}
                    onClick={() => void patchSetting('avatarImage', async () => null)}>
                    {t('profile.removeAvatar')}</button>}
                </div>
                {mediaFeedback('avatarImage')}
              </fieldset>
              {profileError && <p role="alert" className={styles.error}>{profileError}</p>}
              <div className={editorStyles.saveRow}>
                <button type="submit" className="btn btn-primary" disabled={profileBusy || !nickname.trim()}>
                  {profileBusy ? t('common.loading') : t('common.save')}
                </button>
                {saved && <p role="status" className={styles.success}>{t('profile.saved')}</p>}
              </div>
            </form>
            <section className={editorStyles.appearance} aria-labelledby="profile-appearance-heading">
              <h2 id="profile-appearance-heading">{t('profile.appearance')}</h2>
              <p className={styles.hint}>{t('profile.appearanceAutoSave')}</p>
              <div className={editorStyles.imageSetting}>
                <div className={editorStyles.imageHeading}>
                  <h3>{t('profile.background')}</h3>
                  <div className={editorStyles.compactActions}>
                    <input ref={backgroundInput} type="file" accept="image/*" hidden
                      onChange={chooseImage('tableBackground')} />
                    <button type="button" className="btn btn-outline" disabled={mediaBusy !== null}
                      onClick={() => backgroundInput.current?.click()}>
                      {mediaBusy === 'tableBackground' ? t('profile.uploading') : t('profile.uploadBackground')}
                    </button>
                    {account.tableBackground && <button type="button" className="btn btn-outline"
                      disabled={mediaBusy !== null}
                      onClick={() => void patchSetting('tableBackground', async () => null)}>
                      {t('profile.removeBackground')}</button>}
                  </div>
                </div>
                <p className={styles.hint}>{t('profile.backgroundHelp')}</p>
                {mediaFeedback('tableBackground')}
                {opacitySlider('tableBackgroundOpacity', t('profile.backgroundOpacity'), !!account.tableBackground)}
                {mediaFeedback('tableBackgroundOpacity')}
              </div>
              <div className={editorStyles.imageSetting}>
                <div className={editorStyles.imageHeading}>
                  <h3>{t('profile.cardBack')}</h3>
                  <div className={editorStyles.compactActions}>
                    <input ref={cardBackInput} type="file" accept="image/*" hidden
                      onChange={chooseImage('cardBack')} />
                    <button type="button" className="btn btn-outline" disabled={mediaBusy !== null}
                      onClick={() => cardBackInput.current?.click()}>
                      {mediaBusy === 'cardBack' ? t('profile.uploading') : t('profile.uploadCardBack')}
                    </button>
                    {account.cardBack && <button type="button" className="btn btn-outline"
                      disabled={mediaBusy !== null}
                      onClick={() => void patchSetting('cardBack', async () => null)}>
                      {t('profile.removeCardBack')}</button>}
                  </div>
                </div>
                <p className={styles.hint}>{t('profile.cardBackHelp')}</p>
                {mediaFeedback('cardBack')}
                {opacitySlider('cardBackOpacity', t('profile.cardBackOpacity'), !!account.cardBack)}
                {mediaFeedback('cardBackOpacity')}
              </div>
            </section>
          </div>
        </div>
      </div>
      <section id="account-panel-history" role="tabpanel" aria-labelledby="account-tab-history"
        className={editorStyles.managementPanel} hidden={activeTab !== 'history'}>
        <h2>{t('history.title')}</h2>
        <p className={styles.hint}>{t('history.humanOnly')}</p>
        <label className={`${styles.row} ${editorStyles.historyVisibility}`}>
          <input type="checkbox" checked={account.matchesPublic} disabled={mediaBusy !== null}
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
      <section id="account-panel-emoji" role="tabpanel" aria-labelledby="account-tab-emoji"
        className={editorStyles.managementPanel} hidden={activeTab !== 'emoji'}>
        <h2>{t('emoji.title')}</h2>
        <EmojiLibrary />
      </section>
      <section id="account-panel-password" role="tabpanel" aria-labelledby="account-tab-password"
        className={editorStyles.managementPanel} hidden={activeTab !== 'password'}>
        <h2>{t('profile.security')}</h2>
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
          <button type="submit" className="btn btn-primary" disabled={securityBusy}>
            {securityBusy ? t('common.loading') : t('profile.changePassword')}
          </button>
          <button type="button" className="btn btn-outline" disabled={securityBusy}
            onClick={() => void signOutAll()}>{t('auth.signOutAll')}</button>
        </form>
      </section>
    </main>
  );
}
