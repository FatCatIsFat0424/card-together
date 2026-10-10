// ─── SevensTable: Sevens table (suit rows, play/cover hand, info rail, settlement) ───

import { Fragment, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { svPenalty, svSortHand } from '@shared/rules/sevens';
import { RANK_DISPLAY, SUIT_SYMBOLS } from '@shared/constants';
import type { Card, Seat, SevensMatchResult, SevensVisibleState, Suit } from '@shared/types';
import type { TranslationKey } from '../../i18n';
import { socket } from '../../socket';
import { useGameStore } from '../../stores/game-store';
import { useGodViewStore } from '../../stores/god-view-store';
import { useI18nStore } from '../../stores/i18n-store';
import { CardHand } from '../../components/CardHand';
import { GameShell } from '../GameShell';
import { ResultDialog, resultStyles } from '../ResultDialog';
import { RoundHistory } from '../RoundHistory';
import { infoStyles, RulesBox, TurnBox } from '../TableInfo';
import { joinNames, useSeatName } from '../seat-names';
import { useConnectionReady } from '../use-connection-ready';
import { useGamePresentation } from '../use-game-presentation';
import {
  coverCost, coverSelection, lastPlayedCard, rankAtOrder, recentMoves, sameCard, sevensHandMode, sevensRows,
} from './sevens-view';
import type { SevensHandMode, SevensRow } from './sevens-view';
import { AppIcon } from '../../components/AppIcon';
import styles from './SevensTable.module.css';
import { isOwnTurn, isSpectator } from '../observer-view';

const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
const RECENT_MOVES = 8;

type ActionCallback = (timeout: Error | null, response?: { success: boolean; error?: string }) => void;
type Translate = (key: TranslationKey, params?: Record<string, string>) => string;

const cardLabel = (card: Card): string => `${SUIT_SYMBOLS[card.suit]}${RANK_DISPLAY[card.rank]}`;
const isRed = (suit: Suit): boolean => suit === 'hearts' || suit === 'diamonds';

/** Compact card face: readable rank and suit even after the centre is scaled down on phones. */
function CardChip({ card, className, style }: { card: Card; className?: string; style?: CSSProperties }): ReactNode {
  return <span className={`${styles.chip} ${styles.face} ${isRed(card.suit) ? styles.red : ''} ${className ?? ''}`}
    style={style} role="img" aria-label={cardLabel(card)}>
    <span className={styles.chipRank} aria-hidden="true">{RANK_DISPLAY[card.rank]}</span>
    <span className={styles.chipSuit} aria-hidden="true">{SUIT_SYMBOLS[card.suit]}</span>
  </span>;
}

function ChipList({ cards, label }: { cards: readonly Card[]; label?: string }): ReactNode {
  return <span className={styles.chipList} role="group" aria-label={label}>
    {svSortHand(cards).map((card) => <CardChip key={`${card.suit}-${card.rank}`} card={card} className={styles.mini} />)}
  </span>;
}

function SuitRow({ row, last, preview }: { row: SevensRow; last: Card | null; preview: Card | null }): ReactNode {
  const { t } = useI18nStore();
  const played = row.slots.filter((slot) => slot.state === 'played');
  const range = played.length > 0
    ? `${RANK_DISPLAY[rankAtOrder(played[0].order)]}–${RANK_DISPLAY[rankAtOrder(played[played.length - 1].order)]}`
    : t('sevens.waiting');
  const label = `${SUIT_SYMBOLS[row.suit]} ${range}${row.closed ? ` ${t('sevens.closed')}` : ''}`;
  return <div className={styles.row} role="group" aria-label={label}>
    <span className={`${styles.rowSuit} ${isRed(row.suit) ? styles.redSuit : ''}`} aria-hidden="true">
      {SUIT_SYMBOLS[row.suit]}
      {row.closed && <span className={styles.closedLabel}>{t('sevens.closed')}</span>}
    </span>
    <div className={styles.slots}>
      {row.slots.map((slot) => {
        const position = { gridColumn: slot.order } as CSSProperties;
        const key = slot.order;
        if (slot.state === 'played') {
          const isLast = last !== null && sameCard(last, slot.card);
          const low = slot.order === played[0].order;
          const inner = !low && slot.order !== played[played.length - 1].order;
          const chip = <CardChip key={key} card={slot.card} style={position}
            className={`${isLast ? styles.last : ''} ${inner ? styles.inner : ''}`} />;
          // Narrow tables keep only the row ends, so the cards between them collapse into an ellipsis.
          return low && played.length > 2
            ? <Fragment key={key}>{chip}<span className={styles.ellipsis} aria-hidden="true">…</span></Fragment>
            : chip;
        }
        if (slot.state === 'next') {
          const previewed = slot.target && preview !== null && sameCard(preview, slot.card);
          return <span key={key} style={position} aria-hidden={!slot.target}
            className={`${styles.chip} ${styles.next} ${slot.target ? styles.target : ''} ${previewed ? styles.previewed : ''}`}
            title={slot.target ? t('sevens.playHere', { card: cardLabel(slot.card) }) : undefined}>
            <span className={styles.chipRank}>{RANK_DISPLAY[slot.card.rank]}</span>
          </span>;
        }
        // An unopened row shows only its 7 slot and the waiting label.
        return row.open && <span key={key} style={position} className={`${styles.chip} ${styles.empty}`}
          aria-hidden="true">{RANK_DISPLAY[slot.card.rank]}</span>;
      })}
      {!row.open && <span className={styles.waiting} aria-hidden="true">{t('sevens.waiting')}</span>}
    </div>
  </div>;
}

function Centre({ game, targets, preview }: {
  game: SevensVisibleState; targets: readonly Card[]; preview: Card | null;
}): ReactNode {
  const rows = sevensRows(game.table, targets, game.options?.closeOnEnd);
  const last = lastPlayedCard(game.log);
  return <div className={styles.centre}>
    {rows.map((row) => <SuitRow key={row.suit} row={row} last={last} preview={preview} />)}
  </div>;
}

function turnText(
  game: SevensVisibleState, mode: SevensHandMode, t: Translate, seatName: (seat: Seat) => string,
): string {
  if (game.phase !== 'playing') return t('game.scoring');
  if (!isOwnTurn(game)) return t('sevens.turnOf', { name: seatName(game.currentTurnSeat) });
  return mode === 'cover' ? t('sevens.mustCoverTurn') : t('sevens.yourTurn');
}

function Info({ game }: { game: SevensVisibleState }): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const mode = sevensHandMode(isOwnTurn(game), game.validCards, game.myHand.length);
  const recent = recentMoves(game.log, RECENT_MOVES);
  const covered = useGodViewStore((state) => state.covered);
  const observedCovered = isSpectator(game) ? covered : null;
  return <aside className={infoStyles.rail}>
    <TurnBox text={turnText(game, mode, t, seatName)}>
      {game.phase === 'playing' && game.log.length === 0 && <p className={infoStyles.note}>{t('sevens.spadeSeven')}</p>}
    </TurnBox>

    <section className={infoStyles.box}>
      <h2 className={infoStyles.caption}>{t('sevens.coveredCards')}</h2>
      <ul className={infoStyles.list}>{SEATS.map((seat) => (
        <li key={seat} className={styles.coveredSeat}>
          <div className={infoStyles.row}>
            <span className={infoStyles.name}>{seatName(seat)}</span>
            <span className={styles.countTag}>{t('sevens.covered', {
              n: String(observedCovered ? observedCovered[seat].length : game.coveredCounts[seat]),
            })}</span>
            {seat === game.mySeat && !isSpectator(game) && <span className={styles.penaltyTag}>
              {t('sevens.myPenalty', { n: String(svPenalty(game.myCovered)) })}
            </span>}
            {observedCovered && <span className={styles.penaltyTag}>
              {t('sevens.observedPenalty', { n: String(svPenalty(observedCovered[seat])) })}
            </span>}
          </div>
          {observedCovered && observedCovered[seat].length > 0 && <ChipList cards={observedCovered[seat]}
            label={`${seatName(seat)} ${t('sevens.coveredCards')}`} />}
        </li>
      ))}</ul>
      {!isSpectator(game) && <p className={infoStyles.note}>{t('sevens.coveredPrivate')}</p>}
    </section>

    <section className={`${infoStyles.box} ${infoStyles.grow}`}>
      <h2 className={infoStyles.caption}>{t('sevens.recent')}</h2>
      {recent.length === 0 ? <p className={infoStyles.note}>{t('sevens.noMoves')}</p>
        : <ol className={infoStyles.list}>{recent.map((entry, index) => (
          // Newest first: the log position is a stable key.
          <li key={game.log.length - index} className={infoStyles.row}>
            <span className={infoStyles.name}>{seatName(entry.seat)}</span>
            {entry.type === 'play' ? <CardChip card={entry.card} className={styles.mini} />
              : <span className={styles.coverTag}>{t('sevens.logCover')}</span>}
          </li>
        ))}</ol>}
    </section>

    <RulesBox title={t('sevens.rules')} lines={[
      t('sevens.rulesOpen'), t('sevens.rulesExtend'), t('sevens.rulesCover'), t('sevens.rulesScore'),
      ...(game.options?.closeOnEnd ? [t('sevens.rulesCloseOnEnd')] : []),
    ]} />
  </aside>;
}

