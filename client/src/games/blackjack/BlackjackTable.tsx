// ─── BlackjackTable: dealer, every seat's hands, betting and play controls, info rail, settlement ───

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { BJ_ACTIONS, BJ_HANDS, BJ_MIN_BET, bjMaxBet, bjSitsIn } from '@shared/rules/blackjack';
import type {
  BlackjackAction, BlackjackLogEntry, BlackjackMatchResult, BlackjackVisibleState, Seat,
} from '@shared/types';
import { DeadlineClock } from '../../components/TurnClock';
import { tablePosition } from '../../game-view';
import type { TablePosition } from '../../game-view';
import { socket } from '../../socket';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { GameShell } from '../GameShell';
import { ResultDialog, resultStyles } from '../ResultDialog';
import { RoundHistory } from '../RoundHistory';
import { infoStyles, RulesBox, TurnBox } from '../TableInfo';
import { joinNames, useSeatName } from '../seat-names';
import { projectedServerNow } from '../turn-clock';
import { useConnectionReady } from '../use-connection-ready';
import { useGamePresentation } from '../use-game-presentation';
import { ChipIcon } from '../ChipIcon';
import { BjHand, DealerHand } from './BlackjackCards';
import {
  BJ_SEATS, autoBetSeats, betChips, blackjackActions, blackjackHandNumber, blackjackNeedsBet, blackjackSeatOut,
  blackjackView,
  clampBet, rankBlackjack, recentBlackjackMoves, signedChips, stepBet,
} from './blackjack-view';
import type { BlackjackTableView } from './blackjack-view';
import { AppIcon } from '../../components/AppIcon';
import styles from './BlackjackTable.module.css';
import { isOwnTurn, isSpectator } from '../observer-view';
import { useGodViewStore } from '../../stores/god-view-store';

const RECENT_MOVES = 10;

type ActionCallback = (timeout: Error | null, response?: { success: boolean; error?: string }) => void;

const toneClass = (value: number): string | undefined => value > 0 ? styles.gain : value < 0 ? styles.loss : undefined;

function SeatHands({ seat, view, position, betPlaced, auto }: {
  seat: Seat; view: BlackjackTableView; position: TablePosition; betPlaced: boolean; auto: boolean;
}): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const hands = view.hands[seat];
  const out = blackjackSeatOut(view, seat);
  const net = hands.length > 0 ? view.settlement?.net[seat] : undefined;
  const status = out ? t('blackjack.sittingOut')
    : view.betting ? betPlaced ? <><AppIcon name="check" /> {t('blackjack.betPlaced')}</> : t('blackjack.betting') : '';
  return <section className={`${styles.seatHands} ${styles[position]} ${out ? styles.out : ''}`}
    aria-label={seatName(seat)}>
    <header className={styles.seatHeader}>
      <span className={styles.seatName}>{seatName(seat)}</span>
      {net !== undefined && <strong className={`${styles.net} ${toneClass(net) ?? ''}`}>{signedChips(net)}</strong>}
      {auto && hands.length > 0 && <span className={styles.auto}>{t('blackjack.auto')}</span>}
    </header>
    {hands.length > 0 && <div className={styles.handRow}>
      {hands.map((hand, handIndex) => <BjHand key={handIndex} hand={hand} size="sm"
        outcome={view.settlement?.outcomes[seat][handIndex]}
        active={view.turn?.seat === seat && view.turn.handIndex === handIndex}
        label={hands.length > 1 ? t('blackjack.handIndex', { n: String(handIndex + 1) }) : undefined} />)}
    </div>}
    {status && <span className={styles.pill}>{status}</span>}
  </section>;
}

function Centre({ game, view }: { game: BlackjackVisibleState; view: BlackjackTableView }): ReactNode {
  const { t } = useI18nStore();
  const peek = useGodViewStore((state) => state.hole) ?? undefined;
  const auto = autoBetSeats(game.log, view.logEnd);
  // My own hands sit in the hand zone while a hand is played; between hands the zone holds the bet controls.
  const seats = BJ_SEATS.filter((seat) => view.betting || seat !== game.mySeat);
  return <div className={styles.centre}>
    <div className={styles.dealerArea}>
      <DealerHand cards={view.dealer} holeHidden={view.holeHidden} size="md" peek={peek} />
    </div>
    {seats.map((seat) => <SeatHands key={seat} seat={seat} view={view} position={tablePosition(seat, game.mySeat)}
      betPlaced={game.betPlaced[seat]} auto={auto.includes(seat)} />)}
    {view.betting && <p className={styles.notice}>
      {t('blackjack.handOf', { n: String(blackjackHandNumber(view)), total: String(BJ_HANDS) })} ·
      {' '}{t(game.betDeadline === null ? 'blackjack.bettingSoon' : 'blackjack.placeBet')}
    </p>}
  </div>;
}

