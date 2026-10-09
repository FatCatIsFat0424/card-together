// ─── ChinesePokerTable: arrange three rows, wait for the table, then the showdown result ───

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CP_ROWS, CP_ROW_SIZES, cpEvaluate, cpSortHand } from '@shared/rules/chinesepoker';
import { cpBestArrangement } from '@shared/rules/chinesepoker-arrange';
import type {
  Card, ChinesePokerArrangement, ChinesePokerMatchResult, ChinesePokerRow, ChinesePokerVisibleState, Seat,
} from '@shared/types';
import { cardImageUrl } from '../../cards';
import { socket } from '../../socket';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { CardHand } from '../../components/CardHand';
import { reconcileHandOrder } from '../../components/card-hand-order';
import { tablePosition } from '../../game-view';
import { GameShell } from '../GameShell';
import { ResultDialog, resultStyles } from '../ResultDialog';
import { infoStyles, RulesBox, TurnBox } from '../TableInfo';
import { joinNames, useSeatName } from '../seat-names';
import { useConnectionReady } from '../use-connection-ready';
import { projectedServerNow } from '../turn-clock';
import { useGamePresentation } from '../use-game-presentation';
import { CardRow, cardName } from './ChinesePokerCards';
import {
  EMPTY_ROWS, buildArrangement, canPlace, categoryLabelKey, isFoulArrangement, placeCards, placedCount,
  returnCard, rowHints, rowLabelKey, rowSpace, rowsFromArrangement, sameCard, sanitizeRows, signedPoints,
  sortCpHand, unplacedCards,
} from './chinesepoker-view';
import type { CpRowCards } from './chinesepoker-view';
import styles from './ChinesePokerTable.module.css';

const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
const NO_CARDS: readonly Card[] = [];

type ActionCallback = (timeout: Error | null, response?: { success: boolean; error?: string }) => void;

const cardsKey = (cards: readonly Card[]): string => cards.map((card) => `${card.suit}${card.rank}`).join();

function toggleCard(selection: readonly Card[], card: Card): Card[] {
  return selection.some((candidate) => sameCard(candidate, card))
    ? selection.filter((candidate) => !sameCard(candidate, card)) : [...selection, card];
}

interface RowSlotProps {
  row: ChinesePokerRow;
  cards: readonly Card[];
  rows: CpRowCards;
  selection: readonly Card[];
  /** Placed cards return to the hand and the empty slots accept the selection */
  editable: boolean;
  onPlace: (row: ChinesePokerRow) => void;
  onReturn: (card: Card) => void;
}

function RowSlot({ row, cards, rows, selection, editable, onPlace, onReturn }: RowSlotProps): ReactNode {
  const { t } = useI18nStore();
  const hint = rowHints(rows)[row];
  const space = rowSpace(rows, row);
  const placeable = editable && canPlace(rows, row, selection);
  const rowName = t(rowLabelKey(row));
  return <section className={`${styles.row} ${hint.beats ? styles.rowFoul : ''}`} aria-label={rowName}>
    <header className={styles.rowHeader}>
      <span className={styles.rowName}>{rowName}</span>
      <span className={styles.rowCount}>{cards.length}/{CP_ROW_SIZES[row]}</span>
      {hint.category && <span className={styles.category}>
        {t(categoryLabelKey(hint.category))}
        {hint.value > 1 && <span className={styles.rowValue}> · {t('chinesepoker.rowValue', { n: String(hint.value) })}</span>}
      </span>}
      {hint.beats && <span className={styles.foulHint} role="status">
        ⚠ {t('chinesepoker.beats', { row: t(rowLabelKey(hint.beats)) })} · {t('chinesepoker.foul')}
      </span>}
    </header>
    <div className={styles.slots}>
      {cards.map((card) => editable
        ? <button key={`${card.suit}-${card.rank}`} type="button" className={`${styles.slotCard} ${styles.returnable}`}
          aria-label={t('chinesepoker.returnCard', { card: cardName(card) })} onClick={() => onReturn(card)}>
          <img src={cardImageUrl(card)} alt="" draggable={false} />
        </button>
        : <span key={`${card.suit}-${card.rank}`} className={styles.slotCard}>
          <img src={cardImageUrl(card)} alt={cardName(card)} draggable={false} />
        </span>)}
      {space > 0 && (editable
        ? <button type="button" className={`${styles.dropZone} ${placeable ? styles.dropReady : ''}`}
          style={{ gridColumn: `span ${space}` }} disabled={!placeable}
          aria-label={t('chinesepoker.placeIn', { row: rowName })} onClick={() => onPlace(row)}>
          {placeable && <span className={styles.dropLabel}>{t('chinesepoker.placeHere')}</span>}
        </button>
        : <span className={styles.dropZone} style={{ gridColumn: `span ${space}` }} aria-hidden="true" />)}
    </div>
  </section>;
}

