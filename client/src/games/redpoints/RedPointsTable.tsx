// ─── RedPointsTable: Red Points table (table cards, stock flip, hand, info rail, settlement) ───

import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { rpCardPoints, rpPairOptions } from '@shared/rules/redpoints';
import { RANK_DISPLAY, SUIT_SYMBOLS } from '@shared/constants';
import type { Card, RedPointsMatchResult, RedPointsVisibleState, Seat } from '@shared/types';
import { cardImageUrl } from '../../cards';
import { socket } from '../../socket';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { CardHand } from '../../components/CardHand';
import { GameShell } from '../GameShell';
import { ResultDialog, resultStyles } from '../ResultDialog';
import { RoundHistory } from '../RoundHistory';
import { infoStyles, RulesBox, TurnBox } from '../TableInfo';
import { joinNames, useSeatName } from '../seat-names';
import { useConnectionReady } from '../use-connection-ready';
import { useGamePresentation } from '../use-game-presentation';
import { AppIcon } from '../../components/AppIcon';
import styles from './RedPointsTable.module.css';
import { redPointsCardAction, redPointsTableLayout, redPointsTablePage } from './redpoints-view';
import { isOwnTurn } from '../observer-view';

const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
const RECENT_MOVES = 8;

type ActionCallback = (timeout: Error | null, response?: { success: boolean; error?: string }) => void;

const sameCard = (a: Card, b: Card): boolean => a.suit === b.suit && a.rank === b.rank;
const cardLabel = (card: Card): string => `${SUIT_SYMBOLS[card.suit]}${RANK_DISPLAY[card.rank]}`;

function CardImage({ card, className }: { card: Card; className?: string }): ReactNode {
  return <img className={`${styles.card} ${className ?? ''}`} src={cardImageUrl(card)} alt={cardLabel(card)} draggable={false} />;
}

function Centre({ game, options, previewOptions, onCapture }: {
  game: RedPointsVisibleState; options: readonly Card[]; previewOptions: readonly Card[]; onCapture: ((card: Card) => void) | null;
}): ReactNode {
  const { t } = useI18nStore();
  const tableViewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 228, height: 88 });
  const [pagination, setPagination] = useState({ key: '', page: 0 });
  useLayoutEffect(() => {
    const element = tableViewport.current;
    if (!element) return;
    const measure = (rect: Pick<DOMRectReadOnly, 'width' | 'height'>): void => {
      const width = Math.floor(rect.width);
      const height = Math.floor(rect.height);
      setSize((previous) => previous.width === width && previous.height === height ? previous : { width, height });
    };
    const measureViewport = (): void => measure(element.getBoundingClientRect());
    measureViewport();
    const observer = new ResizeObserver(([entry]) => measure(entry.contentRect));
    observer.observe(element);
    window.addEventListener('resize', measureViewport);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measureViewport);
    };
  }, []);
  const layout = redPointsTableLayout(size.width, size.height, game.table.length);
  const pageKey = `${game.table.map(cardLabel).join(',')}:${layout.pageSize}`;
  const page = redPointsTablePage(game.table, pagination.key === pageKey ? pagination.page : 0, layout.pageSize);
  const lastFlip = game.log.findLast((entry) => entry.type === 'flip');
  const flipped = game.pendingFlip ?? lastFlip?.card ?? null;
  const centreStyle = { '--card-w': `${layout.cardWidth}px`, '--table-columns': Math.max(1, Math.min(layout.columns, page.cards.length)) } as CSSProperties;
  return <div className={styles.centreFrame}>
    <div className={styles.centre} style={centreStyle}>
      <div className={styles.stockRow}>
        <span className={styles.stockCount}>{t('redpoints.stock')} {game.stockCount}</span>
        {flipped && <div key={`${game.log.length}-${game.pendingFlip ? 'pending' : 'done'}`}
          className={`${styles.flip} ${game.pendingFlip ? styles.flipPending : ''}`}>
          <CardImage card={flipped} className={styles.flipCard} />
          <span className={styles.flipLabel} aria-hidden="true">{cardLabel(flipped)}</span>
        </div>}
      </div>
      <div className={styles.tableViewport} ref={tableViewport}>
        <div className={styles.tableGrid}>
          {page.cards.map((card) => {
            const previewed = previewOptions.some((option) => sameCard(option, card));
            const pairable = options.some((option) => sameCard(option, card));
            return <button key={`${card.suit}-${card.rank}`} type="button"
              className={`${styles.tableCard} ${pairable ? styles.pairable : ''} ${previewed ? styles.previewed : ''}`}
              disabled={!pairable || !onCapture} onClick={() => onCapture?.(card)}
              aria-label={cardLabel(card)}>
              <CardImage card={card} />
            </button>;
          })}
        </div>
      </div>
      <div className={styles.pagination}>
        {page.pageCount > 1 && <>
          <button type="button" className={`${styles.pageButton} touch-target`} disabled={page.page === 0}
            aria-label={t('redpoints.tablePrevious')}
            onClick={() => setPagination({ key: pageKey, page: page.page - 1 })}><AppIcon name="previousPage" /></button>
          <span className={styles.pageLabel} aria-live="polite">
            {t('redpoints.tablePage', { page: String(page.page + 1), total: String(page.pageCount) })}
          </span>
          <button type="button" className={`${styles.pageButton} touch-target`} disabled={page.page === page.pageCount - 1}
            aria-label={t('redpoints.tableNext')}
            onClick={() => setPagination({ key: pageKey, page: page.page + 1 })}><AppIcon name="nextPage" /></button>
        </>}
      </div>
    </div>
  </div>;
}

