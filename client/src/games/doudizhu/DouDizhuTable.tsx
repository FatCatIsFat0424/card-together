// ─── DouDizhuTable: auction, bottom cards, last play, multi-select hand, info rail, settlement ───

import { useCallback, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { RANK_DISPLAY, SUIT_SYMBOLS } from '@shared/constants';
import { cardKey, isJoker } from '@shared/rules/cards';
import { ddzIsBomb, ddzResolve } from '@shared/rules/doudizhu';
import type { DouDizhuAction } from '@shared/games/doudizhu/actions';
import type { CardOrJoker, DouDizhuMatchResult, DouDizhuVisibleState } from '@shared/types';
import type { DdzTable } from '@shared/rules/doudizhu-table';
import { useCardOrJokerFaceUrl } from '../../cosmetics/card-faces/use-card-face';
import { CardBackArt } from '../../cosmetics/art-layers/CardBackArt';
import { AppIcon } from '../../components/AppIcon';
import { CardHand } from '../../components/CardHand';
import { socket } from '../../socket';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { GameShell } from '../GameShell';
import { HandActions } from '../HandActions';
import { ResultDialog, resultStyles } from '../ResultDialog';
import { useResultRoundHistory } from '../RoundHistory';
import { infoStyles, TurnBox } from '../TableInfo';
import { isOwnTurn, isSpectator } from '../observer-view';
import { joinNames, useSeatName } from '../seat-names';
import { useConnectionReady } from '../use-connection-ready';
import { useGamePresentation } from '../use-game-presentation';
import { useViewedGame } from '../use-table-perspective';
import {
  auctionPrompt, doudizhuView, selectedIn, settledDeals, shownHand, signed, stakeOf, toggleCard,
} from './doudizhu-view';
import styles from './DouDizhuTable.module.css';

type ActionCallback = (timeout: Error | null, response?: { success: boolean; error?: string }) => void;

function cardName(card: CardOrJoker, jokerName: (joker: 'big' | 'small') => string): string {
  return isJoker(card) ? jokerName(card.joker) : `${RANK_DISPLAY[card.rank]}${SUIT_SYMBOLS[card.suit]}`;
}

function CardFan({ cards, small }: { cards: readonly CardOrJoker[]; small?: boolean }): ReactNode {
  const faceUrl = useCardOrJokerFaceUrl();
  const { t } = useI18nStore();
  const middle = (cards.length - 1) / 2;
  const jokerName = (joker: 'big' | 'small'): string => t(`napoleon.joker.${joker}`);
  return <span className={`${styles.fan} ${small ? styles.fanSmall : ''}`}>
    {cards.map((card, index) => <img key={cardKey(card)} className={styles.fanCard} src={faceUrl(card)} draggable={false}
      alt={cardName(card, jokerName)} style={{ '--fan': index - middle } as CSSProperties} />)}
  </span>;
}

function BottomCards({ cards }: { cards: readonly CardOrJoker[] | null }): ReactNode {
  const { t } = useI18nStore();
  return <div className={styles.bottom} aria-label={t('doudizhu.bottom')}>
    <span className={styles.bottomLabel}>{t('doudizhu.bottom')}</span>
    {cards ? <CardFan cards={cards} small /> : <span className={styles.backs} title={t('doudizhu.bottomHidden')}>
      {[0, 1, 2].map((index) => <span key={index} className={styles.back}><CardBackArt /></span>)}</span>}
  </div>;
}

function Centre({ game, table, myTurn }: { game: DouDizhuVisibleState; table: DdzTable; myTurn: boolean }): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const stake = stakeOf(table);
  const calling = table.phase === 'calling' || table.phase === 'idle';
  const last = table.lastPlay;
  const bomb = last ? ddzIsBomb(last.combo) : false;
  return <div className={styles.centre}>
    <div className={styles.stakeLine}>
      <span>{t('doudizhu.deal', { n: String(Math.max(1, table.deal)), total: String(game.totalDeals) })}</span>
      {table.landlord && <span className={styles.stake} title={t('doudizhu.stakeTitle', {
        base: String(Math.max(1, table.base)), doublings: String(table.grabs + table.bombs) })}>
        {t('doudizhu.base', { n: String(Math.max(1, table.base)) })} {t('doudizhu.multiplier', { n: String(stake) })}
      </span>}
    </div>
    <BottomCards cards={table.landlord ? table.bottom : null} />
    {calling ? <p className={styles.hintText} role="status">
      {table.turn && table.turn !== game.mySeat ? t('doudizhu.bidOf', { name: seatName(table.turn) })
        : myTurn ? t('doudizhu.bidYou') : table.firstCaller ? t('doudizhu.openingBid', { name: seatName(table.firstCaller) }) : ''}
    </p> : last
      ? <div key={`${last.seat}-${last.cards.map(cardKey).join()}`} className={`${styles.lastPlay} ${bomb ? styles.bombPlay : ''}`}>
        <CardFan cards={last.cards} />
        <span className={styles.playMeta}>
          {bomb && <span aria-hidden="true"><AppIcon name="burst" /></span>}
          <strong>{t(`doudizhu.combo.${last.combo.type}`)}</strong>
          <span>{seatName(last.seat)}</span>
        </span>
      </div>
      : table.phase === 'playing' && <span className={styles.freeLead}>{t('doudizhu.freeLead')}</span>}
  </div>;
}

