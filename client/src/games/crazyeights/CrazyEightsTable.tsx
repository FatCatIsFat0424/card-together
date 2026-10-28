// ─── CrazyEightsTable: stock and top card, suit in force, hand with suit picker, info rail, settlement ───

import { useState } from 'react';
import type { ReactNode } from 'react';
import { CE_HANDS, CE_SUITS, CE_WILD_RANK, ceNeedsSuit, ceTurnOptions } from '@shared/rules/crazyeights';
import { RANK_DISPLAY, SUIT_SYMBOLS } from '@shared/constants';
import type { Card, GameSeat, Suit } from '@shared/types';
import type { CrazyEightsAction } from '@shared/games/crazyeights/actions';
import type { CrazyEightsMatchResult, CrazyEightsVisibleState } from '@shared/games/crazyeights/types';
import { useCardFaceUrl } from '../../cosmetics/card-faces/use-card-face';
import { socket } from '../../socket';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { CardHand } from '../../components/CardHand';
import { GameShell } from '../GameShell';
import { HandActions } from '../HandActions';
import { useViewedGame } from '../use-table-perspective';
import { ResultDialog, resultStyles } from '../ResultDialog';
import { useResultRoundHistory } from '../RoundHistory';
import { infoStyles, TurnBox } from '../TableInfo';
import { joinNames, useSeatName } from '../seat-names';
import { useConnectionReady } from '../use-connection-ready';
import { useGamePresentation } from '../use-game-presentation';
import { AppIcon } from '../../components/AppIcon';
import { isOwnTurn } from '../observer-view';
import { CardBackArt } from '../../cosmetics/art-layers/CardBackArt';
import styles from './CrazyEightsTable.module.css';

const RECENT_MOVES = 8;

type ActionCallback = (timeout: Error | null, response?: { success: boolean; error?: string }) => void;

const sameCard = (a: Card, b: Card): boolean => a.suit === b.suit && a.rank === b.rank;
const cardLabel = (card: Card): string => `${SUIT_SYMBOLS[card.suit]}${RANK_DISPLAY[card.rank]}`;
const isRed = (suit: Suit): boolean => suit === 'hearts' || suit === 'diamonds';

function CardImage({ card, className }: { card: Card; className?: string }): ReactNode {
  const cardImageUrl = useCardFaceUrl();
  return <img className={`${styles.card} ${className ?? ''}`} src={cardImageUrl(card)} alt={cardLabel(card)} draggable={false} />;
}

function SuitBadge({ suit, label, className }: { suit: Suit; label: string; className?: string }): ReactNode {
  return <span className={`${styles.suit} ${isRed(suit) ? styles.red : ''} ${className ?? ''}`} role="img" aria-label={label} title={label}>
    {SUIT_SYMBOLS[suit]}
  </span>;
}

function Centre({ game, canDraw, onDraw }: { game: CrazyEightsVisibleState; canDraw: boolean; onDraw: () => void }): ReactNode {
  const { t } = useI18nStore();
  const ccw = game.direction === 'ccw';
  const available = game.stockCount + game.reserveCount;
  const stockLabel = available > 0 ? t('crazyeights.stock', { n: String(available) }) : t('crazyeights.stockEmpty');
  const suitName = t(`crazyeights.suit.${game.activeSuit}`);
  const stock = <>
    {available > 0 && <span className={styles.back} aria-hidden="true"><CardBackArt /></span>}
    <span className={styles.pill}>{stockLabel}</span>
  </>;
  return <div className={styles.centre}>
    <div className={styles.pileRow}>
      {canDraw
        ? <button type="button" className={`${styles.pile} ${styles.drawable}`} onClick={onDraw}
          aria-label={t('crazyeights.drawPile')} title={t('crazyeights.drawPile')}>{stock}</button>
        : <div className={styles.pile} title={stockLabel}>{stock}</div>}
      {game.lastPlayed && <div className={styles.pile}>
        <CardImage key={cardLabel(game.lastPlayed)} card={game.lastPlayed} className={styles.lastCard} />
        <span className={styles.pill}>{t('crazyeights.topCard')}</span>
      </div>}
    </div>
    <div className={styles.status}>
      {/* key replays the animation whenever the suit in force changes */}
      <SuitBadge key={game.activeSuit} suit={game.activeSuit} label={t('crazyeights.activeSuit', { suit: suitName })} className={styles.activeSuit} />
      <span className={styles.direction} title={t(ccw ? 'crazyeights.directionCcw' : 'crazyeights.directionCw')}
        aria-label={t(ccw ? 'crazyeights.directionCcw' : 'crazyeights.directionCw')}>{ccw ? '⟲' : '⟳'}</span>
      <span className={styles.pill}>{t('crazyeights.handOf', { n: String(game.hand), total: String(CE_HANDS) })}</span>
    </div>
  </div>;
}

