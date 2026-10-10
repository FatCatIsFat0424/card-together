// ─── NinetyNineTable: Ninety-Nine table (running total, direction, last card, hand, info rail, settlement) ───

import { useState } from 'react';
import type { ReactNode } from 'react';
import { NN_MAX, nnApply, nnIsPlayable, nnRequiresChoice } from '@shared/rules/ninetynine';
import type { NnChoice } from '@shared/rules/ninetynine';
import { RANK_DISPLAY, SUIT_SYMBOLS } from '@shared/constants';
import type { Card, NinetyNineMatchResult, NinetyNineVisibleState, Seat } from '@shared/types';
import { cardImageUrl } from '../../cards';
import { socket } from '../../socket';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { CardHand } from '../../components/CardHand';
import { GameShell } from '../GameShell';
import { ResultDialog, resultStyles } from '../ResultDialog';
import { RoundHistory } from '../RoundHistory';
import { infoStyles, RulesBox, TurnBox } from '../TableInfo';
import { useSeatName } from '../seat-names';
import { useConnectionReady } from '../use-connection-ready';
import { useGamePresentation } from '../use-game-presentation';
import styles from './NinetyNineTable.module.css';
import { isOwnTurn } from '../observer-view';

const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
const RECENT_MOVES = 8;

type ActionCallback = (timeout: Error | null, response?: { success: boolean; error?: string }) => void;

const sameCard = (a: Card, b: Card): boolean => a.suit === b.suit && a.rank === b.rank;
const cardLabel = (card: Card): string => `${SUIT_SYMBOLS[card.suit]}${RANK_DISPLAY[card.rank]}`;

/** Change color near 99 */
function totalTone(total: number): string {
  if (total >= 90) return styles.danger;
  if (total >= 70) return styles.warning;
  return '';
}

function CardImage({ card, className }: { card: Card; className?: string }): ReactNode {
  return <img className={`${styles.card} ${className ?? ''}`} src={cardImageUrl(card)} alt={cardLabel(card)} draggable={false} />;
}

function Centre({ game }: { game: NinetyNineVisibleState }): ReactNode {
  const { t } = useI18nStore();
  const ccw = game.direction === 'ccw';
  return <div className={styles.centre}>
    <div className={styles.totalRow}>
      <span className={styles.direction} title={t(ccw ? 'ninetynine.directionCcw' : 'ninetynine.directionCw')}
        aria-label={t(ccw ? 'ninetynine.directionCcw' : 'ninetynine.directionCw')}>{ccw ? '⟲' : '⟳'}</span>
      {/* key replays the animation on every total change */}
      <span key={game.total} className={`${styles.total} ${totalTone(game.total)}`} title={t('ninetynine.total')}>
        {game.total}
      </span>
      <span className={styles.max}>/ {NN_MAX}</span>
    </div>
    <div className={styles.pileRow}>
      <div className={styles.pile} title={t('ninetynine.stock', { n: String(game.stockCount) })}>
        {game.stockCount > 0 && <span className={styles.back} aria-hidden="true" />}
        <span className={styles.pill}>{t('ninetynine.stock', { n: String(game.stockCount) })}</span>
      </div>
      {game.lastPlayed && <div className={styles.pile}>
        <CardImage key={cardLabel(game.lastPlayed)} card={game.lastPlayed} className={styles.lastCard} />
        <span className={styles.pill}>{t('ninetynine.lastPlayed')}</span>
      </div>}
    </div>
  </div>;
}

function Info({ game }: { game: NinetyNineVisibleState }): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const recent = game.log.slice(-RECENT_MOVES).reverse();
  return <aside className={infoStyles.rail}>
    <TurnBox text={game.phase !== 'playing' ? t('game.scoring')
      : isOwnTurn(game) ? t('ninetynine.yourTurn')
        : t('ninetynine.turnOf', { name: seatName(game.currentTurnSeat) })}>
      <p className={infoStyles.note}>
        {t('ninetynine.total')} {game.total} · {t(game.direction === 'ccw' ? 'ninetynine.directionCcw' : 'ninetynine.directionCw')}
      </p>
    </TurnBox>

    <section className={`${infoStyles.box} ${infoStyles.grow}`}>
      <h2 className={infoStyles.caption}>{t('ninetynine.recent')}</h2>
      {recent.length === 0 ? <p className={infoStyles.note}>{t('ninetynine.noMoves')}</p>
        : <ol className={infoStyles.list}>{recent.map((entry) => (
          <li key={`${entry.timestamp}-${entry.type === 'play' ? cardLabel(entry.card) : entry.seat}`} className={infoStyles.row}>
            <span className={infoStyles.name}>{seatName(entry.seat)}</span>
            {entry.type === 'play' ? <>
              <CardImage card={entry.card} className={styles.mini} />
              {entry.target && <span>→ {seatName(entry.target)}</span>}
              <span className={styles.recentTotal}>{entry.total}</span>
            </> : <span className={styles.bustTag}>{t('ninetynine.logBusted')}</span>}
          </li>
        ))}</ol>}
    </section>

    <RulesBox title={t('ninetynine.rules')}
      lines={[t('ninetynine.rulesNumbers'), t('ninetynine.rulesSpecial'), t('ninetynine.rulesBust')]} />
  </aside>;
}

