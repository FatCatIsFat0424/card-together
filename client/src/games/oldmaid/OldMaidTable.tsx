// ─── OldMaidTable: Old Maid table (neighbour's face-down fan, own reorderable hand, info rail, settlement) ───

import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { RANK_DISPLAY } from '@shared/constants';
import { sameCard } from '@shared/rules/cards';
import { omRandomOrder } from '@shared/rules/oldmaid';
import type { CardOrJoker, OldMaidLogEntry, OldMaidMatchResult, OldMaidVisibleState } from '@shared/types';
import { socket } from '../../socket';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { AppIcon } from '../../components/AppIcon';
import { CardBackArt } from '../../cosmetics/art-layers/CardBackArt';
import { useCardOrJokerFaceUrl } from '../../cosmetics/card-faces/use-card-face';
import { GameShell } from '../GameShell';
import { HandActions } from '../HandActions';
import { useViewedGame } from '../use-table-perspective';
import { useHandReorder } from '../use-hand-reorder';
import { ResultDialog, resultStyles } from '../ResultDialog';
import { useResultRoundHistory } from '../RoundHistory';
import { infoStyles, TurnBox } from '../TableInfo';
import { joinNames, useSeatName } from '../seat-names';
import { useConnectionReady } from '../use-connection-ready';
import { useGamePresentation } from '../use-game-presentation';
import { isOwnTurn, isSpectator } from '../observer-view';
import { fanRows, finishPlace, oldMaidMode, oldMaidView, recentOldMaidMoves } from './oldmaid-view';
import type { OldMaidTableView } from './oldmaid-view';
// The card rows look the same as Blackjack's, so the two games share one stylesheet for the card faces and backs.
import cardStyles from '../blackjack/BlackjackCards.module.css';
import styles from './OldMaidTable.module.css';

const RECENT_MOVES = 8;

type ActionCallback = (timeout: Error | null, response?: { success: boolean; error?: string }) => void;
type OldMaidSend = { type: 'draw'; index: number } | { type: 'reorder'; order: readonly number[] };

function coarsePointer(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
}

/**
 * The next player's hand, face down. Each card is a position to take from; `onPick` is absent while it is not the
 * viewer's turn, which leaves the cards as a plain display.
 */
function Fan({ count, owner, armed, onPick }: {
  count: number; owner: string; armed: number | null; onPick?: (index: number) => void;
}): ReactNode {
  const { t } = useI18nStore();
  const rows = fanRows(count);
  return <div className={styles.fan} role="group" aria-label={t('oldmaid.fanLabel', { name: owner, n: String(count) })}
    style={{ '--fan-cards': Math.max(...rows.map((row) => row.length), 1), '--fan-rows': rows.length } as CSSProperties}>
    {rows.map((row, rowIndex) => <div key={rowIndex} className={styles.fanRow}>
      {row.map((index) => onPick
        ? <button key={index} type="button" data-fan-position={index}
          className={`${styles.fanCard} ${cardStyles.back} ${armed === index ? styles.fanArmed : ''}`}
          aria-label={t('oldmaid.takeCard', { n: String(index + 1), total: String(count) })}
          onClick={() => onPick(index)}><CardBackArt /></button>
        : <span key={index} className={`${styles.fanCard} ${cardStyles.back}`} aria-hidden="true"><CardBackArt /></span>)}
    </div>)}
  </div>;
}

function Centre({ game, view, locked, armed, onPick }: {
  game: OldMaidVisibleState; view: OldMaidTableView; locked: boolean; armed: number | null;
  onPick?: (index: number) => void;
}): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const source = game.phase === 'playing' && !locked ? game.drawFrom : null;
  const pairs = Object.values(view.pairs).reduce((sum, value) => sum + value, 0);
  return <div className={styles.centre}>
    <div className={styles.facts}>
      <span className={styles.pill}>{t('oldmaid.deal', { n: String(view.deal), total: String(game.totalDeals) })}</span>
      <span className={styles.pill}>{t('oldmaid.discardCount', { n: String(pairs) })}</span>
    </div>
    {source && <>
      <span className={styles.caption}>
        {game.currentTurnSeat === game.mySeat && !isSpectator(game)
          ? t('oldmaid.promptDrawOwn', { name: seatName(source) })
          : t('oldmaid.turnOf', { name: seatName(game.currentTurnSeat), from: seatName(source) })}
      </span>
      <Fan count={game.handCounts[source]} owner={seatName(source)} armed={armed} onPick={onPick} />
    </>}
  </div>;
}

function rankText(entry: Extract<OldMaidLogEntry, { type: 'draw' }>): string {
  const pair = entry.discarded[0];
  return pair ? RANK_DISPLAY[pair.rank] : '';
}

