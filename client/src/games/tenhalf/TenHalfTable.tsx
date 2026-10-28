// ─── TenHalfTable: every seat's hand, betting and play controls, info rail, settlement ───

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { BJ_MIN_BET, bjMaxBet, bjSitsIn } from '@shared/rules/blackjack';
import { TH_ACTIONS } from '@shared/rules/tenhalf';
import type { Card, GameSeat, TenHalfAction, TenHalfLogEntry, TenHalfMatchResult, TenHalfVisibleState } from '@shared/types';
import { DeadlineClock } from '../../components/TurnClock';
import { tablePosition } from '../../game-view';
import type { TablePosition } from '../../game-view';
import { socket } from '../../socket';
import { useGameStore } from '../../stores/game-store';
import { useGodViewStore } from '../../stores/god-view-store';
import { useI18nStore } from '../../stores/i18n-store';
import { AppIcon } from '../../components/AppIcon';
import { GameShell } from '../GameShell';
import { HandActions } from '../HandActions';
import { ChipIcon } from '../ChipIcon';
import { ResultDialog, resultStyles } from '../ResultDialog';
import { useResultRoundHistory } from '../RoundHistory';
import { infoStyles, TurnBox } from '../TableInfo';
import { joinNames, useSeatName } from '../seat-names';
import { isSpectator } from '../observer-view';
import { projectedServerNow } from '../turn-clock';
import { useConnectionReady } from '../use-connection-ready';
import { useGamePresentation } from '../use-game-presentation';
import { useViewedGame } from '../use-table-perspective';
import { betChips, clampBet, rankBlackjack, signedChips, stepBet } from '../blackjack/blackjack-view';
import { ThHand } from './TenHalfCards';
import {
  autoBetSeats, holeOf, recentTenHalfMoves, tenHalfCanAct, tenHalfHandNumber, tenHalfNeedsBet, tenHalfSeatOut, tenHalfView,
} from './tenhalf-view';
import type { TenHalfTableView } from './tenhalf-view';
import styles from './TenHalfTable.module.css';

const RECENT_MOVES = 10;

type ActionCallback = (timeout: Error | null, response?: { success: boolean; error?: string }) => void;
type Observed = Partial<Record<GameSeat, readonly Card[]>> | null;

const toneClass = (value: number): string | undefined => value > 0 ? styles.gain : value < 0 ? styles.loss : undefined;

function SeatHands({ seat, game, view, position, observed, auto }: {
  seat: GameSeat; game: TenHalfVisibleState; view: TenHalfTableView; position: TablePosition; observed: Observed;
  auto: boolean;
}): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const out = tenHalfSeatOut(view, seat);
  const banking = seat === view.banker;
  const dealt = view.dealt.includes(seat);
  const hole = holeOf(view, game, seat, observed);
  const net = dealt ? view.settlement?.net[seat] : undefined;
  const outcome = view.settlement?.outcomes[seat];
  const status = banking && !dealt ? t('tenhalf.bankerTag') : out ? t('tenhalf.sittingOut')
    : view.betting ? game.betPlaced[seat] ? <><AppIcon name="check" /> {t('tenhalf.betPlaced')}</> : t('tenhalf.betting') : '';
  return <section className={`${styles.seatHands} ${styles[position]} ${out ? styles.out : ''}`} aria-label={seatName(seat)}>
    <header className={styles.seatHeader}>
      <span className={styles.seatName}>{seatName(seat)}</span>
      {banking && <span className={`${styles.tag} ${styles.bankerTag}`}>{t('tenhalf.bankerTag')}</span>}
      {net !== undefined && !banking && <strong className={`${styles.net} ${toneClass(net) ?? ''}`}>{signedChips(net)}</strong>}
      {auto && dealt && <span className={styles.auto}>{t('tenhalf.auto')}</span>}
    </header>
    {dealt && <ThHand ups={view.ups[seat]} hole={hole.card} hidden={hole.hidden} size="sm"
      bet={banking ? 0 : view.bets[seat]} done={view.done[seat]} active={view.turn === seat}
      outcome={banking ? null : outcome} net={net}
      label={banking ? t('tenhalf.bankerOf', { name: seatName(seat) }) : undefined} />}
    {status && <span className={styles.pill}>{status}</span>}
  </section>;
}