function Info({ game }: { game: CrazyEightsVisibleState }): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const seats = game.seats;
  const recent = game.log.filter((entry) => entry.type === 'play' || entry.type === 'draw' || entry.type === 'pass')
    .slice(-RECENT_MOVES).reverse();
  return <aside className={infoStyles.rail}>
    <TurnBox text={game.phase !== 'playing' ? t('game.scoring')
      : isOwnTurn(game) ? t('crazyeights.yourTurn')
        : t('crazyeights.turnOf', { name: seatName(game.currentTurnSeat) })}>
      <p className={infoStyles.note}>
        {t('crazyeights.handOf', { n: String(game.hand), total: String(CE_HANDS) })} · {t(game.direction === 'ccw' ? 'crazyeights.directionCcw' : 'crazyeights.directionCw')}
      </p>
    </TurnBox>

    <section className={infoStyles.box}>
      <h2 className={infoStyles.caption}>{t('crazyeights.scores')}</h2>
      <ol className={infoStyles.list}>{seats.map((seat) => (
        <li key={seat} className={infoStyles.row}>
          <span className={infoStyles.name}>{seatName(seat)}</span>
          <span className={styles.count}>{t('crazyeights.cards', { n: String(game.handCounts[seat]) })}</span>
          <span className={styles.recentTotal}>{game.scores[seat]}</span>
        </li>
      ))}</ol>
    </section>

    <section className={`${infoStyles.box} ${infoStyles.grow}`}>
      <h2 className={infoStyles.caption}>{t('crazyeights.recent')}</h2>
      {recent.length === 0 ? <p className={infoStyles.note}>{t('crazyeights.noMoves')}</p>
        : <ol className={infoStyles.list}>{recent.map((entry) => (
          <li key={`${entry.timestamp}-${entry.type}-${entry.type === 'play' ? cardLabel(entry.card) : entry.type}`}
            className={infoStyles.row}>
            <span className={infoStyles.name}>{seatName(entry.seat)}</span>
            {entry.type === 'play' ? <>
              <CardImage card={entry.card} className={styles.mini} />
              {entry.suit && <SuitBadge suit={entry.suit} label={t(`crazyeights.suit.${entry.suit}`)} className={styles.miniSuit} />}
              {entry.target && entry.effect && <span className={styles.effect}>
                {entry.effect === 'draw' ? `+${entry.drawn}` : '⏭'} {seatName(entry.target)}</span>}
              {entry.effect === 'reverse' && !entry.target && <span className={styles.effect}>⇄</span>}
            </> : <span className={styles.muted}>{t(entry.type === 'draw' ? 'crazyeights.logDrew' : 'crazyeights.logPassed')}</span>}
          </li>
        ))}</ol>}
    </section>
  </aside>;
}

function ResultOverlay({ result, pending, error, disabled, onBack }: {
  result: CrazyEightsMatchResult; pending: boolean; error: string; disabled: boolean; onBack: () => void;
}): ReactNode {
  const { locale, t } = useI18nStore();
  const log = useGameStore((state) => state.crazyEights?.log);
  const history = useResultRoundHistory(useGameStore((state) => state.visible));
  const seatName = useSeatName();
  const seats = result.seats ?? [];
  const handPoints = (log ?? []).flatMap((entry) => (entry.type === 'handEnd' ? [entry.points] : []));
  const ranked = [...seats].sort((a, b) => result.scores[a] - result.scores[b] || seats.indexOf(a) - seats.indexOf(b));
  const rankOf = (seat: GameSeat): number => 1 + seats.filter((other) => result.scores[other] < result.scores[seat]).length;
  return <ResultDialog history={history}
    title={result.winners.length === 1 ? t('crazyeights.winner', { name: seatName(result.winners[0]) })
      : t('crazyeights.tiedWinners', { names: joinNames(result.winners.map(seatName), locale) })}
    pending={pending} error={error} disabled={disabled} onBack={onBack}>
    <table className={`${resultStyles.table} ${styles.rankTable}`}>
      <thead><tr>
        <th>{t('crazyeights.rank')}</th><th>{t('crazyeights.player')}</th>
        {handPoints.map((_, index) => <th key={index}>{t('crazyeights.handShort', { n: String(index + 1) })}</th>)}
        <th>{t('crazyeights.total')}</th>
      </tr></thead>
      <tbody>{ranked.map((seat) => {
        const won = result.winners.includes(seat);
        return <tr key={seat} className={won ? resultStyles.winnerRow : ''}>
          <td>{t('crazyeights.place', { n: String(rankOf(seat)) })}</td>
          <td>{won && <AppIcon name="trophy" />} {seatName(seat)}</td>
          {handPoints.map((points, index) => <td key={index}>{points[seat]}</td>)}
          <td><strong>{result.scores[seat]}</strong></td>
        </tr>;
      })}</tbody>
    </table>
  </ResultDialog>;
}

