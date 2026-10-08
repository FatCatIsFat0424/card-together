// ─── BigTwoTable：大老二牌桌（上家出牌、手牌多選、資訊欄、結算） ───

import { useCallback, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { canPlay, identifyCombo, isBomb, sortBigTwoHand } from '@shared/rules/bigtwo';
import { RANK_DISPLAY, SUIT_SYMBOLS } from '@shared/constants';
import type { BigTwoMatchResult, BigTwoVisibleState, Card, Seat } from '@shared/types';
import { cardImageUrl } from '../../cards';
import { socket } from '../../socket';
import { useGameStore } from '../../stores/game-store';
import { useRoomStore } from '../../stores/room-store';
import { useI18nStore } from '../../stores/i18n-store';
import { CardHand } from '../../components/CardHand';
import { reconcileHandOrder } from '../../components/card-hand-order';
import { GameShell } from '../GameShell';
import { RoundHistory } from '../RoundHistory';
import { useGamePresentation } from '../use-game-presentation';
import {
  comboLabelKey, currentRoundEntries, lastPlayCombo, penaltyFormula, sameCard, toggleCard,
} from './bigtwo-view';
import styles from './BigTwoTable.module.css';

const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];

type ActionCallback = (timeout: Error | null, response?: { success: boolean; error?: string }) => void;

function useSeatName(): (seat: Seat) => string {
  const seats = useRoomStore((state) => state.roomInfo?.seats);
  const { t } = useI18nStore();
  return (seat: Seat): string => seats?.[seat].player?.nickname ?? t(`seat.${seat}`);
}

function CardFan({ cards, small }: { cards: readonly Card[]; small?: boolean }): ReactNode {
  const middle = (cards.length - 1) / 2;
  return <span className={`${styles.fan} ${small ? styles.fanSmall : ''}`}>
    {cards.map((card, index) => (
      <img key={`${card.suit}-${card.rank}`} className={styles.fanCard} src={cardImageUrl(card)} draggable={false}
        alt={`${RANK_DISPLAY[card.rank]}${SUIT_SYMBOLS[card.suit]}`}
        style={{ '--fan': index - middle } as CSSProperties} />
    ))}
  </span>;
}

function Centre({ game }: { game: BigTwoVisibleState }): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const combo = lastPlayCombo(game.lastPlay);
  if (!game.lastPlay || !combo) {
    return <div className={styles.centre}>
      <span className={styles.freeLead}>{t('bigtwo.freeLead')}</span>
      {game.firstPlay && <span className={styles.hintText}>{t('bigtwo.clubThree')}</span>}
    </div>;
  }
  const bomb = isBomb(combo);
  return <div className={styles.centre}>
    {/* key 依出牌次數，讓每次出牌都重播進場動畫 */}
    <div key={`${game.lastPlay.seat}-${game.lastPlay.cards.map((card) => `${card.suit}${card.rank}`).join()}`} className={`${styles.lastPlay} ${bomb ? styles.bomb : ''}`}>
      <CardFan cards={game.lastPlay.cards} />
      <span className={styles.playMeta}>
        {bomb && <span className={styles.boom} aria-hidden="true">💥</span>}
        <strong>{t(comboLabelKey(combo.type))}</strong>
        <span>{seatName(game.lastPlay.seat)}</span>
      </span>
    </div>
  </div>;
}

function Info({ game }: { game: BigTwoVisibleState }): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const round = currentRoundEntries(game.log);
  return <aside className={styles.rail}>
    <section className={styles.box}>
      <p className={styles.turn}>{game.phase !== 'playing' ? t('game.scoring')
        : game.currentTurnSeat === game.mySeat ? t('bigtwo.yourTurn')
          : t('bigtwo.turnOf', { name: seatName(game.currentTurnSeat) })}</p>
      {game.phase === 'playing' && <p className={styles.note}>
        {game.lastPlay ? null : t('bigtwo.freeLead')}{game.firstPlay && <> · {t('bigtwo.clubThree')}</>}
      </p>}
    </section>

    <section className={`${styles.box} ${styles.roundBox}`}>
      <h2 className={styles.caption}>{t('bigtwo.round')}</h2>
      {round.length === 0 ? <p className={styles.note}>{t('bigtwo.roundEmpty')}</p>
        : <ol className={styles.roundList}>{round.map((entry, index) => (
          <li key={index} className={styles.roundRow}>
            <span className={styles.roundName}>{seatName(entry.seat)}</span>
            {entry.type === 'play' ? <>
              <CardFan cards={entry.cards} small />
              <span className={styles.note}>{t(comboLabelKey(entry.comboType))}</span>
            </> : <span className={styles.passTag}>{t('bigtwo.pass')}</span>}
          </li>
        ))}</ol>}
    </section>

    <details className={styles.box}>
      <summary className={styles.caption}>{t('bigtwo.rules')}</summary>
      <p className={styles.note}>{t('bigtwo.rulesCombos')}</p>
      <p className={styles.note}>{t('bigtwo.rulesOrder')}</p>
      <p className={styles.note}>{t('bigtwo.rulesScore')}</p>
    </details>
  </aside>;
}