function ResultOverlay({ result, pending, error, disabled, onBack }: {
  result: SevensMatchResult; pending: boolean; error: string; disabled: boolean; onBack: () => void;
}): ReactNode {
  const { locale, t } = useI18nStore();
  const historyGame = useGameStore((state) => state.visible);
  const seatName = useSeatName();
  return <ResultDialog wide title={t('sevens.winner', { name: joinNames(result.winners.map(seatName), locale) })}
    pending={pending} error={error} disabled={disabled} onBack={onBack}>
    <table className={resultStyles.table}>
      <thead><tr>
        <th>{t('sevens.player')}</th><th>{t('sevens.coveredCards')}</th><th>{t('sevens.penalty')}</th>
      </tr></thead>
      <tbody>{SEATS.map((seat) => {
        const winner = result.winners.includes(seat);
        return <tr key={seat} className={winner ? resultStyles.winnerRow : ''}>
          <td className={styles.playerCell}>{winner && <><AppIcon name="trophy" /> </>}{seatName(seat)}</td>
          <td>{result.covered[seat].length > 0 ? <ChipList cards={result.covered[seat]} />
            : <span className={resultStyles.note}>{t('sevens.none')}</span>}</td>
          <td className={styles.penaltyCell}>{result.penalties[seat]}</td>
        </tr>;
      })}</tbody>
    </table>
    {historyGame && <RoundHistory game={historyGame} />}
  </ResultDialog>;
}