function Centre({ game, view, observed }: { game: TenHalfVisibleState; view: TenHalfTableView; observed: Observed }): ReactNode {
  const { t } = useI18nStore();
  const auto = autoBetSeats(game.log, view.logEnd);
  // My own hand sits in the hand zone while a hand is played; between hands the zone holds the bet controls.
  const seats = game.seats.filter((seat) => view.betting || seat !== game.mySeat);
  return <div className={[styles.centre, game.seats.some((seat) => seat.startsWith('P')) && styles.expandedCentre].filter(Boolean).join(' ')}>
    {seats.map((seat) => <SeatHands key={seat} seat={seat} game={game} view={view} observed={observed}
      position={tablePosition(seat, game.mySeat, game.seats)} auto={auto.includes(seat)} />)}
    {view.betting && <p className={styles.notice}>
      {t('tenhalf.handOf', { n: String(tenHalfHandNumber(view)), total: String(game.totalHands) })} ·
      {' '}{t(game.betDeadline === null ? 'tenhalf.bettingSoon' : 'tenhalf.placeBet')}
    </p>}
  </div>;
}

function MoveLine({ entry }: { entry: TenHalfLogEntry }): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  if (entry.type === 'deal' || entry.type === 'settle' || entry.type === 'showdown') {
    const label = entry.type === 'deal' ? 'tenhalf.logDeal' : entry.type === 'settle' ? 'tenhalf.logSettle' : 'tenhalf.logShowdown';
    const amounts = entry.type === 'deal' ? entry.bets : entry.type === 'settle' ? entry.net : null;
    const seats = amounts ? (Object.keys(amounts) as GameSeat[]).filter((seat) => entry.type === 'deal'
      ? entry.bets[seat] > 0 : entry.type === 'settle' && (entry.outcomes[seat] !== null || entry.net[seat] !== 0)) : [];
    return <div className={styles.moveBlock}>
      <span className={styles.handLine}>{t(label, { n: String(entry.hand) })}</span>
      {amounts && <span className={styles.moveDetail}>{seats.map((seat) => <span key={seat}>
        {seatName(seat)}{' '}
        <strong className={entry.type === 'settle' ? toneClass(amounts[seat]) : undefined}>
          {entry.type === 'settle' ? signedChips(amounts[seat]) : <><ChipIcon />{amounts[seat]}</>}
        </strong>
      </span>)}</span>}
    </div>;
  }
  const label = entry.type === 'bet' ? 'tenhalf.logBet' : entry.type === 'hit' ? 'tenhalf.logHit' : 'tenhalf.logStand';
  return <>
    <span className={infoStyles.name}>{seatName(entry.seat)}</span>
    <span>{t(label)}</span>
    {entry.type === 'bet' && entry.auto && <span className={styles.tag}>{t('tenhalf.auto')}</span>}
  </>;
}

