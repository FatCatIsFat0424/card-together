import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { RANK_DISPLAY, SUIT_SYMBOLS } from '@shared/constants';
import type { PresentationFrame } from '@shared/game-presentation';
import { NN_MAX } from '@shared/rules/ninetynine';
import type { Card, GameType, Seat } from '@shared/types';
import { cardImageUrl } from '../cards';
import { tablePosition } from '../game-view';
import type { TranslationKey } from '../i18n';
import { useI18nStore } from '../stores/i18n-store';
import { useMotionStore } from '../stores/motion-store';
import { useRoomStore } from '../stores/room-store';
import styles from './GamePresentation.module.css';
import { ChinesePokerReveal } from './chinesepoker/ChinesePokerReveal';

interface GamePresentationProps {
  frame: PresentationFrame;
  bottomSeat: Seat;
  gameType: GameType;
  summary?: string;
  elapsedMs?: number;
}

function specialEffect(card: Card | undefined, t: (key: TranslationKey, params?: Record<string, string>) => string): string {
  if (!card) return '';
  if (card.rank === 4) return t('presentation.reverse');
  if (card.rank === 5) return t('presentation.designate');
  if (card.rank === 11) return t('presentation.unchanged');
  if (card.rank === 13) return t('presentation.maximum', { n: String(NN_MAX) });
  if (card.rank === 14 && card.suit === 'spades') return t('presentation.reset');
  return '';
}

export function GamePresentation({
  frame, bottomSeat, gameType, summary, elapsedMs = 0,
}: GamePresentationProps): ReactNode {
  const rootRef = useRef<HTMLDivElement>(null);
  const timingRef = useRef({ key: frame.key, elapsedMs });
  if (timingRef.current.key !== frame.key) timingRef.current = { key: frame.key, elapsedMs };
  const { t } = useI18nStore();
  const seats = useRoomStore((state) => state.roomInfo?.seats);
  const reducedMotion = useMotionStore((state) => state.reducedMotion);
  const name = (seat: Seat): string => seats?.[seat].player?.nickname ?? t(`seat.${seat}`);
  const position = frame.seat ? tablePosition(frame.seat, bottomSeat) : 'bottom';
  const collecting = frame.kind === 'trick' || frame.kind === 'capture';
  const effect = gameType === 'ninetynine' ? specialEffect(frame.cards[0], t) : '';

  useLayoutEffect(() => {
    const elapsed = timingRef.current.elapsedMs;
    rootRef.current?.style.setProperty('--enter-delay', `${-elapsed}ms`);
    rootRef.current?.style.setProperty('--collect-delay', `${frame.durationMs - 300 - elapsed}ms`);
  }, [frame.key, frame.durationMs]);

  // A showdown row compares all four seats at once, which needs its own layout.
  if (frame.kind === 'reveal' && frame.row) {
    return <ChinesePokerReveal key={frame.key} row={frame.row} bottomSeat={bottomSeat} />;
  }
  return <div ref={rootRef} key={frame.key}
    className={[styles.presentation, styles[position], reducedMotion && styles.reducedMotion,
      frame.kind === 'eliminated' && styles.eliminated].filter(Boolean).join(' ')}
    role="status" aria-live="polite" aria-atomic="true" data-presentation-kind={frame.kind}>
    <div className={styles.heading}>
      {frame.seat && <strong className={styles.playerName}>{name(frame.seat)}</strong>}
      <span>{t(frame.kind === 'finish' && frame.seat ? 'presentation.winner' : `presentation.${frame.kind}`)}</span>
    </div>
    {frame.cards.length > 0 && <div className={collecting ? styles.collecting : undefined}>
      <div className={[styles.cards, (frame.kind === 'play' || frame.kind === 'capture') && styles.arriving,
        frame.kind === 'trick' && styles.trickCards].filter(Boolean).join(' ')}>
        {frame.cards.map((card, index) => <div className={styles.cardSlot}
          key={`${card.suit}-${card.rank}-${index}`}>
          <img className={[styles.card, frame.flipped && index === 0 && styles.flipped].filter(Boolean).join(' ')} src={cardImageUrl(card)}
            alt={`${SUIT_SYMBOLS[card.suit]}${RANK_DISPLAY[card.rank]}`} draggable={false} />
          {frame.cardSeats?.[index] && <span className={styles.cardSeat}>
            {name(frame.cardSeats[index])}
          </span>}
        </div>)}
      </div>
    </div>}
    {frame.total !== undefined && <div className={styles.total}>
      <span>{t('presentation.total')}</span>
      {frame.previousTotal !== undefined && <span>{frame.previousTotal} →</span>}
      <strong>{frame.total}</strong><span>/ {NN_MAX}</span>
    </div>}
    {effect && <div className={styles.effect}>{effect}
      {frame.target && <strong> · {name(frame.target)}</strong>}
    </div>}
    {gameType === 'ninetynine' && frame.direction && <div className={styles.effect}>
      {frame.direction === 'cw' ? `↻ ${t('presentation.clockwise')}` : `↺ ${t('presentation.counterclockwise')}`}
      {frame.choice && ` ${frame.choice === 'plus' ? '+' : '−'}${frame.cards[0]?.rank === 12 ? 20 : 10}`}
    </div>}
    {frame.kind === 'shoot' && frame.target && <div className={styles.effect}>
      → <strong>{name(frame.target)}</strong> ×2
    </div>}
    {frame.passedSeats && frame.passedSeats.length > 0 && <div className={styles.effect}>
      {t('presentation.pass')}: {frame.passedSeats.map(name).join(' · ')}
    </div>}
    {frame.kind === 'capture' && frame.points !== undefined &&
      <div className={styles.effect}>{t('presentation.points', { n: String(frame.points) })}</div>}
    {(frame.kind === 'finish' || frame.kind === 'trick') && summary && <strong className={styles.summary}>{summary}</strong>}
  </div>;
}