export function CrazyEightsTable(): ReactNode {
  const { locked } = useGamePresentation();
  const connectionReady = useConnectionReady();
  const game = useViewedGame(useGameStore((state) => state.crazyEights));
  const { t } = useI18nStore();
  const seatName = useSeatName();
  /** An 8 waiting for its suit */
  const [pendingWild, setPendingWild] = useState<Card | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionPending, setActionPending] = useState(false);

  if (!game) return null;

  const playing = game.phase === 'playing';
  const isMyTurn = playing && !locked && isOwnTurn(game);
  const canAct = isMyTurn && connectionReady && !actionPending;
  const options = game.lastPlayed
    ? ceTurnOptions(game.myHand, game.lastPlayed, game.activeSuit, game.drawn, game.stockCount + game.reserveCount) : null;
  const playable = options?.playable ?? [];
  const unplayable = game.myHand.filter((card) => !playable.some((other) => sameCard(other, card)));
  const chosen = canAct && pendingWild && game.myHand.some((card) => sameCard(card, pendingWild)) ? pendingWild : null;
  const canDraw = canAct && Boolean(options?.canDraw);
  const canPass = canAct && Boolean(options?.canPass);

  const handleActionResult: ActionCallback = (timeout, response) => {
    setActionPending(false);
    if (timeout) setActionError(t('auth.connectionError'));
    else if (!response?.success) setActionError(response?.error ?? t('common.error'));
  };

  const send = (action: CrazyEightsAction): void => {
    if (!canAct) return;
    setActionError('');
    setActionPending(true);
    setPendingWild(null);
    socket.timeout(10000).emit('game:action', { gameType: 'crazyeights', action }, handleActionResult);
  };

  const onCardClick = (card: Card): void => {
    if (card.rank === CE_WILD_RANK && ceNeedsSuit(card, game.myHand.length)) {
      setPendingWild(chosen && sameCard(chosen, card) ? null : card);
    } else send({ type: 'play', card });
  };

  const backToRoom = (): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:continue', handleActionResult);
  };

  const prompt = !playing ? null
    : !isMyTurn ? t('crazyeights.turnOf', { name: seatName(game.currentTurnSeat) })
      : chosen ? t('crazyeights.pickSuit')
        : game.drawn ? t('crazyeights.drawnPlayable')
          : options?.canDraw ? t('crazyeights.mustDraw')
            : options?.canPass ? t('crazyeights.mustPass') : t('crazyeights.pickCard');

  const picker = chosen && <HandActions className={styles.controls} layout="row">
    {CE_SUITS.map((suit) => {
      const name = t(`crazyeights.suit.${suit}`);
      return <button key={suit} type="button" className={`btn btn-primary ${styles.ctrl} ${styles.suitButton} ${isRed(suit) ? styles.red : ''}`}
        aria-label={t('crazyeights.declare', { suit: name })} title={t('crazyeights.declare', { suit: name })}
        disabled={!canAct} onClick={() => send({ type: 'play', card: chosen, suit })}>
        <span aria-hidden="true">{SUIT_SYMBOLS[suit]}</span>
      </button>;
    })}
    <button type="button" className={`btn btn-outline ${styles.ctrl}`} onClick={() => setPendingWild(null)}>
      {t('crazyeights.cancel')}</button>
  </HandActions>;

  const turnActions = !chosen && isMyTurn && (options?.canDraw || options?.canPass);
  const actions = turnActions && <HandActions className={styles.controls}>
    {options?.canDraw && <button type="button" className={`btn btn-primary ${styles.ctrl}`}
      disabled={!canDraw} onClick={() => send({ type: 'draw' })}>{t('crazyeights.draw')}</button>}
    {options?.canPass && <button type="button" className={`btn btn-primary ${styles.ctrl}`}
      disabled={!canPass} onClick={() => send({ type: 'pass' })}>{t('crazyeights.pass')}</button>}
  </HandActions>;

  const handZone = <div className={styles.handArea}>
    <CardHand cards={game.myHand} playableCards={playable} disabled={!canAct} onCardClick={onCardClick}
      markedCards={unplayable} markedLabel={t('crazyeights.unplayable')} />
    {picker}
    {actions}
  </div>;

  return (
    <GameShell
      info={<Info game={game} />}
      centre={<Centre game={game} canDraw={canDraw} onDraw={() => send({ type: 'draw' })} />}
      hand={handZone}
      prompt={prompt}
      overlay={game.phase === 'scoring' && game.result && <ResultOverlay result={game.result}
        pending={actionPending} error={actionError} disabled={!connectionReady} onBack={backToRoom} />}
      error={game.phase !== 'scoring' ? actionError : undefined}
    />
  );
}