function ArrangedRows({ rows, selection, editable, onPlace, onReturn }: Omit<RowSlotProps, 'row' | 'cards'>): ReactNode {
  return <div className={styles.rows}>
    {CP_ROWS.map((row) => <RowSlot key={row} row={row} cards={editable ? rows[row] : cpSortHand(rows[row])}
      rows={rows} selection={selection} editable={editable} onPlace={onPlace} onReturn={onReturn} />)}
  </div>;
}

const noop = (): void => undefined;

function SettledCentre({ result, bottomSeat }: { result: ChinesePokerMatchResult; bottomSeat: Seat }): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  return <div className={styles.settled}>
    {SEATS.map((seat) => <div key={seat}
      className={`${styles.settledSeat} ${styles[tablePosition(seat, bottomSeat)]} ${result.winners.includes(seat) ? styles.settledWinner : ''}`}>
      <span className={styles.settledName}>
        {result.winners.includes(seat) && '🏆 '}{seatName(seat)}
        <strong className={result.scores[seat] > 0 ? styles.gain : result.scores[seat] < 0 ? styles.loss : undefined}>
          {signedPoints(result.scores[seat])}
        </strong>
      </span>
      {result.fouls.includes(seat) && <span className={styles.foulTag}>{t('chinesepoker.foul')}</span>}
      {CP_ROWS.map((row) => <CardRow key={row} cards={cpSortHand(result.arrangements[seat][row])} />)}
    </div>)}
  </div>;
}

function Centre({ game, rows, selection, editable, onPlace, onReturn, locked }: {
  game: ChinesePokerVisibleState; rows: CpRowCards; selection: readonly Card[]; editable: boolean;
  onPlace: (row: ChinesePokerRow) => void; onReturn: (card: Card) => void; locked: boolean;
}): ReactNode {
  const { t, locale } = useI18nStore();
  const seatName = useSeatName();
  if (game.phase === 'scoring' && game.result && !locked) {
    return <SettledCentre result={game.result} bottomSeat={game.mySeat} />;
  }
  if (game.myArrangement) {
    const waiting = SEATS.filter((seat) => !game.submitted[seat]);
    return <div className={styles.centre}>
      <ArrangedRows rows={rowsFromArrangement(game.myArrangement)} selection={[]} editable={false}
        onPlace={noop} onReturn={noop} />
      {game.phase === 'arranging' && <p className={styles.waiting} role="status">
        {t('chinesepoker.waiting')}{waiting.length > 0 && <>: {joinNames(waiting.map(seatName), locale)}</>}
      </p>}
    </div>;
  }
  return <div className={styles.centre}>
    <ArrangedRows rows={rows} selection={selection} editable={editable} onPlace={onPlace} onReturn={onReturn} />
  </div>;
}