function Info({ game, view, locked }: { game: TenHalfVisibleState; view: TenHalfTableView; locked: boolean }): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const recent = recentTenHalfMoves(game.log.slice(0, view.logEnd), RECENT_MOVES);
  const me = game.mySeat;
  const watching = isSpectator(game);
  const myTurn = !watching && game.currentTurnSeat === me;
  const text = game.phase === 'scoring' ? t('game.scoring')
    : locked ? t('game.playing')
      : game.phase === 'betting'
        ? watching ? t(game.betDeadline === null ? 'tenhalf.bettingSoon' : 'tenhalf.betting')
          : game.banker === me ? t('tenhalf.bankingNote')
          : !bjSitsIn(game.chips[me]) ? t('tenhalf.sittingOut')
          : game.betDeadline === null ? t('tenhalf.bettingSoon')
            : game.betPlaced[me] || game.myBet !== null ? t('tenhalf.waitingBets') : t('tenhalf.placeBet')
        : game.currentTurnSeat === game.banker
          ? myTurn ? t('tenhalf.yourBankerTurn') : t('tenhalf.bankerTurnOf', { name: seatName(game.currentTurnSeat) })
          : myTurn ? t('tenhalf.yourTurn') : t('tenhalf.turnOf', { name: seatName(game.currentTurnSeat) });
  const hand = tenHalfHandNumber(view);
  return <aside className={infoStyles.rail}>
    <TurnBox text={text}>
      {hand > 0 && <p className={infoStyles.note}>
        {t('tenhalf.handOf', { n: String(hand), total: String(game.totalHands) })}
        {!watching && <> · {t('tenhalf.myChips', { n: String(view.chips[me]) })}</>}
      </p>}
    </TurnBox>

    <section className={infoStyles.box}>
      <h2 className={infoStyles.caption}>{t('tenhalf.players')}</h2>
      <ul className={infoStyles.list}>{game.seats.map((seat) => {
        const out = tenHalfSeatOut(view, seat);
        return <li key={seat} className={infoStyles.row}>
          <span className={infoStyles.name}>{seatName(seat)}</span>
          <strong className={styles.infoChips}><ChipIcon />{view.chips[seat]}</strong>
          {seat === view.currentBanker ? <span className={infoStyles.note}>{t('tenhalf.bankerTag')}</span>
            : out ? <span className={infoStyles.note}>{t('tenhalf.sittingOut')}</span>
            : view.betting && game.betDeadline !== null && <span className={game.betPlaced[seat] ? styles.statusDone : infoStyles.note}>
              {game.betPlaced[seat] ? <><AppIcon name="check" /> {t('tenhalf.betPlaced')}</> : t('tenhalf.betting')}
            </span>}
        </li>;
      })}</ul>
    </section>

    <section className={`${infoStyles.box} ${infoStyles.grow}`}>
      <h2 className={infoStyles.caption}>{t('tenhalf.recent')}</h2>
      {recent.length === 0 ? <p className={infoStyles.note}>{t('tenhalf.noMoves')}</p>
        : <ol className={infoStyles.list}>{recent.map((entry, index) => (
          <li key={`${entry.timestamp}-${entry.type}-${view.logEnd - index}`} className={infoStyles.row}>
            <MoveLine entry={entry} />
          </li>
        ))}</ol>}
    </section>
  </aside>;
}

function ResultOverlay({ result, pending, error, disabled, onBack }: {
  result: TenHalfMatchResult; pending: boolean; error: string; disabled: boolean; onBack: () => void;
}): ReactNode {
  const { t, locale } = useI18nStore();
  const history = useResultRoundHistory(useGameStore((state) => state.visible));
  const seatName = useSeatName();
  return <ResultDialog history={history} title={t('tenhalf.winner', { names: joinNames(result.winners.map(seatName), locale) })}
    pending={pending} error={error} disabled={disabled} onBack={onBack}>
    <table className={`${resultStyles.table} ${styles.rankTable}`}>
      <thead><tr>
        <th>{t('tenhalf.rank')}</th><th>{t('tenhalf.player')}</th>
        <th>{t('tenhalf.chipsColumn')}</th><th>{t('tenhalf.net')}</th>
      </tr></thead>
      <tbody>{rankBlackjack(result).map((row) => (
        <tr key={row.seat} className={row.winner ? resultStyles.winnerRow : ''}>
          <td>{t('tenhalf.place', { n: String(row.place) })}</td>
          <td>{row.winner && <><AppIcon name="trophy" /> </>}{seatName(row.seat)}</td>
          <td>{row.chips}</td>
          <td className={toneClass(row.net)}>{signedChips(row.net)}</td>
        </tr>
      ))}</tbody>
    </table>
    <p className={resultStyles.note}>{t('tenhalf.handsPlayed', { n: String(result.hands) })}</p>
  </ResultDialog>;
}

