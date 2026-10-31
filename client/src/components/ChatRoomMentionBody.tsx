import { Suspense, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ChatMessage, RoomInfo } from '@shared/types';
import { useI18nStore } from '../stores/i18n-store';
import { ChatMessageBody } from './ChatEmoji';
import { LazyPlayerCard } from './LazyPlayerCard';
import { mentionCandidates } from './chat-mentions';
import styles from './ChatPanel.module.css';

export function ChatRoomMentionBody({ message, room }: {
  readonly message: ChatMessage;
  readonly room: RoomInfo | null;
}): ReactNode {
  const { t } = useI18nStore();
  const [card, setCard] = useState<{ playerId: string; anchor: HTMLElement } | null>(null);
  const players = mentionCandidates(room, null);
  const selected = players.find(({ player }) => player.id === card?.playerId)?.player;
  return <>
    <ChatMessageBody message={message} renderMention={(mention) => {
      const current = players.find(({ player }) => player.id === mention.playerId)?.player;
      return current ? <button type="button" className={styles.mentionToken}
        aria-label={t('chatMention.openPlayer', { name: current.nickname })}
        onClick={(event) => setCard({ playerId: current.id, anchor: event.currentTarget })}>@{mention.nickname}</button>
        : <Link className={styles.mentionToken} to={`/players/${encodeURIComponent(mention.playerId)}`}
          aria-label={t('chatMention.profile', { name: mention.nickname })}>@{mention.nickname}</Link>;
    }} />
    {card && selected && room && <Suspense fallback={null}>
      <LazyPlayerCard player={selected} gameType={room.gameType} anchor={card.anchor} onClose={() => setCard(null)} />
    </Suspense>}
  </>;
}