export function SevensTable(): ReactNode {
  const { locked } = useGamePresentation();
  const connectionReady = useConnectionReady();
  const game = useGameStore((state) => state.sevens);
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const [preview, setPreview] = useState<Card | null>(null);
  // Tied to the log length so a selection never carries over to a later turn.
  const [coverPick, setCoverPick] = useState<{ card: Card; at: number } | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionPending, setActionPending] = useState(false);
  const actionInFlight = useRef(false);
  const hand = useMemo(() => svSortHand(game?.myHand ?? []), [game?.myHand]);

  if (!game) return null;

  const playing = game.phase === 'playing';
  const isMyTurn = playing && !locked && isOwnTurn(game);
  const canAct = isMyTurn && connectionReady && !actionPending;
  const mode = sevensHandMode(isMyTurn, game.validCards, hand.length);
  const selected = mode === 'cover' && canAct && coverPick?.at === game.log.length
    ? coverSelection(coverPick.card, hand) : null;
  const targets = mode === 'play' ? game.validCards : [];
  const penalty = svPenalty(game.myCovered);

  const handleActionResult: ActionCallback = (timeout, response) => {
    actionInFlight.current = false;
    setActionPending(false);
    if (timeout) setActionError(t('auth.connectionError'));
    else if (!response?.success) setActionError(response?.error ?? t('common.error'));
  };

  const begin = (): boolean => {
    if (!canAct || actionInFlight.current) return false;
    actionInFlight.current = true;
    setActionError('');
    setActionPending(true);
    return true;
  };

  const play = (card: Card): void => {
    if (mode !== 'play' || !game.validCards.some((valid) => sameCard(valid, card)) || !begin()) return;
    setPreview(null);
    socket.timeout(10000).emit('game:sevens:play', { card }, handleActionResult);
  };

  const cover = (card: Card): void => {
    if (mode !== 'cover' || !begin()) return;
    socket.timeout(10000).emit('game:sevens:cover', { card }, (timeout, response) => {
      if (!timeout && response?.success) setCoverPick(null);
      handleActionResult(timeout, response);
    });
  };

  // Covering is irreversible and costs points, so a tap only selects; the button confirms.
  const onCardClick = (card: Card): void => {
    if (mode === 'play') play(card);
    else if (mode === 'cover' && canAct) {
      setCoverPick(selected && sameCard(selected, card) ? null : { card, at: game.log.length });
    }
  };

  const backToRoom = (): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:continue', handleActionResult);
  };

  const cost = selected ? coverCost(selected, game.myCovered) : null;
  const handPrompt = (): string | null => {
    if (!playing) return null;
    if (!isMyTurn) return t('sevens.turnOf', { name: seatName(game.currentTurnSeat) });
    if (mode === 'cover') return cost ? t('sevens.coverTotal', { n: String(cost.total) }) : t('sevens.mustCover');
    return mode === 'play' ? t('sevens.pickCard') : null;
  };
  const prompt = handPrompt();

  const handZone = <div className={styles.handArea}>
    {mode === 'cover'
      ? <CardHand cards={hand} selectedCards={selected ? [selected] : []} disabled={!canAct}
        onCardClick={onCardClick} />
      : <CardHand cards={hand} playableCards={targets} disabled={!canAct}
        onCardClick={onCardClick} onCardPreview={setPreview} />}
    {playing && !isSpectator(game) && <div className={styles.controls}>
      <span className={styles.penaltyTag}>{t('sevens.myPenalty', { n: String(penalty) })}</span>
      {game.myCovered.length > 0 && <ChipList cards={game.myCovered} label={t('sevens.myCovered')} />}
      {prompt && <span className={`${styles.prompt} ${isMyTurn ? styles.promptActive : ''} ${
        mode === 'cover' ? styles.promptCover : ''}`} role={mode === 'cover' ? 'status' : undefined}>{prompt}</span>}
      {selected && cost && <>
        <button type="button" className={`btn btn-danger ${styles.ctrl}`} disabled={!canAct}
          onClick={() => cover(selected)}>
          {t('sevens.coverConfirm', { card: cardLabel(selected), n: String(cost.penalty) })}
        </button>
        <button type="button" className={`btn btn-outline ${styles.ctrl}`}
          onClick={() => setCoverPick(null)}>{t('sevens.cancel')}</button>
      </>}
    </div>}
  </div>;

  return (
    <GameShell
      info={<Info game={game} />}
      centre={<Centre game={game} targets={targets}
        preview={preview && targets.some((card) => sameCard(card, preview)) ? preview : null} />}
      hand={handZone}
      overlay={game.phase === 'scoring' && game.result && <ResultOverlay result={game.result}
        pending={actionPending} error={actionError} disabled={!connectionReady} onBack={backToRoom} />}
      error={game.phase !== 'scoring' ? actionError : undefined}
    />
  );
}