function Info({ game, locked }: { game: ChinesePokerVisibleState; locked: boolean }): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const arranged = SEATS.filter((seat) => game.submitted[seat]).length;
  const scoring = game.phase === 'scoring';
  // Scores stay hidden until the showdown presentation has revealed them.
  const settled = scoring && !locked;
  return <aside className={infoStyles.rail}>
    <TurnBox text={scoring ? t('game.scoring')
      : game.submitted[game.mySeat] ? t('chinesepoker.waiting') : t('chinesepoker.yourArrange')}>
      {!scoring && <p className={infoStyles.note}>
        {t('chinesepoker.arrangedCount', { n: String(arranged) })}
        {!game.submitted[game.mySeat] && <> · {t('chinesepoker.hint')}</>}
      </p>}
    </TurnBox>

    <section className={infoStyles.box}>
      <h2 className={infoStyles.caption}>{t('chinesepoker.players')}</h2>
      <ul className={infoStyles.list}>{SEATS.map((seat) => <li key={seat} className={infoStyles.row}>
        <span className={infoStyles.name}>{seatName(seat)}</span>
        {settled && game.result
          ? <strong className={styles.infoScore}>{signedPoints(game.result.scores[seat])}</strong>
          : <span className={game.submitted[seat] ? styles.statusDone : styles.statusPending}>
            {game.submitted[seat] ? `✓ ${t('chinesepoker.arranged')}` : t('chinesepoker.arranging')}
          </span>}
        {game.autoArranged.includes(seat) && <span className={infoStyles.note}>{t('chinesepoker.autoTag')}</span>}
      </li>)}</ul>
    </section>

    <RulesBox title={t('chinesepoker.rules')} lines={[
      t('chinesepoker.rulesRows'), t('chinesepoker.rulesFoul'), t('chinesepoker.rulesValues'), t('chinesepoker.rulesSweep'),
    ]} />
  </aside>;
}

function ResultOverlay({ result, autoArranged, pending, error, disabled, onBack }: {
  result: ChinesePokerMatchResult; autoArranged: readonly Seat[];
  pending: boolean; error: string; disabled: boolean; onBack: () => void;
}): ReactNode {
  const { t, locale } = useI18nStore();
  const seatName = useSeatName();
  return <ResultDialog wide title={t('chinesepoker.winner', { names: joinNames(result.winners.map(seatName), locale) })}
    eyebrow={result.homeRun ? `💥 ${t('chinesepoker.homeRunBy', { name: seatName(result.homeRun) })}` : undefined}
    pending={pending} error={error} disabled={disabled} onBack={onBack}>
    <div className={styles.resultSeats}>
      {SEATS.map((seat) => {
        const winner = result.winners.includes(seat);
        const score = result.scores[seat];
        return <section key={seat} className={`${styles.resultSeat} ${winner ? styles.resultWinner : ''}`}>
          <header className={styles.resultHeader}>
            <span className={styles.resultName}>{winner && '🏆 '}{seatName(seat)}</span>
            {result.fouls.includes(seat) && <span className={styles.foulTag}>{t('chinesepoker.foul')}</span>}
            {autoArranged.includes(seat) && <span className={styles.autoTag}>{t('chinesepoker.autoTag')}</span>}
            <span className={styles.resultTotal}>
              {t('chinesepoker.total')} <strong className={score > 0 ? styles.gain : score < 0 ? styles.loss : undefined}>
                {signedPoints(score)}
              </strong>
            </span>
          </header>
          <div className={styles.resultRows}>
            {CP_ROWS.map((row) => {
              const cards = cpSortHand(result.arrangements[seat][row]);
              return <div key={row} className={styles.resultRow}>
                <span className={styles.resultRowName}>{t(rowLabelKey(row))}</span>
                <CardRow cards={cards} />
                <span className={styles.resultCategory}>{t(categoryLabelKey(cpEvaluate(cards).category))}</span>
              </div>;
            })}
          </div>
        </section>;
      })}
    </div>

    <h3 className={styles.matchupTitle}>{t('chinesepoker.matchups')}</h3>
    <table className={`${resultStyles.table} ${styles.matchupTable}`}>
      <thead><tr>
        <th>{t('chinesepoker.matchup')}</th>
        {CP_ROWS.map((row) => <th key={row}>{t(rowLabelKey(row))}</th>)}
        <th>{t('chinesepoker.points')}</th>
      </tr></thead>
      <tbody>{result.matchups.map(({ seats: [first, second], rows, shooter, points }) => <tr key={`${first}${second}`}>
        <td>
          <div>{t('chinesepoker.versus', { a: seatName(first), b: seatName(second) })}</div>
          {shooter && <span className={styles.shootTag}>🎯 {t('chinesepoker.shotBy', { name: seatName(shooter) })}</span>}
        </td>
        {rows.map((value, index) => <td key={CP_ROWS[index]}>{signedPoints(value)}</td>)}
        <td><strong>{signedPoints(points)}</strong></td>
      </tr>)}</tbody>
    </table>
  </ResultDialog>;
}