function Info({ game }: { game: RedPointsVisibleState }): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const recent = game.log.slice(-RECENT_MOVES).reverse();
  return <aside className={infoStyles.rail}>
    <TurnBox text={game.phase !== 'playing' ? t('game.scoring')
      : isOwnTurn(game) ? t('redpoints.yourTurn')
        : t('redpoints.turnOf', { name: seatName(game.currentTurnSeat) })}>
      <p className={infoStyles.note}>{t('redpoints.stock')} {game.stockCount}</p>
    </TurnBox>

    <section className={`${infoStyles.box} ${infoStyles.grow}`}>
      <h2 className={infoStyles.caption}>{t('redpoints.recent')}</h2>
      {recent.length === 0 ? <p className={infoStyles.note}>{t('redpoints.noMoves')}</p>
        : <ol className={infoStyles.list}>{recent.map((entry) => (
          // Each card is played or flipped only once
          <li key={cardLabel(entry.card)} className={infoStyles.row}>
            <span className={infoStyles.name}>{seatName(entry.seat)}</span>
            <span>{t(entry.type === 'play' ? 'redpoints.logPlay' : 'redpoints.logFlip')}</span>
            <CardImage card={entry.card} className={styles.mini} />
            {entry.captured ? <>→<CardImage card={entry.captured} className={styles.mini} /></>
              : <span className={styles.stayTag}>{t('redpoints.logStay')}</span>}
          </li>
        ))}</ol>}
    </section>

    <RulesBox title={t('redpoints.rules')}
      lines={[t('redpoints.rulesPair'), t('redpoints.rulesTurn'), t('redpoints.rulesScore')]} />
  </aside>;
}

function ResultOverlay({ result, captured, pending, error, disabled, onBack }: {
  result: RedPointsMatchResult; captured: Record<Seat, Card[]>;
  pending: boolean; error: string; disabled: boolean; onBack: () => void;
}): ReactNode {
  const { locale, t } = useI18nStore();
  const historyGame = useGameStore((state) => state.visible);
  const seatName = useSeatName();
  return <ResultDialog wide title={t('redpoints.winner', { name: joinNames(result.winners.map(seatName), locale) })}
    pending={pending} error={error} disabled={disabled} onBack={onBack}>
    <table className={resultStyles.table}>
      <thead><tr><th>{t('redpoints.player')}</th><th>{t('redpoints.score')}</th></tr></thead>
      <tbody>{SEATS.map((seat) => {
        const red = captured[seat].filter((card) => rpCardPoints(card) > 0);
        return <tr key={seat} className={result.winners.includes(seat) ? resultStyles.winnerRow : ''}>
          <td>
            <div>{result.winners.includes(seat) && <><AppIcon name="trophy" /> </>}{seatName(seat)}</div>
            {red.length > 0 && <span className={styles.miniRow}>
              {red.map((card) => <CardImage key={`${card.suit}-${card.rank}`} card={card} className={styles.mini} />)}
            </span>}
          </td>
          <td className={styles.pointsCell}>{result.points[seat]}</td>
        </tr>;
      })}</tbody>
    </table>
    {historyGame && <RoundHistory game={historyGame} />}
  </ResultDialog>;
}

