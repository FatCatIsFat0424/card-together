import type { ReactNode } from 'react';
import type { ChatFrameId } from '@shared/types';
import { Avatar } from '../../components/Avatar';
import { useI18nStore } from '../../stores/i18n-store';
import type { PreviewAccount } from '../preview-props';
import { ChatFrame } from './ChatFrame';
import styles from './ChatFramePreview.module.css';

/** A sample room-chat line from the shopper, so the frame is judged around their own name and avatar. */
export function ChatFramePreview({ id, account }: { readonly id: ChatFrameId; readonly account: PreviewAccount }): ReactNode {
  const { t } = useI18nStore();
  return <div className={styles.preview}>
    <div className={styles.row}>
      <Avatar avatar={account.avatar} image={account.avatarImage} border={account.avatarBorder} color={account.color} size="compact" />
      <span className={styles.name}>{account.nickname}</span>
    </div>
    <ChatFrame id={id} className={styles.message}>{t('shop.chatFrame.sample')}</ChatFrame>
  </div>;
}