function Info({ game, table }: { game: DouDizhuVisibleState; table: DdzTable }): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const deals = settledDeals(game.log, game.log.length);
  const text = game.phase === 'scoring' ? t('game.scoring')
    : table.turn === null ? '' : table.turn === game.mySeat && game.observer !== 'spectator'
      ? t('doudizhu.yourTurn') : t('doudizhu.turnOf', { name: seatName(table.turn) });
  return <aside className={infoStyles.rail}>
    <TurnBox text={text}>
      {table.landlord && <p className={infoStyles.note}>{t('doudizhu.landlord')}: {seatName(table.landlord)} · {t('doudizhu.base', {
        n: String(Math.max(1, table.base)) })} {t('doudizhu.multiplier', { n: String(stakeOf(table)) })}
      {table.bombs > 0 && <> · {t('doudizhu.bombs', { n: String(table.bombs) })}</>}</p>}
    </TurnBox>
    <section className={`${infoStyles.box} ${infoStyles.grow}`}>
      <h2 className={infoStyles.caption}>{t('doudizhu.scores')}</h2>
      <ol className={infoStyles.list}>{game.seats.map((seat) => <li key={seat} className={infoStyles.row}>
        <span className={infoStyles.name}>{seatName(seat)}</span>
        <strong className={table.totals[seat] > 0 ? styles.gain : table.totals[seat] < 0 ? styles.loss : undefined}>
          {signed(table.totals[seat])}</strong>
      </li>)}</ol>
      {deals.length > 0 && <ol className={`${infoStyles.list} ${styles.dealList}`}>{deals.map((line) => <li key={line.deal}
        className={infoStyles.row}>
        <span className={infoStyles.note}>{t('doudizhu.dealResult', { n: String(line.deal),
          result: t(line.landlordWins ? 'doudizhu.landlordWins' : 'doudizhu.farmersWin') })}</span>
        <span className={infoStyles.note}>{t('doudizhu.multiplier', { n: String(line.multiplier) })}</span>
      </li>)}</ol>}
    </section>
  </aside>;
}

function ResultOverlay({ result, game, pending, error, disabled, onBack }: {
  result: DouDizhuMatchResult; game: DouDizhuVisibleState; pending: boolean; error: string; disabled: boolean;
  onBack: () => void;
}): ReactNode {
  const { t, locale } = useI18nStore();
  const seatName = useSeatName();
  const history = useResultRoundHistory(useGameStore((state) => state.visible));
  const deals = settledDeals(game.log);
  const names = joinNames(result.winners.map(seatName), locale);
  return <ResultDialog history={history} wide
    title={t(result.winners.length === 1 ? 'doudizhu.winner' : 'doudizhu.winners', { name: names, names })}
    pending={pending} error={error} disabled={disabled} onBack={onBack}>
    <table className={resultStyles.table}>
      <thead><tr>
        <th scope="col">{t('doudizhu.player')}</th>
        {deals.map((line) => <th key={line.deal} scope="col">{line.deal}</th>)}
        <th scope="col">{t('doudizhu.total')}</th>
      </tr></thead>
      <tbody>{result.seats.map((seat) => <tr key={seat} className={result.winners.includes(seat) ? resultStyles.winnerRow : ''}>
        <td>{result.winners.includes(seat) && <><AppIcon name="trophy" /> </>}{seatName(seat)}</td>
        {deals.map((line) => <td key={line.deal} className={seat === line.landlord ? styles.landlordCell : undefined}
          title={seat === line.landlord ? t('doudizhu.landlord') : undefined}>{signed(line.scores[seat])}</td>)}
        <td><strong>{signed(result.scores[seat])}</strong></td>
      </tr>)}</tbody>
    </table>
  </ResultDialog>;
}

