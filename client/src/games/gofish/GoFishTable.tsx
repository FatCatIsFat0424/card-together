// ─── GoFishTable: stock and last ask, seat-and-rank ask flow, books and ask log in the rail, settlement ───

import { useState } from 'react';
import type { ReactNode } from 'react';
import { GF_HANDS, gfRank, gfRanks, gfTargets } from '@shared/rules/gofish';
import { RANK_DISPLAY } from '@shared/constants';
import type { Card, GameSeat, Rank } from '@shared/types';
import type { GoFishMatchResult, GoFishVisibleState } from '@shared/games/gofish/types';
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
import { askOutcome } from './gofish-view';
import styles from './GoFishTable.module.css';

const RECENT_ENTRIES = 12;

type ActionCallback = (timeout: Error | null, response?: { success: boolean; error?: string }) => void;

function Centre({ game }: { game: GoFishVisibleState }): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const handStart = game.log.map((entry) => entry.type).lastIndexOf('hand');
  const last = game.log.slice(handStart + 1).reverse().find((entry) => entry.type === 'ask');
  const stockLabel = game.stockCount > 0 ? t('gofish.stock', { n: String(game.stockCount) }) : t('gofish.stockEmpty');
  return <div className={styles.centre}>
    <div className={styles.pile} title={stockLabel}>
      {game.stockCount > 0 && <span className={styles.back} aria-hidden="true"><CardBackArt /></span>}
      <span className={styles.pill}>{stockLabel}</span>
    </div>
    <div className={styles.status}>
      <span className={styles.pill}>{t('gofish.handOf', { n: String(game.hand), total: String(GF_HANDS) })}</span>
      {last?.type === 'ask' && <p className={styles.lastAsk}>
        <span className={styles.lastCaption}>{t('gofish.lastAsk')}</span>
        {t('gofish.logAsk', { name: seatName(last.seat), target: seatName(last.target), rank: RANK_DISPLAY[last.rank] })}
        <strong>{askOutcome(t, last)}</strong>
      </p>}
    </div>
  </div>;
}

function Info({ game }: { game: GoFishVisibleState }): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const recent = game.log.map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.type === 'ask' || entry.type === 'book' || entry.type === 'refill')
    .slice(-RECENT_ENTRIES).reverse();
  return <aside className={infoStyles.rail}>
    <TurnBox text={game.phase !== 'playing' ? t('game.scoring')
      : isOwnTurn(game) ? t('gofish.yourTurn')
        : t('gofish.turnOf', { name: seatName(game.currentTurnSeat) })}>
      <p className={infoStyles.note}>{t('gofish.handOf', { n: String(game.hand), total: String(GF_HANDS) })}</p>
    </TurnBox>

    <section className={infoStyles.box}>
      <h2 className={infoStyles.caption}>{t('gofish.books')}</h2>
      <ol className={infoStyles.list}>{game.seats.map((seat) => (
        <li key={seat} className={styles.seatRow}>
          <div className={infoStyles.row}>
            <span className={infoStyles.name}>{seatName(seat)}</span>
            <span className={styles.count}>{t('gofish.cards', { n: String(game.handCounts[seat]) })}</span>
            <span className={styles.total} title={t('gofish.booksTitle', {
              hand: String(game.books[seat].length), total: String(game.scores[seat] + game.books[seat].length),
            })}>{game.scores[seat] + game.books[seat].length}</span>
          </div>
          {game.books[seat].length > 0 && <ul className={styles.bookChips} aria-label={t('gofish.books')}>
            {game.books[seat].map((rank) => <li key={rank} className={styles.bookChip}>{RANK_DISPLAY[rank]}</li>)}
          </ul>}
        </li>
      ))}</ol>
    </section>

    <section className={`${infoStyles.box} ${infoStyles.grow}`}>
      <h2 className={infoStyles.caption}>{t('gofish.recent')}</h2>
      {recent.length === 0 ? <p className={infoStyles.note}>{t('gofish.noAsks')}</p>
        : <ol className={infoStyles.list}>{recent.map(({ entry, index }) => (
          <li key={index} className={styles.logEntry}>
            {entry.type === 'ask' ? <>
              <span>{t('gofish.logAsk', { name: seatName(entry.seat), target: seatName(entry.target), rank: RANK_DISPLAY[entry.rank] })}</span>
              <span className={entry.given > 0 ? styles.got : styles.muted}>{askOutcome(t, entry)}</span>
            </> : entry.type === 'book' ? <>
              <span className={infoStyles.name}>{seatName(entry.seat)}</span>
              <span className={styles.got}>{t('gofish.logBook', { rank: RANK_DISPLAY[entry.rank] })}</span>
            </> : entry.type === 'refill' && <>
              <span className={infoStyles.name}>{seatName(entry.seat)}</span>
              <span className={styles.muted}>{t('gofish.logRefill')}</span>
            </>}
          </li>
        ))}</ol>}
    </section>
  </aside>;
}