function ResultOverlay({ result, pending, error, disabled, onBack }: {
  result: NinetyNineMatchResult; pending: boolean; error: string; disabled: boolean; onBack: () => void;
}): ReactNode {
  const { t } = useI18nStore();
  const historyGame = useGameStore((state) => state.visible);
  const seatName = useSeatName();
  // The last player eliminated ranks 2nd, and so on
  const ranking = [result.winnerSeat, ...[...result.eliminationOrder].reverse()];
  return <ResultDialog title={t('ninetynine.winner', { name: seatName(result.winnerSeat) })}
    pending={pending} error={error} disabled={disabled} onBack={onBack}>
    <table className={`${resultStyles.table} ${styles.rankTable}`}>
      <thead><tr><th>{t('ninetynine.rank')}</th><th>{t('ninetynine.player')}</th></tr></thead>
      <tbody>{ranking.map((seat, index) => (
        <tr key={seat} className={index === 0 ? resultStyles.winnerRow : ''}>
          <td>{t('ninetynine.place', { n: String(index + 1) })}</td>
          <td>{index === 0 ? '🏆 ' : '💥 '}{seatName(seat)}</td>
        </tr>
      ))}</tbody>
    </table>
    <p className={resultStyles.note}>{t('ninetynine.total')} {result.finalTotal}</p>
    {historyGame && <RoundHistory game={historyGame} />}
  </ResultDialog>;
}

export function NinetyNineTable(): ReactNode {
  const { locked } = useGamePresentation();
  const connectionReady = useConnectionReady();
  const game = useGameStore((state) => state.ninetyNine);
  const { t } = useI18nStore();
  const seatName = useSeatName();
  /** Cards waiting for a +/- choice or a target player */
  const [pendingCard, setPendingCard] = useState<Card | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionPending, setActionPending] = useState(false);

  if (!game) return null;

  const playing = game.phase === 'playing';
  const isMyTurn = playing && !locked && isOwnTurn(game);
  const canPlay = isMyTurn && connectionReady && !actionPending;
  const playable = game.myHand.filter((card) => nnIsPlayable(game.total, card));
  const unplayable = game.myHand.filter((card) => !nnIsPlayable(game.total, card));
  const chosen = canPlay && pendingCard && game.myHand.some((card) => sameCard(card, pendingCard)) ? pendingCard : null;
  const targets = chosen?.rank === 5
    ? SEATS.filter((seat) => seat !== game.mySeat && !game.eliminated.includes(seat)) : [];

  const handleActionResult: ActionCallback = (timeout, response) => {
    setActionPending(false);
    if (timeout) setActionError(t('auth.connectionError'));
    else if (!response?.success) setActionError(response?.error ?? t('common.error'));
  };

  const send = (card: Card, choice?: NnChoice, target?: Seat): void => {
    if (!canPlay) return;
    setActionError('');
    setActionPending(true);
    setPendingCard(null);
    socket.timeout(10000).emit('game:ninetynine:play', {
      card, ...(choice && { choice }), ...(target && { target }),
    }, handleActionResult);
  };

  const onCardClick = (card: Card): void => {
    if (nnRequiresChoice(card) || card.rank === 5) setPendingCard(chosen && sameCard(chosen, card) ? null : card);
    else send(card);
  };

  const backToRoom = (): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:continue', handleActionResult);
  };

  const prompt = !playing ? null
    : !isMyTurn ? t('ninetynine.turnOf', { name: seatName(game.currentTurnSeat) })
      : chosen?.rank === 5 ? t('ninetynine.pickTarget') : !chosen ? t('ninetynine.pickCard') : null;

  const delta = chosen?.rank === 10 ? 10 : 20;
  const handZone = <div className={styles.handArea}>
    <CardHand cards={game.myHand} playableCards={playable} disabled={!canPlay} onCardClick={onCardClick}
      markedCards={unplayable} markedLabel={t('ninetynine.unplayable')} />
    {playing && <div className={styles.controls}>
      {prompt && <span className={`${styles.prompt} ${isMyTurn ? styles.promptActive : ''}`}>{prompt}</span>}
      {chosen && nnRequiresChoice(chosen) && <div className={styles.choice} role="group" aria-label={cardLabel(chosen)}>
        <CardImage card={chosen} className={styles.mini} />
        {(['plus', 'minus'] as const).map((choice) => (
          <button key={choice} type="button" className={`btn btn-primary ${styles.ctrl}`}
            disabled={!canPlay || nnApply(game.total, chosen, choice).total > NN_MAX}
            onClick={() => send(chosen, choice)}>
            {t(choice === 'plus' ? 'ninetynine.plus' : 'ninetynine.minus', { n: String(delta) })}
          </button>
        ))}
      </div>}
      {chosen && <button type="button" className={`btn btn-outline ${styles.ctrl}`}
        onClick={() => setPendingCard(null)}>{t('ninetynine.cancel')}</button>}
    </div>}
  </div>;

  return (
    <GameShell
      info={<Info game={game} />}
      centre={<Centre game={game} />}
      hand={handZone}
      pickableSeats={targets}
      onPickSeat={chosen ? (seat) => send(chosen, undefined, seat) : undefined}
      overlay={game.phase === 'scoring' && game.result && <ResultOverlay result={game.result}
        pending={actionPending} error={actionError} disabled={!connectionReady} onBack={backToRoom} />}
      error={game.phase !== 'scoring' ? actionError : undefined}
    />
  );
}