export function ChinesePokerTable(): ReactNode {
  const { locked } = useGamePresentation();
  const connectionReady = useConnectionReady();
  const game = useGameStore((state) => state.chinesePoker);
  const { t } = useI18nStore();
  const myHand = game?.myHand ?? NO_CARDS;
  const handKey = cardsKey(myHand);
  // Rows and selection belong to one deal; a new hand starts from empty rows.
  const [local, setLocal] = useState<{ key: string; rows: CpRowCards; selection: readonly Card[] }>(
    { key: '', rows: EMPTY_ROWS, selection: [] });
  const [manualOrder, setManualOrder] = useState<readonly Card[]>([]);
  const [sortBy, setSortBy] = useState<'rank' | 'suit'>('rank');
  const [foulWarnedFor, setFoulWarnedFor] = useState<string | null>(null);
  // The acknowledgement can arrive before the updated state; keep the hand locked in between.
  const [sentFor, setSentFor] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionPending, setActionPending] = useState(false);
  const actionInFlight = useRef(false);
  const clock = useGameStore((state) => state.visible?.clock);
  const receivedAt = useGameStore((state) => state.presentationReceivedAt);
  // Close editing at the shared deadline so a late Confirm is not sent only to be rejected.
  const [expiredDeadline, setExpiredDeadline] = useState<number | null>(null);
  const deadline = game?.phase === 'arranging' ? game.arrangeDeadline : null;
  useEffect(() => {
    if (deadline === null) return;
    const now = Date.now();
    const remaining = deadline - (clock ? projectedServerNow(clock, receivedAt, now) : now);
    const timer = setTimeout(() => setExpiredDeadline(deadline), Math.min(2_147_483_647, Math.max(0, remaining)));
    return () => clearTimeout(timer);
  }, [deadline, clock, receivedAt]);
  const expired = deadline !== null && expiredDeadline === deadline;

  const current = local.key === handKey ? local : { key: handKey, rows: EMPTY_ROWS, selection: [] };
  const rows = sanitizeRows(current.rows, myHand);
  const hand = reconcileHandOrder(sortCpHand(unplacedCards(myHand, rows), sortBy), manualOrder);
  const selection = current.selection.filter((card) => hand.some((candidate) => sameCard(candidate, card)));
  const arrangement = buildArrangement(rows);
  const arrangementKey = arrangement ? cardsKey([...arrangement.front, ...arrangement.middle, ...arrangement.back]) : '';
  const foul = isFoulArrangement(rows);
  const foulWarned = foul && foulWarnedFor === arrangementKey;
  const arranging = game?.phase === 'arranging';
  const submitted = game
    ? game.submitted[game.mySeat] || game.myArrangement !== null || sentFor === handKey : false;
  const editable = arranging && !submitted && !expired && !locked && !actionPending;

  const update = (next: Partial<{ rows: CpRowCards; selection: readonly Card[] }>): void => {
    setLocal({ key: handKey, rows: next.rows ?? rows, selection: next.selection ?? selection });
  };

  const handleActionResult: ActionCallback = (timeout, response) => {
    actionInFlight.current = false;
    setActionPending(false);
    if (timeout) setActionError(t('auth.connectionError'));
    else if (!response?.success) setActionError(response?.error ?? t('common.error'));
  };

  const submit = (final: ChinesePokerArrangement): void => {
    if (!editable || !connectionReady || actionInFlight.current) return;
    actionInFlight.current = true;
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:chinesepoker:arrange', { arrangement: final }, (timeout, response) => {
      if (!timeout && response?.success) setSentFor(handKey);
      handleActionResult(timeout, response);
    });
  };

  const confirm = (): void => {
    if (!arrangement) return;
    // A foul is legal but costly, so the first press only warns.
    if (foul && !foulWarned) {
      setFoulWarnedFor(arrangementKey);
      return;
    }
    submit(arrangement);
  };

  const backToRoom = (): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:continue', handleActionResult);
  };

  if (!game) return null;

  const place = (row: ChinesePokerRow): void => {
    if (!editable || !canPlace(rows, row, selection)) return;
    update({ rows: placeCards(rows, row, selection), selection: [] });
  };
  const giveBack = (card: Card): void => {
    if (editable) update({ rows: returnCard(rows, card) });
  };

  const handZone = <div className={styles.handArea}>
    {arranging && !submitted ? <>
      <CardHand cards={hand} selectedCards={selection} disabled={!editable}
        onCardClick={(card) => update({ selection: toggleCard(selection, card) })}
        onReorder={setManualOrder} />
      {foulWarned && <p className={styles.foulWarning} role="alert">{t('chinesepoker.foulWarning')}</p>}
      <div className={styles.controls}>
        <button type="button" className={`btn btn-outline ${styles.ctrl}`} disabled={!editable}
          onClick={() => {
            setSortBy(sortBy === 'rank' ? 'suit' : 'rank');
            setManualOrder([]);
          }}>
          {t(sortBy === 'rank' ? 'chinesepoker.sortSuit' : 'chinesepoker.sortRank')}
        </button>
        <button type="button" className={`btn btn-outline ${styles.ctrl}`} disabled={!editable}
          onClick={() => update({ rows: rowsFromArrangement(cpBestArrangement(myHand)), selection: [] })}>
          {t('chinesepoker.autoArrange')}
        </button>
        <button type="button" className={`btn btn-outline ${styles.ctrl}`}
          disabled={!editable || placedCount(rows) === 0}
          onClick={() => update({ rows: EMPTY_ROWS, selection: [] })}>
          {t('chinesepoker.clearRows')}
        </button>
        <button type="button" className={`btn ${foulWarned ? 'btn-danger' : 'btn-primary'} ${styles.ctrl}`}
          disabled={!arrangement || !editable || !connectionReady} onClick={confirm}>
          {t(foulWarned ? 'chinesepoker.confirmFoul' : 'chinesepoker.confirm')}
        </button>
      </div>
    </> : arranging && <p className={styles.submittedNote}>{t('chinesepoker.submitted')}</p>}
  </div>;

  return (
    <GameShell
      info={<Info game={game} locked={locked} />}
      centre={<Centre game={game} rows={rows} selection={selection} editable={editable}
        onPlace={place} onReturn={giveBack} locked={locked} />}
      hand={handZone}
      overlay={game.phase === 'scoring' && game.result && <ResultOverlay result={game.result}
        autoArranged={game.autoArranged} pending={actionPending} error={actionError} disabled={!connectionReady}
        onBack={backToRoom} />}
      error={game.phase !== 'scoring' ? actionError : undefined}
      turnReady={arranging && !submitted}
    />
  );
}