export function RedPointsTable(): ReactNode {
  const { locked } = useGamePresentation();
  const connectionReady = useConnectionReady();
  const game = useGameStore((state) => state.redPoints);
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const [preview, setPreview] = useState<Card | null>(null);
  const [selection, setSelection] = useState<Card | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionPending, setActionPending] = useState(false);
  const actionInFlight = useRef(false);

  if (!game) return null;

  const playing = game.phase === 'playing';
  const isMyTurn = playing && !locked && isOwnTurn(game);
  const choosingFlip = isMyTurn && game.step === 'flip-choose' && game.pendingFlip !== null;
  const canPlay = isMyTurn && connectionReady && game.step === 'play' && !actionPending;
  // Drop the selection when it is not our turn; only cards still in hand count
  const selected = canPlay && selection && game.myHand.some((card) => sameCard(card, selection)) ? selection : null;
  const options = choosingFlip && game.pendingFlip ? rpPairOptions(game.pendingFlip, game.table)
    : selected ? rpPairOptions(selected, game.table) : [];

  const previewOptions = canPlay && preview && game.myHand.some((card) => sameCard(card, preview))
    ? rpPairOptions(preview, game.table) : [];

  const handleActionResult: ActionCallback = (timeout, response) => {
    actionInFlight.current = false;
    setActionPending(false);
    if (timeout) setActionError(t('auth.connectionError'));
    else if (!response?.success) setActionError(response?.error ?? t('common.error'));
  };

  const send = (capture: Card | null, card: Card | null = selected): void => {
    if (!isMyTurn || !connectionReady || actionInFlight.current || (!choosingFlip && (!canPlay || !card))) return;
    if (choosingFlip && !capture) return;
    actionInFlight.current = true;
    setActionError('');
    setActionPending(true);
    if (choosingFlip && capture) {
      socket.timeout(10000).emit('game:redpoints:chooseFlip', { capture }, handleActionResult);
    } else if (card) {
      socket.timeout(10000).emit('game:redpoints:play', capture ? { card, capture } : { card },
        (timeout, response) => {
          if (!timeout && response?.success) setSelection(null);
          handleActionResult(timeout, response);
        });
    }
  };

  const onCardClick = (card: Card): void => {
    if (!canPlay || actionInFlight.current) return;
    const action = redPointsCardAction(card, game.table);
    if (action.type === 'choose') setSelection(selected && sameCard(selected, card) ? null : card);
    else send(action.capture, card);
  };

  const backToRoom = (): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:continue', handleActionResult);
  };

  const prompt = !playing ? null
    : game.step === 'flip-choose' && game.pendingFlip
      ? choosingFlip ? t('redpoints.flipChoose', { card: cardLabel(game.pendingFlip) })
        : t('redpoints.flipWait', { name: seatName(game.currentTurnSeat) })
      : !isMyTurn ? t('redpoints.turnOf', { name: seatName(game.currentTurnSeat) })
        : !selected ? t('redpoints.pickCard')
          : options.length > 0 ? t('redpoints.pickCapture') : null;

  const handZone = <div className={styles.handArea}>
    <CardHand cards={game.myHand} selectedCards={selected ? [selected] : []} disabled={!canPlay}
      onCardClick={onCardClick} onCardPreview={setPreview} confirmTouch />
    {playing && <div className={styles.controls}>
      {prompt && <span className={`${styles.prompt} ${isMyTurn ? styles.promptActive : ''}`}>{prompt}</span>}
    </div>}
  </div>;

  return (
    <GameShell
      info={<Info game={game} />}
      centre={<Centre game={game} options={options} previewOptions={previewOptions} onCapture={options.length > 0 && !actionPending && connectionReady ? send : null} />}
      hand={handZone}
      overlay={game.phase === 'scoring' && game.result && <ResultOverlay result={game.result}
        captured={game.captured} pending={actionPending} error={actionError} disabled={!connectionReady}
        onBack={backToRoom} />}
      error={game.phase !== 'scoring' ? actionError : undefined}
    />
  );
}