export function DouDizhuTable(): ReactNode {
  const { locked, frame } = useGamePresentation();
  const connectionReady = useConnectionReady();
  const game = useViewedGame(useGameStore((state) => state.doudizhu));
  const { t } = useI18nStore();
  const [selection, setSelection] = useState<CardOrJoker[]>([]);
  const [actionError, setActionError] = useState('');
  const [actionPending, setActionPending] = useState(false);
  const actionInFlight = useRef(false);

  const table = useMemo(() => game ? doudizhuView(game, frame) : null, [game, frame]);
  const hand = useMemo(() => game && table ? shownHand(game, table) : [], [game, table]);
  const selected = selectedIn(hand, selection);

  const handleActionResult = useCallback<ActionCallback>((timeout, response) => {
    actionInFlight.current = false;
    setActionPending(false);
    if (timeout) setActionError(t('auth.connectionError'));
    else if (!response?.success) setActionError(response?.error ?? t('common.error'));
  }, [t]);

  const send = (action: DouDizhuAction, onDone?: () => void): void => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:action', { gameType: 'doudizhu', action }, (timeout, response) => {
      if (!timeout && response?.success) onDone?.();
      handleActionResult(timeout, response);
    });
  };

  const backToRoom = (): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:continue', handleActionResult);
  };

  if (!game || !table) return null;

  const watching = isSpectator(game);
  const live = !locked && table.deal === game.deal;
  const playing = game.phase === 'playing';
  const myTurn = live && !watching && isOwnTurn(game);
  const prompt = live && !watching ? auctionPrompt(game, table) : null;
  const previous = table.lastPlay?.combo ?? null;
  const resolved = selected.length > 0 ? ddzResolve(selected, previous) : null;
  const canPlay = myTurn && playing && resolved !== null;
  const busy = actionPending || !connectionReady;

  const auctionButtons = prompt && <HandActions className={styles.controls} layout="grid">
    {prompt.mode === 'score' ? <>
      <button type="button" className={`btn btn-outline ${styles.ctrl}`} disabled={busy}
        onClick={() => send({ type: 'bid', score: 0 })}>{t('doudizhu.bidPassButton')}</button>
      {([1, 2, 3] as const).map((score) => <button key={score} type="button" className={`btn btn-primary ${styles.ctrl}`}
        disabled={busy || score < prompt.minScore} onClick={() => send({ type: 'bid', score })}>
        {t('doudizhu.bidButton', { n: String(score) })}</button>)}
    </> : <>
      <button type="button" className={`btn btn-outline ${styles.ctrl}`} disabled={busy}
        onClick={() => send({ type: 'claim', take: false })}>
        {t(prompt.mode === 'call' ? 'doudizhu.noCallButton' : 'doudizhu.noGrabButton')}</button>
      <button type="button" className={`btn btn-primary ${styles.ctrl}`} disabled={busy}
        onClick={() => send({ type: 'claim', take: true })}>
        {t(prompt.mode === 'call' ? 'doudizhu.callButton' : 'doudizhu.grabButton')}</button>
    </>}
  </HandActions>;

  const playButtons = playing && !watching && <HandActions className={styles.controls} layout="grid">
    <button type="button" className={`btn btn-outline ${styles.ctrl}`} onClick={() => setSelection([])}
      disabled={selected.length === 0}>{t('doudizhu.clear')}</button>
    <button type="button" className={`btn btn-outline ${styles.ctrl}`} disabled={!myTurn || busy || previous === null}
      onClick={() => send({ type: 'pass' }, () => setSelection([]))}>{t('doudizhu.pass')}</button>
    <button type="button" className={`btn btn-primary ${styles.ctrl}`} disabled={!canPlay || busy}
      onClick={() => send({ type: 'play', cards: selected }, () => setSelection([]))}>
      {t('doudizhu.play')}
      {selected.length > 0 && <span className={styles.comboName}>
        {resolved ? t(`doudizhu.combo.${resolved.type}`) : t('doudizhu.invalid')}</span>}
    </button>
  </HandActions>;

  const handZone = <div className={styles.handArea}>
    <CardHand cards={hand} selectedCards={selected} disabled={!playing || !live || actionPending || watching}
      onCardClick={(card) => setSelection(toggleCard(selected, card))} />
    {auctionButtons || playButtons}
  </div>;

  return <GameShell
    turnReady={myTurn}
    info={<Info game={game} table={table} />}
    centre={<Centre game={game} table={table} myTurn={myTurn} />}
    hand={handZone}
    overlay={game.phase === 'scoring' && game.result && <ResultOverlay result={game.result} game={game}
      pending={actionPending} error={actionError} disabled={!connectionReady} onBack={backToRoom} />}
    error={game.phase !== 'scoring' ? actionError : undefined}
  />;
}
