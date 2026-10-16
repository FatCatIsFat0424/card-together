import { occupiedSeats, roomPlayers, roomSeatInfo } from '@shared/rules/seats';
import type { Seat } from '@shared/types';
import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { PresentationFrame } from '@shared/game-presentation';
import { NN_MAX } from '@shared/rules/ninetynine';
import type { GameSeat, NapoleonCard, PlayerVisibleGameState } from '@shared/types';
import { tablePosition } from '../game-view';
import { useI18nStore } from '../stores/i18n-store';
import { useMotionStore } from '../stores/motion-store';
import { useRoomStore } from '../stores/room-store';
import styles from './GamePresentation.module.css';
import { ChinesePokerReveal } from './chinesepoker/ChinesePokerReveal';
import { LiarsDeckFrame } from './liarsdeck/LiarsDeckFrame';
import { BlackjackFrame } from './blackjack/BlackjackFrame';
import { HoldemFrame } from './holdem/HoldemFrame';
import { NapoleonFrame } from './napoleon/NapoleonFrame';
import { useNapoleonCardImageUrl } from './napoleon/napoleon-card-art';
import { napoleonCardText } from './napoleon/napoleon-view';
import { CardPlayEffect } from './CardPlayEffect';
import { cardPlayEffect } from './card-play-effect';

interface GamePresentationProps {
  frame: PresentationFrame;
  bottomSeat: GameSeat;
  game: PlayerVisibleGameState;
  summary?: string;
  elapsedMs?: number;
}

export function GamePresentation({
  frame, bottomSeat, game, summary, elapsedMs = 0,
}: GamePresentationProps): ReactNode {
  const gameType = game.gameType;
  const napoleonCardImageUrl = useNapoleonCardImageUrl();
  const rootRef = useRef<HTMLDivElement>(null);
  const timingRef = useRef({ key: frame.key, elapsedMs });
  if (timingRef.current.key !== frame.key) timingRef.current = { key: frame.key, elapsedMs };
  const { t } = useI18nStore();
  const room = useRoomStore((state) => state.roomInfo);
  const reducedMotion = useMotionStore((state) => state.reducedMotion);
  const name = (seat: GameSeat): string => (room ? roomSeatInfo(room, seat)?.player?.nickname : null) ?? t(`seat.${seat}`);
  const position = frame.seat ? tablePosition(frame.seat, bottomSeat, room ? occupiedSeats(roomPlayers(room)) : undefined) : 'bottom';
  const collecting = frame.kind === 'trick' || frame.kind === 'capture';
  // Napoleon frames carry their cards separately because they may include jokers.
  const frameCards: readonly NapoleonCard[] = frame.napoleonCards ?? frame.cards;
  const playEffect = cardPlayEffect(game, frame);

  useLayoutEffect(() => {
    const elapsed = timingRef.current.elapsedMs;
    rootRef.current?.style.setProperty('--enter-delay', `${-elapsed}ms`);
    rootRef.current?.style.setProperty('--collect-delay', `${frame.durationMs - 300 - elapsed}ms`);
  }, [frame.key, frame.durationMs]);

  // A showdown row compares all four seats at once, which needs its own layout.
  if (frame.kind === 'reveal' && frame.row) {
    return <ChinesePokerReveal key={frame.key} row={frame.row} bottomSeat={bottomSeat as Seat} />;
  }
  return <div ref={rootRef} key={frame.key}
    className={[styles.presentation, styles[position], gameType === 'ninetynine' && styles.large,
      reducedMotion && styles.reducedMotion,
      (frame.kind === 'eliminated' || frame.survived === false) && styles.eliminated].filter(Boolean).join(' ')}
    role="status" aria-live="polite" aria-atomic="true" data-presentation-kind={frame.kind}>
    {playEffect && <CardPlayEffect effect={playEffect} elapsedMs={elapsedMs}
      durationMs={frame.durationMs} reducedMotion={reducedMotion} />}
    <div className={styles.heading}>
      {frame.seat && <strong className={styles.playerName}>{name(frame.seat)}</strong>}
      <span>{t(frame.kind === 'finish' && frame.seat ? 'presentation.winner'
        : gameType === 'blackjack' && frame.kind === 'deal' ? 'blackjack.presentationDeal'
          : gameType === 'holdem' && frame.kind === 'deal' ? 'holdem.presentationDeal'
            : gameType === 'napoleon' && frame.kind === 'call' ? 'napoleon.presentation.call' : `presentation.${frame.kind}`)}</span>
    </div>
    {gameType === 'liarsdeck' && <LiarsDeckFrame frame={frame} name={name} />}
    {gameType === 'blackjack' && <BlackjackFrame frame={frame} name={name} />}
    {gameType === 'holdem' && <HoldemFrame frame={frame} name={name} />}
    {gameType === 'napoleon' && <NapoleonFrame frame={frame} name={name} />}
    {/* Blackjack and Hold'em frames draw whole hands and the board themselves rather than the new cards. */}
    {frameCards.length > 0 && gameType !== 'blackjack' && gameType !== 'holdem' && <div className={collecting ? styles.collecting : undefined}>
      <div className={[styles.cards, (frame.kind === 'play' || frame.kind === 'capture') && styles.arriving,
        frame.kind === 'trick' && styles.trickCards].filter(Boolean).join(' ')}>
        {frameCards.map((card, index) => <div className={styles.cardSlot}
          key={`${'joker' in card ? `joker-${card.joker}` : `${card.suit}-${card.rank}`}-${index}`}>
          <img className={[styles.card, frame.flipped && index === 0 && styles.flipped].filter(Boolean).join(' ')}
            src={napoleonCardImageUrl(card)}
            alt={napoleonCardText(card, (joker) => t(`napoleon.joker.${joker}`))} draggable={false} />
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
    {gameType === 'ninetynine' && frame.direction && <div className={styles.effect}>
      <span aria-label={t(frame.direction === 'cw' ? 'presentation.clockwise' : 'presentation.counterclockwise')}>
        {frame.direction === 'cw' ? '↻' : '↺'}
      </span>
      {frame.choice && ` ${frame.choice === 'plus' ? '+' : '−'}${frame.cards[0]?.rank === 12 ? 20 : 10}`}
    </div>}
    {gameType === 'ninetynine' && frame.target && <div className={styles.effect}>
      → <strong>{name(frame.target)}</strong>
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