function MoveLine({ entry }: { entry: BlackjackLogEntry }): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  if (entry.type === 'deal' || entry.type === 'settle') {
    const amounts = entry.type === 'deal' ? entry.bets : entry.net;
    const seats = BJ_SEATS.filter((seat) => entry.type === 'deal' ? entry.bets[seat] > 0 : entry.outcomes[seat].length > 0);
    return <div className={styles.moveBlock}>
      <span className={styles.handLine}>
        {t(entry.type === 'deal' ? 'blackjack.logDeal' : 'blackjack.logSettle', { n: String(entry.hand) })}
      </span>
      <span className={styles.moveDetail}>{seats.map((seat) => <span key={seat}>
        {seatName(seat)}{' '}
        <strong className={entry.type === 'settle' ? toneClass(amounts[seat]) : undefined}>
          {entry.type === 'settle' ? signedChips(amounts[seat]) : <><ChipIcon />{amounts[seat]}</>}
        </strong>
      </span>)}</span>
    </div>;
  }
  if (entry.type === 'reveal' || entry.type === 'dealerHit') {
    return <>
      <span className={infoStyles.name}>{t('blackjack.dealer')}</span>
      <span>{t(entry.type === 'reveal' ? 'blackjack.logReveal' : 'blackjack.logDealerHit')}</span>
    </>;
  }
  const label = entry.type === 'bet' ? 'blackjack.logBet' : entry.type === 'hit' ? 'blackjack.logHit'
    : entry.type === 'stand' ? 'blackjack.logStand' : entry.type === 'double' ? 'blackjack.logDouble'
      : 'blackjack.logSplit';
  return <>
    <span className={infoStyles.name}>{seatName(entry.seat)}</span>
    <span>{t(label)}</span>
    {entry.type === 'bet' && entry.auto && <span className={styles.tag}>{t('blackjack.auto')}</span>}
  </>;
}

function Info({ game, view, locked }: { game: BlackjackVisibleState; view: BlackjackTableView; locked: boolean }): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const recent = recentBlackjackMoves(game.log.slice(0, view.logEnd), RECENT_MOVES);
  const me = game.mySeat;
  const watching = isSpectator(game);
  const text = game.phase === 'scoring' ? t('game.scoring')
    : locked ? t('game.playing')
      : game.phase === 'betting'
        ? watching ? t(game.betDeadline === null ? 'blackjack.bettingSoon' : 'blackjack.betting')
          : !bjSitsIn(game.chips[me]) ? t('blackjack.sittingOut')
          : game.betDeadline === null ? t('blackjack.bettingSoon')
            : game.betPlaced[me] || game.myBet !== null ? t('blackjack.waitingBets') : t('blackjack.placeBet')
        : isOwnTurn(game) ? t('blackjack.yourTurn')
          : t('blackjack.turnOf', { name: seatName(game.currentTurnSeat) });
  const hand = blackjackHandNumber(view);
  return <aside className={infoStyles.rail}>
    <TurnBox text={text}>
      {hand > 0 && <p className={infoStyles.note}>
        {t('blackjack.handOf', { n: String(hand), total: String(BJ_HANDS) })}
        {!watching && <> · {t('blackjack.myChips', { n: String(view.chips[me]) })}</>}
      </p>}
    </TurnBox>

    <section className={infoStyles.box}>
      <h2 className={infoStyles.caption}>{t('blackjack.players')}</h2>
      <ul className={infoStyles.list}>{BJ_SEATS.map((seat) => {
        const out = blackjackSeatOut(view, seat);
        return <li key={seat} className={infoStyles.row}>
          <span className={infoStyles.name}>{seatName(seat)}</span>
          <strong className={styles.infoChips}><ChipIcon />{view.chips[seat]}</strong>
          {out ? <span className={infoStyles.note}>{t('blackjack.sittingOut')}</span>
            : view.betting && game.betDeadline !== null && <span className={game.betPlaced[seat] ? styles.statusDone : infoStyles.note}>
              {game.betPlaced[seat] ? <><AppIcon name="check" /> {t('blackjack.betPlaced')}</> : t('blackjack.betting')}
            </span>}
        </li>;
      })}</ul>
    </section>

    <section className={`${infoStyles.box} ${infoStyles.grow}`}>
      <h2 className={infoStyles.caption}>{t('blackjack.recent')}</h2>
      {recent.length === 0 ? <p className={infoStyles.note}>{t('blackjack.noMoves')}</p>
        : <ol className={infoStyles.list}>{recent.map((entry, index) => (
          <li key={`${entry.timestamp}-${entry.type}-${view.logEnd - index}`} className={infoStyles.row}>
            <MoveLine entry={entry} />
          </li>
        ))}</ol>}
    </section>

    <RulesBox title={t('blackjack.rules')} lines={[t('blackjack.rulesBet'), t('blackjack.rulesPlay'),
      t('blackjack.rulesDealer'), t('blackjack.rulesPay')]} />
  </aside>;
}