function ResultOverlay({ result, revealed, pending, error, onBack }: {
  result: BigTwoMatchResult; revealed: Record<Seat, Card[]> | null;
  pending: boolean; error: string; onBack: () => void;
}): ReactNode {
  const { t } = useI18nStore();
  const historyGame = useGameStore((state) => state.visible);
  const seatName = useSeatName();
  return <div className={styles.scoreOverlay}>
    <div className={styles.overlayCard}>
      {result.dragon && <p className={styles.dragon}>{t('bigtwo.dragon')}</p>}
      <h2 className={styles.scoreTitle}>{t('bigtwo.winner', { name: seatName(result.winnerSeat) })}</h2>
      <table className={styles.scoreTable}>
        <thead><tr>
          <th>{t('bigtwo.player')}</th><th>{t('bigtwo.cardsLeft')}</th>
          <th>{t('bigtwo.twosLeft')}</th><th>{t('bigtwo.penalty')}</th>
        </tr></thead>
        <tbody>{SEATS.map((seat) => <tr key={seat} className={seat === result.winnerSeat ? styles.winnerRow : ''}>
          <td>
            <div>{seat === result.winnerSeat && '🏆 '}{seatName(seat)}</div>
            {revealed && revealed[seat].length > 0 && <CardFan cards={sortBigTwoHand(revealed[seat])} small />}
          </td>
          <td>{result.cardsLeft[seat]}</td>
          <td>{result.twosLeft[seat]}</td>
          <td>{seat === result.winnerSeat ? 0
            : penaltyFormula(result.cardsLeft[seat], result.twosLeft[seat], result.scores[seat])}</td>
        </tr>)}</tbody>
      </table>
      {historyGame && <RoundHistory game={historyGame} />}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <button className="btn btn-primary" disabled={pending} onClick={onBack}>{t('score.backToRoom')}</button>
    </div>
  </div>;
}

export function BigTwoTable(): ReactNode {
  const { locked } = useGamePresentation();
  const game = useGameStore((state) => state.bigTwo);
  const { t } = useI18nStore();
  const [selection, setSelection] = useState<Card[]>([]);
  const [manualOrder, setManualOrder] = useState<readonly Card[]>([]);
  const [sortBy, setSortBy] = useState<'rank' | 'suit'>('rank');
  const [actionError, setActionError] = useState('');
  const [actionPending, setActionPending] = useState(false);
  const actionInFlight = useRef(false);

  const hand = useMemo(() => reconcileHandOrder(
    sortBigTwoHand(game?.myHand ?? [], sortBy), manualOrder,
  ), [game?.myHand, sortBy, manualOrder]);
  // 別人出牌時保留預選；只剔除已不在手上的牌
  const selected = selection.filter((card) => hand.some((c) => sameCard(c, card)));
  const previous = lastPlayCombo(game?.lastPlay ?? null);
  const firstPlay = game?.firstPlay ?? false;
  const playing = game?.phase === 'playing';
  const isMyTurn = playing && !locked && game.currentTurnSeat === game.mySeat;
  const selectedCombo = identifyCombo(selected);
  const playable = isMyTurn && canPlay(selected, previous, firstPlay);

  const handleActionResult = useCallback<ActionCallback>((timeout, response) => {
    actionInFlight.current = false;
    setActionPending(false);
    if (timeout) setActionError(t('auth.connectionError'));
    else if (!response?.success) setActionError(response?.error ?? t('common.error'));
  }, [t]);

  const play = (cards: readonly Card[]): void => {
    if (!isMyTurn || actionInFlight.current || !canPlay(cards, previous, firstPlay)) return;
    actionInFlight.current = true;
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:bigtwo:play', { cards: [...cards] }, (timeout, response) => {
      if (!timeout && response?.success) setSelection([]);
      handleActionResult(timeout, response);
    });
  };

  const pass = (): void => {
    if (!isMyTurn || actionInFlight.current || !game?.lastPlay) return;
    actionInFlight.current = true;
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:bigtwo:pass', handleActionResult);
  };

  const backToRoom = (): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:continue', handleActionResult);
  };

  if (!game) return null;

  const handZone = <div className={styles.handArea}>
    <CardHand cards={hand} selectedCards={selected} disabled={!playing || actionPending}
      onCardClick={(card) => setSelection(toggleCard(selected, card))}
      onReorder={setManualOrder} />
    {playing && <div className={styles.controls}>
      <button type="button" className={`btn btn-outline ${styles.ctrl}`}
        onClick={() => {
          setSortBy(sortBy === 'rank' ? 'suit' : 'rank');
          setManualOrder([]);
        }}>
        {t(sortBy === 'rank' ? 'bigtwo.sortSuit' : 'bigtwo.sortRank')}
      </button>
      <button type="button" className={`btn btn-outline ${styles.ctrl}`} onClick={() => setSelection([])}
        disabled={selected.length === 0}>{t('bigtwo.clear')}</button>
      <button type="button" className={`btn btn-outline ${styles.ctrl}`} onClick={pass}
        disabled={!isMyTurn || actionPending || game.lastPlay === null}>{t('bigtwo.pass')}</button>
      <button type="button" className={`btn btn-primary ${styles.ctrl}`} onClick={() => play(selected)}
        disabled={!playable || actionPending}>
        {t('bigtwo.play')}
        {selected.length > 0 && <span className={styles.comboName}>
          {selectedCombo ? t(comboLabelKey(selectedCombo.type)) : t('bigtwo.invalid')}
        </span>}
      </button>
    </div>}
  </div>;

  return (
    <GameShell
      info={<Info game={game} />}
      centre={<Centre game={game} />}
      hand={handZone}
      overlay={game.phase === 'scoring' && game.result && <ResultOverlay result={game.result}
        revealed={game.revealedHands} pending={actionPending} error={actionError} onBack={backToRoom} />}
      error={game.phase !== 'scoring' ? actionError : undefined}
    />
  );
}