function MoveLine({ entry }: { entry: OldMaidLogEntry }): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  if (entry.type === 'deal') {
    return <span className={styles.dealLine}>{t('oldmaid.logDeal', { n: String(entry.deal), name: seatName(entry.starter) })}</span>;
  }
  if (entry.type === 'settle') {
    return <span className={styles.dealLine}>{t('oldmaid.logSettle', { name: seatName(entry.loser) })}</span>;
  }
  return <>
    <span className={infoStyles.name}>{seatName(entry.seat)}</span>
    <span>{t('oldmaid.logDraw', { n: String(entry.index + 1), name: seatName(entry.from) })}</span>
    {entry.discarded.length > 0 && <span className={`${styles.tag} ${styles.tagGood}`}>
      {t('oldmaid.logPair', { rank: rankText(entry) })}</span>}
    {entry.finished.includes(entry.seat) && <span className={styles.tag}>{t('oldmaid.logOut')}</span>}
  </>;
}

function Info({ game, view, locked }: { game: OldMaidVisibleState; view: OldMaidTableView; locked: boolean }): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const recent = recentOldMaidMoves(game.log.slice(0, view.logEnd), RECENT_MOVES);
  const turnText = game.phase !== 'playing' || locked ? t('game.playing')
    : isOwnTurn(game) ? t('oldmaid.yourTurn')
      : t('oldmaid.turnOf', { name: seatName(game.currentTurnSeat), from: game.drawFrom ? seatName(game.drawFrom) : '' });
  return <aside className={infoStyles.rail}>
    <TurnBox text={turnText}>
      <p className={infoStyles.note}>{t('oldmaid.deal', { n: String(view.deal), total: String(game.totalDeals) })}</p>
    </TurnBox>

    <section className={infoStyles.box}>
      <h2 className={infoStyles.caption}>{t('oldmaid.scores')}</h2>
      <ul className={infoStyles.list}>{game.seats.map((seat) => {
        const place = finishPlace(view, seat);
        return <li key={seat} className={infoStyles.row}>
          <span className={infoStyles.name}>{seatName(seat)}</span>
          <span className={styles.score}>{t('oldmaid.points', { n: String(view.totals[seat]) })}</span>
          {place !== null && <span className={styles.tag}>{t('oldmaid.finishedTag', { n: String(place) })}</span>}
        </li>;
      })}</ul>
    </section>

    <section className={`${infoStyles.box} ${infoStyles.grow}`}>
      <h2 className={infoStyles.caption}>{t('oldmaid.recent')}</h2>
      {recent.length === 0 ? <p className={infoStyles.note}>{t('oldmaid.noMoves')}</p>
        : <ol className={infoStyles.list}>{recent.map((entry, index) => (
          <li key={view.logEnd - index} className={infoStyles.row}><MoveLine entry={entry} /></li>
        ))}</ol>}
    </section>
  </aside>;
}

/** Placement of a seat in each deal of a finished match: 1 for first out. */
function dealPlaces(result: OldMaidMatchResult, seat: OldMaidMatchResult['seats'][number]): number[] {
  return result.dealOrders.map((order) => order.indexOf(seat) + 1);
}

function ResultOverlay({ result, pending, error, disabled, onBack }: {
  result: OldMaidMatchResult; pending: boolean; error: string; disabled: boolean; onBack: () => void;
}): ReactNode {
  const { t, locale } = useI18nStore();
  const history = useResultRoundHistory(useGameStore((state) => state.visible));
  const seatName = useSeatName();
  const ranking = [...result.seats].sort((a, b) => result.totals[b] - result.totals[a]);
  const title = result.winners.length === 1 ? t('oldmaid.winner', { name: seatName(result.winners[0]) })
    : t('oldmaid.winners', { names: joinNames(result.winners.map(seatName), locale) });
  return <ResultDialog history={history} title={title} pending={pending} error={error} disabled={disabled} onBack={onBack}>
    <table className={`${resultStyles.table} ${styles.rankTable}`}>
      <thead><tr>
        <th>{t('oldmaid.rank')}</th><th>{t('oldmaid.player')}</th>
        {result.dealOrders.map((_order, index) => <th key={index}>{t('oldmaid.dealColumn', { n: String(index + 1) })}</th>)}
        <th>{t('oldmaid.total')}</th>
      </tr></thead>
      <tbody>{ranking.map((seat) => {
        const winner = result.winners.includes(seat);
        const places = dealPlaces(result, seat);
        return <tr key={seat} className={winner ? resultStyles.winnerRow : ''}>
          <td>{ranking.filter((other) => result.totals[other] > result.totals[seat]).length + 1}</td>
          <td>{winner && <><AppIcon name="trophy" /> </>}{seatName(seat)}</td>
          {places.map((place, index) => <td key={index} className={place === result.seats.length ? styles.lastPlace : ''}>
            {place === result.seats.length ? t('oldmaid.joker') : t('oldmaid.place', { n: String(place) })}</td>)}
          <td>{result.totals[seat]}</td>
        </tr>;
      })}</tbody>
    </table>
  </ResultDialog>;
}

