import type { ReactNode } from 'react';
import type { AccountProfile, AvatarId } from '@shared/types';
import { Link } from 'react-router-dom';
import type { AccountAppearance } from '../account-appearance';
import { cardBackStyle, tableBackgroundStyle } from '../account-appearance';
import { useI18nStore } from '../stores/i18n-store';
import aceOfSpades from '../assets/cards/AS.svg';
import { Avatar } from './Avatar';
import styles from '../pages/AccountPage.module.css';

interface AccountProfilePreviewProps {
  readonly account: AccountProfile;
  readonly nickname: string;
  readonly avatar: AvatarId;
  readonly color: string;
  readonly appearance: AccountAppearance;
}

/** One shared preview shows identity and personal table settings together. */
export function AccountProfilePreview({
  account, nickname, avatar, color, appearance,
}: AccountProfilePreviewProps): ReactNode {
  const { t, locale } = useI18nStore();
  const background = tableBackgroundStyle(appearance);
  return <aside className={styles.preview} aria-label={t('profile.livePreview')}>
    <div className={styles.previewHeading}>
      <span className={styles.liveLabel}><span aria-hidden="true" />{t('profile.livePreview')}</span>
      <span className={styles.previewCaption}>{t('profile.previewHint')}</span>
    </div>
    <div className={`${styles.previewTable} ${background ? styles.customTable : ''}`}
      style={{ ...background, ...cardBackStyle(appearance) }}>
      <div className={styles.tableMark} aria-hidden="true">♠</div>
      <div className={styles.previewCards} aria-hidden="true">
        <span className={styles.previewBack} />
        <span className={styles.previewBack} />
        <img className={styles.previewFace} src={aceOfSpades} alt="" />
      </div>
      <div className={styles.previewIdentity}>
        <Avatar avatar={avatar} image={account.avatarImage} color={color} size="large" />
        <div>
          <h2>{nickname.trim() || account.username}</h2>
          <p>@{account.username}</p>
        </div>
      </div>
    </div>
    <div className={styles.previewFooter}>
      <span>{t('profile.joined')} {new Date(account.createdAt).toLocaleDateString(locale)}</span>
      <Link to={`/players/${encodeURIComponent(account.id)}`}>{t('player.viewOwn')}</Link>
    </div>
  </aside>;
}