function BetControls({ game, amount, onAmount, disabled, expired, sent, onBet }: {
  game: TenHalfVisibleState; amount: number; onAmount: (amount: number) => void; disabled: boolean;
  expired: boolean; sent: boolean; onBet: (amount: number) => void;
}): ReactNode {
  const { t } = useI18nStore();
  const chips = game.chips[game.mySeat];
  if (game.banker === game.mySeat) {
    return <p className={styles.prompt}>{t(bjSitsIn(chips) ? 'tenhalf.bankingNote' : 'tenhalf.sitOutBankerNote',
      { n: String(BJ_MIN_BET) })}</p>;
  }
  if (!bjSitsIn(chips)) return <p className={styles.prompt}>{t('tenhalf.sitOutNote', { n: String(BJ_MIN_BET) })}</p>;
  if (game.myBet !== null || game.betPlaced[game.mySeat] || sent) {
    return <p className={`${styles.prompt} ${styles.placed}`} role="status">
      {game.myBet !== null ? <><AppIcon name="check" /> {t('tenhalf.betPlacedNote', { n: String(game.myBet) })}</>
        : t('tenhalf.betPlacedHidden')}
    </p>;
  }
  if (game.betDeadline === null) return <p className={styles.prompt}>{t('tenhalf.bettingSoon')}</p>;
  const value = clampBet(amount, chips);
  const max = bjMaxBet(chips);
  const locked = disabled || expired;
  return <div className={styles.betting}>
    <div className={styles.chipRow} role="group" aria-label={t('tenhalf.betAmount')}>
      {betChips(chips).map((chip) => <button key={chip.amount} type="button"
        className={`${styles.chipButton} ${chip.amount === value ? styles.chipActive : ''}`}
        aria-pressed={chip.amount === value} disabled={locked || !chip.enabled} onClick={() => onAmount(chip.amount)}>
        {chip.amount}
      </button>)}
    </div>
    <div className={styles.controls}>
      <button type="button" className={`btn btn-outline ${styles.stepButton}`} aria-label={t('tenhalf.betMinus')}
        title={t('tenhalf.betMinus')} disabled={locked || value <= BJ_MIN_BET}
        onClick={() => onAmount(stepBet(value, -1, chips))}>−</button>
      <output className={styles.amount} aria-label={t('tenhalf.betAmount')}><ChipIcon />{value}</output>
      <button type="button" className={`btn btn-outline ${styles.stepButton}`} aria-label={t('tenhalf.betPlus')}
        title={t('tenhalf.betPlus')} disabled={locked || value >= max}
        onClick={() => onAmount(stepBet(value, 1, chips))}>+</button>
      {expired && <span className={styles.prompt}>{t('tenhalf.betClosed')}</span>}
    </div>
    <HandActions className={styles.confirm} layout="row">
      <button type="button" className={`btn btn-primary ${styles.ctrl}`} disabled={locked} onClick={() => onBet(value)}>
        {t('tenhalf.confirmBet', { n: String(value) })}
      </button>
      {!expired && <span className={styles.deadline} title={t('tenhalf.timeLeft')}><DeadlineClock deadline={game.betDeadline} /></span>}
    </HandActions>
    <p className={styles.limits}>
      {t('tenhalf.betLimits', { min: String(BJ_MIN_BET), max: String(max), chips: String(chips) })}
    </p>
  </div>;
}