/** The viewer's hand in its own order, which can be dragged into a new one. */
function OwnHand({ cards, canReorder, onReorder }: {
  cards: readonly CardOrJoker[]; canReorder: boolean; onReorder: (order: readonly number[]) => void;
}): ReactNode {
  const { t } = useI18nStore();
  const faceUrl = useCardOrJokerFaceUrl();
  const dragProps = useHandReorder(cards, canReorder, (next) => {
    onReorder(next.map((card) => cards.findIndex((candidate) => sameCard(candidate, card))));
  });
  return <div className={styles.hand} role="group" aria-label={t('oldmaid.hand')}
    style={{ '--hand-cards': Math.max(cards.length, 1) } as CSSProperties}>
    {cards.map((card, index) => {
      const props = dragProps(index);
      return <img key={'joker' in card ? card.joker : `${card.suit}${card.rank}`} {...props}
        className={`${cardStyles.card} ${styles.handCard}`} src={faceUrl(card)} draggable={false}
        alt={'joker' in card ? t('oldmaid.joker') : `${card.suit} ${RANK_DISPLAY[card.rank]}`} />;
    })}
  </div>;
}

export function OldMaidTable(): ReactNode {
  const { locked, frame } = useGamePresentation();
  const connectionReady = useConnectionReady();
  const game = useViewedGame(useGameStore((state) => state.oldMaid));
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const [armedPick, setArmed] = useState<{ readonly key: number; readonly index: number } | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionPending, setActionPending] = useState(false);

  // A touch pick is armed by the first tap; a new log entry, or a tap anywhere else, puts it down.
  const logLength = game?.log.length ?? 0;
  const armed = armedPick?.key === logLength ? armedPick.index : null;
  useEffect(() => {
    if (armed === null) return;
    const disarm = (event: Event): void => {
      if (event.target instanceof Element && event.target.closest('[data-fan-position]')) return;
      setArmed(null);
    };
    document.addEventListener('pointerdown', disarm);
    return () => document.removeEventListener('pointerdown', disarm);
  }, [armed]);

  if (!game) return null;

  const view = oldMaidView(game, frame);
  const playing = game.phase === 'playing';
  const watching = isSpectator(game);
  const out = !watching && view.finished.includes(game.mySeat);
  const mode = oldMaidMode(game, playing && !locked && !view.handHidden && isOwnTurn(game));
  const canAct = mode === 'draw' && connectionReady && !actionPending;

  const handleActionResult: ActionCallback = (timeout, response) => {
    setActionPending(false);
    if (timeout) setActionError(t('auth.connectionError'));
    else if (!response?.success) setActionError(response?.error ?? t('common.error'));
  };

  const send = (action: OldMaidSend): void => {
    setActionError('');
    if (action.type === 'draw') setActionPending(true);
    socket.timeout(10000).emit('game:action', { gameType: 'oldmaid', action }, action.type === 'draw'
      ? handleActionResult : (timeout: Error | null, response?: { success: boolean; error?: string }) => {
        if (timeout) setActionError(t('auth.connectionError'));
        else if (!response?.success) setActionError(response?.error ?? t('common.error'));
      });
  };

  const pick = (index: number): void => {
    if (!canAct) return;
    if (coarsePointer() && armed !== index) {
      setArmed({ key: logLength, index });
      return;
    }
    setArmed(null);
    send({ type: 'draw', index });
  };

  const backToRoom = (): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:continue', handleActionResult);
  };

  const canReorderHand = playing && !watching && !out && connectionReady && !view.handHidden && game.myHand.length > 1;
  const shuffle = (): void => {
    if (canReorderHand) send({ type: 'reorder', order: omRandomOrder(game.myHand.length, Math.random) });
  };

  const name = (seat: OldMaidVisibleState['mySeat']): string => seatName(seat);
  const prompt = !playing || view.handHidden ? null
    : out ? t('oldmaid.youFinished')
      : mode === 'draw' && game.drawFrom ? t('oldmaid.promptDraw', { name: name(game.drawFrom) })
        : game.drawFrom ? t('oldmaid.promptWait', { name: name(game.currentTurnSeat), from: name(game.drawFrom) }) : null;

  const handZone = <div className={styles.handArea}>
    {playing && !out && (view.handHidden
      ? <div className={styles.hand} style={{ '--hand-cards': Math.max(view.counts[game.mySeat], 1) } as CSSProperties}>
        {Array.from({ length: view.counts[game.mySeat] }, (_, index) => <span key={index}
          className={`${cardStyles.card} ${cardStyles.back} ${styles.handCard}`}><CardBackArt /></span>)}
      </div>
      : <OwnHand cards={game.myHand} canReorder={canReorderHand}
        onReorder={(order) => send({ type: 'reorder', order })} />)}
    {playing && !watching && !out && <HandActions className={styles.controls} layout="wide">
      <button type="button" className={`btn ${styles.ctrl}`} disabled={!canReorderHand} onClick={shuffle}
        title={t('oldmaid.shuffleTitle')}>{t('oldmaid.shuffle')}</button>
    </HandActions>}
  </div>;

  return (
    <GameShell
      info={<Info game={game} view={view} locked={locked} />}
      centre={<Centre game={game} view={view} locked={locked} armed={armed} onPick={mode === 'draw' ? pick : undefined} />}
      hand={handZone}
      prompt={prompt}
      overlay={game.phase === 'scoring' && game.result && <ResultOverlay result={game.result}
        pending={actionPending} error={actionError} disabled={!connectionReady} onBack={backToRoom} />}
      error={game.phase !== 'scoring' ? actionError : undefined}
    />
  );
}