function ResultOverlay({ result, pending, error, disabled, onBack }: {
  result: GoFishMatchResult; pending: boolean; error: string; disabled: boolean; onBack: () => void;
}): ReactNode {
  const { locale, t } = useI18nStore();
  const history = useResultRoundHistory(useGameStore((state) => state.visible));
  const seatName = useSeatName();
  const seats = result.seats ?? [];
  const ranked = [...seats].sort((a, b) => result.scores[b] - result.scores[a] || seats.indexOf(a) - seats.indexOf(b));
  return <ResultDialog history={history}
    title={result.winners.length === 1 ? t('gofish.winner', { name: seatName(result.winners[0]) })
      : t('gofish.tiedWinners', { names: joinNames(result.winners.map(seatName), locale) })}
    pending={pending} error={error} disabled={disabled} onBack={onBack}>
    <table className={`${resultStyles.table} ${styles.rankTable}`}>
      <thead><tr>
        <th>{t('gofish.rank')}</th><th>{t('gofish.player')}</th>
        {result.handBooks.map((_, index) => <th key={index}>{t('gofish.handShort', { n: String(index + 1) })}</th>)}
        <th>{t('gofish.total')}</th>
      </tr></thead>
      <tbody>{ranked.map((seat) => {
        const won = result.winners.includes(seat);
        return <tr key={seat} className={won ? resultStyles.winnerRow : ''}>
          <td>{t('gofish.place', { n: String(gfRank(result, seat)) })}</td>
          <td>{won && <AppIcon name="trophy" />} {seatName(seat)}</td>
          {result.handBooks.map((books, index) => <td key={index}>{books[seat]}</td>)}
          <td><strong>{result.scores[seat]}</strong></td>
        </tr>;
      })}</tbody>
    </table>
  </ResultDialog>;
}

export function GoFishTable(): ReactNode {
  const { locked } = useGamePresentation();
  const connectionReady = useConnectionReady();
  const game = useViewedGame(useGameStore((state) => state.goFish));
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const [pickedSeat, setPickedSeat] = useState<GameSeat | null>(null);
  const [pickedRank, setPickedRank] = useState<Rank | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionPending, setActionPending] = useState(false);

  if (!game) return null;

  const playing = game.phase === 'playing';
  const isMyTurn = playing && !locked && isOwnTurn(game);
  const canAct = isMyTurn && connectionReady && !actionPending;
  const targets = isMyTurn ? gfTargets(game.seats, game.handCounts, game.mySeat) : [];
  const ranks = gfRanks(game.myHand);
  // With one possible target there is nothing to choose.
  const target = pickedSeat && targets.includes(pickedSeat) ? pickedSeat : targets.length === 1 ? targets[0] : null;
  const rank = pickedRank !== null && ranks.includes(pickedRank) ? pickedRank : null;
  const selected = rank === null ? [] : game.myHand.filter((card) => card.rank === rank);
  const ready = canAct && target !== null && rank !== null;

  const handleActionResult: ActionCallback = (timeout, response) => {
    setActionPending(false);
    if (timeout) setActionError(t('auth.connectionError'));
    else if (!response?.success) setActionError(response?.error ?? t('common.error'));
  };

  const send = (): void => {
    if (!ready) return;
    setActionError('');
    setActionPending(true);
    setPickedSeat(null);
    setPickedRank(null);
    socket.timeout(10000).emit('game:action', { gameType: 'gofish', action: { type: 'ask', target, rank } }, handleActionResult);
  };

  const onCardClick = (card: Card): void => {
    if (canAct) setPickedRank(rank === card.rank ? null : card.rank);
  };

  const backToRoom = (): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:continue', handleActionResult);
  };

  const prompt = !playing ? null
    : !isMyTurn ? t('gofish.turnOf', { name: seatName(game.currentTurnSeat) })
      : target !== null && rank !== null ? t('gofish.confirmPrompt', { name: seatName(target), rank: RANK_DISPLAY[rank] })
        : target !== null ? t('gofish.pickRank', { name: seatName(target) })
          : rank !== null ? t('gofish.pickTarget', { rank: RANK_DISPLAY[rank] }) : t('gofish.pickBoth');

  const actions = isMyTurn && <HandActions className={styles.controls}>
    <button type="button" className={`btn btn-primary ${styles.ctrl}`} disabled={!ready} onClick={send}>
      {t('gofish.ask')}</button>
    {(pickedSeat !== null || pickedRank !== null) && <button type="button" className={`btn btn-outline ${styles.ctrl}`}
      onClick={() => { setPickedSeat(null); setPickedRank(null); }}>{t('gofish.cancel')}</button>}
  </HandActions>;

  const handZone = <div className={styles.handArea}>
    <CardHand cards={game.myHand} selectedCards={selected} disabled={!canAct} onCardClick={onCardClick} />
    {actions}
  </div>;

  return (
    <GameShell
      info={<Info game={game} />}
      centre={<Centre game={game} />}
      hand={handZone}
      prompt={prompt}
      pickableSeats={canAct ? targets : undefined}
      onPickSeat={canAct ? (seat) => setPickedSeat(pickedSeat === seat ? null : seat) : undefined}
      pickedSeat={target}
      pickLabel="gofish.askPlayer"
      overlay={game.phase === 'scoring' && game.result && <ResultOverlay result={game.result}
        pending={actionPending} error={actionError} disabled={!connectionReady} onBack={backToRoom} />}
      error={game.phase !== 'scoring' ? actionError : undefined}
    />
  );
}