function ResultOverlay({ result, pending, error, disabled, onBack }: {
  result: BlackjackMatchResult; pending: boolean; error: string; disabled: boolean; onBack: () => void;
}): ReactNode {
  const { t, locale } = useI18nStore();
  const historyGame = useGameStore((state) => state.visible);
  const seatName = useSeatName();
  return <ResultDialog title={t('blackjack.winner', { names: joinNames(result.winners.map(seatName), locale) })}
    pending={pending} error={error} disabled={disabled} onBack={onBack}>
    <table className={`${resultStyles.table} ${styles.rankTable}`}>
      <thead><tr>
        <th>{t('blackjack.rank')}</th><th>{t('blackjack.player')}</th>
        <th>{t('blackjack.chipsColumn')}</th><th>{t('blackjack.net')}</th>
      </tr></thead>
      <tbody>{rankBlackjack(result).map((row) => (
        <tr key={row.seat} className={row.winner ? resultStyles.winnerRow : ''}>
          <td>{t('blackjack.place', { n: String(row.place) })}</td>
          <td>{row.winner && <><AppIcon name="trophy" /> </>}{seatName(row.seat)}</td>
          <td>{row.chips}</td>
          <td className={toneClass(row.net)}>{signedChips(row.net)}</td>
        </tr>
      ))}</tbody>
    </table>
    <p className={resultStyles.note}>{t('blackjack.handsPlayed', { n: String(result.hands) })}</p>
    {historyGame && <RoundHistory game={historyGame} />}
  </ResultDialog>;
}

function BetControls({ game, amount, onAmount, disabled, expired, sent, onBet }: {
  game: BlackjackVisibleState; amount: number; onAmount: (amount: number) => void; disabled: boolean;
  expired: boolean; sent: boolean; onBet: (amount: number) => void;
}): ReactNode {
  const { t } = useI18nStore();
  const chips = game.chips[game.mySeat];
  if (!bjSitsIn(chips)) {
    return <p className={styles.prompt}>{t('blackjack.sitOutNote', { n: String(BJ_MIN_BET) })}</p>;
  }
  if (game.myBet !== null || game.betPlaced[game.mySeat] || sent) {
    return <p className={`${styles.prompt} ${styles.placed}`} role="status">
      {game.myBet !== null ? <><AppIcon name="check" /> {t('blackjack.betPlacedNote', { n: String(game.myBet) })}</> : t('blackjack.betPlacedHidden')}
    </p>;
  }
  if (game.betDeadline === null) return <p className={styles.prompt}>{t('blackjack.bettingSoon')}</p>;
  const value = clampBet(amount, chips);
  const max = bjMaxBet(chips);
  const locked = disabled || expired;
  return <div className={styles.betting}>
    <div className={styles.chipRow} role="group" aria-label={t('blackjack.betAmount')}>
      {betChips(chips).map((chip) => <button key={chip.amount} type="button"
        className={`${styles.chipButton} ${chip.amount === value ? styles.chipActive : ''}`}
        aria-pressed={chip.amount === value} disabled={locked || !chip.enabled} onClick={() => onAmount(chip.amount)}>
        {chip.amount}
      </button>)}
    </div>
    <div className={styles.controls}>
      <button type="button" className={`btn btn-outline ${styles.stepButton}`} aria-label={t('blackjack.betMinus')}
        title={t('blackjack.betMinus')} disabled={locked || value <= BJ_MIN_BET}
        onClick={() => onAmount(stepBet(value, -1, chips))}>−</button>
      <output className={styles.amount} aria-label={t('blackjack.betAmount')}><ChipIcon />{value}</output>
      <button type="button" className={`btn btn-outline ${styles.stepButton}`} aria-label={t('blackjack.betPlus')}
        title={t('blackjack.betPlus')} disabled={locked || value >= max}
        onClick={() => onAmount(stepBet(value, 1, chips))}>+</button>
      <button type="button" className={`btn btn-primary ${styles.ctrl}`} disabled={locked} onClick={() => onBet(value)}>
        {t('blackjack.confirmBet', { n: String(value) })}
      </button>
      {expired ? <span className={styles.prompt}>{t('blackjack.betClosed')}</span>
        : <span className={styles.deadline} title={t('blackjack.timeLeft')}><DeadlineClock deadline={game.betDeadline} /></span>}
    </div>
    <p className={styles.limits}>
      {t('blackjack.betLimits', { min: String(BJ_MIN_BET), max: String(max), chips: String(chips) })}
    </p>
  </div>;
}

