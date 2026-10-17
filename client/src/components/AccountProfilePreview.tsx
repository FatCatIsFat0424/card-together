import type { CSSProperties, ReactNode } from 'react';
import type { AccountProfile, AvatarId, Card } from '@shared/types';
import { Link } from 'react-router-dom';
import type { AccountAppearance } from '../account-appearance';
import { useMotionStore } from '../stores/motion-store';
import { cardBackStyle, seatBackgroundStyle, tableBackgroundStyle } from '../account-appearance';
import { useI18nStore } from '../stores/i18n-store';
import { useCardFaceUrl } from '../cosmetics/card-faces/use-card-face';
import { ChatFrame } from '../cosmetics/chat-frames/ChatFrame';
import { SeatFrame, seatFrameHostClass } from '../cosmetics/seat-frames/SeatFrame';
import { SeatFramePreview } from '../cosmetics/seat-frames/SeatFramePreview';
import { SoundPackPreview } from '../cosmetics/sound-packs/SoundPackPreview';
import { VictoryEffectPreview } from '../cosmetics/victory-effects/VictoryEffectPreview';
import { ChipIcon } from '../games/ChipIcon';
import { Avatar } from './Avatar';
import { Nameplate } from './Nameplate';
import styles from '../pages/AccountPage.module.css';
import chatStyles from './ChatPanel.module.css';

interface AccountProfilePreviewProps {
  readonly account: AccountProfile;
  readonly nickname: string;
  readonly avatar: AvatarId;
  readonly color: string;
  readonly appearance: AccountAppearance;
}

// Both colours and a court card, so deck styles and four-colour suits are visible at a glance.
const SAMPLE_CARDS: readonly Card[] = [
  { rank: 14, suit: 'spades' },
  { rank: 13, suit: 'hearts' },
  { rank: 12, suit: 'diamonds' },
  { rank: 10, suit: 'clubs' },
];
const SAMPLE_CHIPS = '1,280';

function PreviewSection({ title, shared, wide = false, children }: {
  readonly title: string;
  readonly shared: boolean;
  readonly wide?: boolean;
  readonly children: ReactNode;
}): ReactNode {
  const { t } = useI18nStore();
  return <section className={`${styles.previewSection} ${wide ? styles.previewWide : ''}`}>
    <header className={styles.previewSectionHeader}>
      <h3>{title}</h3>
      <span className={shared ? styles.publicBadge : styles.privateBadge}>
        {t(shared ? 'profile.preview.public' : 'profile.preview.private')}
      </span>
    </header>
    {children}
  </section>;
}

/** Every equippable look in one place: the private table view first, then what others see. */
export function AccountProfilePreview({
  account, nickname, avatar, color, appearance,
}: AccountProfilePreviewProps): ReactNode {
  const { t } = useI18nStore();
  const cardFaceUrl = useCardFaceUrl();
  const reducedMotion = useMotionStore((state) => state.reducedMotion);
  const background = tableBackgroundStyle(appearance, reducedMotion);
  const seatBackground = seatBackgroundStyle(appearance, reducedMotion);
  const name = nickname.trim() || account.username;
  const previewAccount = { avatar, avatarImage: account.avatarImage, avatarBorder: account.avatarBorder, color, nickname: name };
  const identity = (size: 'compact' | 'large'): ReactNode =>
    <Avatar avatar={avatar} image={account.avatarImage} border={account.avatarBorder} color={color} size={size} />;
  const middle = (SAMPLE_CARDS.length - 1) / 2;
  return <aside className={styles.preview} aria-label={t('profile.livePreview')}>
    <div className={styles.previewHeading}>
      <span className={styles.liveLabel}><span aria-hidden="true" />{t('profile.livePreview')}</span>
    </div>
    <div className={styles.previewSections}>
      <PreviewSection title={t('profile.preview.table')} shared={false} wide>
        <div className={`${styles.previewTable} ${background ? styles.customTable : ''}`}
          style={{ ...background, ...cardBackStyle(appearance, reducedMotion) }}>
          <div className={styles.tableMark} aria-hidden="true">♠</div>
          <div className={styles.previewCards} aria-hidden="true">
            <span className={styles.previewBack} />
            <span className={styles.previewBack} />
            <span className={styles.previewFan}>
              {SAMPLE_CARDS.map((card, index) => <img key={`${card.rank}${card.suit}`} className={styles.previewFace}
                style={{ '--tilt': `${(index - middle) * 9}deg`, '--drop': `${Math.abs(index - middle) * 4}px` } as CSSProperties}
                src={cardFaceUrl(card)} alt="" draggable={false} />)}
            </span>
          </div>
          <div className={styles.previewTableRow}>
            <SeatFramePreview id={account.seatFrame ?? null} account={previewAccount} />
            <span className={styles.previewChips} aria-hidden="true">
              <span className={styles.previewChipStack}><ChipIcon /><ChipIcon /><ChipIcon /></span>
              <span><ChipIcon />{SAMPLE_CHIPS}</span>
            </span>
          </div>
        </div>
      </PreviewSection>
      <PreviewSection title={t('profile.preview.seat')} shared>
        <div className={`${styles.seatPreviewCard} ${seatBackground ? styles.customSeat : ''} ${seatFrameHostClass(account.seatFrame)}`}
          style={seatBackground}>
          <SeatFrame frame={account.seatFrame} />
          {identity('large')}
          <h3>{name}</h3>
        </div>
      </PreviewSection>
      <PreviewSection title={t('profile.preview.chat')} shared>
        <div className={`${chatStyles.chatMessage} ${styles.previewChat}`}>
          <span className={chatStyles.chatAvatar}>{identity('compact')}</span>
          <div className={chatStyles.chatBody}>
            <div className={chatStyles.chatHeading}>
              <span className={chatStyles.chatSender}>{name}</span>
              <Nameplate id={account.nameplate} />
            </div>
            <ChatFrame id={account.chatFrame} className={chatStyles.chatContent}>
              {t('profile.preview.chatSample')}
            </ChatFrame>
          </div>
        </div>
      </PreviewSection>
      <PreviewSection title={t('profile.preview.victory')} shared>
        {account.victoryEffect
          ? <div className={styles.previewCentered}><VictoryEffectPreview id={account.victoryEffect} account={previewAccount} /></div>
          : <div className={styles.previewEmpty}>
            <span>{t('profile.preview.noVictory')}</span>
            <Link to="/shop?type=victoryEffect">{t('profile.preview.browse')}</Link>
          </div>}
      </PreviewSection>
      <PreviewSection title={t('profile.preview.sound')} shared={false}>
        <div className={styles.previewCentered}><SoundPackPreview id={account.soundPack ?? null} account={previewAccount} /></div>
      </PreviewSection>
    </div>
  </aside>;
}