export function TenHalfTable(): ReactNode {
  const { locked, frame } = useGamePresentation();
  const connectionReady = useConnectionReady();
  const game = useViewedGame(useGameStore((state) => state.tenhalf));
  const observed = useGodViewStore((state) => state.hands);
  const clock = useGameStore((state) => state.visible?.clock);
  const receivedAt = useGameStore((state) => state.presentationReceivedAt);
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const [amount, setAmount] = useState(BJ_MIN_BET);
  const [actionError, setActionError] = useState('');
  const [actionPending, setActionPending] = useState(false);
  // An acknowledgement can arrive before the updated state; stay locked until the log grows.
  const [sentAt, setSentAt] = useState<number | null>(null);
  // Close betting at the shared deadline so a late bet is not sent only to be rejected.
  const [expiredDeadline, setExpiredDeadline] = useState<number | null>(null);
  const deadline = game?.phase === 'betting' ? game.betDeadline : null;
  useEffect(() => {
    if (deadline === null) return;
    const now = Date.now();
    const remaining = deadline - (clock ? projectedServerNow(clock, receivedAt, now) : now);
    const timer = setTimeout(() => setExpiredDeadline(deadline), Math.min(2_147_483_647, Math.max(0, remaining)));
    return () => clearTimeout(timer);
  }, [deadline, clock, receivedAt]);

  if (!game) return null;

  const view = tenHalfView(game, frame);
  const expired = deadline !== null && expiredDeadline === deadline;
  const awaiting = sentAt !== null && sentAt === game.log.length;
  const ready = !locked && connectionReady && !actionPending && !awaiting;
  const canAct = tenHalfCanAct(game, ready);
  const watching = isSpectator(game);
  const needsBet = view.betting && tenHalfNeedsBet(game) && !awaiting;
  const me = game.mySeat;
  const dealt = view.dealt.includes(me);
  const hole = holeOf(view, game, me, observed);
  const settlement = view.settlement;
  const myNet = dealt && me !== view.banker ? settlement?.net[me] : undefined;

  const handleActionResult: ActionCallback = (timeout, response) => {
    setActionPending(false);
    if (timeout || !response?.success) setSentAt(null);
    if (timeout) setActionError(t('auth.connectionError'));
    else if (!response?.success) setActionError(response?.error ?? t('common.error'));
  };

  const send = (action: { type: 'bet'; amount: number } | { type: 'act'; action: TenHalfAction }): void => {
    setActionError('');
    setActionPending(true);
    setSentAt(game.log.length);
    socket.timeout(10000).emit('game:action', { gameType: 'tenhalf', action }, handleActionResult);
  };

  const sendBet = (value: number): void => {
    if (!needsBet || expired || !ready) return;
    send({ type: 'bet', amount: value });
  };

  const sendAction = (action: TenHalfAction): void => {
    if (!canAct) return;
    send({ type: 'act', action });
  };

  const backToRoom = (): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:continue', handleActionResult);
  };

  const banking = view.banker === me;
  const prompt = game.phase !== 'playing' || locked ? null
    : game.currentTurnSeat === me ? t(game.banker === me ? 'tenhalf.yourBankerTurn' : 'tenhalf.yourTurn')
      : t(game.currentTurnSeat === game.banker ? 'tenhalf.bankerTurnOf' : 'tenhalf.turnOf', { name: seatName(game.currentTurnSeat) });
  const handZone = <div className={styles.handArea}>
    {view.betting && watching ? <p className={styles.prompt}>{t(game.betDeadline === null
      ? 'tenhalf.bettingSoon' : 'tenhalf.betting')}</p>
    : view.betting ? <BetControls game={game} amount={amount} onAmount={setAmount}
      disabled={!ready} expired={expired} sent={awaiting && !actionPending} onBet={sendBet} />
      // Phone landscape keeps controls beside the hand rather than floating them over the table.
      : <>
        {dealt ? <div className={styles.myHands} role="group" aria-label={t('tenhalf.hand')}>
          <ThHand ups={view.ups[me]} hole={hole.card} hidden={hole.hidden} size="lg" sortable={!watching}
            bet={banking ? 0 : view.bets[me]} done={view.done[me]} active={view.turn === me}
            outcome={banking ? null : settlement?.outcomes[me]} net={myNet}
            label={banking ? t('tenhalf.bankerOf', { name: seatName(me) }) : undefined} />
          {settlement && myNet !== undefined && <strong className={`${styles.myNet} ${toneClass(myNet) ?? ''}`}>
            {signedChips(myNet)}
          </strong>}
          {settlement && banking && <strong className={`${styles.myNet} ${toneClass(settlement.net[me]) ?? ''}`}>
            {signedChips(settlement.net[me])}
          </strong>}
        </div> : game.phase === 'playing' && view.hand > 0 && <p className={styles.prompt}>
          {t(bjSitsIn(view.chips[me]) ? 'tenhalf.notInHand' : 'tenhalf.sittingOut')}
        </p>}
        {game.phase === 'playing' && dealt && !watching && <HandActions className={styles.controls} layout="row">
          {TH_ACTIONS.map((action) => <button key={action} type="button"
            className={`btn ${action === 'hit' ? 'btn-primary' : 'btn-outline'} ${styles.ctrl}`}
            disabled={!canAct} title={t(`tenhalf.hint.${action}`)} onClick={() => sendAction(action)}>
            {t(`tenhalf.action.${action}`)}
          </button>)}
        </HandActions>}
      </>}
  </div>;

  return (
    <GameShell
      info={<Info game={game} view={view} locked={locked} />}
      centre={<Centre game={game} view={view} observed={observed} />}
      hand={handZone}
      prompt={game.phase === 'playing' && dealt ? prompt : null}
      overlay={game.phase === 'scoring' && game.result && <ResultOverlay result={game.result}
        pending={actionPending} error={actionError} disabled={!connectionReady} onBack={backToRoom} />}
      error={game.phase !== 'scoring' ? actionError : undefined}
      turnReady={game.phase === 'betting' ? needsBet && !expired : undefined}
    />
  );
}