export function BlackjackTable(): ReactNode {
  const { locked, frame } = useGamePresentation();
  const connectionReady = useConnectionReady();
  const game = useGameStore((state) => state.blackjack);
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

  const view = blackjackView(game, frame);
  const expired = deadline !== null && expiredDeadline === deadline;
  const awaiting = sentAt !== null && sentAt === game.log.length;
  const ready = !locked && connectionReady && !actionPending && !awaiting;
  const legal = blackjackActions(game, ready);
  const isMyTurn = game.phase === 'playing' && !locked && isOwnTurn(game);
  const myHands = view.hands[game.mySeat];
  const settlement = view.settlement;
  const needsBet = view.betting && blackjackNeedsBet(game) && !awaiting;

  const handleActionResult: ActionCallback = (timeout, response) => {
    setActionPending(false);
    if (timeout || !response?.success) setSentAt(null);
    if (timeout) setActionError(t('auth.connectionError'));
    else if (!response?.success) setActionError(response?.error ?? t('common.error'));
  };

  const sendBet = (value: number): void => {
    if (!needsBet || expired || !ready) return;
    setActionError('');
    setActionPending(true);
    setSentAt(game.log.length);
    socket.timeout(10000).emit('game:blackjack:bet', { amount: value }, handleActionResult);
  };

  const sendAction = (action: BlackjackAction): void => {
    if (!legal.includes(action)) return;
    setActionError('');
    setActionPending(true);
    setSentAt(game.log.length);
    socket.timeout(10000).emit('game:blackjack:action', { action }, handleActionResult);
  };

  const backToRoom = (): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:continue', handleActionResult);
  };

  const prompt = game.phase !== 'playing' || locked ? null
    : isMyTurn ? myHands.length > 1
      ? `${t('blackjack.yourTurn')} · ${t('blackjack.handIndex', { n: String(game.activeHand + 1) })}`
      : t('blackjack.yourTurn')
      : t('blackjack.turnOf', { name: seatName(game.currentTurnSeat) });

  const watching = isSpectator(game);
  const handZone = <div className={styles.handArea}>
    {view.betting && watching ? <p className={styles.prompt}>{t(game.betDeadline === null
      ? 'blackjack.bettingSoon' : 'blackjack.betting')}</p>
    : view.betting ? <BetControls game={game} amount={amount} onAmount={setAmount}
      disabled={!ready} expired={expired} sent={awaiting && !actionPending} onBet={sendBet} />
      : <>
        {myHands.length > 0 ? <div className={styles.myHands} role="group" aria-label={t('blackjack.hand')}>
          {myHands.map((hand, handIndex) => <BjHand key={handIndex} hand={hand} size="lg"
            outcome={settlement?.outcomes[game.mySeat][handIndex]}
            active={view.turn?.seat === game.mySeat && view.turn.handIndex === handIndex}
            label={myHands.length > 1 ? t('blackjack.handIndex', { n: String(handIndex + 1) }) : undefined} />)}
          {settlement && <strong className={`${styles.myNet} ${toneClass(settlement.net[game.mySeat]) ?? ''}`}>
            {signedChips(settlement.net[game.mySeat])}
          </strong>}
        </div> : game.phase === 'playing' && view.hand > 0 && <p className={styles.prompt}>
          {t(bjSitsIn(view.chips[game.mySeat]) ? 'blackjack.notInHand' : 'blackjack.sittingOut')}
        </p>}
        {game.phase === 'playing' && myHands.length > 0 && <div className={styles.controls}>
          {prompt && <span className={`${styles.prompt} ${isMyTurn ? styles.promptActive : ''}`}>{prompt}</span>}
          {!watching && BJ_ACTIONS.map((action) => <button key={action} type="button"
            className={`btn ${action === 'hit' ? 'btn-primary' : 'btn-outline'} ${styles.ctrl}`}
            disabled={!legal.includes(action)} title={t(`blackjack.hint.${action}`)}
            onClick={() => sendAction(action)}>
            {t(`blackjack.action.${action}`)}
          </button>)}
        </div>}
      </>}
  </div>;

  return (
    <GameShell
      info={<Info game={game} view={view} locked={locked} />}
      centre={<Centre game={game} view={view} />}
      hand={handZone}
      overlay={game.phase === 'scoring' && game.result && <ResultOverlay result={game.result}
        pending={actionPending} error={actionError} disabled={!connectionReady} onBack={backToRoom} />}
      error={game.phase !== 'scoring' ? actionError : undefined}
      turnReady={game.phase === 'betting' ? needsBet && !expired : undefined}
    />
  );
}
